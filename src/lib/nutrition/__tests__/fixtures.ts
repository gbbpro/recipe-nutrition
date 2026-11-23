import type { FdcClient, FdcDataType, FdcFood, FdcSearchFood } from "../types";

// Hand-built fixtures in the shape of USDA FoodData Central responses.
// Nutrient values are close to the real SR Legacy entries but are test data — the
// fdcIds here are placeholders, not real USDA ids.

const n = (id: number, amount: number, unitName = "g") => ({ nutrient: { id, unitName }, amount });

export const FLOUR: FdcFood = {
  fdcId: 1001,
  description: "Wheat flour, white, all-purpose, enriched, bleached",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 364, "kcal"), n(1003, 10.33), n(1004, 0.98), n(1005, 76.31), n(1079, 2.7), n(2000, 0.27), n(1093, 2, "mg")],
  foodPortions: [
    { amount: 1, modifier: "cup", gramWeight: 125, measureUnit: { name: "undetermined" } },
    { amount: 1, modifier: "tbsp", gramWeight: 7.8, measureUnit: { name: "undetermined" } },
  ],
};

export const BUTTER: FdcFood = {
  fdcId: 1002,
  description: "Butter, salted",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 717, "kcal"), n(1003, 0.85), n(1004, 81.11), n(1005, 0.06), n(1079, 0), n(2000, 0.06), n(1093, 643, "mg")],
  foodPortions: [
    { amount: 1, modifier: "cup", gramWeight: 227 },
    { amount: 1, modifier: "tbsp", gramWeight: 14.2 },
    { amount: 1, modifier: "stick", gramWeight: 113 },
    { amount: 1, modifier: "pat (1\" sq, 1/3\" high)", gramWeight: 5 },
  ],
};

export const EGG: FdcFood = {
  fdcId: 1003,
  description: "Egg, whole, raw, fresh",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 143, "kcal"), n(1003, 12.56), n(1004, 9.51), n(1005, 0.72), n(1079, 0), n(2000, 0.37), n(1093, 142, "mg")],
  foodPortions: [
    { amount: 1, modifier: "large", gramWeight: 50 },
    { amount: 1, modifier: "medium", gramWeight: 44 },
    { amount: 1, modifier: "extra large", gramWeight: 56 },
    { amount: 1, modifier: "cup (4.86 large eggs)", gramWeight: 243 },
  ],
};

/** Foundation-style food: no 1008 energy, uses Atwater 2047; portions via measureUnit. */
export const SUGAR_FOUNDATION: FdcFood = {
  fdcId: 1004,
  description: "Sugars, granulated",
  dataType: "Foundation",
  foodNutrients: [n(2047, 385, "kcal"), n(1062, 1611, "kJ"), n(1003, 0), n(1004, 0.32), n(1050, 99.6)],
  foodPortions: [{ amount: 1, measureUnit: { name: "cup", abbreviation: "cup" }, modifier: "", gramWeight: 200 }],
};

export const SALT: FdcFood = {
  fdcId: 1005,
  description: "Salt, table",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 0, "kcal"), n(1093, 38758, "mg")],
  foodPortions: [{ amount: 1, modifier: "tsp", gramWeight: 6 }],
};

export const TOMATOES_CANNED: FdcFood = {
  fdcId: 1006,
  description: "Tomatoes, red, ripe, canned, packed in tomato juice",
  dataType: "SR Legacy",
  foodNutrients: [n(1008, 16, "kcal"), n(1003, 0.79), n(1004, 0.28), n(1005, 3.47)],
  foodPortions: [{ amount: 1, modifier: "cup", gramWeight: 240 }],
};

/** Branded entry that searches for "butter" would otherwise surface. */
export const BRANDED_BUTTER_SNACK: FdcSearchFood = {
  fdcId: 9001,
  description: "BUTTER CRACKERS",
  dataType: "Branded",
  brandOwner: "Snack Co",
};

export const asSearch = ({ fdcId, description, dataType }: FdcFood): FdcSearchFood => ({ fdcId, description, dataType });

export const FOODS = [FLOUR, BUTTER, EGG, SUGAR_FOUNDATION, SALT, TOMATOES_CANNED];

/** Fake client: search does naive token matching over the fixtures. */
export function fakeClient(): FdcClient & { calls: { search: number; getFood: number } } {
  const calls = { search: 0, getFood: 0 };
  const all: FdcSearchFood[] = [...FOODS.map(asSearch), BRANDED_BUTTER_SNACK];
  return {
    calls,
    async search(query: string, dataTypes: FdcDataType[]) {
      calls.search++;
      const words = query.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
      return all.filter(
        (f) =>
          dataTypes.includes(f.dataType as FdcDataType) &&
          words.some((w) => f.description.toLowerCase().includes(w.replace(/s$/, ""))),
      );
    },
    async getFood(fdcId: number) {
      calls.getFood++;
      const f = FOODS.find((x) => x.fdcId === fdcId);
      if (!f) throw new Error("404 Not Found");
      return f;
    },
  };
}
