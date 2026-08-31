# Exportable One-Page ROI Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shareable, login-gated `/report/[analysisId]` page that renders a branded one-page ROI report from a saved analysis and prints to PDF via the browser (`window.print()`).

**Architecture:** A print-styled server route recomputes economics + sensitivity from the saved analysis (reusing the P2 recompute/divergence logic) and renders a single A4 sheet. Two currently-private helpers (`resultsDiverged`, the `Provenance` badge) are extracted to shared modules first. No new dependencies, no new economics.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind v4, Prisma 7. No new deps.

**Spec:** `docs/superpowers/specs/2026-08-31-exportable-report-design.md`

## Global Constraints

- **Never commit to `master`.** Branch `exportable-report` (already checked out).
- **Prisma 7:** DB via Docker on host **5433** (already up). Run tests `npx --yes vitest run < /dev/null`; build `npm run build` (exit 0).
- **The existing 101 tests MUST stay green** after every task. Extractions (Tasks 1–2) are behavior-preserving.
- **No new economics** — pure reuse of `computeEconomics`, `sensitivity`, `resultsDiverged`, `isCalculable`. **Do not change any output number.**
- **UI is Russian.** Money via `formatCost(usd, usdToRub)`, years via `formatYearsRu`.

## File structure

- `lib/analyses/diverged.ts` — CREATE: extracted `resultsDiverged` (+ test).
- `app/(app)/calculate/[solutionId]/page.tsx` — MODIFY: import it, remove the local copy.
- `components/provenance-badge.tsx` — CREATE: extracted `ProvenanceBadge`.
- `app/(app)/compare/[type]/page.tsx` — MODIFY: import it, remove the local `Provenance`.
- `components/report/print-button.tsx` — CREATE: client print button.
- `app/globals.css` — MODIFY: print rules.
- `components/site-header.tsx` — MODIFY: `no-print` on the root (hide in printed PDF).
- `app/(app)/report/[analysisId]/page.tsx` — CREATE: the report route.
- `app/(app)/analyses/page.tsx` — MODIFY: add an "Отчёт" link.
- `components/calculator/save-control.tsx` — MODIFY: "Открыть отчёт" link on save success.
- `CHANGELOG.md` — MODIFY.

---

### Task 1: Extract `resultsDiverged` to a shared module (+ unit test)

**Files:**
- Create: `lib/analyses/diverged.ts`
- Test: `lib/analyses/diverged.test.ts`
- Modify: `app/(app)/calculate/[solutionId]/page.tsx`

**Interfaces:**
- Produces: `resultsDiverged(stored: unknown, recomputed: EconomicsResult): boolean` from `lib/analyses/diverged.ts`.

- [ ] **Step 1: Create `lib/analyses/diverged.ts`** with the exact function currently in the calculate page:

```ts
import type { EconomicsResult } from "@/lib/economics/types";

/**
 * True when a stored saved-analysis `results` blob differs from a fresh recompute — a changed
 * discriminant (economical / reason) or any numeric output field drifting beyond a tiny
 * tolerance. Used to flag stale saved analyses on revisit and in the report.
 */
export function resultsDiverged(stored: unknown, recomputed: EconomicsResult): boolean {
  if (!stored || typeof stored !== "object") return true;
  const s = stored as Record<string, unknown>;
  const now = recomputed as Record<string, unknown>;
  if (s.economical !== now.economical) return true;
  if (now.reason !== undefined && s.reason !== now.reason) return true;
  for (const [k, v] of Object.entries(now)) {
    if (typeof v !== "number") continue;
    const then = s[k];
    if (typeof then !== "number") return true;
    if (Math.abs(v - then) / Math.max(1, Math.abs(v)) > 1e-6) return true;
  }
  return false;
}
```

- [ ] **Step 2: Write `lib/analyses/diverged.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { resultsDiverged } from "./diverged";
import { computeEconomics } from "@/lib/economics/calculate";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";
import type { SolutionCapacity, FacilityParams } from "@/lib/economics/types";

const cap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW", priceUsd: 50000,
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
const r = computeEconomics(cap, params, DEFAULT_ASSUMPTIONS);

describe("resultsDiverged", () => {
  it("is false when stored equals the recompute", () => {
    expect(resultsDiverged({ ...r }, r)).toBe(false);
  });
  it("is true when a numeric field drifts beyond tolerance", () => {
    if (!r.economical) throw new Error("expected economical");
    expect(resultsDiverged({ ...r, npvUsd: r.npvUsd * 1.5 }, r)).toBe(true);
  });
  it("is true when the economical discriminant differs", () => {
    expect(resultsDiverged({ economical: false, reason: "no_savings" }, r)).toBe(true);
  });
  it("is true for a null / non-object stored blob", () => {
    expect(resultsDiverged(null, r)).toBe(true);
  });
  it("tolerates tiny float noise", () => {
    if (!r.economical) throw new Error("expected economical");
    expect(resultsDiverged({ ...r, npvUsd: r.npvUsd + 1e-9 }, r)).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx --yes vitest run lib/analyses/diverged < /dev/null` → PASS (5).

