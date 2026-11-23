import type { FdcFood, NutrientKey, NutrientTotals, NutrientValues } from "./types";

/**
 * USDA nutrient ids, in priority order. Foundation foods often lack the SR Legacy id,
 * so each nutrient falls back through alternates.
 *   Energy: 1008 (kcal) → 2048 (Atwater specific) → 2047 (Atwater general)
 */
export const NUTRIENT_IDS: Record<NutrientKey, number[]> = {
  calories: [1008, 2048, 2047],
  protein: [1003],
  fat: [1004, 1085],
  saturatedFat: [1258],
  carbs: [1005, 1050],
  fiber: [1079],
  sugars: [2000, 1063],
  sodium: [1093],
  cholesterol: [1253],
  potassium: [1092],
  calcium: [1087],
  iron: [1089],
};

export const NUTRIENT_META: Record<NutrientKey, { label: string; unit: string }> = {
  calories: { label: "Calories", unit: "kcal" },
  protein: { label: "Protein", unit: "g" },
  fat: { label: "Total fat", unit: "g" },
  saturatedFat: { label: "Saturated fat", unit: "g" },
  carbs: { label: "Carbohydrates", unit: "g" },
  fiber: { label: "Fiber", unit: "g" },
  sugars: { label: "Sugars", unit: "g" },
  sodium: { label: "Sodium", unit: "mg" },
  cholesterol: { label: "Cholesterol", unit: "mg" },
  potassium: { label: "Potassium", unit: "mg" },
  calcium: { label: "Calcium", unit: "mg" },
  iron: { label: "Iron", unit: "mg" },
};

export const NUTRIENT_KEYS = Object.keys(NUTRIENT_IDS) as NutrientKey[];

/**
 * Nutrient values per 100 g of the food. For SR Legacy, Foundation, FNDDS *and* Branded,
 * `foodNutrients[].amount` from the detail endpoint is per 100 g (Branded `labelNutrients`
 * are per serving, which we don't use). Missing nutrients are null, not 0.
 */
export function per100g(food: FdcFood): NutrientValues {
  const byId = new Map<number, number>();
  for (const fn of food.foodNutrients ?? []) {
    const id = fn.nutrient?.id;
    if (id === undefined || fn.amount === undefined || fn.amount === null) continue;
    // Skip kJ energy entries that share a name with kcal ones.
    if (fn.nutrient.unitName && /kj/i.test(fn.nutrient.unitName)) continue;
    if (!byId.has(id)) byId.set(id, fn.amount);
  }
  const out = {} as NutrientValues;
  for (const key of NUTRIENT_KEYS) {
    const id = NUTRIENT_IDS[key].find((i) => byId.has(i));
    out[key] = id === undefined ? null : byId.get(id)!;
  }
  return out;
}

export function scaleNutrients(base: NutrientValues, grams: number): NutrientValues {
  const out = {} as NutrientValues;
  for (const key of NUTRIENT_KEYS) {
    const v = base[key];
    out[key] = v === null ? null : (v * grams) / 100;
  }
  return out;
}

export function emptyTotals(): NutrientTotals {
  const out = {} as NutrientTotals;
  for (const key of NUTRIENT_KEYS) out[key] = { value: 0, incomplete: false };
  return out;
}

export function sumNutrients(items: NutrientValues[]): NutrientTotals {
  const totals = emptyTotals();
  for (const item of items) {
    for (const key of NUTRIENT_KEYS) {
      const v = item[key];
      if (v === null) totals[key].incomplete = true;
      else totals[key].value += v;
    }
  }
  return totals;
}

export function divideTotals(totals: NutrientTotals, servings: number): NutrientTotals {
  const out = {} as NutrientTotals;
  for (const key of NUTRIENT_KEYS) {
    out[key] = { value: totals[key].value / servings, incomplete: totals[key].incomplete };
  }
  return out;
}
