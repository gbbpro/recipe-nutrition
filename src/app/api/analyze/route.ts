import { FatalLookupError, analyzeRecipe } from "@/lib/nutrition/analyze";
import { createFdcClient } from "@/lib/nutrition/fdc";

const MAX_TEXT_LENGTH = 10_000;

/**
 * POST /api/analyze
 * Body: { text: string, servings?: number, overrides?: { [lineIndex]: fdcId } }
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { text, servings, overrides } = (body ?? {}) as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "`text` is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: `Recipe text is limited to ${MAX_TEXT_LENGTH} characters` }, { status: 413 });
  }
  if (servings !== undefined && (typeof servings !== "number" || !(servings > 0) || servings > 1000)) {
    return Response.json({ error: "`servings` must be a positive number" }, { status: 400 });
  }

  const cleanOverrides: Record<number, number> = {};
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      const idx = Number(k);
      if (Number.isInteger(idx) && typeof v === "number" && Number.isInteger(v) && v > 0) cleanOverrides[idx] = v;
    }
  }

  try {
    const result = await analyzeRecipe(text, {
      client: createFdcClient(),
      servings: servings as number | undefined,
      overrides: cleanOverrides,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof FatalLookupError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("analyze failed", err);
    return Response.json({ error: "Analysis failed" }, { status: 500 });
  }
}
