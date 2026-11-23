import type {
  FdcDataType,
  FdcSearchFood,
  FoodMatchSummary,
  ParsedLine,
} from "./types";

/**
 * Words that describe prep or appearance and don't change nutrition.
 * They are stripped before searching USDA.
 */
const NOISE_WORDS = new Set([
  "fresh",
  "freshly",
  "finely",
  "roughly",
  "coarsely",
  "thinly",
  "thickly",
  "chopped",
  "minced",
  "diced",
  "sliced",
  "grated",
  "shredded",
  "crushed",
  "cubed",
  "julienned",
  "peeled",
  "trimmed",
  "halved",
  "quartered",
  "torn",
  "softened",
  "melted",
  "cold",
  "warm",
  "chilled",
  "room",
  "temperature",
  "divided",
  "packed",
  "lightly",
  "firmly",
  "sifted",
  "heaping",
  "level",
  "scant",
  "good",
  "quality",
  "organic",
  "large",
  "medium",
  "small",
  "about",
  "approximately",
  "pure",
  "plain",
  "store-bought",
  "homemade",
  "your",
  "favorite",
  "of",
  "the",
]);

/** Words that DO change nutrition — never stripped, and used to bias scoring. */
const STATE_WORDS = [
  "raw",
  "cooked",
  "boiled",
  "roasted",
  "fried",
  "baked",
  "grilled",
  "steamed",
  "canned",
  "dried",
  "dry",
  "frozen",
  "uncooked",
  "drained",
  "unsalted",
  "salted",
  "low-sodium",
  "reduced-fat",
  "fat-free",
  "nonfat",
  "skim",
  "whole",
  "lean",
];

function singularize(word: string): string {
  if (word.length <= 3 || word.endsWith("ss")) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(ches|shes|xes|ses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** "Freshly grated Parmesan cheese" → "parmesan cheese"; "eggs" → "egg". */
export function cleanIngredientName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9%\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE_WORDS.has(w));
  if (words.length)
    words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join(" ").trim();
}

/**
 * Curated mapping for common ingredients → the canonical USDA description to search for.
 * USDA's search ranking is weak for generic words ("butter" returns branded products),
 * so steering the top ~200 ingredients by hand covers most recipe lines.
 *
 * Values are USDA SR Legacy descriptions. If one doesn't match exactly, matching falls
 * back to normal scoring, so an imperfect alias degrades gracefully. Once you've confirmed
 * a match against the live API, you can pin the fdcId directly in `pinnedFdcId`.
 */
export const INGREDIENT_ALIASES: Record<
  string,
  { query: string; pinnedFdcId?: number }