- [ ] **Step 4: Update the calculate page** (`app/(app)/calculate/[solutionId]/page.tsx`): delete the local `function resultsDiverged(…) { … }` definition and add near the other imports:
```ts
import { resultsDiverged } from "@/lib/analyses/diverged";
```
(All call sites stay the same.)

- [ ] **Step 5: Verify build + full suite** — `npm run build` (exit 0), `npx --yes vitest run < /dev/null` → 106 passed (101 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add lib/analyses/diverged.ts lib/analyses/diverged.test.ts "app/(app)/calculate/[solutionId]/page.tsx"
git commit -m "refactor: extract resultsDiverged to lib/analyses/diverged (+ unit test)"
```

---

### Task 2: Extract the `Provenance` badge to a shared component

**Files:**
- Create: `components/provenance-badge.tsx`
- Modify: `app/(app)/compare/[type]/page.tsx`

**Interfaces:**
- Produces: `ProvenanceBadge({ source, sourceUrl }: { source: string; sourceUrl: string | null })`.

- [ ] **Step 1: Create `components/provenance-badge.tsx`** — the component currently inline in the compare page, renamed `ProvenanceBadge`:

```tsx
// Data-provenance badge: honest labelling of where a solution's data came from.
export function ProvenanceBadge({
  source,
  sourceUrl,
}: {
  source: string;
  sourceUrl: string | null;
}) {
  const base = "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium";
  if (source === "ORGANIZER") {
    return <span className={`${base} bg-emerald-100 text-emerald-800`}>данные организатора</span>;
  }
  if (source === "PARSED") {
    return sourceUrl ? (
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
        className={`${base} bg-blue-100 text-blue-800 underline`}>открытый источник ↗</a>
    ) : (
      <span className={`${base} bg-blue-100 text-blue-800`}>открытый источник</span>
    );
  }
  return <span className={`${base} bg-amber-100 text-amber-800`}>демо-данные</span>;
}
```

- [ ] **Step 2: Update the compare page** (`app/(app)/compare/[type]/page.tsx`): delete the local `function Provenance(…) { … }` and its usage `<Provenance …/>`; import and use the shared one:
```ts
import { ProvenanceBadge } from "@/components/provenance-badge";
```
Replace `<Provenance source={s.source} sourceUrl={s.sourceUrl} />` with
`<ProvenanceBadge source={s.source} sourceUrl={s.sourceUrl} />`.

- [ ] **Step 3: Verify build + suite** — `npm run build` (exit 0), `npx --yes vitest run < /dev/null` (106). Smoke `/compare/warehouse` still shows "открытый источник" (dev server + fetch).

- [ ] **Step 4: Commit**

```bash
git add components/provenance-badge.tsx "app/(app)/compare/[type]/page.tsx"
git commit -m "refactor: extract ProvenanceBadge to a shared component"
```

---

### Task 3: Print button + print CSS

**Files:**
- Create: `components/report/print-button.tsx`
- Modify: `app/globals.css`
- Modify: `components/site-header.tsx`

**Interfaces:**
- Produces: `<PrintButton/>` (client) and a `.no-print` utility + `@page` rules.

- [ ] **Step 1: Create `components/report/print-button.tsx`**:

```tsx
"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-md border px-3 py-2 text-sm font-medium"
    >
      Печать / Сохранить PDF
    </button>
  );
}
```

- [ ] **Step 2: Add print rules to `app/globals.css`** (append at the end):

```css
@media print {
  .no-print {
    display: none !important;
  }
}

@page {
  size: A4;
  margin: 14mm;
}

