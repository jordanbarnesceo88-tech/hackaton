import { simWasRun } from "./metrics";
import type { SimBottleneck, SimSummaryStored, SimVerdict } from "./types";

/**
 * Строки «Итоги имитации» для экрана, отчёта и выгрузок CSV/XLSX (ТЗ §3.7.2–3.7.4). Числа
 * остаются числами (округлены до десятых), чтобы XLSX получил числовые ячейки, а формат с
 * десятичной запятой навёл сборщик выгрузки.
 */

/** Подписи узких мест по-русски. */
export const BOTTLENECK_LABELS: Readonly<Record<SimBottleneck, string>> = {
  none: "нет",
  fleet: "парк роботов",
  points: "точки приёмки и отгрузки",
  charging: "зарядные станции",
  payload: "грузоподъёмность",
};

/** Подписи вердикта по-русски. */
export const VERDICT_LABELS: Readonly<Record<SimVerdict, string>> = {
  CONFIRMED: "Расчёт подтверждён имитацией",
  NOT_CONFIRMED: "Не подтверждён",
  NOT_SUPPORTED: "Имитация для этого класса не поддерживается",
  NOT_EVALUATED: "Нагрузка не оценена",
};

/**
 * Значение показателя прогона, когда прогона не было (вход отклонён предварительной
 * проверкой): нули в сводке означают «не применимо», а не «простой 0 %».
 */
export const NO_RUN_VALUE = "прогон не выполнялся";

/** Строка таблицы: подпись и значение. */
export type SimRow = [label: string, value: number | string];

/** Округление до десятых без хвостов двоичной арифметики. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Итоги прогона строками [подпись, значение]. Первые десять строк — показатели, которые
 * сверяются с расчётом (рассчитано и достигнуто, загрузка, простой, зарядка, ожидание,
 * очередь, узкое место, вердикт); дальше — параметры прогона для воспроизводимости. Если
 * прогона не было (`simWasRun` ложно), показатели прогона заменены словами `NO_RUN_VALUE`.
 */
export function simSummaryRows(summary: SimSummaryStored): SimRow[] {
  const s = summary;
  const ran = simWasRun(s);
  const measured = (v: number): number | string => (ran ? round1(v) : NO_RUN_VALUE);
  const verdictText =
    s.verdict === "NOT_CONFIRMED"
      ? `${VERDICT_LABELS.NOT_CONFIRMED}: ${BOTTLENECK_LABELS[s.bottleneck]}`
      : s.verdict === "CONFIRMED" && s.oversized
        ? `${VERDICT_LABELS.CONFIRMED} (парк избыточен)`
        : VERDICT_LABELS[s.verdict];
  return [
    ["Рассчитано, пал./ч", round1(s.requiredPerH)],
    ["Достигнуто, пал./ч", measured(s.achievedPerH)],
    ["Загрузка парка, %", measured(s.fleetUtilPct)],
    ["Простой, %", measured(s.idlePct)],
    ["Зарядка, %", measured(s.chargingPct)],
    ["Ожидание у точек, %", measured(s.waitAtPointsPct)],
    ["Очередь, макс.", ran ? s.queueMax : NO_RUN_VALUE],
    ["Ожидание p95, мин", measured(s.waitP95Min)],
    ["Узкое место", BOTTLENECK_LABELS[s.bottleneck]],
    ["Вердикт", verdictText],
    ...(s.observedPeakTasks !== undefined ? [["Наблюдалось клиентских заданий в пике", s.observedPeakTasks] as SimRow] : []),
    ...(s.assessmentReason ? [["Основание оценки", s.assessmentReason] as SimRow] : []),
    ["Состав потока: приёмка / отгрузка / внутренние", s.demandMix
      ? `${round1(s.demandMix.inbound * 100)} / ${round1(s.demandMix.outbound * 100)} / ${round1(s.demandMix.internal * 100)} %`
      : "Исторический вход: 50 / 50 / 0 %"],
    ...(s.storageVacancyShare !== undefined ? [["Начальная доля свободных мест (допущение)", s.storageVacancyShare] as SimRow] : []),
    ["Роботов в прогоне", s.fleet],
    ["Загрузка в расчёте, %", round1(s.assumedUtilPct)],
    ["Обслужено заданий пика, %", s.verdict === "NOT_EVALUATED" ? "нет поступивших клиентских заданий" : measured(s.servedShare * 100)],
    ["Минимальный устойчивый парк", s.minStableFleet ?? "не определён"],
    ["Парк по паспортной норме", s.fleetByNorm ?? "нет нормы"],
    [
      "Вердикт при парке по норме",
      s.verdictByNorm === null ? "не проверялся" : VERDICT_LABELS[s.verdictByNorm],
    ],
    ["Зерно генератора", s.seed],
    ["Модель имитации", s.simModelVersion],
  ];
}
