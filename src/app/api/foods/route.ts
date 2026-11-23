import { FatalLookupError } from "@/lib/nutrition/analyze";
import { createFdcClient } from "@/lib/nutrition/fdc";
import { FALLBACK_DATA_TYPES, PRIMARY_DATA_TYPES, summarize } from "@/lib/nutrition/match";

/**
 * GET /api/foods?q=greek+yogurt&branded=1
 * Manual USDA search so users can fix a match the pipeline got wrong.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) return Response.json({ error: "`q` is required" }, { status: 400 });

  const dataTypes = url.searchParams.get("branded") === "1"
    ? [...PRIMARY_DATA_TYPES, ...FALLBACK_DATA_TYPES]
    : PRIMARY_DATA_TYPES;

  try {
    const foods = await createFdcClient().search(q.slice(0, 100), dataTypes);
    return Response.json({ foods: foods.slice(0, 15).map(summarize) });
  } catch (err) {
    if (err instanceof FatalLookupError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: "Search failed" }, { status: 502 });
  }
}
