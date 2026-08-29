# Economics Model Revision (audit fixes A1–A3)

> Status: approved 2026-08-25. Implements the Phase-A audit findings A1/A2/A3
> ([docs/AUDIT.md](../../AUDIT.md)). **These change output numbers** vs the Week-2 model;
> the deltas were signed off by the product owner. Supersedes the savings/ROI formulas in
> [execution-plan §4](../../02-execution-plan.md) and closes §8 items I2 (fully) and M2
> (discount-rate half). Every change is behind an editable `Assumption`, keeping the
> "assumptions are visible and defensible" credibility lever from execution-plan §4.

## Why

The Week-2 model made annual savings a function of the client's **entire declared headcount**
(`staffCount × laborReplacementPct`), decoupled from how much work the fleet actually does,
with a 70% default replacement, zero retained running cost, and an **undiscounted** 5-year ROI
assuming robots last the horizon on maintenance alone. Result: implausibly high ROI/short
payback (e.g. 1 robot → 1648% ROI) that fails the "skeptical client" bar the product exists to
clear.

## New assumptions (all editable, seeded)

| key | default | meaning |
|---|---|---|
| `opsPerWorkerPerYear` | 12500 | Annual operations one human worker handles (same unit as facility demand = `opsPerDay × workingDaysPerYear`). Caps how many workers the fleet can realistically displace. |
| `laborReplacementPct` | **0.5** (was 0.7) | Fraction of a displaced worker's cost the robots actually remove. |
| `residualSupervisionPct` | 0.1 | Fraction of displaced labor that stays as human oversight/exception-handling (reduces savings). |
| `discountRate` | 0.12 | Annual discount rate for NPV / discounted payback. |
| `assetLifeYears` | 7 | Service life of a robot; if `< roiHorizonYears`, CAPEX is re-incurred when assets expire. |

`staffCount` (facility param) is **relabelled in the UI** to "Персонал, замещаемый решением"
(staff the solution can displace) — the field name stays `staffCount` for saved-analysis
compatibility, but it now means displaceable staff and is further capped by workload (A1).

## Model (pure `lib/economics`)

### A1 — couple displaced labor to workload
```
annualLaborCostPerFteUsd = laborCostPerHourUsd × hoursPerYear
demandOpsPerYear         = opsPerDay × workingDaysPerYear            // = demandPerYear()
maxDisplaceableFte       = demandOpsPerYear ÷ opsPerWorkerPerYear
displacedFte             = min(staffCount, maxDisplaceableFte)       // ← the A1 cap
baselineAnnualUsd        = displacedFte × annualLaborCostPerFteUsd
```
`opsPerWorkerPerYear ≤ 0` → `invalid_inputs`. The fleet is always sized to meet demand
(`quantity = ceil(demand/capacity)`), so covered demand = full `demandOpsPerYear` for every
basis (the `CONCURRENT_STOCK` sizing rule only changes unit count, not the flow handled).

### A2 — conservative defaults + residual supervision
```
laborSavedUsd    = baselineAnnualUsd × laborReplacementPct × (1 − residualSupervisionPct)
annualSavingsUsd = laborSavedUsd − opexAnnualUsd
```
`opexAnnualUsd = quantity × (maintenance + energy + licensing)` (I1, unchanged).
`annualSavingsUsd ≤ 0` → `no_savings` (C2, unchanged).

### A3 — discounting, NPV, asset lifecycle
```
capexUsd = quantity × priceUsd × (1 + installPctOfCapex)            // initial outlay
lifeYears      = floor(assetLifeYears)         // whole-year cadence (annual model; life ≥ 1)
cashflows[0]   = −capexUsd
cashflows[t]   = annualSavingsUsd − ((t % lifeYears == 0 && t < H) ? capexUsd : 0)   for t=1..H
                 (re-CAPEX only when assets expire with productive years left; `t < H` avoids
                  a spurious final-year fleet — notably when lifeYears exactly divides H, e.g.
                  life == H ⇒ no re-buy)

npvUsd                = Σ_{t=0..H} cashflows[t] / (1+discountRate)^t
discountedPaybackYears = first fractional year cumulative discounted CF ≥ 0, else null (>H)
simplePaybackYears     = capexUsd ÷ annualSavingsUsd                // undiscounted, first-cost
reCapexTotal           = capexUsd × count(t in 1..H : t % assetLifeYears == 0)
simpleRoiPct           = (annualSavingsUsd×H − capexUsd − reCapexTotal) ÷ (capexUsd + reCapexTotal) × 100
```
When `assetLifeYears ≥ roiHorizonYears` (the default 7 ≥ 5), there is no re-CAPEX and
`simpleRoiPct` reduces to the old `(savings×H − capex)/capex×100`.

## Result shape

`EconomicsResult` `economical: true` branch now carries: `quantity, capexUsd, opexAnnualUsd,
baselineAnnualUsd, annualSavingsUsd, displacedFte, simplePaybackYears, simpleRoiPct, npvUsd,
discountedPaybackYears (number | null)`. (`paybackYears`/`roiPct` renamed to `simple*`.) The
`no_savings` branch carries the common fields incl. `displacedFte`. `invalid_inputs` unchanged.

## UI

- Relabel `staffCount`; add the 5 new assumptions to the panel (already generic-mapped).
- Results panel shows: displaced FTE, CAPEX, OPEX/yr, baseline labor, annual savings, **simple
  payback**, **discounted payback** (or "> N лет" when null), **simple ROI**, **NPV** — with
  the simple figures explicitly labelled "простой (без дисконтирования)".
- Visualization uses `annualSavingsUsd` (unchanged field).

## Tests

Unit tests updated for the new numbers; new tests for the A1 workload cap, the A2 residual
factor, and `lib/economics/finance.ts` (`npv`, `discountedPaybackYears`) incl. re-CAPEX and
never-pays-back-within-horizon.