> = {
  flour: { query: "Wheat flour, white, all-purpose, enriched, bleached" },
  "all-purpose flour": {
    query: "Wheat flour, white, all-purpose, enriched, bleached",
  },
  "ap flour": { query: "Wheat flour, white, all-purpose, enriched, bleached" },
  "bread flour": { query: "Wheat flour, white, bread, enriched" },
  "whole wheat flour": { query: "Flour, whole wheat, unenriched" },
  sugar: { query: "Sugars, granulated" },
  "granulated sugar": { query: "Sugars, granulated" },
  "white sugar": { query: "Sugars, granulated" },
  "brown sugar": { query: "Sugars, brown" },
  "light brown sugar": { query: "Sugars, brown" },
  "dark brown sugar": { query: "Sugars, brown" },
  "powdered sugar": { query: "Sugars, powdered" },
  "confectioners sugar": { query: "Sugars, powdered" },
  butter: { query: "Butter, salted" },
  "salted butter": { query: "Butter, salted" },
  "unsalted butter": { query: "Butter, without salt" },
  egg: { query: "Egg, whole, raw, fresh" },
  "egg white": { query: "Egg, white, raw, fresh" },
  "egg yolk": { query: "Egg, yolk, raw, fresh" },
  milk: { query: "Milk, whole, 3.25% milkfat, with added vitamin D" },
  "whole milk": { query: "Milk, whole, 3.25% milkfat, with added vitamin D" },
  buttermilk: { query: "Milk, buttermilk, fluid, cultured, lowfat" },
  "heavy cream": { query: "Cream, fluid, heavy whipping" },
  "heavy whipping cream": { query: "Cream, fluid, heavy whipping" },
  "sour cream": { query: "Cream, sour, cultured" },
  "cream cheese": { query: "Cheese, cream" },
  "cheddar cheese": { query: "Cheese, cheddar" },
  cheddar: { query: "Cheese, cheddar" },
  "parmesan cheese": { query: "Cheese, parmesan, grated" },
  parmesan: { query: "Cheese, parmesan, grated" },
  "mozzarella cheese": { query: "Cheese, mozzarella, whole milk" },
  "olive oil": { query: "Oil, olive, salad or cooking" },
  "extra virgin olive oil": { query: "Oil, olive, salad or cooking" },
  "extra-virgin olive oil": { query: "Oil, olive, salad or cooking" },
  "canola oil": { query: "Oil, canola" },
  "vegetable oil": { query: "Oil, soybean, salad or cooking" },
  salt: { query: "Salt, table" },
  "kosher salt": { query: "Salt, table" },
  "sea salt": { query: "Salt, table" },
  "table salt": { query: "Salt, table" },
  "black pepper": { query: "Spices, pepper, black" },
  pepper: { query: "Spices, pepper, black" },
  garlic: { query: "Garlic, raw" },
  "garlic clove": { query: "Garlic, raw" },
  onion: { query: "Onions, raw" },
  "yellow onion": { query: "Onions, raw" },
  "red onion": { query: "Onions, raw" },
  "white onion": { query: "Onions, raw" },
  carrot: { query: "Carrots, raw" },
  "celery stalk": { query: "Celery, raw" },
  celery: { query: "Celery, raw" },
  potato: { query: "Potatoes, flesh and skin, raw" },
  tomato: { query: "Tomatoes, red, ripe, raw, year round average" },
  "diced tomato": {
    query: "Tomatoes, red, ripe, canned, packed in tomato juice",
  },
  "canned tomato": {
    query: "Tomatoes, red, ripe, canned, packed in tomato juice",
  },
  "lemon juice": { query: "Lemon juice, raw" },
  "lime juice": { query: "Lime juice, raw" },
  "orange juice": { query: "Orange juice, raw" },
  "lemon zest": { query: "Lemon peel, raw" },
  honey: { query: "Honey" },
  "maple syrup": { query: "Syrups, maple" },
  "vanilla extract": { query: "Vanilla extract" },
  vanilla: { query: "Vanilla extract" },
  "baking soda": { query: "Leavening agents, baking soda" },
  "baking powder": {
    query:
      "Leavening agents, baking powder, double-acting, sodium aluminum sulfate",
  },
  water: { query: "Beverages, water, tap, drinking" },
  "white rice": { query: "Rice, white, long-grain, regular, raw, enriched" },
  rice: { query: "Rice, white, long-grain, regular, raw, enriched" },
  "brown rice": { query: "Rice, brown, long-grain, raw" },
  "rolled oat": {
    query: "Cereals, oats, regular and quick, not fortified, dry",
  },
  oat: { query: "Cereals, oats, regular and quick, not fortified, dry" },
  "chicken breast": {
    query: "Chicken, broilers or fryers, breast, meat only, raw",
  },
  "boneless skinless chicken breast": {
    query: "Chicken, broilers or fryers, breast, meat only, raw",
  },
  "chicken thigh": {
    query: "Chicken, broilers or fryers, thigh, meat only, raw",
  },
  "ground beef": { query: "Beef, ground, 80% lean meat / 20% fat, raw" },
  "chicken broth": { query: "Soup, chicken broth, ready-to-serve" },
  "black bean": { query: "Beans, black, mature seeds, canned, low sodium" },
  chickpea: {
    query:
      "Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids",
  },
  walnut: { query: "Nuts, walnuts, english" },
  almond: { query: "Nuts, almonds" },
  "coconut milk": {
    query:
      "Nuts, coconut milk, canned (liquid expressed from grated meat and water)",
  },
  bread: {
    query: "Bread, white, commercially prepared (includes soft bread crumbs)",
  },
  "soy sauce": { query: "Soy sauce made from soy (tamari)" },
  "chocolate chip": { query: "Candies, semisweet chocolate" },
  "semisweet chocolate chip": { query: "Candies, semisweet chocolate" },
  "cocoa powder": { query: "Cocoa, dry powder, unsweetened" },
  spinach: { query: "Spinach, raw" },
  "bell pepper": { query: "Peppers, sweet, red, raw" },
  "red bell pepper": { query: "Peppers, sweet, red, raw" },
  "green bell pepper": { query: "Peppers, sweet, green, raw" },
  banana: { query: "Bananas, raw" },
  apple: {
    query:
      "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)",
  },
};

