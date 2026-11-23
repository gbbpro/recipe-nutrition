"use client";

import { useState } from "react";
import { NUTRIENT_META } from "@/lib/nutrition/nutrients";
import type { FoodMatchSummary, LineResult, LineStatus, NutrientKey, RecipeAnalysis } from "@/lib/nutrition/types";

const SAMPLE = `Serves 8
For the cookies:
2 1/4 cups all-purpose flour
1 tsp baking soda
1 tsp salt
1 cup unsalted butter, softened
3/4 cup granulated sugar
3/4 cup packed brown sugar
2 large eggs
2 tsp vanilla extract
2 cups semisweet chocolate chips
1 cup walnuts, chopped (optional)
flaky sea salt, for topping`;

const LABEL_ROWS: { key: NutrientKey; indent?: boolean }[] = [
  { key: "fat" },
  { key: "saturatedFat", indent: true },
  { key: "cholesterol" },
  { key: "sodium" },
  { key: "carbs" },
  { key: "fiber", indent: true },
  { key: "sugars", indent: true },
  { key: "protein" },
  { key: "calcium" },
  { key: "iron" },
  { key: "potassium" },
];

const STATUS_STYLE: Record<LineStatus, { label: string; className: string }> = {
  matched: { label: "Matched", className: "bg-emerald-100 text-emerald-800" },
  estimated: { label: "Estimated", className: "bg-amber-100 text-amber-800" },
  needs_review: { label: "Review", className: "bg-rose-100 text-rose-800" },
  excluded: { label: "Skipped", className: "bg-stone-200 text-stone-600" },
  header: { label: "", className: "" },
};

function fmt(n: number, unit: string) {
  const v = unit === "kcal" || unit === "mg" ? Math.round(n) : Math.round(n * 10) / 10;
  return `${v}${unit === "kcal" ? "" : " " + unit}`;
}

