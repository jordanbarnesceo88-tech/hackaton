# Design: ROI-Ranked Recommendation + Sensitivity Analysis

> Status: approved via brainstorming 2026-08-29. Sub-project #1 of the "award-winning" backlog
> (decision engine). Turns the per-solution calculator into a decision tool: for the user's
> facility, rank the alternatives in a category by real ROI and show which assumptions move the
> result most. Engine-only — no new economics model, no new infra. Behind the existing flow.

## Goal & context

The brief's headline value is an **independent comparison** that drives an investment decision.
Today Step 3 (`/calculate/[solutionId]`) computes ROI/NPV/payback for **one** chosen solution.
This adds two things on that same page, both computed live from the user's entered
`params`/`assumptions`:

1. **Recommendation** — rank the *other solutions in the same category* by NPV/payback, mark the
   best, and let the user switch the primary solution in place.
2. **Sensitivity** — a tornado chart of how much each key assumption swings the NPV, answering
   "are these numbers real?" by exposing the levers.

Scope decisions locked in brainstorming:
- **Ranking breadth: within each category** (substitutes), not across the whole facility
  (functionally-different categories aren't substitutes).
- **Placement: Step-3 calculate page** (approach A) — reuses the calculator's existing
  `params`/`assumptions` state and the pure engine.
- **Switching: in-place** via shell state (no navigation, params preserved).
- **Sensitivity metric: NPV**, one-at-a-time ±25% perturbation (custom per-assumption ranges are
  a later enhancement — out of scope).

## Architecture & data flow

```
/calculate/[solutionId] (server)
  getSolutionForCalc(id)          → primary solution (unchanged)
  getSiblingSolutions(id)  [NEW]  → all solutions in the SAME category (capacity + id/name/vendor)
        │
        ▼
  <EconomicsCalculator categorySolutions=… initialSelectedId=id … />  (client shell)
        │  state: params, assumptions, selectedSolutionId (seed = route id)
        │  primary = categorySolutions.find(selectedSolutionId)
        │  result  = computeEconomics(primary.capacity, params, assumptions)
        │  ranked  = rankSolutions(categorySolutions, params, assumptions)
        │  bars    = sensitivity(primary.capacity, params, assumptions)
        ├── <ResultsPanel result … />            (primary — unchanged)
        ├── <RecommendationPanel ranked selectedId onSelect=setSelectedSolutionId />  [NEW]
        ├── <SensitivityChart bars usdToRub />   [NEW]
        ├── <SaveControl solutionId=selectedSolutionId … />   (follows the switch)
        └── <FacilityVisualization capacity=primary.capacity result … />  (follows the switch)
```

All siblings share the primary's `capacityBasis` (same category), so one set of `params` ranks
them coherently. Ranking/sensitivity recompute reactively as the user edits inputs or switches.

### New query — `lib/db/queries.ts`

```ts
getSiblingSolutions(solutionId: string): Promise<SiblingSolution[]>
```
Resolves the solution's `solutionCategoryId`, returns every solution in that category ordered by
`name`, selecting: `id, name, vendor, priceUsd, capacityPerUnit, capacityUnit, capacityBasis,
maintenanceUsdYear, energyUsdYear, licensingUsdYear`. (The primary is included in the list.) The
row shape is exported as `SiblingSolution` from `queries.ts` — it is a `SolutionCapacity` plus
`{ id, name, vendor, capacityUnit }`, reused by `recommend.ts` and the shell.

## Engine modules (pure, unit-tested)

### Refactor — extract the finance step (`lib/economics/finance.ts`)

`computeEconomics` currently inlines the cash-flow → NPV/payback/ROI block and only exposes
`npvUsd` on the `economical: true` branch. A tornado needs NPV even when a perturbed scenario has
negative savings (otherwise bars truncate at 0 and mislead). Extract:

```ts
export function projectFinance(
  annualSavingsUsd: number, capexUsd: number, a: AssumptionValues
): { npvUsd: number; simplePaybackYears: number; simpleRoiPct: number; discountedPaybackYears: number | null }
```
It contains the exact logic currently in `calculate.ts` (horizon floor, whole-year re-CAPEX
cadence with `t < horizon`, `npv`, `discountedPaybackYears`, simple payback/ROI). `computeEconomics`
calls it on its economical branch — **behavior-identical**, verified by the unchanged 83 tests.

### `npvForScenario` (in `sensitivity.ts`)

```ts
export function npvForScenario(cap: SolutionCapacity, params: FacilityParams, a: AssumptionValues): number | null
```
Rebuilds `quantity`, `capex`, `opex`, `annualSavings` (via the same helpers `computeEconomics`
uses — `computeQuantity`, `demandPerYear`, the A1/A2 savings formula), then returns
`projectFinance(...).npvUsd` **allowing negative savings/NPV**. Returns `null` only for the
`invalid_inputs` conditions (same guards as `computeEconomics`: null quantity, non-positive
opsPerWorkerPerYear/horizon/assetLife, discountRate ≤ −1, non-finite money, non-positive capex).
To avoid duplicating the savings formula, factor a small **exported** `baseEconomics(cap, params, a)`
in `calculate.ts` that both `computeEconomics` and `npvForScenario` call, returning
`{ quantity, capexUsd, opexAnnualUsd, baselineAnnualUsd, annualSavingsUsd } | null` (`null` for all
the `invalid_inputs` conditions — the guards + finiteness sweep + non-positive capex live here).

### `lib/economics/recommend.ts`

```ts
export type RankedSolution = { id: string; name: string; vendor: string; result: EconomicsResult };
export function rankSolutions(
  siblings: SiblingSolution[], params: FacilityParams, a: AssumptionValues
): RankedSolution[];
```
Computes `computeEconomics` per sibling; sorts by:
1. **economical** (has `npvUsd`) before `no_savings` before `invalid_inputs`;
2. within economical, **`npvUsd` desc**;
3. deterministic tiebreak by `name` asc.
The UI marks index-0-if-economical as ★ and flags the currently-selected id.

### `lib/economics/sensitivity.ts`

```ts
export type SensitivityBar = { key: keyof AssumptionValues; baseNpv: number; lowNpv: number; highNpv: number; swing: number };
export function sensitivity(
  cap: SolutionCapacity, params: FacilityParams, a: AssumptionValues, deltaPct?: number
): SensitivityBar[];
```
`deltaPct` default `0.25`. Base NPV = `npvForScenario(cap, params, a)`; if `null`, return `[]`.
For each key in the fixed set below, recompute NPV with `a[key] * (1 ± deltaPct)`,
`swing = |highNpv − lowNpv|`, drop keys whose low/high is `null`, sort by `swing` desc.

Perturbed keys (economically meaningful; excludes display-only `usdToRub` and the
basis/timing constants `workingDaysPerYear`, `operatingHoursPerDay`, `turnoverPerDay`,
`hoursPerYear`):
`laborCostPerHourUsd, laborReplacementPct, opsPerWorkerPerYear, residualSupervisionPct,
installPctOfCapex, discountRate, assetLifeYears, roiHorizonYears`.

## UI components (`components/calculator/`, presentational)

### `RecommendationPanel`
`md:col-span-2`. Props: `ranked: RankedSolution[]`, `selectedId`, `usdToRub`, `onSelect(id)`.
Renders only when `ranked.length ≥ 2`. Each row: name · vendor · payback (`formatYearsRu` on
`simplePaybackYears`) · NPV (`formatCost(npvUsd, usdToRub)`). ★ on the top economical row;
"вы смотрите" on the selected row; **"Сделать основным"** button on others → `onSelect(id)`.
Non-economical rows greyed with "не окупается" / "проверьте параметры".

### `SensitivityChart`
`md:col-span-2`. Props: `bars: SensitivityBar[]`, `usdToRub`. Renders only when `bars.length ≥ 1`.
Inline **SVG horizontal tornado**: one row per bar, sorted longest-first; bar length ∝ `swing`
(scaled to the max swing); each labelled with its RU `ASSUMPTION_LABELS` string and the swing in
`formatCost`. Theme-aware via `currentColor` / existing CSS variables (light+dark already
supported). No chart dependency. A caption notes "±25% по каждому допущению → размах NPV."

### Shell (`economics-calculator.tsx`)
Gains `categorySolutions: SiblingSolution[]` + `initialSelectedId` props and a
`selectedSolutionId` state. Derives `primary` (selected sibling) → its `capacity`,
`capacityUnit`, `facilitySlug`, `solutionId` feed `ResultsPanel`, `SaveControl`,
`FacilityVisualization` (so a switch updates results + viz + save). `ASSUMPTION_LABELS` (and
`RATIO_KEYS`) move from `AssumptionsPanel` into a small shared module
(`components/calculator/assumption-labels.ts`) so both `AssumptionsPanel` and `SensitivityChart`
import it without a component-to-component dependency.

## Edge cases
- Non-economical primary/siblings: still ranked, sorted after economical ones, labelled.
- `invalid_inputs` (zeroed divisor etc.): recommendation rows show "—"; `sensitivity` returns
  `[]` so the chart hides.
- <2 siblings (e.g. seed "Other" generic categories with one product each): panel hidden.
- Switching re-derives capacity → visualization + results follow the new solution honestly.
- Revisit/save (P2): `SaveControl` uses `selectedSolutionId`, so a saved analysis round-trips to
  the solution actually shown.

## Testing
- `recommend.test.ts` — economical-by-NPV-desc; `no_savings` after economical; `invalid_inputs`
  last; name tiebreak; single-item list; the selected/★ flags are UI-only (not tested here).
- `sensitivity.test.ts` — swing magnitude + ordering desc; a perturbation that flips to negative
  savings yields a real negative NPV (not truncated 0); `[]` when base is `invalid_inputs`;
  `usdToRub` not in the perturbed set.
- `finance.test.ts` — `projectFinance` parity with the pre-refactor figures for a known case;
  `npvForScenario` returns a negative NPV for a negative-savings case and `null` for invalid.
- `calculate.test.ts` / all existing — **stay green** (finance extraction is behavior-preserving).
- Components: presentational; a light render smoke-check only (logic is in the engine).

## Out of scope (later sub-projects / enhancements)
- Per-assumption custom ranges instead of a flat ±25%; ROI/payback tornadoes.
- Cross-category "best overall" pick.
- The exportable report (sub-project #2) — consumes this output.
- URL-persisting the selected solution / params for shareability.
