import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";
import { baseEconomics } from "./calculate";
import { projectFinance } from "./finance";

/** NPV for a scenario, allowing negative savings (real negative NPV). null only if invalid. */
export function npvForScenario(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  const base = baseEconomics(cap, params, a);
  if (base === null) return null;
  return projectFinance(base.annualSavingsUsd, base.capexUsd, a).npvUsd;
}

export type SensitivityBar = {
  key: keyof AssumptionValues;
  baseNpv: number;
  lowNpv: number;
  highNpv: number;
  swing: number;
};

// Economically meaningful levers; excludes display-only usdToRub and basis/timing constants.
const PERTURBED_KEYS: (keyof AssumptionValues)[] = [
  "laborCostPerHourUsd",
  "laborReplacementPct",
  "opsPerWorkerPerYear",
  "residualSupervisionPct",
  "installPctOfCapex",
  "discountRate",
  "assetLifeYears",
  "roiHorizonYears",
];

/** One-at-a-time ±deltaPct tornado on NPV, sorted by swing desc. [] if base is invalid. */
export function sensitivity(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  deltaPct = 0.25
): SensitivityBar[] {
  const baseNpv = npvForScenario(cap, params, a);
  if (baseNpv === null) return [];

  const bars: SensitivityBar[] = [];
  for (const key of PERTURBED_KEYS) {
    const lowNpv = npvForScenario(cap, params, { ...a, [key]: a[key] * (1 - deltaPct) });
    const highNpv = npvForScenario(cap, params, { ...a, [key]: a[key] * (1 + deltaPct) });
    if (lowNpv === null || highNpv === null) continue;
    bars.push({ key, baseNpv, lowNpv, highNpv, swing: Math.abs(highNpv - lowNpv) });
  }
  return bars.sort((x, y) => y.swing - x.swing);
}
