// Shared types for the recipe nutrition pipeline.
//   text → ParsedLine (parse.ts) → FDC match (match.ts) → grams (portions.ts) → nutrients (nutrients.ts)

export type UnitKind = "mass" | "volume" | "count" | "none";

export type SizeWord = "small" | "medium" | "large" | "extra large" | "jumbo";

export interface PackageSize {
  /** e.g. 14 for "(14 oz) can" */
  quantity: number;
  /** canonical unit id, e.g. "ounce", "gram", "fluid ounce" */
  unit: string;
  unitKind: Exclude<UnitKind, "count" | "none">;
}

export type LineKind = "ingredient" | "header" | "excluded";

export interface ParsedLine {
  index: number;
  raw: string;
  kind: LineKind;
  /** Quantity used for math. For ranges this is the midpoint. */
  quantity: number | null;
  /** Original range bounds, kept for display ("2–3 cloves"). */
  quantityMin: number | null;
  quantityMax: number | null;
  /** Canonical unit id from parse-ingredient ("cup", "tablespoon", "clove"...) or null. */
  unit: string | null;
  unitKind: UnitKind;
  size: SizeWord | null;
  /** Ingredient name with prep notes removed, e.g. "all-purpose flour". */
  name: string;
  /** Prep notes and parentheticals, e.g. ["sifted"], ["drained", "rinsed"]. */
  notes: string[];
  /** Weight/volume inside a container unit: "1 (14 oz) can". */
  packageSize: PackageSize | null;
  /** Other options the recipe offered: "butter or margarine" → ["margarine"]. */
  alternatives: string[];
  optional: boolean;
  /** Why the line was excluded from nutrition ("to taste", "header"...). */
  excludedReason: string | null;
  /** The most recent group header above this line ("For the sauce"). */
  group: string | null;
}

export interface ParsedRecipe {
  lines: ParsedLine[];
  /** Servings found in the text ("Serves 4", "Makes 12"), if any. */
  servings: number | null;
}

// ---- USDA FoodData Central shapes (only the fields we use) ----

export type FdcDataType = "Foundation" | "SR Legacy" | "Survey (FNDDS)" | "Branded";

/** Search results use flat nutrient entries. */
export interface FdcSearchNutrient {
  nutrientId: number;
  nutrientName?: string;
  unitName?: string;
  value?: number;
}

export interface FdcSearchFood {
  fdcId: number;
  description: string;
  dataType: FdcDataType | string;
  brandOwner?: string;
  foodNutrients?: FdcSearchNutrient[];
}

/** Full food detail (GET /food/{fdcId}) uses nested nutrient entries. */
export interface FdcFoodNutrient {
  nutrient: { id: number; number?: string; name?: string; unitName?: string };
  amount?: number;
}

export interface FdcFoodPortion {
  id?: number;
  amount?: number;
  gramWeight: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: { id?: number; name?: string; abbreviation?: string };
}

export interface FdcFood {
  fdcId: number;
  description: string;
  dataType: FdcDataType | string;
  foodNutrients: FdcFoodNutrient[];
  foodPortions?: FdcFoodPortion[];
  /** Branded only. */
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
}

export interface FdcClient {
  search(query: string, dataTypes: FdcDataType[]): Promise<FdcSearchFood[]>;
  getFood(fdcId: number): Promise<FdcFood>;
}

// ---- Analysis output ----

export type NutrientKey =
  | "calories"
  | "protein"
  | "fat"
  | "saturatedFat"
  | "carbs"
  | "fiber"
  | "sugars"
  | "sodium"
  | "cholesterol"
  | "potassium"
  | "calcium"
  | "iron";

/** null = USDA has no value for this food (unknown, NOT zero). */
export type NutrientValues = Record<NutrientKey, number | null>;

export type GramsMethod =
  | "mass"
  | "package"
  | "portion"
  | "density"
  | "count-fallback"
  | "serving";

export interface GramsResult {
  grams: number;
  method: GramsMethod;
  estimated: boolean;
  /** Human-readable explanation, e.g. "1 cup = 125 g (USDA portion)". */
  detail: string;
}

export type LineStatus = "matched" | "estimated" | "needs_review" | "excluded" | "header";

export interface FoodMatchSummary {
  fdcId: number;
  description: string;
  dataType: string;
}

export interface LineResult {
  line: ParsedLine;
  status: LineStatus;
  match: FoodMatchSummary | null;
  /** Other candidates for the user to pick from. */
  candidates: FoodMatchSummary[];
  grams: GramsResult | null;
  nutrients: NutrientValues | null;
  message: string | null;
}

export interface NutrientTotal {
  value: number;
  /** True when at least one counted line had no USDA value for this nutrient. */
  incomplete: boolean;
}

export type NutrientTotals = Record<NutrientKey, NutrientTotal>;

export interface RecipeAnalysis {
  servings: number;
  lines: LineResult[];
  totals: NutrientTotals;
  perServing: NutrientTotals;
  /** Lines that were not counted because they need review. */
  uncountedLines: number;
}
