import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

/**
 * Project any solution-shaped record (a Prisma row, a `SiblingSolution`) down to exactly the
 * six fields the engine consumes. Callers hold wider objects — DB rows carry ids, names,
 * provenance — and every entry point was rebuilding this literal by hand, so a new cost field
 * on `SolutionCapacity` meant editing four call sites. Structural typing does the narrowing;
 * this just names it in one place.
 */
export function toSolutionCapacity(s: SolutionCapacity): SolutionCapacity {
  return {
    capacityPerUnit: s.capacityPerUnit,
    capacityBasis: s.capacityBasis,
    priceUsd: s.priceUsd,
    maintenanceUsdYear: s.maintenanceUsdYear,
    energyUsdYear: s.energyUsdYear,
    licensingUsdYear: s.licensingUsdYear,
  };
}

/** Annualized throughput capacity of ONE unit (flow bases only). */
export function capacityPerYear(cap: SolutionCapacity, a: AssumptionValues): number {
  const hoursFactor =
    cap.capacityBasis === "PER_HOUR_FLOW" ? a.operatingHoursPerDay : 1;
  return cap.capacityPerUnit * hoursFactor * a.workingDaysPerYear;
}

/** Annualized facility demand from daily operations. */
export function demandPerYear(params: FacilityParams, a: AssumptionValues): number {
  return params.opsPerDay * a.workingDaysPerYear;
}

/**
 * Fleet size needed to meet demand. Returns `null` for degenerate inputs (non-positive
 * per-unit capacity, a zero turnover rate with no explicit peak, or any zero-valued
 * annualization divisor) instead of throwing or producing Infinity — callers translate the
 * null into a typed `invalid_inputs` result rather than leaking a non-finite number.
 */
export function computeQuantity(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  if (!(cap.capacityPerUnit > 0)) return null;

  if (cap.capacityBasis === "CONCURRENT_STOCK") {
    const peak =
      params.peakConcurrent ?? Math.ceil(params.opsPerDay / a.turnoverPerDay);
    if (!Number.isFinite(peak)) return null; // e.g. turnoverPerDay <= 0
    return Math.max(1, Math.ceil(peak / cap.capacityPerUnit));
  }

  const perYear = capacityPerYear(cap, a);
  if (!(perYear > 0)) return null; // e.g. workingDaysPerYear or operatingHoursPerDay <= 0
  return Math.max(1, Math.ceil(demandPerYear(params, a) / perYear));
}
