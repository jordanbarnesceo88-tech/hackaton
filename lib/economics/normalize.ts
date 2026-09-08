import type {
  WorkloadStream,
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "./types";

/**
 * Project any solution-shaped record (a Prisma row, a `SiblingSolution`) down to exactly the
 * fields the engine consumes. Callers hold wider objects — DB rows carry ids, names,
 * provenance — and every entry point was rebuilding this literal by hand, so a new cost field
 * on `SolutionCapacity` meant editing four call sites. Structural typing does the narrowing;
 * this just names it in one place.
 */
export function toSolutionCapacity(s: SolutionCapacity): SolutionCapacity {
  return {
    workloadStream: s.workloadStream,
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

/**
 * The peak concurrent load a CONCURRENT_STOCK solution is sized against: the user's explicit
 * figure when they gave one, otherwise derived from throughput and turnover. Returns null when
 * the derivation is degenerate (a zero or negative turnover rate with no explicit peak).
 *
 * Exported because the UI needs the same answer the engine uses. `ParamsForm` used to render
 * `params.peakConcurrent ?? 0`, so whenever the field was unset it displayed 0 while the engine
 * quietly sized the fleet from the derived peak — the form and the result disagreeing about the
 * number driving the calculation.
 */
export function resolvePeakConcurrent(
  params: FacilityParams,
  a: AssumptionValues
): number | null {
  if (params.peakConcurrent !== undefined) {
    return Number.isFinite(params.peakConcurrent) ? params.peakConcurrent : null;
  }
  const derived = Math.ceil(params.opsPerDay / a.turnoverPerDay);
  return Number.isFinite(derived) ? derived : null;
}

/** Annualized facility demand from daily operations. */
export function demandPerYear(
  params: FacilityParams,
  a: AssumptionValues,
  stream: WorkloadStream = "OPERATION_FLOW"
): number {
  // Значение по умолчанию — не удобство, а совместимость: тринадцать из пятнадцати категорий
  // считаются потоком операций, и их числа обязаны остаться прежними до знака.
  if (stream === "FLOOR_AREA") {
    return params.areaM2 * a.cleaningsPerDay * a.workingDaysPerYear;
  }
  return params.opsPerDay * a.workingDaysPerYear;
}

/** Сколько работы ЭТОГО потока делает один человек за год — делитель предела замещения (A1). */
export function workerOutputPerYear(a: AssumptionValues, stream: WorkloadStream): number {
  return stream === "FLOOR_AREA" ? a.areaPerCleanerPerYear : a.opsPerWorkerPerYear;
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
    const peak = resolvePeakConcurrent(params, a);
    if (peak === null) return null; // e.g. turnoverPerDay <= 0
    return Math.max(1, Math.ceil(peak / cap.capacityPerUnit));
  }

  const perYear = capacityPerYear(cap, a);
  if (!(perYear > 0)) return null; // e.g. workingDaysPerYear or operatingHoursPerDay <= 0
  return Math.max(1, Math.ceil(demandPerYear(params, a) / perYear));
}
