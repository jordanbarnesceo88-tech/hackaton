# Design: Exportable One-Page ROI Report

> Status: approved via brainstorming 2026-08-31. Backlog #3 (client walk-away). A shareable,
> login-gated, print-to-PDF **one-page** report generated from a saved analysis — facility,
> solution, assumptions, ROI/NPV/payback, the sensitivity tornado, and data provenance. No new
> dependencies; pure reuse of the existing engine + components.

## Goal & context

A client wants a tangible artifact to take away. Today the analysis lives only on the interactive
calculate page. This adds a branded `/report/[analysisId]` page that renders as a clean A4 sheet
and prints to PDF via the browser — a URL a presenter can share and a document a client can keep.

### Decisions locked in brainstorming
- **Mechanism: print-styled HTML route + browser "Save as PDF"** (`window.print()`). Zero new
  deps, serverless-safe, reuses React/Tailwind. (Rejected: `@react-pdf/renderer` — big dep +
  parallel UI code; Puppeteer — heavy/fragile in serverless.)
- **Source: a saved analysis** (`/report/[analysisId]`) — shareable, login-gated, reuses the
  saved-analysis data + the P2 recompute/divergence logic. (Rejected: anonymous live-state print
  — not shareable; "both" — v1 scope creep.)

## Architecture & data flow

```
/report/[analysisId] (server component, under (app))
  auth() → redirect("/login") if unauthenticated
  getSavedAnalysis(analysisId, session.user.id)  → null (not owned/unknown) ⇒ notFound()
  getSolutionForCalc(saved.solutionId) + getAssumptions()  (for display context)
  params/assumptions ← saved (typed)
  result ← computeEconomics(capacity, params, assumptions)      // recompute, same as P2
  bars   ← sensitivity(capacity, params, assumptions)
  dataChanged ← resultsDiverged(saved.results, result)          // reuse P2 helper
        │
        ▼
  <ReportView …/> (server-rendered print layout) + <PrintButton/> (client, window.print())
```

No new economics, no new query — `getSavedAnalysis`, `getSolutionForCalc`, `getAssumptions`,
`computeEconomics`, `sensitivity`, `resultsDiverged`, `isCalculable` all already exist and are
tested. Ownership scoping is inherited from `getSavedAnalysis(id, userId)` — **no new IDOR
surface**.

## Report content (one A4 page, top-to-bottom)

1. **Header bar** — app name + accent rule; `Отчёт ROI: {saved.name}`; generation date
   (`toLocaleDateString("ru-RU")`, pinned like `formatCost`).
2. **Object & solution** — facility type (industry) · solution name + vendor · the **provenance
   badge** (демо-данные / открытый источник ↗) so the data's nature is on the artifact.
3. **Parameters & assumptions** — area, ops/day, displaced staff; the key assumptions
   (labor cost, replacement %, residual %, discount rate, ROI horizon, asset life). Compact
   two-column list.
4. **Results** (headline block) — displaced FTE, CAPEX (+ **"оценка цены … по середине
   диапазона"** when `priceEstimated`), OPEX/yr, baseline labor, annual savings, **simple +
   discounted payback, simple ROI, NPV**. `no_savings` → "не окупается"; non-calculable →
   "проверьте параметры".
5. **Sensitivity** — the NPV tornado (reuse `SensitivityChart`, `md:col-span` removed / print
   width); hidden when `bars` is empty.
6. **Provenance & disclaimer footer** — citation link(s) for a `PARSED` solution + the
   plain-language close: *"Показатели — независимая оценка по открытым данным; цены —
   оценочные диапазоны, не оферта. Проверьте перед принятием решения."* Plus the `dataChanged`
   note when the stored numbers drifted.

**Reuse:** `computeEconomics`, `sensitivity`, `SensitivityChart`, `formatCost`, `formatYearsRu`,
`isCalculable`. **Not** the recommendation panel (a report is about the chosen solution).

### Small refactors for reuse (two helpers are currently private)
The report shares two pieces that today live inline in a page and must be extracted first
(DRY — else the report duplicates them):
- **`resultsDiverged`** — currently a local function in `app/(app)/calculate/[solutionId]/page.tsx`.
  Extract to `lib/analyses/diverged.ts` (pure); the calculate page imports it; the report imports it.
- **`Provenance`** badge — currently a local component in `app/(app)/compare/[type]/page.tsx`.
  Extract to `components/provenance-badge.tsx`; the compare page imports it; the report imports it.
Both extractions are behavior-preserving (the existing pages must still build + 101 tests green).

**Brand:** a clean, professional print identity (accent bar, typographic hierarchy) — a full
visual-identity system is backlog **#5**; this uses a tasteful minimal treatment.

## Print styling & controls

- `@page { size: A4; margin: 14mm }`; a `.no-print` utility hides the site header + the print
  button in the printed output (`@media print { .no-print { display: none } }`).
- `break-inside: avoid` on the results and tornado blocks so they don't split across pages.
- The report also renders as a normal viewable page (the shareable URL works in-browser); print
  produces the PDF.
- **`<PrintButton>`** — small client component ("Печать / Сохранить PDF") calling
  `window.print()`; itself `.no-print`.

## Entry points
- **`/analyses` list** — an **"Отчёт"** link next to the existing "Открыть" → `/report/[id]`.
- **Calculate save-success** — `SaveControl` already gets `res.id` from `saveAnalysisAction`;
  on success show an **"Открыть отчёт"** link to `/report/[res.id]`.

## Edge cases
- Unauthenticated → `redirect("/login")`; not-owned/unknown id → `notFound()`.
- `invalid_inputs` → neutral "проверьте параметры", tornado hidden.
- `no_savings` → "Решение не окупается" in the results block.
- `dataChanged` (stored ≠ recomputed) → the divergence note prints.
- SEED vs PARSED provenance rendering; estimated-price note only when `priceEstimated`.
- Print hides all interactive chrome; on-screen the page is still readable/shareable.

## Testing
- **No new economics logic** — pure reuse of already-tested `computeEconomics`/`sensitivity`/
  `resultsDiverged`/`isCalculable`; the **existing 101 tests stay green**.
- The report route is a presentational server component behind auth → **build typecheck + a
  logged-in manual/print check**. (Auth-gated routes are impractical to smoke via plain `fetch`
  with no session; full flow coverage is the E2E backlog #7.)
- If any non-trivial pure formatting helper is extracted (e.g. a date formatter), it gets a unit
  test; otherwise none needed.

## Out of scope (later)
- Full brand/visual-identity system + WCAG pass (#5).
- E2E coverage of the report flow (#7).
- Anonymous / live-state report; a real PDF-library download; multi-page / multi-solution reports.