.report-block {
  break-inside: avoid;
}
```

- [ ] **Step 3: Hide the site header in print** — in `components/site-header.tsx`, add `no-print`
to the root element's `className` (e.g. the outer `<header>`/`<div>`), so it does not appear in
the printed PDF. (Add the token to the existing className string; change nothing else.)

- [ ] **Step 4: Verify build** — `npm run build` (exit 0). (Suite unaffected: 106.)

- [ ] **Step 5: Commit**

```bash
git add components/report/print-button.tsx app/globals.css components/site-header.tsx
git commit -m "feat: print button + A4 print CSS (.no-print, @page)"
```

---

### Task 4: The report route

**Files:**
- Create: `app/(app)/report/[analysisId]/page.tsx`

**Interfaces:**
- Consumes: `getSavedAnalysis`, `getSolutionForCalc`, `getAssumptions`, `assumptionsToValues`, `computeEconomics`, `sensitivity`, `resultsDiverged` (Task 1), `isCalculable`, `formatCost`, `formatYearsRu`, `SensitivityChart`, `ProvenanceBadge` (Task 2), `PrintButton` (Task 3).

- [ ] **Step 1: Create `app/(app)/report/[analysisId]/page.tsx`**:

```tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSavedAnalysis, getSolutionForCalc, getAssumptions } from "@/lib/db/queries";
import { computeEconomics } from "@/lib/economics/calculate";
import { sensitivity } from "@/lib/economics/sensitivity";
import { resultsDiverged } from "@/lib/analyses/diverged";
import { isCalculable } from "@/lib/economics/types";
import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { SensitivityChart } from "@/components/calculator/sensitivity-chart";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { PrintButton } from "@/components/report/print-button";
import type {
  FacilityParams,
  AssumptionValues,
  SolutionCapacity,
} from "@/lib/economics/types";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const saved = await getSavedAnalysis(analysisId, session.user.id);
  if (!saved) notFound();

  const solution = await getSolutionForCalc(saved.solutionId);
  if (!solution) notFound();

  const p = saved.params as FacilityParams;
  const a = saved.assumptions as AssumptionValues;
  const capacity: SolutionCapacity = {
    capacityPerUnit: solution.capacityPerUnit,
    capacityBasis: solution.capacityBasis,
    priceUsd: solution.priceUsd,
    maintenanceUsdYear: solution.maintenanceUsdYear,
    energyUsdYear: solution.energyUsdYear,
    licensingUsdYear: solution.licensingUsdYear,
  };
  const result = computeEconomics(capacity, p, a);
  const bars = sensitivity(capacity, p, a);
  const dataChanged = resultsDiverged(saved.results, result);
  const money = (usd: number) => formatCost(usd, a.usdToRub);
  const hasNumbers = isCalculable(result);
  const ft = solution.solutionCategory.facilityType;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <header className="border-b-2 border-sky-600 pb-3">
        <div className="text-xs font-medium uppercase tracking-wide text-sky-700">
          Robotization ROI
        </div>
        <h1 className="text-2xl font-semibold">Отчёт ROI: {saved.name}</h1>
        <div className="text-xs text-muted-foreground">
          Сформировано {new Date().toLocaleDateString("ru-RU")}
        </div>
      </header>

      <section className="report-block mt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Объект и решение</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>{ft.name} ({ft.industry.name})</span>
          <span>·</span>
          <b>{solution.name}</b>
          <span className="text-muted-foreground">{solution.vendor}</span>
          <ProvenanceBadge source={solution.source} sourceUrl={solution.sourceUrl} />
        </div>
      </section>

      <section className="report-block mt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Параметры и допущения</h2>
        <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <div>Площадь: {p.areaM2} м²</div>
          <div>Стоимость труда: {money(a.laborCostPerHourUsd)}/час</div>
          <div>Операций в сутки: {p.opsPerDay}</div>
          <div>Замещение труда: {(a.laborReplacementPct * 100).toFixed(0)}%</div>
          <div>Персонал (замещаемый): {p.staffCount}</div>
          <div>Ставка дисконтирования: {(a.discountRate * 100).toFixed(0)}%</div>
          <div>Горизонт ROI: {a.roiHorizonYears} лет</div>
          <div>Срок службы техники: {a.assetLifeYears} лет</div>
        </div>
      </section>

      <section className="report-block mt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Экономика</h2>
        {!hasNumbers ? (
          <div className="mt-1 text-sm text-muted-foreground">Проверьте параметры расчёта</div>
        ) : (
          <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div>Требуется единиц: <b>{result.quantity}</b></div>
            <div>Замещается персонала (ЭПЗ): <b>{result.displacedFte.toFixed(1)}</b></div>
            <div>CAPEX: <b>{money(result.capexUsd)}</b></div>
            <div>OPEX/год: <b>{money(result.opexAnnualUsd)}</b></div>
            {result.economical ? (
              <>
                <div>Годовая экономия: <b>{money(result.annualSavingsUsd)}</b></div>
                <div>Срок окупаемости (простой): <b>{formatYearsRu(result.simplePaybackYears)}</b></div>
                <div>
                  Срок окупаемости (дисконт.):{" "}
                  <b>
                    {result.discountedPaybackYears === null
                      ? "не окупается в пределах горизонта"
                      : formatYearsRu(result.discountedPaybackYears)}
                  </b>
                </div>
                <div>ROI (простой): <b>{result.simpleRoiPct.toFixed(0)}%</b></div>
                <div>NPV: <b>{money(result.npvUsd)}</b></div>
              </>
            ) : (
              <div className="col-span-2 font-medium text-red-600">
                Решение не окупается при текущих параметрах
              </div>
            )}
          </div>
        )}
        {solution.priceEstimated &&
          solution.priceLowUsd != null &&
          solution.priceHighUsd != null && (
            <p className="mt-1 text-xs text-amber-700">
              Оценка цены: {money(solution.priceLowUsd)}–{money(solution.priceHighUsd)} · CAPEX по
              середине диапазона.
            </p>
          )}
      </section>

      {bars.length > 0 && (
        <section className="report-block mt-4">
          <SensitivityChart bars={bars} usdToRub={a.usdToRub} />
        </section>
      )}

      <footer className="mt-6 border-t pt-3 text-xs text-muted-foreground">
        {dataChanged && (
          <p className="mb-1 text-amber-700">
            Данные решения или модель расчёта изменились с момента сохранения — показатели
            пересчитаны по актуальным данным.
          </p>
        )}
        {solution.source === "PARSED" && solution.sourceUrl && (
          <p>
            Источник данных о решении:{" "}
            <a href={solution.sourceUrl} className="underline">{solution.sourceUrl}</a>
          </p>
        )}
        <p>
          Показатели — независимая оценка по открытым данным; цены — оценочные диапазоны, не
          оферта. Проверьте перед принятием решения.
        </p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build** — `npm run build` (exit 0, no TS errors). Full suite `npx --yes vitest run < /dev/null` still 106.

