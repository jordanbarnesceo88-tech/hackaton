export type CapacityBasis = "PER_HOUR_FLOW" | "PER_DAY_FLOW" | "CONCURRENT_STOCK";

/**
 * Какую работу объекта делает решение.
 *
 * Заведено потому, что движок этого не знал и сравнивал несравнимое: спрос всегда брался как
 * `opsPerDay × дни`, кем бы ни было решение, поэтому робот-уборщик за $47 500 «замещал» сорок
 * складских сотрудников — 5000 отборов заказов в сутки сопоставлялись с 2780 м² уборки в час
 * как одна и та же величина.
 *
 * Потоков два, а не шесть: измерение заводится тогда, когда появляется решение, которое в нём
 * считается. Заранее — это усложнение модели авансом.
 */
export type WorkloadStream = "OPERATION_FLOW" | "FLOOR_AREA";

export type SolutionCapacity = {
  capacityPerUnit: number;
  capacityBasis: CapacityBasis;
  workloadStream: WorkloadStream;

  /**
   * Контекст ЗАДАЧИ, а не машины. Лежит здесь по той же причине, что и workloadStream: движку
   * нужно знать, против какой работы считать решение, и узнать это можно только вместе с
   * решением. Вынести в отдельный аргумент нельзя — у sensitivity() четвёртый параметр уже
   * занят deltaPct, а вызовы слишком разнородны, чтобы менять их механически.
   *
   * categorySlug — ключ, по которому движок находит заявленную человеком занятость в
   * params.taskStaffing. workerOutputPerYear — норматив категории для отката, когда занятость
   * не заявлена; null означает «норматива со ссылкой нет», и тогда расчёт отказывается считать.
   */
  categorySlug: string;
  workerOutputPerYear: number | null;
  priceUsd: number;
  maintenanceUsdYear: number;
  energyUsdYear: number;
  licensingUsdYear: number;
};

export type FacilityParams = {
  areaM2: number;
  opsPerDay: number;
  staffCount: number;

  /**
   * Переопределения пользователя. Необязательные, и отсутствие — это ДРУГАЯ инструкция, чем
   * любое конкретное число: «считай сам». Живут здесь, а не отдельным объектом, потому что
   * это вход расчёта, их надо сохранять вместе с ним, и withParamDefaults уже защищает
   * этот путь.
   *
   * Цена переопределяется ЗА ЕДИНИЦУ, а не суммарным CAPEX: суммарный зависит от количества,
   * и переопределив оба, человек получил бы противоречие, которое некому разрешить.
   */
  quantityOverride?: number;
  capexPerUnitUsdOverride?: number;
  peakConcurrent?: number;

  /**
   * Сколько человек занято каждой задачей, по словам владельца объекта. Ключ — slug категории.
   *
   * Живёт в параметрах, а не отдельным объектом: это вход расчёта, его надо сохранять вместе с
   * ним, и withParamDefaults уже защищает этот путь. Отсутствие ключа — ДРУГАЯ инструкция, чем
   * ноль: ноль значит «никто не занят», отсутствие — «считай по нормативу категории».
   *
   * Карта, а не одно число, потому что экран сравнения считает все применимые задачи разом, а
   * сохранённый расчёт обязан помнить занятость целиком — иначе при возврате к нему соседние
   * задачи пересчитаются по нормативу и цифры на экране разъедутся с отчётом.
   */
  taskStaffing?: Record<string, number>;
};

