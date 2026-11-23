# Recipe Nutrition

Paste an ingredient list → get a per-serving nutrition label, using USDA FoodData Central.

## Quick start

```bash
npm install
echo "USDA_API_KEY=your-key-here" > .env.local
npm run dev                    # http://localhost:3000
npm test                       # unit tests, no network needed
```

Get a free key at https://fdc.nal.usda.gov/api-key-signup (1,000 requests/hour).
`DEMO_KEY` works for a quick look but is heavily rate-limited.

**On Vercel:** add `USDA_API_KEY` under Project Settings → Environment Variables, then
redeploy (new variables only apply to new deployments).

## How it works

```
text ─▶ parse.ts ─▶ match.ts ─▶ fdc.ts (USDA) ─▶ portions.ts ─▶ nutrients.ts ─▶ totals
        quantity    clean name   search +          grams          per-100g × g
        unit        alias table  food detail       (portion /     unknown ≠ 0
        name/notes  scoring                        density /
                                                   fallbacks)
```

| File | Job |
|---|---|
| `src/lib/nutrition/parse.ts` | Line → `{ quantity, unit, size, name, notes, packageSize }`. Wraps `parse-ingredient` and adds: number words, size words, `1 (14 oz) can`, `1 14-ounce can`, `juice of 1 lemon`, fl oz vs oz, `T`/`t`, ranges, dozen, `or` alternatives, `to taste` / `for frying` exclusions, section headers, `Serves 4`. |
| `src/lib/nutrition/match.ts` | Cleans names for search, an alias table steering ~100 common ingredients to the right USDA entry, and candidate scoring (SR Legacy > Foundation > FNDDS > Branded). |
| `src/lib/nutrition/fdc.ts` | Server-only USDA client with an in-memory cache. |
| `src/lib/nutrition/portions.ts` | Grams from mass, package size, USDA `foodPortions` (normalizes the SR Legacy / Foundation / FNDDS shapes), then density and per-item fallback tables. |
| `src/lib/nutrition/nutrients.ts` | Per-100 g nutrient extraction with id fallbacks (e.g. energy 1008 → 2048 → 2047 for Foundation foods). |
| `src/lib/nutrition/analyze.ts` | The pipeline. Takes an injectable `FdcClient`, so tests run on fixtures. |
| `src/app/api/analyze/route.ts` | `POST { text, servings?, overrides? }` → `RecipeAnalysis` |
| `src/app/api/foods/route.ts` | `GET ?q=…&branded=1` manual USDA search for fixing matches |
| `src/app/page.tsx` | UI: textarea, nutrition label, per-line table with status and a match picker |

### Line statuses

- **matched**: confident match with a USDA weight. Counted.
- **estimated**: counted, but the grams came from a fallback (assumed density, typical egg/can size). Marked `*`.
- **needs_review**: not counted. No quantity, no match, low-confidence match, or no way to convert to grams.
- **excluded**: "to taste", "for frying", salt/pepper with no amount, and a recipe title
  pasted above the ingredients. Anything after an "Instructions"/"Directions"/"Method"
  line is ignored.
- **removed**: any line can be removed (and restored) in the UI; totals update instantly
  without new USDA calls.

Missing USDA nutrient values are tracked as *unknown*, and totals show `+` when incomplete,
so a missing fiber value doesn't silently read as 0 g.

## Before production

1. **Verify the alias table against the live API.** It was written against USDA's
   documented descriptions without live access. A wrong alias just falls back to normal
   scoring, but once you've confirmed a match, pin it with `pinnedFdcId` to skip the search.
2. **Swap the in-memory cache** in `fdc.ts` for Redis/Postgres when you deploy to serverless
   or run more than one instance. Food details rarely change, so cache them for a long time.
3. **Persist user overrides** (ingredient name → fdcId) so every user's corrections improve
   matching for everyone.
4. Overrides are keyed by line index, so they reset when the text is edited. That's fine for
   a single editing session, but key them by ingredient name once you save recipes.

`USDA_BASE_URL` can point the client at a mock server for local testing.
