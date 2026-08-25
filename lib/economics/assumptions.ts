import type { AssumptionValues } from "./types";

export const DEFAULT_ASSUMPTIONS: AssumptionValues = {
  laborCostPerHourUsd: 15,
  hoursPerYear: 2000,
  workingDaysPerYear: 250,
  operatingHoursPerDay: 16,
  installPctOfCapex: 0.15,
  laborReplacementPct: 0.7,
  opsPerWorkerPerYear: 12500, // A1
  turnoverPerDay: 8,
  roiHorizonYears: 5,
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
