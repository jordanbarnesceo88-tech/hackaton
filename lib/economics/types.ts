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
  // A1: annual operations one human worker handles (same unit as facility demand). Caps how
  // many workers the fleet can realistically displace, so savings track workload not headcount.
  opsPerWorkerPerYear: number;
  turnoverPerDay: number;
  roiHorizonYears: number;
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
      paybackYears: number;
      roiPct: number;
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
