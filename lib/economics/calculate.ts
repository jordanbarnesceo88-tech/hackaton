import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity, demandPerYear } from "./normalize";
import { projectFinance } from "./finance";

export type BaseEconomics = {
  quantity: number;
  displacedFte: number;
  capexUsd: number;
  opexAnnualUsd: number;
  baselineAnnualUsd: number;
  annualSavingsUsd: number;
};

/**
 * Shared core: quantity + capex/opex + A1/A2 savings, with all invalid_inputs guards. Returns
 * null for degenerate inputs. Used by computeEconomics and by the sensitivity engine.
 */
export function baseEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): BaseEconomics | null {
  const quantity = computeQuantity(cap, params, a);
  if (
    quantity === null ||
    !(a.opsPerWorkerPerYear > 0) ||
    !(a.roiHorizonYears >= 1) ||
    !(a.assetLifeYears >= 1) ||
    !(a.discountRate > -1)
  ) {
    return null;
  }

  const annualLaborCostPerFteUsd = a.laborCostPerHourUsd * a.hoursPerYear;
  const maxDisplaceableFte = demandPerYear(params, a) / a.opsPerWorkerPerYear;
  const displacedFte = Math.max(0, Math.min(params.staffCount, maxDisplaceableFte));
  const baselineAnnualUsd = displacedFte * annualLaborCostPerFteUsd;

  const capexUsd = quantity * cap.priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear * a.energyCostFactor + cap.licensingUsdYear);
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct * (1 - a.residualSupervisionPct) - opexAnnualUsd;

  const finite =
    Number.isFinite(displacedFte) &&
    Number.isFinite(capexUsd) &&
    Number.isFinite(opexAnnualUsd) &&
    Number.isFinite(baselineAnnualUsd) &&
    Number.isFinite(annualSavingsUsd);
  if (!finite || capexUsd <= 0) return null;

  return { quantity, displacedFte, capexUsd, opexAnnualUsd, baselineAnnualUsd, annualSavingsUsd };
}

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const base = baseEconomics(cap, params, a);
  if (base === null) return { economical: false, reason: "invalid_inputs" };

  if (base.annualSavingsUsd <= 0) {
    return { economical: false, reason: "no_savings", ...base };
  }

  const fin = projectFinance(base.annualSavingsUsd, base.capexUsd, a);
  return { economical: true, ...base, ...fin };
}
