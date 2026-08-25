export type CapacityBasis = "PER_HOUR_FLOW" | "PER_DAY_FLOW" | "CONCURRENT_STOCK";

export type SolutionCapacity = {
  capacityPerUnit: number;
  capacityBasis: CapacityBasis;
  priceUsd: number;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
};

export type FacilityParams = {
  areaM2: number;
  opsPerDay: number;
  staffCount: number;
  peakConcurrent?: number;
};

export type AssumptionValues = {
  laborCostPerHourUsd: number;
  hoursPerYear: number;
  workingDaysPerYear: number;
  operatingHoursPerDay: number;
  installPctOfCapex: number;
  laborReplacementPct: number;
  // A2: fraction of displaced labor that stays as human oversight/exception-handling and is
  // therefore NOT saved (reduces savings by (1 - residualSupervisionPct)).
  residualSupervisionPct: number;
  // A1: annual operations one human worker handles (same unit as facility demand). Caps how
  // many workers the fleet can realistically displace, so savings track workload not headcount.
  opsPerWorkerPerYear: number;
  turnoverPerDay: number;
  roiHorizonYears: number;
  // A3: time-value + lifecycle. discountRate drives NPV / discounted payback; assetLifeYears
  // triggers CAPEX re-investment when robots wear out before the ROI horizon ends.
  discountRate: number;
  assetLifeYears: number;
};

type EconomicsCommon = {
  quantity: number;
  // A1: workload-capped displaced full-time-equivalents = min(staffCount, demand/opsPerWorker).
  displacedFte: number;
  capexUsd: number;
  opexAnnualUsd: number;
  baselineAnnualUsd: number;
  annualSavingsUsd: number;
};

export type EconomicsResult =
  | (EconomicsCommon & {
      economical: true;
      // A3: "simple" = undiscounted; NPV/discounted payback use the discount rate. Discounted
      // payback is null when the investment does not pay back within the ROI horizon.
      simplePaybackYears: number;
      simpleRoiPct: number;
      npvUsd: number;
      discountedPaybackYears: number | null;
    })
  | (EconomicsCommon & {
      economical: false;
      reason: "no_savings";
    })
  // Degenerate inputs (zero-valued divisors, non-positive price/capacity, or any
  // non-finite intermediate) yield no meaningful numbers. Returned as a typed result so
  // the engine never leaks Infinity/NaN to callers (UI, persisted `results`, future API).
  | {
      economical: false;
      reason: "invalid_inputs";
    };

/** Result variants that carry numeric fields (economical or no_savings) — i.e. not the
 *  `invalid_inputs` placeholder. Used to gate/narrow number rendering in the UI. */
export type CalculableResult = Extract<EconomicsResult, { quantity: number }>;

export function isCalculable(r: EconomicsResult): r is CalculableResult {
  return "quantity" in r;
}
