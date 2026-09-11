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
    categorySlug: s.categorySlug,
    workerOutputPerYear: s.workerOutputPerYear,
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
  // ОБЯЗАТЕЛЬНЫЙ параметр, и это не педантизм. Сначала здесь стояло значение по умолчанию
  // «ради совместимости» — и оно немедленно спрятало пропуск: computeQuantity вызывал функцию
  // без потока, поэтому парк для решения потока площади считался по потоку заказов, а
  // покрытие — по площади. Две функции разошлись молча, и абсурд «один уборщик замещает
  // склад» вернулся с другой стороны: парк из одной единицы там, где нужно три, покрытие
  // 0,44 и 18,5 замещаемых человек за 0,22 года. Без умолчания компилятор перечисляет все
  // места сам.
  stream: WorkloadStream
): number {
  if (stream === "FLOOR_AREA") {
    return params.areaM2 * a.cleaningsPerDay * a.workingDaysPerYear;
  }
  return params.opsPerDay * a.workingDaysPerYear;
}

/**
 * Сколько работы ЭТОГО потока делает один человек за год.
 *
 * БОЛЬШЕ НЕ ДЕЛИТЕЛЬ ПРЕДЕЛА ЗАМЕЩЕНИЯ. Движок его не читает: замещение считается от занятости,
 * названной владельцем объекта (resolveTaskFte), а норматив живёт на категории и служит только
 * предзаполнением поля в визарде, где значение видно и его можно поправить.
 *
 * Глобальные 12 500 операций в год — это 6 операций в час. Отраслевой бенчмарк по отбору
 * заказов 80–120 в час, по укладке коробок 200–400: допущение занижено в 13–50 раз, и всегда в
 * сторону завышения замещаемого персонала. Появление этой функции в calculate.ts — регрессия,
 * ради которой писался подпроект A.
 */
export function workerOutputPerYear(a: AssumptionValues, stream: WorkloadStream): number {
  return stream === "FLOOR_AREA" ? a.areaPerCleanerPerYear : a.opsPerWorkerPerYear;
}

/**
 * Fleet size needed to meet demand. Returns `null` for degenerate inputs (non-positive
 * per-unit capacity, a zero turnover rate with no explicit peak, or any zero-valued
 * annualization divisor) instead of throwing or producing Infinity — callers translate the
 * null into a typed `invalid_inputs` result rather than leaking a non-finite number.
 */
/**
 * Какую долю работы объекта закрывает парк из `quantity` единиц. 0..1.
 *
 * До появления переопределений покрытие было равно единице ПО ПОСТРОЕНИЮ: парк вычислялся как
 * «ровно столько, чтобы покрыть спрос», и величина нигде не фигурировала. Как только
 * количество задаёт человек, это перестаёт быть правдой — и замещение персонала обязано
 * масштабироваться покрытием, иначе половина парка экономит столько же, сколько целый, а
 * переопределение превращается в способ получить любой желаемый NPV.
 *
 * Ограничено единицей сверху: лишние роботы не создают работу, но стоят денег.
 */
export function coverageOf(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues,
  quantity: number
): number | null {
  if (!(cap.capacityPerUnit > 0) || !(quantity > 0)) return null;

  // Нет работы — покрывать нечего, и это НЕ вырожденный ввод: отрицательный или нулевой
  // спрос движок и раньше трактовал как «нечего экономить» (замещение обнуляется, результат
  // становится no_savings), а не как invalid_inputs. Вернуть здесь null значило бы поменять
  // типизированный ответ на другой типизированный ответ — существующий тест это и поймал.
  if (cap.capacityBasis === "CONCURRENT_STOCK") {
    const peak = resolvePeakConcurrent(params, a);
    if (peak === null) return null; // например, turnoverPerDay <= 0 — вот это вырожденный ввод
    if (!(peak > 0)) return 0;
    return Math.min(1, (quantity * cap.capacityPerUnit) / peak);
  }

  const perYear = capacityPerYear(cap, a);
  if (!(perYear > 0)) return null;
  const demand = demandPerYear(params, a, cap.workloadStream);
  if (!(demand > 0)) return 0;
  return Math.min(1, (quantity * perYear) / demand);
}

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
  return Math.max(1, Math.ceil(demandPerYear(params, a, cap.workloadStream) / perYear));
}
