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
  kind: PerturbationKind;
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

/**
 * Assumptions `projectFinance` floors to whole years before using. A percentage perturbation on
 * these lands somewhere other than what it claims: at the defaults, ±25% on roiHorizonYears
 * gives 3.75 and 6.25, which floor to 3 and 6 — an actual −40% / +20%. That bar was then ranked
 * against seven others measured at a true ±25%, i.e. on a different ruler, and assetLifeYears
 * drew an empty bar because 5.25→5 and 8.75→8 both leave the 5-year horizon re-CAPEX-free.
 * Perturbing them by one whole year instead measures what the model actually consumes.
 */
const WHOLE_YEAR_KEYS = new Set<keyof AssumptionValues>(["roiHorizonYears", "assetLifeYears"]);

/** How a bar was perturbed, so the chart can label it honestly. */
export type PerturbationKind = "percent" | "whole-year";

/**
 * One-at-a-time tornado on NPV, sorted by swing desc. [] if base is invalid.
 * Continuous assumptions move by ±deltaPct; the year-valued ones move by ±1 whole year
 * (see WHOLE_YEAR_KEYS).
 */
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
    const wholeYear = WHOLE_YEAR_KEYS.has(key);
    const delta = wholeYear ? 1 : a[key] * deltaPct;
    const lowNpv = npvForScenario(cap, params, { ...a, [key]: a[key] - delta });
    const highNpv = npvForScenario(cap, params, { ...a, [key]: a[key] + delta });
    if (lowNpv === null || highNpv === null) continue;
    bars.push({
      key,
      kind: wholeYear ? "whole-year" : "percent",
      baseNpv,
      lowNpv,
      highNpv,
      swing: Math.abs(highNpv - lowNpv),
    });
  }
  return bars.sort((x, y) => y.swing - x.swing);
}
