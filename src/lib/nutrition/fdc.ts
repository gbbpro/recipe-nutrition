import "server-only";
import { FatalLookupError } from "./analyze";
import type { FdcClient, FdcDataType, FdcFood, FdcSearchFood } from "./types";

/** Overridable for tests / a local mock. */
const BASE_URL = process.env.USDA_BASE_URL ?? "https://api.nal.usda.gov/fdc/v1";
const THIRTY_DAYS = 60 * 60 * 24 * 30;
const MAX_CACHE_ENTRIES = 5000;

/**
 * In-process cache. Good enough for dev and a single server; swap for Redis/Postgres
 * (keyed the same way) when you deploy to serverless or run multiple instances.
 * Promises are cached so concurrent lookups for the same food share one request.
 */
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  value.catch(() => cache.delete(key));
  cache.set(key, { expires: Date.now() + THIRTY_DAYS * 1000, value });
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

async function request<T>(path: string, init: RequestInit, apiKey: string): Promise<T> {
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (res.status === 429) {
    throw new FatalLookupError("USDA rate limit reached (1,000 requests/hour). Try again later.", 429);
  }
  if (res.status === 401 || res.status === 403) {
    throw new FatalLookupError("USDA rejected the API key. Check USDA_API_KEY in .env.local.", 500);
  }
  if (!res.ok) throw new Error(`USDA ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function createFdcClient(apiKey = process.env.USDA_API_KEY): FdcClient {
  if (!apiKey) {
    throw new FatalLookupError(
      "USDA_API_KEY is not set. Get a free key at https://fdc.nal.usda.gov/api-key-signup and add it to .env.local.",
      500,
    );
  }

  return {
    search(query: string, dataTypes: FdcDataType[]) {
      const key = `search:${dataTypes.join("|")}:${query.toLowerCase()}`;
      return cached(key, async () => {
        const data = await request<{ foods?: FdcSearchFood[] }>(
          "/foods/search",
          { method: "POST", cache: "no-store", body: JSON.stringify({ query, dataType: dataTypes, pageSize: 15 }) },
          apiKey,
        );
        return data.foods ?? [];
      });
    },

    getFood(fdcId: number) {
      return cached(`food:${fdcId}`, () =>
        request<FdcFood>(`/food/${fdcId}`, { method: "GET", cache: "no-store" }, apiKey),
      );
    },
  };
}
