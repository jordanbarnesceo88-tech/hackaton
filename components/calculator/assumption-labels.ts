import type { AssumptionValues } from "@/lib/economics/types";
import { TASK_STAFFING_KEY, type SensitivityLeverKey } from "@/lib/economics/sensitivity";

export const ASSUMPTION_LABELS: Record<keyof AssumptionValues, string> = {
  laborCostPerHourUsd: "Стоимость труда (USD/час)",
  hoursPerYear: "Рабочих часов в году",
  workingDaysPerYear: "Рабочих дней в году",
  operatingHoursPerDay: "Часов работы в сутки",
  installPctOfCapex: "Монтаж (доля от CAPEX)",
  laborReplacementPct: "Замещение труда (доля)",
  residualSupervisionPct: "Остаточный надзор (доля)",
  opsPerWorkerPerYear: "Операций на сотрудника в год",
  areaPerCleanerPerYear: "Площадь на уборщика в год, м²",
  cleaningsPerDay: "Уборок площади в сутки",
  turnoverPerDay: "Оборотов в сутки",
  roiHorizonYears: "Горизонт ROI (лет)",
  discountRate: "Ставка дисконтирования (доля)",
  assetLifeYears: "Срок службы техники (лет)",
  usdToRub: "Курс USD→RUB",
  energyCostFactor: "Множитель энергозатрат (регион)",
};

/**
 * Подписи рычагов диаграммы. Шире, чем допущения: занятость задачей — тоже рычаг, но живёт в
 * параметрах объекта, а не в допущениях (остаток A-7).
 *
 * Отдельная карта, а не расширение ASSUMPTION_LABELS: та типизирована по `AssumptionValues` и
 * ровно поэтому не даёт забыть подпись новому допущению. Дописать в неё ключ, которого в
 * `AssumptionValues` нет, — значит снять эту гарантию ради одной строки.
 */
export const LEVER_LABELS: Record<SensitivityLeverKey, string> = {
  ...ASSUMPTION_LABELS,
  [TASK_STAFFING_KEY]: "Занятость этой работой (человек)",
};

// Ratio (0..1 fraction) assumptions get a finer spinner step; everything else steps by 1.
export const RATIO_KEYS = new Set<keyof AssumptionValues>([
  "installPctOfCapex",
  "laborReplacementPct",
  "residualSupervisionPct",
  "discountRate",
  "energyCostFactor",
]);
