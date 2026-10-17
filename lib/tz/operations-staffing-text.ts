import { formatNum, formatRub } from "../format/rub";
import type { ScenarioSpec } from "./types";

/** Persisted assumptions, not a recalculation: shared by UI and archived exports. */
export function operationsStaffingText(value: ScenarioSpec["operationsStaffing"]): string {
  if (!value) return "Исходное допущение: отдельный пост эксплуатации на всё время работы объекта; это допущение модели, не требование ТЗ";
  const detail = value.mode === "dedicated"
    ? `Выделенный персонал: оклад ${formatRub(value.grossSalaryRubMonth)}/мес, начисления ×${formatNum(value.payrollMultiplier, 3)}, фонд ${formatNum(value.annualHoursPerFte)} ч/ставку в год`
    : value.mode === "shared-existing"
      ? `Существующий персонал: только дополнительная оплата ${formatNum(value.incrementalHoursYear)} ч/год × ${formatRub(value.grossHourlyRub)}/ч × ${formatNum(value.payrollMultiplier, 3)}; исходный ФОТ повторно не начисляется`
      : value.billing === "separate" ? `Диспетчеризация интегратором: ${formatRub(value.annualFeeRub)}/год на весь парк отдельным платежом`
        : "Диспетчеризация интегратором включена в уже оплачиваемый сервис / RaaS, отдельная плата исключена";
  return `${detail}. Основание (допущение): ${value.reason}`;
}
