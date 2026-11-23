import { FALLBACK_DATA_TYPES, MIN_CONFIDENT_SCORE, PRIMARY_DATA_TYPES, planSearch, rankCandidates, summarize } from "./match";
import { divideTotals, per100g, scaleNutrients, sumNutrients } from "./nutrients";
import { parseRecipe } from "./parse";
import { resolveGrams } from "./portions";
import type { FdcClient, FdcSearchFood, LineResult, ParsedLine, RecipeAnalysis } from "./types";

export interface AnalyzeOptions {
  client: FdcClient;
  /** Overrides servings found in the text. */
  servings?: number;
  /** User-chosen USDA food per line index: { 3: 171705 }. */
  overrides?: Record<number, number>;
  /** Max parallel USDA lookups. Keep low to respect the 1,000 req/hour limit. */
  concurrency?: number;
}

/** Errors that should abort the whole analysis (bad key, rate limit) rather than one line. */
export class FatalLookupError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function base(line: ParsedLine, status: LineResult["status"], message: string | null = null): LineResult {
  return { line, status, match: null, candidates: [], grams: null, nutrients: null, message };
}

export async function analyzeLine(line: ParsedLine, client: FdcClient, overrideFdcId?: number): Promise<LineResult> {
  if (line.kind === "header") return base(line, "header");
  if (line.kind === "excluded") return base(line, "excluded", `Not counted (${line.excludedReason})`);
  if (!line.name) return base(line, "needs_review", "Couldn't find an ingredient name");

  // 1. Pick the USDA food.
  const plan = planSearch(line);
  let candidates: FdcSearchFood[] = [];
  let chosenId: number | null = overrideFdcId ?? plan.pinnedFdcId;
  let confident = chosenId !== null;

  try {
    if (plan.query) {
      let ranked = rankCandidates(await client.search(plan.query, PRIMARY_DATA_TYPES), plan, line);
      if (!ranked.length || ranked[0].score < MIN_CONFIDENT_SCORE) {
        const more = rankCandidates(await client.search(plan.key, FALLBACK_DATA_TYPES), plan, line);
        ranked = [...ranked, ...more].sort((a, b) => b.score - a.score);
      }
      candidates = ranked.slice(0, 6).map((r) => r.food);
      if (chosenId === null && ranked.length) {
        chosenId = ranked[0].food.fdcId;
        confident = ranked[0].score >= MIN_CONFIDENT_SCORE;
      }
    }
  } catch (err) {
    if (err instanceof FatalLookupError) throw err;
    return base(line, "needs_review", `USDA search failed: ${(err as Error).message}`);
  }

  const result: LineResult = { ...base(line, "matched"), candidates: candidates.map(summarize) };
  if (chosenId === null) {
    return { ...result, status: "needs_review", message: `No USDA match for "${plan.key}"` };
  }

  // 2. Fetch full detail (nutrients + portions).
  let food;
  try {
    food = await client.getFood(chosenId);
  } catch (err) {
    if (err instanceof FatalLookupError) throw err;
    return { ...result, status: "needs_review", message: `USDA lookup failed: ${(err as Error).message}` };
  }
  result.match = summarize(food);
  if (!result.candidates.some((c) => c.fdcId === food.fdcId)) result.candidates.unshift(result.match);

  if (line.quantity === null) {
    return { ...result, status: "needs_review", message: "No quantity — add an amount to count this line" };
  }

  // 3. Convert to grams.
  const grams = resolveGrams(line, food);
  if (!grams) {
    return {
      ...result,
      status: "needs_review",
      message: `Couldn't convert ${line.unit ?? "item"} of "${line.name}" to grams — try a weight or pick another match`,
    };
  }
  result.grams = grams;

  // 4. Nutrients.
  result.nutrients = scaleNutrients(per100g(food), grams.grams);

  if (!confident) {
    result.status = "needs_review";
    result.message = "Low-confidence match — please confirm";
  } else if (grams.estimated) {
    result.status = "estimated";
  }
  return result;
}

export async function analyzeRecipe(text: string, opts: AnalyzeOptions): Promise<RecipeAnalysis> {
  const parsed = parseRecipe(text);
  const servings = opts.servings && opts.servings > 0 ? opts.servings : parsed.servings ?? 1;

  const lines = await mapPool(parsed.lines, opts.concurrency ?? 4, (line) =>
    analyzeLine(line, opts.client, opts.overrides?.[line.index]),
  );

  const counted = lines.filter((l) => (l.status === "matched" || l.status === "estimated") && l.nutrients);
  const totals = sumNutrients(counted.map((l) => l.nutrients!));

  return {
    servings,
    lines,
    totals,
    perServing: divideTotals(totals, servings),
    uncountedLines: lines.filter((l) => l.status === "needs_review").length,
  };
}
