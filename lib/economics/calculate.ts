import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity, demandPerYear } from "./normalize";

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const quantity = computeQuantity(cap, params, a);
  if (quantity === null || !(a.opsPerWorkerPerYear > 0)) {
    return { economical: false, reason: "invalid_inputs" }; // E1 / A1
  }

  // A1: cap displaced labor by the work the fleet actually covers, not raw headcount. The
  // fleet is always sized to meet demand (quantity = ceil(demand/capacity)), so covered
  // demand = full annual demand for every basis; a human handles `opsPerWorkerPerYear` of it.
  const annualLaborCostPerFteUsd = a.laborCostPerHourUsd * a.hoursPerYear;
  const maxDisplaceableFte = demandPerYear(params, a) / a.opsPerWorkerPerYear;
  const displacedFte = Math.min(params.staffCount, maxDisplaceableFte);
  const baselineAnnualUsd = displacedFte * annualLaborCostPerFteUsd;

  const capexUsd = quantity * cap.priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear + cap.licensingUsdYear); // I1
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct - opexAnnualUsd; // I2

  // E1: reject any degenerate money output (non-finite, or a non-positive CAPEX that would
  // make payback/ROI meaningless or divide-by-zero) as invalid rather than emitting garbage.
  const finite =
    Number.isFinite(displacedFte) &&
    Number.isFinite(capexUsd) &&
    Number.isFinite(opexAnnualUsd) &&
    Number.isFinite(baselineAnnualUsd) &&
    Number.isFinite(annualSavingsUsd);
  if (!finite || capexUsd <= 0) {
    return { economical: false, reason: "invalid_inputs" };
  }

  const common = {
    quantity,
    displacedFte,
    capexUsd,
    opexAnnualUsd,
    baselineAnnualUsd,
    annualSavingsUsd,
  };

  if (annualSavingsUsd <= 0) {
    return { economical: false, reason: "no_savings", ...common }; // C2
  }

  const paybackYears = capexUsd / annualSavingsUsd;
  const roiPct =
    ((annualSavingsUsd * a.roiHorizonYears - capexUsd) / capexUsd) * 100;

  return { economical: true, ...common, paybackYears, roiPct };
}
