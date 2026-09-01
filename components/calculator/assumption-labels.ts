import type { AssumptionValues } from "@/lib/economics/types";

export const ASSUMPTION_LABELS: Record<keyof AssumptionValues, string> = {
  laborCostPerHourUsd: "Стоимость труда (USD/час)",
  hoursPerYear: "Рабочих часов в году",
  workingDaysPerYear: "Рабочих дней в году",
  operatingHoursPerDay: "Часов работы в сутки",
  installPctOfCapex: "Монтаж (доля от CAPEX)",
  laborReplacementPct: "Замещение труда (доля)",
  residualSupervisionPct: "Остаточный надзор (доля)",
  opsPerWorkerPerYear: "Операций на сотрудника в год",
  turnoverPerDay: "Оборотов в сутки",
  roiHorizonYears: "Горизонт ROI (лет)",
  discountRate: "Ставка дисконтирования (доля)",
  assetLifeYears: "Срок службы техники (лет)",
  usdToRub: "Курс USD→RUB",
  energyCostFactor: "Множитель энергозатрат (регион)",
};

// Ratio (0..1 fraction) assumptions get a finer spinner step; everything else steps by 1.
export const RATIO_KEYS = new Set<keyof AssumptionValues>([
  "installPctOfCapex",
  "laborReplacementPct",
  "residualSupervisionPct",
  "discountRate",
  "energyCostFactor",
]);
