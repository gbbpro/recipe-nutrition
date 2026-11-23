import { parseIngredient } from "parse-ingredient";
import type { PackageSize, ParsedLine, ParsedRecipe, SizeWord } from "./types";
import { SIZE_WORDS, looksLiquid, normalizeUnitWord, unitKind } from "./units";

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

/** Approximate juice/zest yield per fruit, in tablespoons. */
const FRUIT_YIELD_TBSP: Record<string, { juice: number; zest: number }> = {
  lemon: { juice: 3, zest: 1 },
  lime: { juice: 2, zest: 0.5 },
  orange: { juice: 6, zest: 1.5 },
};

const YIELD_RE =
  /^(?:serves|servings|serving size|yield|yields|makes)\b[:\s-]*(?:about\s+|approx\.?\s+)?(\d+)(?:\s*(?:-|–|to)\s*(\d+))?/i;

const NO_QUANTITY_EXCLUDE_RE =
  /\b(to taste|as needed|as desired|if desired|for (?:serving|garnish(?:ing)?|frying|deep[- ]frying|greasing|dusting|the pan|topping|drizzling|brushing))\b/i;

const TRAILING_PHRASE_RE =
  /,?\s*\b(?:plus more|or more|plus extra|more|extra)?\s*(?:to taste|as needed|as desired|if desired|for (?:serving|garnish(?:ing)?|frying|deep[- ]frying|greasing|dusting|the pan|topping|drizzling|brushing))\b.*$/i;

const PAREN_MEASURE_RE =
  /^(?:about\s+|approx\.?\s+)?(\d+(?:\.\d+)?)\s*-?\s*(fl\.?\s*oz|fluid ounces?|oz|ounces?|g|grams?|kg|lbs?|pounds?|ml|milliliters?|l|liters?)\.?\b/i;

/** Clean up list markers, number words, and patterns parse-ingredient misses. */
export function preprocessLine(input: string): { text: string; extraNotes: string[] } {
  const extraNotes: string[] = [];
  let t = input
    .trim()
    .replace(/^(?:[-•*▢◦·]|\[\s?\])\s*/, "")
    .replace(/\s+/g, " ");

  // "half a cup" → "1/2 cup"
  t = t.replace(/^half\s+(?:a|an)\s+/i, "1/2 ");
  // "a pinch of salt", "an egg" → leading 1
  t = t.replace(/^(?:a|an)\s+(?!few\b|handful\b|little\b|bit\b|splash\b)/i, "1 ");
  // "two eggs" → "2 eggs"
  t = t.replace(/^([a-z]+)\b/i, (w) => NUMBER_WORDS[w.toLowerCase()] ?? w);

  // "Juice of 1 lemon" / "zest of 2 limes" → tablespoons of juice/zest
  t = t.replace(
    /^(juice|zest)\s+(?:and\s+(?:juice|zest)\s+)?of\s+(\d+(?:\.\d+)?|1\/2|half (?:a|an)|a|an)\s+(lemon|lime|orange)s?\b(.*)$/i,
    (_m, what: string, n: string, fruit: string, rest: string) => {
      const count = /^(1\/2|half)/i.test(n) ? 0.5 : /^(a|an)$/i.test(n) ? 1 : Number(n);
      const kind = what.toLowerCase() as "juice" | "zest";
      const tbsp = count * FRUIT_YIELD_TBSP[fruit.toLowerCase()][kind];
      extraNotes.push(`estimated ${kind} yield`);
      return `${tbsp} tablespoons ${fruit.toLowerCase()} ${kind}${rest}`;
    },
  );

  // "1 14-ounce can tomatoes" → "1 can (14 ounce) tomatoes"
  t = t.replace(
    /^(\d+(?:\s+\d+\/\d+|[./]\d+)?)\s+(\d+(?:\.\d+)?)\s*-?\s*(ounce|oz|fl\.? oz|gram|g|pound|lb)s?\.?\s+(cans?|jars?|packages?|bags?|box(?:es)?|cartons?|containers?)\b/i,
    "$1 $4 ($2 $3)",
  );

  return { text: t, extraNotes };
}

function parsePackage(text: string): PackageSize | null {
  const m = text.trim().match(PAREN_MEASURE_RE);
  if (!m) return null;
  const unit = normalizeUnitWord(m[2].replace(/\s+/g, " "));
  if (!unit) return null;
  const kind = unitKind(unit);
  if (kind !== "mass" && kind !== "volume") return null;
  return { quantity: Number(m[1]), unit, unitKind: kind };
}

