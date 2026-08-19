import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

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

export function computeQuantity(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): number {
  if (!(cap.capacityPerUnit > 0)) {
    throw new Error("capacityPerUnit must be > 0");
  }

  if (cap.capacityBasis === "CONCURRENT_STOCK") {
    const peak =
      params.peakConcurrent ?? Math.ceil(params.opsPerDay / a.turnoverPerDay);
    return Math.max(1, Math.ceil(peak / cap.capacityPerUnit));
  }

  return Math.max(1, Math.ceil(demandPerYear(params, a) / capacityPerYear(cap, a)));
}
