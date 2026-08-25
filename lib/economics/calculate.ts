import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity, demandPerYear } from "./normalize";
import { npv, discountedPaybackYears } from "./finance";

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const quantity = computeQuantity(cap, params, a);
  if (
    quantity === null ||
    !(a.opsPerWorkerPerYear > 0) ||
    !(a.roiHorizonYears >= 1) || // A3: need at least one year to model
    !(a.assetLifeYears >= 1) || // A3: whole-year re-CAPEX cadence (annual cash-flow model)
    !(a.discountRate > -1) // A3: (1+rate) must stay positive
  ) {
    return { economical: false, reason: "invalid_inputs" }; // E1 / A1 / A3
  }

  // A1: cap displaced labor by the work the fleet actually covers, not raw headcount. The
  // fleet is always sized to meet demand (quantity = ceil(demand/capacity)), so covered
  // demand = full annual demand for every basis; a human handles `opsPerWorkerPerYear` of it.
  const annualLaborCostPerFteUsd = a.laborCostPerHourUsd * a.hoursPerYear;
  const maxDisplaceableFte = demandPerYear(params, a) / a.opsPerWorkerPerYear;
  // Clamp at 0 so a negative param (e.g. a pasted negative opsPerDay/staffCount that slips past
  // the min=0 inputs) can't surface a negative displaced-FTE / negative baseline labour cost.
  const displacedFte = Math.max(0, Math.min(params.staffCount, maxDisplaceableFte));
  const baselineAnnualUsd = displacedFte * annualLaborCostPerFteUsd;

  const capexUsd = quantity * cap.priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear + cap.licensingUsdYear); // I1
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct * (1 - a.residualSupervisionPct) -
    opexAnnualUsd; // I2 (A2: residual supervision retained)

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

  // A3: model yearly cash flows over the horizon, re-buying the fleet whenever the assets wear
  // out with productive years still left (t % lifeYears === 0 && t < horizon). The `t < horizon`
  // guard avoids charging a spurious final-year fleet that is never used — notably when
  // assetLifeYears exactly divides the horizon (e.g. life == horizon → no re-buy at all). Life
  // is floored to whole years to match the annual cash-flow granularity. t=0 is the initial CAPEX.
  const horizon = Math.floor(a.roiHorizonYears);
  const lifeYears = Math.floor(a.assetLifeYears);
  const cashflows: number[] = [-capexUsd];
  let reCapexTotal = 0;
  for (let t = 1; t <= horizon; t++) {
    const reCapex = t % lifeYears === 0 && t < horizon ? capexUsd : 0;
    reCapexTotal += reCapex;
    cashflows.push(annualSavingsUsd - reCapex);
  }

  const investmentUsd = capexUsd + reCapexTotal;
  const simplePaybackYears = capexUsd / annualSavingsUsd; // undiscounted, first-cost
  const simpleRoiPct =
    ((annualSavingsUsd * horizon - investmentUsd) / investmentUsd) * 100;
  const npvUsd = npv(a.discountRate, cashflows);
  const discountedPayback = discountedPaybackYears(a.discountRate, cashflows);

  return {
    economical: true,
    ...common,
    simplePaybackYears,
    simpleRoiPct,
    npvUsd,
    discountedPaybackYears: discountedPayback,
  };
}
