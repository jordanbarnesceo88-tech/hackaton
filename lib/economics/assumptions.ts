import type { AssumptionValues } from "./types";

export const DEFAULT_ASSUMPTIONS: AssumptionValues = {
  laborCostPerHourUsd: 15,
  hoursPerYear: 2000,
  workingDaysPerYear: 250,
  operatingHoursPerDay: 16,
  installPctOfCapex: 0.15,
  laborReplacementPct: 0.5, // A2 (was 0.7)
  residualSupervisionPct: 0.1, // A2
  opsPerWorkerPerYear: 12500, // A1
  turnoverPerDay: 8,
  roiHorizonYears: 5,
  discountRate: 0.12, // A3
  assetLifeYears: 7, // A3
  usdToRub: 90, // I6 (display-only; update before a live demo)
  energyCostFactor: 1.0, // #8a (regional; 1.0 = no change)
};

export function assumptionsToValues(
  rows: { key: string; value: number }[]
): AssumptionValues {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_ASSUMPTIONS };
  for (const k of Object.keys(out) as (keyof AssumptionValues)[]) {
    const v = byKey.get(k);
    if (typeof v === "number") out[k] = v;
  }
  return out;
}