export type AssumptionValues = {
  laborCostPerHourUsd: number;
  hoursPerYear: number;
  workingDaysPerYear: number;
  operatingHoursPerDay: number;
  installPctOfCapex: number;
  laborReplacementPct: number;
  // A2: fraction of displaced labor that stays as human oversight/exception-handling and is
  // therefore NOT saved (reduces savings by (1 - residualSupervisionPct)).
  residualSupervisionPct: number;
  // A1: annual operations one human worker handles (same unit as facility demand). Caps how
  // many workers the fleet can realistically displace, so savings track workload not headcount.
  opsPerWorkerPerYear: number;
  // Тот же предел, но для потока FLOOR_AREA: сколько площади обслуживает один уборщик за год.
  // Сотрудник, обрабатывающий операции, и уборщик — разные величины, и делитель обязан быть
  // разным, иначе A1 ограничивает нагрузку не той меркой.
  areaPerCleanerPerYear: number;
  // Сколько раз в сутки обслуживается площадь. Превращает площадь из разовой величины в поток.
  cleaningsPerDay: number;
  turnoverPerDay: number;
  roiHorizonYears: number;
  // A3: time-value + lifecycle. discountRate drives NPV / discounted payback; assetLifeYears
  // triggers CAPEX re-investment when robots wear out before the ROI horizon ends.
  discountRate: number;
  assetLifeYears: number;
  // I6: display-only USD→RUB rate. Not used by the engine (all math is USD) — lives here so it
  // is editable in the same assumptions panel and sourced from the DB Assumption table.
  usdToRub: number;
  // #8a: regional energy-cost multiplier on each solution's energyUsdYear. Default 1.0 (no-op).
  energyCostFactor: number;
};

type EconomicsCommon = {
  quantity: number;
  // A1: workload-capped displaced full-time-equivalents = min(staffCount, demand/opsPerWorker).
  displacedFte: number;
  capexUsd: number;
  opexAnnualUsd: number;
  baselineAnnualUsd: number;
  annualSavingsUsd: number;
};

export type EconomicsResult =
  | (EconomicsCommon & {
      economical: true;
      // A3: "simple" = undiscounted; NPV/discounted payback use the discount rate. Discounted
      // payback is null when the investment does not pay back within the ROI horizon.
      simplePaybackYears: number;
      simpleRoiPct: number;
      npvUsd: number;
      discountedPaybackYears: number | null;
    })
  | (EconomicsCommon & {
      economical: false;
      reason: "no_savings";
    })
  // Degenerate inputs (zero-valued divisors, non-positive price/capacity, or any
  // non-finite intermediate) yield no meaningful numbers. Returned as a typed result so
  // the engine never leaks Infinity/NaN to callers (UI, persisted `results`, future API).
  | {
      economical: false;
      reason: "invalid_inputs";
    }
  // Занятость задачи не заявлена, и норматива со ссылкой у категории нет. Это не вырожденный
  // ввод, а ОТСУТСТВУЮЩИЙ ОТВЕТ: показать ноль экономии значило бы утверждать, что задачей
  // никто не занят. Отдельная причина, а не invalid_inputs, потому что экран обязан сказать
  // человеку, что именно от него требуется, — это единственный отказ, который он может снять.
  | {
      economical: false;
      reason: "staffing_required";
    };

/**
 * True when the investment is worth recommending, not merely cash-flow positive.
 *
 * `economical` answers a narrower question than the UI was reading into it: it is set by
 * `annualSavingsUsd > 0` alone, so it stays true for a solution whose savings never recover the
 * discounted CAPEX. Two of the thirteen seeded solutions are exactly that — MediCarry M1 pairs
 * `economical: true` with an NPV of −$87 878 and no discounted payback inside the horizon — and
 * the hero band was celebrating them while the results panel directly below said
 * «не окупается в пределах горизонта».
 *
 * Viability adds the two discounted tests: the project must be NPV-positive and must actually
 * recover within the modelled horizon. Presentational only — the engine's discriminant and every
 * number it produces are unchanged.
 */
export function isViable(r: EconomicsResult): boolean {
  return r.economical && r.npvUsd >= 0 && r.discountedPaybackYears !== null;
}

/**
 * Отказ, который человек может снять сам, введя число.
 *
 * Заведено потому, что `isCalculable` ложен для ОБОИХ отказов, и интерфейс их не различал:
 * «не хватает занятости» показывалось теми же словами, что «вы ввели ерунду» — «проверьте
 * параметры расчёта». На семи решениях из одиннадцати это был обычный путь, а не край, и
 * человек не мог догадаться, что от него требуется одно число.
 */
export function isStaffingRequired(r: EconomicsResult): boolean {
  return !r.economical && "reason" in r && r.reason === "staffing_required";
}

/** Result variants that carry numeric fields (economical or no_savings) — i.e. not the
 *  `invalid_inputs` placeholder. Used to gate/narrow number rendering in the UI. */
export type CalculableResult = Extract<EconomicsResult, { quantity: number }>;

export function isCalculable(r: EconomicsResult): r is CalculableResult {
  return "quantity" in r;
}
