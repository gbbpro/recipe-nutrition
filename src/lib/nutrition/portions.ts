import { parseIngredient } from "parse-ingredient";
import type { FdcFood, FdcFoodPortion, GramsResult, ParsedLine, SizeWord } from "./types";
import { SIZE_WORDS, massToGrams, normalizeUnitWord, unitKind, volumeToMl } from "./units";

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export interface NormalizedPortion {
  /** Number of units this gramWeight is for. */
  amount: number;
  unit: string | null;
  size: SizeWord | null;
  /** Full text, lowercased, for matching notes ("chopped", "packed"). */
  text: string;
  gramWeight: number;
}

/**
 * USDA portions come in different shapes per data type:
 *   SR Legacy:  { amount: 1, modifier: "cup, chopped", measureUnit: { name: "undetermined" } }
 *   Foundation: { amount: 1, measureUnit: { name: "cup" }, modifier: "" }
 *   FNDDS:      { portionDescription: "1 cup", modifier: "..." }
 * This normalizes them into { amount, unit, size }.
 */
export function normalizePortion(p: FdcFoodPortion): NormalizedPortion | null {
  if (!p.gramWeight || p.gramWeight <= 0) return null;
  const measureName = p.measureUnit?.name && p.measureUnit.name !== "undetermined" ? p.measureUnit.name : "";
  const text = [measureName, p.modifier, p.portionDescription].filter(Boolean).join(" ").toLowerCase().trim();

  let amount = p.amount && p.amount > 0 ? p.amount : 1;
  let unit = normalizeUnitWord(measureName) ?? normalizeUnitWord(p.measureUnit?.abbreviation);
  let size: SizeWord | null = null;

  // Parse modifier / description text ("cup, chopped", "1 large", "tbsp", "1 cup").
  const candidateText = [p.modifier, p.portionDescription].filter(Boolean).join(" ");
  if (!unit && candidateText) {
    const startsWithNumber = /^\s*[\d½¼¾⅓⅔.]/.test(candidateText);
    // parse-ingredient only recognizes a unit when something follows it, hence the trailing "x".
    const parsed = parseIngredient(`${startsWithNumber ? candidateText : `1 ${candidateText}`} x`)[0];
    if (parsed?.unitOfMeasureID) {
      if (SIZE_WORDS[parsed.unitOfMeasureID]) size = SIZE_WORDS[parsed.unitOfMeasureID];
      else unit = parsed.unitOfMeasureID;
      if (startsWithNumber && parsed.quantity) amount = parsed.quantity;
    }
    if (!unit) {
      const firstWord = candidateText.toLowerCase().match(/[a-z]+/)?.[0];
      unit = normalizeUnitWord(firstWord);
    }
  }
  if (!size) {
    const m = text.match(/\b(extra[- ]large|jumbo|small|medium|large)\b/);
    if (m) size = SIZE_WORDS[m[1]] ?? null;
  }
  return { amount, unit, size, text, gramWeight: p.gramWeight };
}

/** Rough densities (g/ml) for when USDA has no volume portion. Results are flagged as estimated. */
const DENSITY_FALLBACKS: [RegExp, number, string][] = [
  [/\b(oil|ghee)\b/, 0.92, "oil"],
  [/\bbutter\b/, 0.96, "butter"],
  [/\b(honey|molasses|corn syrup)\b/, 1.42, "honey/syrup"],
  [/\bmaple syrup\b/, 1.32, "maple syrup"],
  [/\b(powdered|confectioners) sugar\b/, 0.51, "powdered sugar"],
  [/\bbrown sugar\b/, 0.93, "brown sugar, packed"],
  [/\bsugar\b/, 0.85, "granulated sugar"],
  [/\bflour\b/, 0.53, "flour"],
  [/\b(cocoa)\b/, 0.36, "cocoa powder"],
  [/\b(oats?|oatmeal)\b/, 0.34, "rolled oats"],
  [/\brice\b/, 0.78, "uncooked rice"],
  [/\bsalt\b/, 1.22, "table salt"],
  [/\b(cheese)\b/, 0.48, "shredded cheese"],
  [/\b(nuts?|walnuts?|pecans?|almonds?)\b/, 0.5, "chopped nuts"],
  [/\b(milk|water|broth|stock|juice|cream|vinegar|wine|sauce)\b/, 1.03, "water-like liquid"],
];

