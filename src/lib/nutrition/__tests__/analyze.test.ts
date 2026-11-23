import { describe, expect, it } from "vitest";
import { analyzeRecipe } from "../analyze";
import { fakeClient } from "./fixtures";

const RECIPE = `Serves 4
2 cups all-purpose flour
1 stick butter, softened
2 large eggs
3/4 cup sugar
salt to taste
1 cup quinoa`;

describe("analyzeRecipe", () => {
  it("runs the full pipeline", async () => {
    const client = fakeClient();
    const r = await analyzeRecipe(RECIPE, { client });

    expect(r.servings).toBe(4);
    const statuses = r.lines.map((l) => [l.line.name, l.status]);
    expect(statuses).toEqual([
      ["all-purpose flour", "matched"],
      ["butter", "matched"],
      ["eggs", "matched"],
      ["sugar", "matched"],
      ["salt", "excluded"],
      ["quinoa", "needs_review"], // not in fixtures
    ]);

    // flour 250 g (910) + butter 113 g (810.2) + eggs 100 g (143) + sugar 150 g (577.5)
    expect(r.totals.calories.value).toBeCloseTo(910 + 810.21 + 143 + 577.5, 0);
    expect(r.perServing.calories.value).toBeCloseTo(r.totals.calories.value / 4);
    expect(r.uncountedLines).toBe(1);
  });

  it("respects a servings override and user-picked foods", async () => {
    const client = fakeClient();
    const r = await analyzeRecipe("1 cup mystery powder", { client, servings: 2, overrides: { 0: 1001 } });
    expect(r.servings).toBe(2);
    expect(r.lines[0].match?.fdcId).toBe(1001);
    expect(r.lines[0].grams?.grams).toBe(125);
    expect(r.lines[0].status).toBe("matched");
  });

  it("flags lines without a quantity for review", async () => {
    const r = await analyzeRecipe("Eggs", { client: fakeClient() });
    expect(r.lines[0].status).toBe("needs_review");
    expect(r.lines[0].message).toMatch(/quantity/i);
  });
});