- [ ] **Step 3: Smoke the auth gate** (DB up + dev server). An unauthenticated fetch must redirect to login (the route exists and gates):
```bash
node -e '(async()=>{const r=await fetch("http://localhost:3000/report/whatever",{redirect:"manual"});
console.log("status",r.status,"| location",r.headers.get("location"));})();'
```
Expected: a redirect (307/302 or a 200 login page) — NOT a 500. Full rendered-report verification requires a logged-in session (manual: sign in, save an analysis, open `/report/{id}`, print-preview shows a clean one-pager). Note this in the report.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/report/[analysisId]/page.tsx"
git commit -m "feat: /report/[analysisId] one-page ROI report (print to PDF)"
```

---

### Task 5: Entry points + CHANGELOG

**Files:**
- Modify: `app/(app)/analyses/page.tsx`
- Modify: `components/calculator/save-control.tsx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an "Отчёт" link to the analyses list** (`app/(app)/analyses/page.tsx`). Next to
the existing "Открыть" `<Link>`, add:
```tsx
              <Link href={`/report/${a.id}`} className="underline">
                Отчёт
              </Link>
```
Wrap the two links in a `<span className="flex gap-3">` if they aren't already grouped, so both show.

- [ ] **Step 2: Show an "Открыть отчёт" link on save success** (`components/calculator/save-control.tsx`).
`saveAnalysisAction` returns `{ ok: true, id }`. Add a `savedId` state; set it on success; render a
link when present:
```tsx
  const [savedId, setSavedId] = useState<string | null>(null);
```
In `handleSave`, on `res.ok`: `setSavedId(res.id); setSaveMsg("Сохранено");`. Then in the JSX,
where `saveMsg` renders, add (when `savedId`):
```tsx
        {savedId && (
          <a href={`/report/${savedId}`} className="text-sm underline">
            Открыть отчёт
          </a>
        )}
```

- [ ] **Step 3: CHANGELOG "Added" entry** under `## [Unreleased]` describing the shareable
one-page `/report/[id]` (print-to-PDF), from a saved analysis, with results + sensitivity +
provenance + disclaimer; entry points from `/analyses` and post-save.

- [ ] **Step 4: Verify build + suite** — `npm run build` (exit 0), `npx --yes vitest run < /dev/null` (106).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/analyses/page.tsx" components/calculator/save-control.tsx CHANGELOG.md
git commit -m "feat: report entry points (analyses list + post-save link) + CHANGELOG"
```

---

## Whole-feature review (after Task 5)

- [ ] `npm run build` (exit 0) + `npx --yes vitest run < /dev/null` (106 green).
- [ ] `/code-review high` over `git diff master...HEAD`; fix findings.
- [ ] **Manual logged-in check:** sign in, save an analysis, open `/report/{id}`, verify the
  one-pager + print preview (A4, no site header/button in print).
- [ ] Merge to master with `--no-ff` only after review + user sign-off.
