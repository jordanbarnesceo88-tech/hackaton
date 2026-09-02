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

/**
 * Accepted range for each assumption. Two kinds of bound live here:
 *  - physical/definitional — hours in a day, days in a year, a fraction being 0..1;
 *  - sanity caps on the open-ended ones, set far above any real facility so they never
 *    obstruct legitimate input while still refusing figures that can only be typos.
 *
 * The engine does NOT consult these: it keeps its own `invalid_inputs` guards and must stay
 * total for any finite input (the sensitivity tornado deliberately evaluates degenerate
 * scenarios). These bounds are the UI and persistence boundary — they stop a mistyped digit
 * from producing an authoritative-looking number and being saved into a client report.
 *
 * `discountRate` is the one worth calling out. The engine only requires `> -1` (below that the
 * discount factor divides by zero), which admits the whole (-1, 0) range where NPV explodes:
 * at -0.99 a default scenario returns an NPV of ~61 000 000 000 000 000 ₽. A discount rate is
 * a cost of capital, so 0..1 is the meaningful domain.
 */
export const ASSUMPTION_BOUNDS: Record<keyof AssumptionValues, { min: number; max: number }> = {
  laborCostPerHourUsd: { min: 0, max: 1000 },
  hoursPerYear: { min: 1, max: 8760 }, // hours in a year
  workingDaysPerYear: { min: 1, max: 366 }, // days in a year
  operatingHoursPerDay: { min: 1, max: 24 }, // hours in a day
  installPctOfCapex: { min: 0, max: 2 }, // integration can exceed hardware cost, but not 3x
  laborReplacementPct: { min: 0, max: 1 }, // a fraction
  residualSupervisionPct: { min: 0, max: 1 }, // a fraction
  opsPerWorkerPerYear: { min: 1, max: 10_000_000 },
  turnoverPerDay: { min: 0, max: 1000 },
  roiHorizonYears: { min: 1, max: 30 },
  discountRate: { min: 0, max: 1 }, // 0..100% cost of capital
  assetLifeYears: { min: 1, max: 50 },
  usdToRub: { min: 1, max: 1000 }, // display-only
  energyCostFactor: { min: 0, max: 10 }, // regional multiplier; 1.0 = Moscow reference
};

/** Clamp one assumption into its accepted range. Non-finite input falls back to the default. */
export function clampAssumption(key: keyof AssumptionValues, value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ASSUMPTIONS[key];
  const { min, max } = ASSUMPTION_BOUNDS[key];
  return Math.min(max, Math.max(min, value));
}

/** True when every assumption sits inside its accepted range. */
export function assumptionsInRange(a: AssumptionValues): boolean {
  return (Object.keys(ASSUMPTION_BOUNDS) as (keyof AssumptionValues)[]).every((k) => {
    const { min, max } = ASSUMPTION_BOUNDS[k];
    return Number.isFinite(a[k]) && a[k] >= min && a[k] <= max;
  });
}

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

/**
 * Backfill a persisted (jsonb) assumptions blob with defaults for any key that is missing or
 * non-finite. Saved analyses created before a new assumption was introduced (e.g. #8a's
 * `energyCostFactor`) lack that key; without this, `energyUsdYear * undefined = NaN` would poison
 * the recompute and a formerly-valid saved analysis would render as invalid. Use on every read of
 * `SavedAnalysis.assumptions` before feeding the engine.
 */
export function withAssumptionDefaults(raw: unknown): AssumptionValues {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_ASSUMPTIONS };
  for (const k of Object.keys(out) as (keyof AssumptionValues)[]) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