/** Data types to search first. SR Legacy has the richest household portions. */
export const PRIMARY_DATA_TYPES: FdcDataType[] = ["SR Legacy", "Foundation"];
export const FALLBACK_DATA_TYPES: FdcDataType[] = ["Survey (FNDDS)", "Branded"];

const DATA_TYPE_BONUS: Record<string, number> = {
  "SR Legacy": 0.15,
  Foundation: 0.12,
  "Survey (FNDDS)": 0.05,
  Branded: 0,
};

export interface SearchPlan {
  /** Cleaned ingredient name, used as cache key. */
  key: string;
  query: string;
  /** Exact USDA description we expect, if the name hit the alias table. */
  expectedDescription: string | null;
  pinnedFdcId: number | null;
}

export function planSearch(line: ParsedLine): SearchPlan {
  const key = cleanIngredientName(line.name);
  const alias = INGREDIENT_ALIASES[key];
  // Keep nutrition-relevant notes ("drained", "cooked") in the query.
  const stateNotes = line.notes
    .flatMap((n) => n.toLowerCase().split(/\s+/))
    .filter((w) => STATE_WORDS.includes(w));
  return {
    key,
    query: alias?.query ?? [key, ...stateNotes].join(" "),
    expectedDescription: alias?.query ?? null,
    pinnedFdcId: alias?.pinnedFdcId ?? null,
  };
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize);
}

/**
 * Score a USDA result against the ingredient. Higher is better (roughly 0–1.5).
 * - token overlap between query and description
 * - extra weight on the description's first segment ("Butter" in "Butter, salted")
 * - data-type preference (SR Legacy > Foundation > FNDDS > Branded)
 * - prefer "raw" when the recipe doesn't say otherwise
 * - mild penalty for long, very specific descriptions
 */
export function scoreCandidate(
  food: FdcSearchFood,
  plan: SearchPlan,
  line: ParsedLine,
): number {
  if (
    plan.expectedDescription &&
    food.description.toLowerCase() === plan.expectedDescription.toLowerCase()
  ) {
    return 10 + (DATA_TYPE_BONUS[food.dataType] ?? 0);
  }
  const q = new Set(tokens(plan.key));
  const descTokens = tokens(food.description);
  const firstSeg = new Set(tokens(food.description.split(",")[0]));
  if (!q.size || !descTokens.length) return 0;

  let hits = 0;
  for (const t of q) if (descTokens.includes(t)) hits++;
  const coverage = hits / q.size;
  let firstHits = 0;
  for (const t of q) if (firstSeg.has(t)) firstHits++;
  const firstCoverage = firstHits / q.size;

  let score = coverage * 0.6 + firstCoverage * 0.4;
  score += DATA_TYPE_BONUS[food.dataType] ?? 0;

  const lineText = [line.name, ...line.notes].join(" ").toLowerCase();
  const wantsCooked =
    /\b(cooked|boiled|roasted|fried|baked|grilled|steamed|canned|drained)\b/.test(
      lineText,
    );
  if (!wantsCooked && descTokens.includes("raw")) score += 0.1;
  if (
    wantsCooked &&
    /\b(cooked|boiled|roasted|canned|drained)\b/i.test(food.description)
  )
    score += 0.1;

  score -= Math.max(0, descTokens.length - 6) * 0.015;
  return score;
}

export function rankCandidates(
  foods: FdcSearchFood[],
  plan: SearchPlan,
  line: ParsedLine,
) {
  return foods
    .map((food) => ({ food, score: scoreCandidate(food, plan, line) }))
    .sort((a, b) => b.score - a.score);
}

/** Below this, a match is shown as "needs review" instead of being counted silently. */
export const MIN_CONFIDENT_SCORE = 0.55;

export function summarize(food: {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
}): FoodMatchSummary {
  return {
    fdcId: food.fdcId,
    description: food.brandOwner
      ? `${food.description} (${food.brandOwner})`
      : food.description,
    dataType: food.dataType,
  };
}
