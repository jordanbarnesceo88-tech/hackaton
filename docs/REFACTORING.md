# Refactoring Backlog

> Status: not started. Captured 2026-08-24 after the 4-week build completed (all weeks merged
> to master). This is OPTIONAL, behavior-preserving cleanup of a working, fully-reviewed,
> demo-ready codebase — nothing here is required. Do it on a branch (`refactor-pass`), keep
> `npm run build` + `npx vitest run` green after each item, and review before merge.
> Requested to be done with Opus 4.8 (was unavailable when this was captured).

## Prioritized items

### High value — structural

1. **Decompose `components/economics-calculator.tsx` (~221 lines, 5 responsibilities).**
   It owns the params form, results panel, assumptions panel, save control, AND composes the
   visualization, plus the NaN-guard and save wiring. Extract:
   - `<ParamsForm params assumptions… />` — the "Параметры объекта" card (incl. the isStock
     `peakConcurrent` field).
   - `<ResultsPanel result />` — the "Результаты" card incl. the `resultsFinite` guard + the
     economical / "не окупается" branches.
   - `<AssumptionsPanel assumptions onChange />` — the "Допущения" card.
   - `<SaveControl … />` — the save button + `saveMsg` states + the login prompt.
   The calculator becomes a thin shell holding the shared `params`/`assumptions` state and
   composing these + `<FacilityVisualization>`. Behavior-preserving; all pure logic already
   lives in `lib/economics`, so no test churn. *(Medium effort, low risk — biggest clarity win.)*

2. **Extract `NumField`** (currently private in the calculator) to a shared component
   (e.g. `components/ui/num-field.tsx`). It's a generic number input the auth/other forms
   could reuse. *(Small.)*

### Small cleanups

3. **Remove the dead `redirect` import** in `lib/auth/actions.ts` (unused; flagged in Week 4
   review). *(Trivial.)*

4. **DRY the finiteness check** — add `isFiniteResult(result)` to `lib/economics` and reuse it
   in the calculator's `resultsFinite` and the visualization's guards (currently duplicated
   across `components/economics-calculator.tsx` and `components/facility-visualization.tsx`).
   *(Small.)*

5. **Log server-action errors** — `saveAnalysisAction`'s catch (`lib/analyses/actions.ts`)
   swallows the error; add a `console.error(...)` before returning the generic client result
   (keep the generic response — don't leak details to the client). *(Small; prod diagnosability.)*

### Behavior-visible (a small UX change, not pure refactor)

6. **Show only calculator fields the current basis/engine uses.** `areaM2` is captured but not
   consumed by the engine; `turnoverPerDay` only matters for `CONCURRENT_STOCK`;
   `operatingHoursPerDay` only for `PER_HOUR_FLOW`. Hide/disable the irrelevant ones per the
   selected solution's `capacityBasis` so editing a field always visibly changes the result.
   *(Medium; behavior-visible — treat as a small feature, get sign-off.)*

## Deliberately NOT refactoring

- The pure engines (`lib/economics`, `lib/scene`) are already DRY and well-bounded (DRY
  helpers `capacityPerYear`/`demandPerYear` shared; per-vertical layout functions small).
- The query layer (`lib/db/queries.ts`) is clean and consistently `userId`-scoped.
- Churning these would be gold-plating a working, reviewed codebase.

## Related (separate from refactoring — see other docs)

- Pre-production **security hardening** (rate-limiting, security headers): `docs/DEPLOY.md §5`.
- Deferred economics/viz findings for future feature work: `docs/02-execution-plan.md §8`.
- Other minor fast-follows noted in reviews: save-button double-submit disable; "лет"→"года"
  RU pluralization in the viz; canvas devicePixelRatio scaling; zod-validate the saved-analysis
  payload; engine-side guard for zero-valued assumption divisors.
