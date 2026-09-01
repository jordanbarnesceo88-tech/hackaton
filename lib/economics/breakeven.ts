import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";
import { baseEconomics } from "./calculate";
import { projectFinance } from "./finance";

/**
 * Minimum labor rate ($/hr) at which the solution pays back (NPV = 0) over the ROI horizon.
 * Closed-form: displacedFte/quantity/capex/opex are all independent of the labor rate, so
 * annualSavings(L) = K·L − opex is linear (K = displacedFte × hoursPerYear × laborReplacementPct
 * × (1 − residualSupervisionPct)), and NPV is linear in savings. Reuses projectFinance for the
 * annuity/re-CAPEX rather than re-deriving it. Returns null when no rate can make it pay back
 * (K ≤ 0) or the inputs are degenerate.
 */
export function breakEvenLaborRateUsd(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  const base = baseEconomics(cap, params, a);
  if (base === null) return null;

  const K =
    base.displacedFte * a.hoursPerYear * a.laborReplacementPct * (1 - a.residualSupervisionPct);
  if (!(K > 0)) return null;

  // NPV is linear in annualSavings; find the savings that make NPV = 0 by two evaluations.
  const npv0 = projectFinance(0, base.capexUsd, a).npvUsd;
  const npv1 = projectFinance(1, base.capexUsd, a).npvUsd;
  const slope = npv1 - npv0;
  if (!(slope > 0)) return null;

  const breakEvenSavings = -npv0 / slope;
  const laborRate = (breakEvenSavings + base.opexAnnualUsd) / K;
  return Number.isFinite(laborRate) && laborRate > 0 ? laborRate : null;
}
