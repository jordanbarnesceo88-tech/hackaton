import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity } from "./normalize";

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const quantity = computeQuantity(cap, params, a);

  const baselineAnnualUsd =
    params.staffCount * a.laborCostPerHourUsd * a.hoursPerYear;
  const capexUsd = quantity * cap.priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear + cap.licensingUsdYear); // I1
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct - opexAnnualUsd; // I2

  const common = {
    quantity,
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