function splitNotes(text: string): string[] {
  return text
    .split(/,|;|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a single ingredient line. `group` is the current section header, if any. */
export function parseLine(raw: string, index: number, group: string | null = null): ParsedLine {
  const { text, extraNotes } = preprocessLine(raw);
  const parsed = parseIngredient(text)[0];

  const base: ParsedLine = {
    index,
    raw,
    kind: "ingredient",
    quantity: null,
    quantityMin: null,
    quantityMax: null,
    unit: null,
    unitKind: "none",
    size: null,
    name: "",
    notes: [...extraNotes],
    packageSize: null,
    alternatives: [],
    optional: false,
    excludedReason: null,
    group,
  };

  if (!parsed) return { ...base, kind: "excluded", excludedReason: "unparseable", name: text };

  const isHeader =
    parsed.isGroupHeader || (parsed.quantity === null && /:\s*$/.test(text) && text.length < 60);
  if (isHeader) {
    return { ...base, kind: "header", name: text.replace(/:\s*$/, "").trim() };
  }

  let quantity = parsed.quantity;
  let quantityMin: number | null = null;
  let quantityMax: number | null = null;
  if (quantity !== null && parsed.quantity2 !== null) {
    quantityMin = quantity;
    quantityMax = parsed.quantity2;
    quantity = (quantity + parsed.quantity2) / 2;
  }

  let unit: string | null = parsed.unitOfMeasureID;
  let size: SizeWord | null = null;
  let description = parsed.description.trim();

  // parse-ingredient treats size words as units: "2 large eggs" → unit "large".
  if (unit && SIZE_WORDS[unit]) {
    size = SIZE_WORDS[unit];
    unit = null;
  }
  const sizeMatch = description.match(/^(extra[- ]large|xl|jumbo|small|medium|large)\b\s*/i);
  if (sizeMatch && !size) {
    size = SIZE_WORDS[sizeMatch[1].toLowerCase()] ?? null;
    description = description.slice(sizeMatch[0].length);
  }

  // "1 dozen eggs" → 12 eggs
  if (unit === "dozen") {
    if (quantity !== null) quantity *= 12;
    if (quantityMin !== null) quantityMin *= 12;
    if (quantityMax !== null) quantityMax *= 12;
    unit = null;
  }

  // Our own count units that parse-ingredient doesn't know: "2 slices bread"
  if (!unit) {
    const m = description.match(/^([a-z]+)\.?\s+(?:of\s+)?/i);
    const u = m ? normalizeUnitWord(m[1]) : null;
    if (u && unitKind(u) === "count") {
      unit = u;
      description = description.slice(m![0].length);
    }
  }

  const notes = base.notes;
  let packageSize: PackageSize | null = null;

  // Parentheticals: "(14 oz)", "(packed)", "(optional)", "(about 2 cups)"
  description = description.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const measure = parsePackage(inner);
    const kind = unitKind(unit);
    if (measure && (kind === "count" || kind === "none") && !packageSize) {
      packageSize = measure;
    } else if (measure && kind === "volume" && measure.unitKind === "mass") {
      // "1 cup (125 g) flour" — the stated weight beats any density estimate.
      notes.push(`${quantity ?? ""} ${unit} stated as ${inner.trim()}`.trim());
      if (quantity !== null) {
        const ratio = measure.quantity / quantity;
        quantity = measure.quantity;
        if (quantityMin !== null) quantityMin *= ratio;
        if (quantityMax !== null) quantityMax *= ratio;
        // quantity now refers to the stated mass for one recipe amount
      }
      unit = measure.unit;
    } else {
      notes.push(inner.trim());
    }
    return " ";
  });

  description = description.replace(/\s+/g, " ").trim();

  // Excluded-without-quantity phrases ("salt to taste", "oil, for frying")
  let excludedReason: string | null = null;
  const phrase = description.match(NO_QUANTITY_EXCLUDE_RE);
  if (phrase) {
    if (quantity === null) excludedReason = phrase[1].toLowerCase();
    notes.push(description.slice(phrase.index!).replace(/^,?\s*/, "").trim());
    description = description.replace(TRAILING_PHRASE_RE, "").trim();
  }

  // Name vs. prep notes: "onion, finely chopped"
  const comma = description.indexOf(",");
  let name = comma >= 0 ? description.slice(0, comma) : description;
  if (comma >= 0) notes.push(...splitNotes(description.slice(comma + 1)));

  // Alternatives: "butter or margarine", "butter/margarine"
  const alts = name.split(/\s+or\s+|\s*\/\s*/i).map((s) => s.trim()).filter(Boolean);
  name = alts[0] ?? name;
  const alternatives = alts.slice(1);

  name = name
    .replace(/^of\s+/i, "")
    .replace(/[.;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const optional = notes.some((n) => /\boptional\b/i.test(n)) || /\boptional\b/i.test(raw);
  if (/\boptional\b/i.test(name)) name = name.replace(/\s*\boptional\b\s*/i, " ").trim();

  // "8 oz milk" is fluid ounces; "8 oz cheese" is weight.
  if (unit === "ounce" && looksLiquid(name)) unit = "fluid ounce";

  const cleanNotes = notes.map((n) => n.trim()).filter((n) => n && !/^optional$/i.test(n));

  return {
    ...base,
    kind: excludedReason ? "excluded" : "ingredient",
    quantity,
    quantityMin,
    quantityMax,
    unit,
    unitKind: unitKind(unit),
    size,
    name,
    notes: cleanNotes,
    packageSize,
    alternatives,
    optional,
    excludedReason,
  };
}

/** Parse a servings line like "Serves 4" or "Makes 12 muffins". */
export function parseYield(line: string): number | null {
  const m = line.trim().match(YIELD_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a whole pasted ingredient list (one ingredient per line). */
export function parseRecipe(text: string): ParsedRecipe {
  let servings: number | null = null;
  let group: string | null = null;
  const lines: ParsedLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const y = parseYield(raw);
    if (y !== null) {
      servings ??= y;
      continue;
    }
    const line = parseLine(raw, lines.length, group);
    if (line.kind === "header") {
      group = line.name.replace(/^for\s+(the\s+)?/i, "").trim() || line.name;
      line.group = group;
    }
    lines.push(line);
  }

  return { lines, servings };
}
