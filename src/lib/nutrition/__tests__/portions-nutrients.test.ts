import { describe, expect, it } from "vitest";
import { cleanIngredientName, planSearch, rankCandidates } from "../match";
import { per100g, scaleNutrients, sumNutrients } from "../nutrients";
import { parseLine } from "../parse";
import { normalizePortion, resolveGrams } from "../portions";
import { BRANDED_BUTTER_SNACK, asSearch, BUTTER, EGG, FLOUR, SALT, SUGAR_FOUNDATION, TOMATOES_CANNED } from "./fixtures";

const grams = (line: string, food = FLOUR) => resolveGrams(parseLine(line, 0), food);

describe("normalizePortion", () => {
  it("reads SR Legacy modifiers", () => {
    expect(normalizePortion({ amount: 1, modifier: "cup", gramWeight: 125, measureUnit: { name: "undetermined" } }))
      .toMatchObject({ unit: "cup", amount: 1 });
    expect(normalizePortion({ amount: 1, modifier: "tbsp", gramWeight: 7.8 })).toMatchObject({ unit: "tablespoon" });
    expect(normalizePortion({ amount: 1, modifier: "large", gramWeight: 50 })).toMatchObject({ size: "large", unit: null });
  });
  it("reads Foundation measureUnit", () => {
    expect(normalizePortion(SUGAR_FOUNDATION.foodPortions![0])).toMatchObject({ unit: "cup" });
  });
  it("reads FNDDS portionDescription", () => {
    expect(normalizePortion({ portionDescription: "2 tablespoons", gramWeight: 30 })).toMatchObject({ unit: "tablespoon", amount: 2 });
  });
});

describe("resolveGrams", () => {
  it("converts mass directly", () => {
    expect(grams("8 oz flour")!.grams).toBeCloseTo(226.8, 1);
    expect(grams("500 g flour")!.method).toBe("mass");
  });

  it("uses the USDA cup portion for volume", () => {
    const r = grams("1 1/2 cups all-purpose flour, sifted")!;
    expect(r.grams).toBeCloseTo(187.5);
    expect(r.method).toBe("portion");
    expect(r.estimated).toBe(false);
  });

  it("derives density from another volume portion", () => {
    // 1 tsp via the cup portion: 125 g / 236.588 ml × 4.929 ml
    expect(grams("1 tsp flour")!.grams).toBeCloseTo(2.6, 1);
  });

  it("falls back to a density table and flags it as estimated", () => {
    const noPortions = { ...FLOUR, foodPortions: [] };
    const r = grams("1 cup flour", noPortions)!;
    expect(r.estimated).toBe(true);
    expect(r.grams).toBeCloseTo(125.4, 0);
  });

  it("matches size words to egg portions", () => {
    expect(grams("2 large eggs", EGG)!.grams).toBe(100);
    expect(grams("1 extra-large egg", EGG)!.grams).toBe(56);
    expect(grams("3 eggs", EGG)!.grams).toBe(132); // no size → medium
  });

  it("matches count units to portions", () => {
    expect(grams("1 stick butter", BUTTER)!.grams).toBe(113);
    expect(grams("2 tbsp butter, melted", BUTTER)!.grams).toBeCloseTo(28.4);
  });

  it("uses a stated package size", () => {
    const r = grams("1 (14 oz) can diced tomatoes", TOMATOES_CANNED)!;
    expect(r.method).toBe("package");
    expect(r.grams).toBeCloseTo(396.9, 1);
  });

  it("assumes a 15 oz can when no size is given", () => {
    const r = grams("2 cans diced tomatoes", TOMATOES_CANNED)!;
    expect(r.estimated).toBe(true);
    expect(r.grams).toBe(850);
  });

  it("returns null when there's no quantity", () => {
    expect(grams("flour")).toBeNull();
  });
});

describe("nutrients", () => {
  it("reads per-100g values and scales them", () => {
    const n = scaleNutrients(per100g(FLOUR), 125);
    expect(n.calories).toBeCloseTo(455);
    expect(n.protein).toBeCloseTo(12.91, 1);
  });

  it("falls back to Atwater energy and summed carbs for Foundation foods", () => {
    const n = per100g(SUGAR_FOUNDATION);
    expect(n.calories).toBe(385); // 2047, not the kJ entry
    expect(n.carbs).toBe(99.6); // 1050 fallback
  });

  it("treats missing nutrients as unknown, not zero", () => {
    const n = per100g(SALT);
    expect(n.fiber).toBeNull();
    const totals = sumNutrients([scaleNutrients(per100g(FLOUR), 100), scaleNutrients(n, 6)]);
    expect(totals.fiber).toEqual({ value: 2.7, incomplete: true });
    expect(totals.sodium.incomplete).toBe(false);
  });
});

describe("matching", () => {
  it("cleans names for search", () => {
    expect(cleanIngredientName("Freshly grated Parmesan cheese")).toBe("parmesan cheese");
    expect(cleanIngredientName("eggs")).toBe("egg");
    expect(cleanIngredientName("tomatoes")).toBe("tomato");
    expect(cleanIngredientName("cherries")).toBe("cherry");
  });

  it("uses the alias table for common ingredients", () => {
    expect(planSearch(parseLine("1 cup butter", 0)).query).toBe("Butter, salted");
  });

  it("keeps nutrition-relevant notes in the query", () => {
    expect(planSearch(parseLine("1 cup quinoa, cooked", 0)).query).toBe("quinoa cooked");
  });

  it("ranks the exact alias match above branded noise", () => {
    const line = parseLine("2 tbsp butter", 0);
    const ranked = rankCandidates([BRANDED_BUTTER_SNACK, asSearch(BUTTER)], planSearch(line), line);
    expect(ranked[0].food.fdcId).toBe(BUTTER.fdcId);
  });
});