/** Per-item weights for when USDA has no count portion. */
const COUNT_FALLBACKS: [RegExp, Partial<Record<SizeWord | "default", number>>, string][] = [
  [/\begg\b|\beggs\b/, { small: 38, medium: 44, large: 50, "extra large": 56, jumbo: 63, default: 50 }, "egg"],
  [/\bgarlic\b/, { default: 3 }, "garlic clove"],
  [/\bonions?\b/, { small: 70, medium: 110, large: 150, default: 110 }, "onion"],
  [/\bbutter\b/, { default: 113 }, "stick of butter"],
  [/\blemons?\b/, { default: 84 }, "lemon"],
  [/\blimes?\b/, { default: 67 }, "lime"],
  [/\bbananas?\b/, { small: 101, medium: 118, large: 136, default: 118 }, "banana"],
  [/\bapples?\b/, { small: 149, medium: 182, large: 223, default: 182 }, "apple"],
  [/\bcarrots?\b/, { small: 50, medium: 61, large: 72, default: 61 }, "carrot"],
  [/\bpotato(es)?\b/, { small: 170, medium: 213, large: 369, default: 213 }, "potato"],
  [/\bbread\b/, { default: 28 }, "slice of bread"],
];

/** Typical can if the recipe doesn't say: 15 oz. */
const DEFAULT_CAN_GRAMS = 425;

function noteOverlap(portionText: string, notes: string[]): number {
  if (!notes.length) return 0;
  const words = notes.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return words.filter((w) => portionText.includes(w)).length;
}

/** Grams per milliliter from any USDA volume portion, preferring one whose text matches the notes. */
function densityFromPortions(portions: NormalizedPortion[], line: ParsedLine) {
  const volumePortions = portions
    .map((p) => ({ p, ml: p.unit ? volumeToMl(p.amount, p.unit) : null }))
    .filter((x): x is { p: NormalizedPortion; ml: number } => x.ml !== null && x.ml > 0);
  if (!volumePortions.length) return null;
  volumePortions.sort((a, b) => {
    const sameUnit = Number(b.p.unit === line.unit) - Number(a.p.unit === line.unit);
    if (sameUnit) return sameUnit;
    return noteOverlap(b.p.text, line.notes) - noteOverlap(a.p.text, line.notes);
  });
  const best = volumePortions[0];
  return { gPerMl: best.p.gramWeight / best.ml, portion: best.p };
}

function countPortion(portions: NormalizedPortion[], line: ParsedLine): NormalizedPortion | null {
  const countLike = portions.filter((p) => !p.unit || unitKind(p.unit) === "count");
  if (!countLike.length) return null;
  // 1. exact unit match ("clove", "slice", "stick")
  if (line.unit) {
    const byUnit = countLike.find((p) => p.unit === line.unit);
    if (byUnit) return byUnit;
    // A container unit ("can") without a matching portion shouldn't fall through to "1 medium".
    if (["can", "jar", "package", "bag", "box", "carton", "container"].includes(line.unit)) return null;
  }
  // 2. size match ("large")
  if (line.size) {
    const bySize = countLike.find((p) => p.size === line.size);
    if (bySize) return bySize;
  }
  // 3. a medium or plain whole item
  return (
    countLike.find((p) => p.size === "medium") ??
    countLike.find((p) => /\b(whole|each|item|fruit|egg)\b/.test(p.text)) ??
    countLike.find((p) => p.size !== null) ??
    null
  );
}

/**
 * Convert a parsed line's quantity to grams for a specific USDA food.
 * Returns null when there's no reasonable way to do it (the line needs review).
 */
