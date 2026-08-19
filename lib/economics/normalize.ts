import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

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

  const hoursFactor =
    cap.capacityBasis === "PER_HOUR_FLOW" ? a.operatingHoursPerDay : 1;
  const capacityPerYear = cap.capacityPerUnit * hoursFactor * a.workingDaysPerYear;
  const demandPerYear = params.opsPerDay * a.workingDaysPerYear;
  return Math.max(1, Math.ceil(demandPerYear / capacityPerYear));
}
