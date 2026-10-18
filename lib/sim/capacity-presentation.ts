import type { CapacityProof } from "./capacity-protocol";
import type { SpatialEvidence } from "../tz/types";
import { fnv1a32 } from "../tz/version";
import { formatNum } from "../format/rub";

export type CapacityDisplayRow = { label: string; value: string | number; unit: string };

export function capacityNominalDisplayRows(review: SpatialEvidence["capacityNominalReview"]): CapacityDisplayRow[] {
  if (!review) return [{ label: "Допуск по номинальной работе", value: "Не сохранён; автоматическая квалификация недоступна", unit: "" }];
  const rows: CapacityDisplayRow[] = [
    { label: "Допуск по номинальной работе", value: review.eligible ? "Номинальные проверки безопасности, очереди и ожидания пройдены" : "Номинальная работа требует разбора; автоматическая квалификация недоступна", unit: "" },
  ];
  for (const reason of review.reasons) rows.push({ label: "Причина ограничения номинальной работы", value: reason, unit: "" });
  if (!review.diagnostics) return [...rows, { label: "Диагностика номинальной работы", value: "Не сохранена", unit: "" }];
  rows.push(
    { label: "Номинальный прогон: наибольшее текущее ожидание начала работы", value: review.diagnostics.pendingWaitMaxS, unit: "с" },
    { label: "Номинальный прогон: наибольшее непрерывное защитное ожидание", value: review.diagnostics.blockedWaitMaxS, unit: "с" },
  );
  for (const task of review.diagnostics.unfinished) rows.push({
    label: `Номинальный прогон: незавершённое задание ${task.taskId}`,
    value: `${task.operation}; ${task.kind}; возраст ${task.ageS} с; до начала работы ${task.pendingWaitS} с; защитное ожидание ${task.blockedWaitS} с${task.robotId === undefined ? "" : `; робот ${task.robotId}`}${task.podId ? `; носитель ${task.podId}` : ""}${task.reason ? `; ${task.reason}` : ""}. Возраст движущегося задания сам по себе не означает нарушение.`, unit: "",
  });
  return rows;
}

/** Saved observations only: displaying an archive never reruns a qualification policy. */
export function capacityDisplayRows(proof: CapacityProof): CapacityDisplayRow[] {
  const m = proof.metrics;
  const observed = (value: number) => proof.terminal && proof.status !== "NOT_EVALUATED" ? value : "Не оценено";
  const rows: CapacityDisplayRow[] = [
    { label: "Сохранённый статус теста", value: proof.status, unit: "" },
    { label: "Обоснование", value: proof.reason ?? "Причина не сохранена", unit: "" },
    { label: "Протокол", value: proof.protocolId, unit: "" },
    { label: "Пространственная модель теста", value: proof.simModelVersion, unit: "" },
    { label: "Короткая метка исходного входа", value: `fnv1a32-${fnv1a32(proof.sourceInputKey)}`, unit: "" },
    { label: "Короткая метка тестового входа", value: `fnv1a32-${fnv1a32(proof.testInputKey)}`, unit: "" },
    { label: "Короткая метка исполнительного входа", value: proof.executionInputKey ? `fnv1a32-${fnv1a32(proof.executionInputKey)}` : "Не получена", unit: "" },
    { label: "Привязка наблюдения", value: "Короткие метки FNV-1a32 предназначены для визуальной сверки отчётов. Полные канонические ключи сохранены в JSON проекта; сервер проверяет полные входы, а не короткие метки.", unit: "" },
    { label: "Состав клиентского потока теста", value: proof.input.demand.mix ? `Приёмка ${formatNum(proof.input.demand.mix.inbound * 100, 2)}%; отгрузка ${formatNum(proof.input.demand.mix.outbound * 100, 2)}%; внутренние перемещения ${formatNum(proof.input.demand.mix.internal * 100, 2)}%` : "Не задан в сохранённом входе", unit: "" },
    { label: "Требуемая мощность исходного сценария", value: m.requiredPerH, unit: "пал./ч" },
    { label: "Периодическая тестовая подача", value: m.offeredPerH, unit: "пал./ч" },
    { label: "Фактически поступило в измерительное окно", value: observed(m.arrivedPerH), unit: "пал./ч" },
    { label: "Доставлено из поступлений окна", value: observed(m.deliveredCohort), unit: "перевозок" },
    { label: "Закрыто полных циклов поступлений окна", value: observed(m.closedCohort), unit: "циклов" },
    { label: "Выпуск по доставкам когорты", value: observed(m.deliveredCohortPerH), unit: "пал./ч" },
    { label: "Выпуск по полным циклам когорты", value: observed(m.closedCohortPerH), unit: "пал./ч" },
    { label: "Начало измерения после старта", value: m.measurementStartS, unit: "с" },
    { label: "Конец измерения после старта", value: m.measurementEndS, unit: "с" },
    { label: "Незавершённые клиентские задания", value: observed(m.unfinishedCustomerCount), unit: "заданий" },
    { label: "Незавершённые подачи и возвраты", value: observed(m.unfinishedServiceCount), unit: "заданий" },
    { label: "Возраст старейшей незавершённой работы", value: observed(m.oldestUnfinishedAgeS), unit: "с" },
    { label: "Парк / зарядки / seed теста", value: `${proof.input.robots.count} / ${proof.input.layout.chargers} / ${proof.input.seed}`, unit: "" },
    { label: "Границы теста", value: "Подача 110% — проектный запас теста. Прогрев 15 минут, измерение 120 минут. Учитываются только поступления измерительного окна с завершённой доставкой и обязательной подачей или возвратом носителя. Задания прогрева и работа после окна не дают зачёта. Номинальный прогон и его статус сохраняются отдельно. Это модельная проверка данного профиля, а не подтверждение годовой эксплуатации.", unit: "" },
  ];
  for (const task of proof.qualificationDiagnostics.unfinished) rows.push({
    label: `Незавершённое задание ${task.taskId}`,
    value: `${task.operation}; ${task.kind}; возраст ${task.ageS} с; до начала работы ${task.pendingWaitS} с; непрерывное защитное ожидание ${task.blockedWaitS} с${task.robotId === undefined ? "" : `; робот ${task.robotId}`}${task.podId ? `; носитель ${task.podId}` : ""}${task.reason ? `; ${task.reason}` : ""}. Возраст не является временем нарушения полного цикла.`,
    unit: "",
  });
  return rows;
}