function describeParse(l: LineResult["line"]) {
  const qty =
    l.quantityMin !== null && l.quantityMax !== null
      ? `${l.quantityMin}–${l.quantityMax}`
      : l.quantity !== null
        ? `${Math.round(l.quantity * 100) / 100}`
        : "?";
  const parts = [qty, l.size, l.unit, l.packageSize ? `(${l.packageSize.quantity} ${l.packageSize.unit})` : null]
    .filter(Boolean)
    .join(" ");
  return parts;
}

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [servings, setServings] = useState("");
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [result, setResult] = useState<RecipeAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze(nextOverrides = overrides) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          servings: servings ? Number(servings) : undefined,
          overrides: nextOverrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function chooseFood(lineIndex: number, fdcId: number) {
    const next = { ...overrides, [lineIndex]: fdcId };
    setOverrides(next);
    analyze(next);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Recipe nutrition</h1>
        <p className="mt-1 text-stone-600">
          Paste an ingredient list, one per line. Data from USDA FoodData Central.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOverrides({}); // line indexes may shift
            }}
            rows={12}
            spellCheck={false}
            className="w-full rounded-lg border border-stone-300 bg-white p-4 font-mono text-sm leading-6 shadow-sm focus:border-stone-500 focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm text-stone-600">
              Servings{" "}
              <input
                type="number"
                min={1}
                value={servings}
                placeholder={result ? String(result.servings) : "auto"}
                onChange={(e) => setServings(e.target.value)}
                className="ml-1 w-20 rounded-md border border-stone-300 bg-white px-2 py-1"
              />
            </label>
            <button
              onClick={() => analyze()}
              disabled={loading || !text.trim()}
              className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
            {error && <p className="text-sm text-rose-700">{error}</p>}
          </div>
        </div>

        {result && <NutritionLabel result={result} />}
      </section>

      {result && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Ingredients</h2>
          {result.uncountedLines > 0 && (
            <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {result.uncountedLines} line{result.uncountedLines > 1 ? "s" : ""} need review and{" "}
              {result.uncountedLines > 1 ? "are" : "is"} not in the totals.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Parsed</th>
                  <th className="px-3 py-2">USDA match</th>
                  <th className="px-3 py-2 text-right">Grams</th>
                  <th className="px-3 py-2 text-right">kcal</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((r) => (
                  <Row key={r.line.index} r={r} onChoose={chooseFood} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Row({ r, onChoose }: { r: LineResult; onChoose: (i: number, id: number) => void }) {
  if (r.status === "header") {
    return (
      <tr className="border-t border-stone-200 bg-stone-50">
        <td colSpan={6} className="px-3 py-2 font-medium">{r.line.name}</td>
      </tr>
    );
  }
  const s = STATUS_STYLE[r.status];
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="px-3 py-2">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
      </td>
      <td className="px-3 py-2">
        <div>{r.line.raw}</div>
        {r.message && <div className="mt-1 text-xs text-rose-700">{r.message}</div>}
      </td>
      <td className="px-3 py-2 text-stone-600">
        {r.status !== "excluded" && (
          <>
            <span className="font-mono text-xs">{describeParse(r.line)}</span>
            <div className="font-medium text-stone-800">{r.line.name}</div>
            {r.line.notes.length > 0 && <div className="text-xs">{r.line.notes.join(", ")}</div>}
            {r.line.optional && <div className="text-xs italic">optional</div>}
          </>
        )}
      </td>
      <td className="px-3 py-2">
        {r.candidates.length > 0 && <MatchPicker r={r} onChoose={onChoose} />}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" title={r.grams?.detail}>
        {r.grams ? Math.round(r.grams.grams) : "—"}
        {r.grams?.estimated && <span className="text-amber-700">*</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {r.nutrients?.calories != null ? Math.round(r.nutrients.calories) : "—"}
      </td>
    </tr>
  );
}

function MatchPicker({ r, onChoose }: { r: LineResult; onChoose: (i: number, id: number) => void }) {
  const [extra, setExtra] = useState<FoodMatchSummary[]>([]);
  const options = [...r.candidates, ...extra.filter((e) => !r.candidates.some((c) => c.fdcId === e.fdcId))];

  async function search() {
    const q = window.prompt("Search USDA for:", r.line.name);
    if (!q) return;
    const res = await fetch(`/api/foods?q=${encodeURIComponent(q)}&branded=1`);
    const data = await res.json();
    if (res.ok) setExtra(data.foods);
  }

  return (
    <div className="flex max-w-sm flex-col gap-1">
      <select
        value={r.match?.fdcId ?? ""}
        onChange={(e) => onChoose(r.line.index, Number(e.target.value))}
        className="w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-xs"
      >
        {!r.match && <option value="">Choose a food…</option>}
        {options.map((c) => (
          <option key={c.fdcId} value={c.fdcId}>
            {c.description} · {c.dataType}
          </option>
        ))}
      </select>
      <button onClick={search} className="self-start text-xs text-stone-500 underline hover:text-stone-800">
        Search USDA…
      </button>
    </div>
  );
}

function NutritionLabel({ result }: { result: RecipeAnalysis }) {
  const ps = result.perServing;
  const cell = (key: NutrientKey) => {
    const t = ps[key];
    return (
      <span className="tabular-nums">
        {fmt(t.value, NUTRIENT_META[key].unit)}
        {t.incomplete && <span title="Some ingredients have no USDA value for this nutrient">+</span>}
      </span>
    );
  };
  return (
    <aside className="w-full min-w-64 self-start border-2 border-stone-900 bg-white p-3 font-sans md:w-72">
      <h2 className="text-3xl font-black leading-none">Nutrition Facts</h2>
      <p className="mt-1 border-b-8 border-stone-900 pb-1 text-sm">
        {result.servings} serving{result.servings === 1 ? "" : "s"} per recipe
      </p>
      <div className="flex items-end justify-between border-b-4 border-stone-900 py-1">
        <span className="text-sm font-bold">
          Amount per serving
          <br />
          <span className="text-2xl font-black">Calories</span>
        </span>
        <span className="text-3xl font-black">{cell("calories")}</span>
      </div>
      <ul className="text-sm">
        {LABEL_ROWS.map(({ key, indent }) => (
          <li key={key} className={`flex justify-between border-b border-stone-300 py-0.5 ${indent ? "pl-4" : "font-semibold"}`}>
            <span>{NUTRIENT_META[key].label}</span>
            {cell(key)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-stone-500">
        * estimated weight · + some ingredients lack data for this nutrient. Values are estimates
        from USDA FoodData Central.
      </p>
    </aside>
  );
}
