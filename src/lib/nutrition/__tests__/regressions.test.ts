import { describe, expect, it } from "vitest";
import { analyzeRecipe } from "../analyze";
import { planSearch } from "../match";
import { totalsForLines } from "../nutrients";
import { parseLine, parseRecipe } from "../parse";
import { resolveGrams } from "../portions";
import type { FdcFood } from "../types";
import { fakeClient } from "./fixtures";
import { COOKIES, PAPRIKASH } from "./paprikash.fixture";

const n = (id: number, amount: number) => ({ nutrient: { id }, amount });

// SR Legacy-style portions, including the "slice" / "chopped" entries that used to win for "1 onion".
const ONION: FdcFood = {
  fdcId: 2001,
  description: "Onions, raw",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 40)],
  foodPortions: [
    { amount: 1, modifier: "cup, chopped", gramWeight: 160 },
    { amount: 1, modifier: "tbsp chopped", gramWeight: 10 },
    { amount: 1, modifier: "slice, medium (1/8\" thick)", gramWeight: 14 },
    { amount: 1, modifier: "medium (2-1/2\" dia)", gramWeight: 110 },
    { amount: 1, modifier: "large", gramWeight: 150 },
    { amount: 1, modifier: "small", gramWeight: 70 },
  ],
};

const GARLIC: FdcFood = {
  fdcId: 2002,
  description: "Garlic, raw",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 149)],
  foodPortions: [
    { amount: 1, modifier: "cup", gramWeight: 136 },
    { amount: 1, modifier: "tsp", gramWeight: 2.8 },
    { amount: 1, modifier: "clove", gramWeight: 3 },
  ],
};

/** Bacon entry with no slice portion — the case that left bacon unconverted. */
const BACON_NO_SLICE: FdcFood = {
  fdcId: 2003,
  description: "Pork, cured, bacon, unprepared",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 417)],
  foodPortions: [{ amount: 1, modifier: "oz", gramWeight: 28.35 }],
};

describe("paprikash recipe (pasted with title and instructions)", () => {
  const r = parseRecipe(PAPRIKASH);
  const byName = (name: string) => r.lines.find((l) => l.name === name)!;

  it("reads servings from a lowercase 'serves 4'", () => {
    expect(r.servings).toBe(4);
  });

  it("skips the title line instead of reading '30' as a quantity", () => {
    expect(r.lines[0].kind).toBe("excluded");
    expect(r.lines[0].excludedReason).toBe("looks like a title");
  });

  it("keeps 'boneless, skinless' in the name", () => {
    const l = r.lines[1];
    expect(l.name).toBe("boneless skinless chicken thighs");
    expect(l.notes).toEqual([]);
    expect(planSearch(l).query).toBe("Chicken, broilers or fryers, thigh, meat only, raw");
  });

  it("skips salt and pepper with no amount", () => {
    const l = r.lines[2];
    expect(l.kind).toBe("excluded");
    expect(l.excludedReason).toBe("seasoning, no amount");
  });

  it("reads a unit that follows the name: '4 garlic cloves'", () => {
    const l = byName("garlic");
    expect(l.quantity).toBe(4);
    expect(l.unit).toBe("clove");
  });

  it("matches diced tomatoes in a can to the canned entry", () => {
    const l = byName("diced tomatoes");
    expect(l.packageSize).toEqual({ quantity: 14.5, unit: "ounce", unitKind: "mass" });
    expect(planSearch(l).query).toBe("Tomatoes, red, ripe, canned, packed in tomato juice");
  });

  it("stops at Instructions so method text isn't parsed", () => {
    const last = r.lines[r.lines.length - 1];
    expect(last.kind).toBe("header");
    expect(last.name).toMatch(/^Instructions/);
    expect(r.lines).toHaveLength(16);
    expect(r.lines.some((l) => /pat the chicken/i.test(l.raw))).toBe(false);
  });

  it("handles stray spaces before commas", () => {
    expect(byName("bacon").notes).toEqual(["minced"]);
    expect(byName("fresh parsley").notes).toEqual(["minced"]);
    expect(planSearch(byName("fresh parsley")).query).toBe("Parsley, fresh");
  });
});

describe("cookie recipe (unchanged behavior)", () => {
  const r = parseRecipe(COOKIES);

  it("parses every line the same as before", () => {
    expect(r.servings).toBe(8);
    expect(r.lines.map((l) => l.kind)).toEqual([
      "header",
      ...Array(10).fill("ingredient"),
      "excluded",
    ]);
    expect(r.lines[7]).toMatchObject({ quantity: 2, size: "large", name: "eggs" });
    expect(r.lines[11].excludedReason).toBe("for topping");
  });

  it("does not treat the first ingredient as a title", () => {
    expect(parseRecipe("2 Cups Flour\n1 cup sugar").lines[0].kind).toBe("ingredient");
    expect(parseRecipe("2 large eggs").lines[0].kind).toBe("ingredient");
  });
});

describe("section words", () => {
  it("treats 'Ingredients' as a header and keeps going", () => {
    const r = parseRecipe("Ingredients\n2 cups flour\nDirections:\nMix 2 cups of it.");
    expect(r.lines.map((l) => l.kind)).toEqual(["header", "ingredient", "header"]);
  });
});

describe("gram conversion fixes", () => {
  const g = (line: string, food: FdcFood) => resolveGrams(parseLine(line, 0), food)!;

  it("uses a whole medium onion, not a slice", () => {
    expect(g("1 onion , minced", ONION).grams).toBe(110);
    expect(g("1 large onion", ONION).grams).toBe(150);
    expect(g("2 slices onion", ONION).grams).toBe(28);
  });

  it("uses USDA's clove weight for '4 garlic cloves'", () => {
    const r = g("4 garlic cloves , minced", GARLIC);
    expect(r.grams).toBe(12);
    expect(r.estimated).toBe(false);
  });

  it("falls back to typical bacon slice weights, raw vs cooked", () => {
    expect(g("1 slice bacon , minced", BACON_NO_SLICE)).toMatchObject({ grams: 28, estimated: true });
    expect(g("3 slices bacon, cooked and crumbled", BACON_NO_SLICE).grams).toBe(24);
  });

  it("looks up cooked bacon separately", () => {
    expect(planSearch(parseLine("1 slice bacon", 0)).query).toBe("Pork, cured, bacon, unprepared");
    expect(planSearch(parseLine("2 slices bacon, cooked", 0)).query).toBe("Pork, cured, bacon, cooked");
  });
});

describe("removing lines", () => {
  it("recomputes totals without the removed lines", async () => {
    const result = await analyzeRecipe("2 cups all-purpose flour\n1 stick butter\nEggs", { client: fakeClient() });
    expect(result.uncountedLines).toBe(1);

    const flourOnly = totalsForLines(result.lines, result.servings, new Set([1, 2]));
    expect(flourOnly.totals.calories.value).toBeCloseTo(910); // 250 g × 3.64
    expect(flourOnly.uncountedLines).toBe(0); // removing "Eggs" clears the review warning
  });
});
