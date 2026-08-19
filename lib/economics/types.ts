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
  turnoverPerDay: number;
  roiHorizonYears: number;
};

export type EconomicsResult =
  | {
      economical: true;
      quantity: number;
      capexUsd: number;
      opexAnnualUsd: number;
      baselineAnnualUsd: number;
      annualSavingsUsd: number;
      paybackYears: number;
      roiPct: number;
    }
  | {
      economical: false;
      reason: "no_savings";
      quantity: number;
      capexUsd: number;
      opexAnnualUsd: number;
      baselineAnnualUsd: number;
      annualSavingsUsd: number;
    };