export function resolveGrams(line: ParsedLine, food: FdcFood): GramsResult | null {
  const q = line.quantity;
  if (q === null || q <= 0) return null;
  const portions = (food.foodPortions ?? [])
    .map(normalizePortion)
    .filter((p): p is NormalizedPortion => p !== null);

  // 1. Mass units: direct conversion.
  if (line.unitKind === "mass" && line.unit) {
    const g = massToGrams(q, line.unit)!;
    return { grams: g, method: "mass", estimated: false, detail: `${q} ${line.unit} = ${round(g)} g` };
  }

  // 2. Container with a stated size: "1 (14 oz) can".
  if (line.packageSize) {
    const pkg = line.packageSize;
    if (pkg.unitKind === "mass") {
      const g = q * massToGrams(pkg.quantity, pkg.unit)!;
      return { grams: g, method: "package", estimated: false, detail: `${q} × ${pkg.quantity} ${pkg.unit} = ${round(g)} g` };
    }
    const ml = q * volumeToMl(pkg.quantity, pkg.unit)!;
    const d = densityFromPortions(portions, line);
    const gPerMl = d?.gPerMl ?? 1;
    return {
      grams: ml * gPerMl,
      method: d ? "density" : "package",
      estimated: !d,
      detail: `${q} × ${pkg.quantity} ${pkg.unit} ≈ ${round(ml * gPerMl)} g`,
    };
  }

  // 3. Volume units: density from USDA portions, then fallback table.
  if (line.unitKind === "volume" && line.unit) {
    const ml = volumeToMl(q, line.unit)!;
    const d = densityFromPortions(portions, line);
    if (d) {
      const g = ml * d.gPerMl;
      const exact = d.portion.unit === line.unit;
      return {
        grams: g,
        method: "portion",
        estimated: false,
        detail: exact
          ? `${q} ${line.unit} × ${round(d.portion.gramWeight / d.portion.amount)} g (USDA "${d.portion.text}")`
          : `${q} ${line.unit} ≈ ${round(g)} g (density from USDA "${d.portion.text}")`,
      };
    }
    const name = `${line.name} ${food.description}`.toLowerCase();
    const fb = DENSITY_FALLBACKS.find(([re]) => re.test(name));
    const gPerMl = fb?.[1] ?? 1;
    return {
      grams: ml * gPerMl,
      method: "density",
      estimated: true,
      detail: `${q} ${line.unit} ≈ ${round(ml * gPerMl)} g (assumed density of ${fb?.[2] ?? "water"})`,
    };
  }

  // 4. Count units or bare numbers ("2 large eggs", "3 cloves").
  if (line.unitKind === "count" || line.unitKind === "none") {
    const p = countPortion(portions, line);
    if (p) {
      const g = (q / p.amount) * p.gramWeight;
      return { grams: g, method: "portion", estimated: false, detail: `${q} × ${round(p.gramWeight / p.amount)} g (USDA "${p.text}")` };
    }
    if (line.unit === "can") {
      const g = q * DEFAULT_CAN_GRAMS;
      return { grams: g, method: "count-fallback", estimated: true, detail: `${q} can ≈ ${round(g)} g (assumed 15 oz can)` };
    }
    // Branded foods: "1 serving" weight.
    if (food.servingSize && /^(g|grm|gram)s?$/i.test(food.servingSizeUnit ?? "") && line.unitKind === "none") {
      const g = q * food.servingSize;
      return { grams: g, method: "serving", estimated: true, detail: `${q} × ${food.servingSize} g serving` };
    }
    const name = `${line.name} ${line.unit ?? ""}`.toLowerCase();
    const fb = COUNT_FALLBACKS.find(([re]) => re.test(name));
    if (fb) {
      const per = (line.size && fb[1][line.size]) || fb[1].default!;
      return {
        grams: q * per,
        method: "count-fallback",
        estimated: true,
        detail: `${q} × ~${per} g (typical ${line.size ? line.size + " " : ""}${fb[2]})`,
      };
    }
  }

  return null;
}
