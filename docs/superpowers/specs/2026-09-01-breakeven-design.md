# Design: Break-Even Labor Rate (backlog #8c)

> Status: approved via brainstorming 2026-09-01. Slice of #8 (model depth). A read-only decision
> aid: the minimum labor rate ($/hr) at which the chosen solution pays back (NPV = 0) over the ROI
> horizon, shown with the current rate + a safety margin. **Pure addition — changes no existing
> output numbers**, so no sign-off gate.

## Goal & context

`laborCostPerHourUsd` is the #1 ROI driver (per the sensitivity tornado). A skeptic's natural
question is "what if labor is cheaper than you assume?". Break-even answers it directly: the labor
rate below which automation stops paying back — and how much headroom the current rate has.

Chosen variable (brainstorming): **labor rate, target NPV = 0.** It's closed-form (savings/NPV are
linear in the labor rate) and ties to the dominant lever. Ops/day and staff break-evens were
rejected for v1 (they feed `quantity = ceil(...)` step functions → non-monotonic, messier).

## The solver — `lib/economics/breakeven.ts` (pure, tested)

```ts
export function breakEvenLaborRateUsd(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null;
```

**Why closed-form:** in `baseEconomics`, `displacedFte`, `quantity`, `capexUsd`, and `opexAnnualUsd`
are all independent of the labor rate; only `baselineAnnualUsd` is linear in it. So:
- `annualSavings(L) = K·L − opex`, where
  `K = displacedFte × hoursPerYear × laborReplacementPct × (1 − residualSupervisionPct)`.
- NPV is linear in `annualSavings`.

**Algorithm (reuses existing engine — DRY, no re-derivation of the annuity/re-CAPEX):**
1. `base = baseEconomics(cap, params, a)`. If `null` (invalid_inputs) → return `null`.
2. `K = base.displacedFte × a.hoursPerYear × a.laborReplacementPct × (1 − a.residualSupervisionPct)`.
   If `!(K > 0)` → return `null` (no labor rate can make it pay back — e.g. zero displaceable
   labor, 0% replacement, or 100% residual supervision).
3. Invert `projectFinance` via its linearity in savings:
   `npv0 = projectFinance(0, base.capexUsd, a).npvUsd`,
   `slope = projectFinance(1, base.capexUsd, a).npvUsd − npv0`.
   If `!(slope > 0)` → return `null` (degenerate horizon; already guarded upstream).
   `breakEvenSavings = -npv0 / slope`.
4. `L* = (breakEvenSavings + base.opexAnnualUsd) / K`. Return `L*` (always > 0 by construction:
   `breakEvenSavings > 0` since capex must be recovered, and `opex ≥ 0`, `K > 0`).

Note: `base`'s `capexUsd`/`opexAnnualUsd`/`displacedFte` don't depend on the labor rate, so using
them while varying only `L` is exact — no iteration needed.

## UI — `components/calculator/break-even-note.tsx`

A small presentational card composed into the calculator shell (near the hero/results block),
props: `capacity`, `params`, `assumptions` (the shell already holds all three).
- Compute `L* = breakEvenLaborRateUsd(...)`.
- `L* === null` → «Не окупается ни при какой ставке труда при текущих параметрах» (muted).
- else → «Окупается при ставке труда ≥ **{formatCost(L*, usdToRub)}**/час (сейчас
  {formatCost(a.laborCostPerHourUsd, usdToRub)})» + a safety margin
  «запас прочности ×{(a.laborCostPerHourUsd / L*).toFixed(1)}» shown only when the current rate
  ≥ L* (i.e. currently economical); when current < L* show «текущая ставка ниже точки
  безубыточности» instead.
- Hidden entirely when the result is `invalid_inputs` (same convention as HeroResults).
- Money via `formatCost(usd, usdToRub)`; label RU.

(Optional, include only if it fits cleanly: the same one-liner in the report footer — a natural
credibility item. Defer if it complicates the report.)

## Testing (`lib/economics/breakeven.test.ts`)
- **Round-trip (the proof):** compute `L*`; then `computeEconomics(cap, params, { ...a,
  laborCostPerHourUsd: L* })` → assert `economical` with `npvUsd` ≈ 0 (small tolerance). This
  validates the closed form against the actual engine.
- Above/below: `L* + 1` ⇒ NPV > 0; `L* − 1` (if > 0) ⇒ NPV < 0.
- `null` when `laborReplacementPct = 0` (K = 0); `null` when `residualSupervisionPct = 1`.
- `null` on an `invalid_inputs` case (e.g. `opsPerWorkerPerYear = 0`).
- Existing **118 unit + 3 E2E stay green**; build clean. No existing number changes.

## Out of scope
- Ops/day and staff break-evens (#8c later variants); break-even against annualSavings=0 instead
  of NPV=0; showing break-even in the exported report (optional, see above).
