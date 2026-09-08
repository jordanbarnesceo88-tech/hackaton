import { DEFAULT_ASSUMPTIONS } from "./assumptions";
import type { AssumptionValues, FacilityParams, SolutionCapacity } from "./types";

// Shared TEST fixtures for the economics/scene suites. Test-only: nothing in app/ or
// components/ imports this. Each factory starts from the shipped defaults (or a documented
// baseline solution/facility) and spreads caller overrides last, so a test states only the
// field it is actually exercising and new model fields land in every fixture automatically.

/** A complete AssumptionValues built from DEFAULT_ASSUMPTIONS plus explicit overrides. */
export function makeAssumptions(
  overrides: Partial<AssumptionValues> = {}
): AssumptionValues {
  return { ...DEFAULT_ASSUMPTIONS, ...overrides };
}

/** Baseline solution: a 400/day flow unit at $50k with $9k/yr all-in OPEX. */
export function makeCapacity(
  overrides: Partial<SolutionCapacity> = {}
): SolutionCapacity {
  return {
    // Поток по умолчанию — операции: так считаются тринадцать категорий из пятнадцати, и
    // существующие тесты обязаны остаться зелёными до знака.
    workloadStream: "OPERATION_FLOW",
    capacityPerUnit: 400,
    capacityBasis: "PER_DAY_FLOW",
    priceUsd: 50000,
    maintenanceUsdYear: 6000,
    energyUsdYear: 1000,
    licensingUsdYear: 2000,
    ...overrides,
  };
}

/** Baseline facility: 1000 m², 400 ops/day, 10 replaceable staff. */
export function makeParams(overrides: Partial<FacilityParams> = {}): FacilityParams {
  return { areaM2: 1000, opsPerDay: 400, staffCount: 10, ...overrides };
}
