import type { SizeWord, UnitKind } from "./types";

/** Grams per unit, keyed by parse-ingredient unit ids. */
export const MASS_TO_GRAMS: Record<string, number> = {
  gram: 1,
  kilogram: 1000,
  milligram: 0.001,
  ounce: 28.3495,
  pound: 453.592,
};

/** Milliliters per unit (US customary). */
export const VOLUME_TO_ML: Record<string, number> = {
  teaspoon: 4.92892,
  tablespoon: 14.7868,
  cup: 236.588,
  "fluid ounce": 29.5735,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
  milliliter: 1,
  deciliter: 100,
  liter: 1000,
  // Informal measures — conventional values.
  pinch: 0.31,
  dash: 0.62,
  drop: 0.05,
};

/** Units that mean "a number of things" and need a per-item weight. */
export const COUNT_UNITS = new Set([
  "bag",
  "box",
  "bunch",
  "can",
  "carton",
  "clove",
  "container",
  "ear",
  "head",
  "pack",
  "package",
  "piece",
  "sprig",
  "stick",
  // added by our parser
  "slice",
  "jar",
  "stalk",
  "leaf",
  "fillet",
]);

export const SIZE_WORDS: Record<string, SizeWord> = {
  small: "small",
  medium: "medium",
  large: "large",
  "extra large": "extra large",
  "extra-large": "extra large",
  xl: "extra large",
  jumbo: "jumbo",
};

export function unitKind(unit: string | null): UnitKind {
  if (!unit) return "none";
  if (unit in MASS_TO_GRAMS) return "mass";
  if (unit in VOLUME_TO_ML) return "volume";
  if (COUNT_UNITS.has(unit)) return "count";
  return "none";
}

export function massToGrams(quantity: number, unit: string): number | null {
  const f = MASS_TO_GRAMS[unit];
  return f === undefined ? null : quantity * f;
}

export function volumeToMl(quantity: number, unit: string): number | null {
  const f = VOLUME_TO_ML[unit];
  return f === undefined ? null : quantity * f;
}

/**
 * Ingredients where "oz" almost always means fluid ounces.
 * "8 oz milk" is volume; "8 oz cheese" is weight.
 */
const LIQUID_WORDS =
  /\b(milk|water|broth|stock|juice|cream|half-and-half|wine|beer|vinegar|oil|syrup|soda|coffee|tea|buttermilk|kefir|liqueur|rum|vodka|whiskey|bourbon|tequila|gin)\b/i;

export function looksLiquid(name: string): boolean {
  // "cream cheese" and "sour cream" are not pourable liquids.
  if (/\b(cream cheese|sour cream|ice cream|whipped cream)\b/i.test(name)) return false;
  return LIQUID_WORDS.test(name);
}

const UNIT_ALIASES: Record<string, string> = {
  // canonical ids used by parse-ingredient
  g: "gram", gram: "gram", grams: "gram",
  kg: "kilogram", kilogram: "kilogram", kilograms: "kilogram",
  mg: "milligram",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  "fl oz": "fluid ounce", "fluid ounce": "fluid ounce", "fluid ounces": "fluid ounce", floz: "fluid ounce",
  ml: "milliliter", milliliter: "milliliter", milliliters: "milliliter", millilitre: "milliliter",
  l: "liter", liter: "liter", liters: "liter", litre: "liter",
  tsp: "teaspoon", teaspoon: "teaspoon", teaspoons: "teaspoon",
  tbsp: "tablespoon", tablespoon: "tablespoon", tablespoons: "tablespoon",
  cup: "cup", cups: "cup",
  pint: "pint", pt: "pint",
  quart: "quart", qt: "quart",
  slice: "slice", slices: "slice",
  clove: "clove", cloves: "clove",
  stick: "stick", sticks: "stick",
  can: "can", cans: "can",
  jar: "jar", jars: "jar",
  package: "package", pkg: "package", packages: "package",
  stalk: "stalk", stalks: "stalk",
  piece: "piece", pieces: "piece",
  leaf: "leaf", leaves: "leaf",
  sprig: "sprig", sprigs: "sprig",
  head: "head", heads: "head",
  bunch: "bunch",
  fillet: "fillet", fillets: "fillet",
  ear: "ear", ears: "ear",
};

/** Normalize a free-text unit word ("Tbsp.", "cups", "fl oz") to a canonical id. */
export function normalizeUnitWord(word: string | undefined | null): string | null {
  if (!word) return null;
  const w = word.toLowerCase().replace(/\./g, "").trim();
  if (UNIT_ALIASES[w]) return UNIT_ALIASES[w];
  // Case-sensitive shorthands: T = tablespoon, t = teaspoon.
  if (word.trim() === "T") return "tablespoon";
  if (word.trim() === "t") return "teaspoon";
  return null;
}
