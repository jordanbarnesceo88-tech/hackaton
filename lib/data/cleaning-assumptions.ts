import type { CleaningProfile } from "../tz/types";
import observations from "./alfa-operating-observations.generated.json";
import { cleaningReportReadiness, type CleaningReportObservation } from "../catalog/operating-evidence-readiness";

/** Measured report totals remain visible without re-labelling task time as brush time. */
export function cleaningOperatingReadiness(productSlug: string) {
  return cleaningReportReadiness(productSlug, observations as CleaningReportObservation[]);
}

const WORKING_RATES: Readonly<Record<string, readonly [number, number, number]>> = {
  "pudu-cc1": [550, 2, 2],
  "agibot-c5": [600, 2, 1],
  "viggo-sc80": [1500, 4, 2],
};

/** Editable expert examples, deliberately separate from the catalogue and reported task-hour data. */
export function cleaningWorkingProfile(productSlug: string): CleaningProfile | undefined {
  if (!Object.hasOwn(WORKING_RATES, productSlug)) return undefined;
  const [throughputM2PerH, workBeforeChargeH, chargeH] = WORKING_RATES[productSlug]!;
  return {
    basis: "active-hour", throughputM2PerH, workBeforeChargeH, chargeH,
    dailyCareMin: 15, windowH: 8, initiallyCharged: true, careWithinWindow: true,
    automatableLabourShare: 0.5, mode: "Влажная уборка кафеля",
    source: "Экспертная оценка команды Альфа-Сервиса от 20.10.2026",
    date: "2026-10-20",
    reason: "Рабочие допущения для расчёта: окно 8 ч, уход 15 мин, роботизируется 50% труда уборщиков. Уточните по объекту. Эти значения не являются замерами этой модели на вашем объекте." + (productSlug === "viggo-sc80" ? " В отчётах Alfa выделена одна машина с сопоставленной моделью SC80; её отчётный час не подменяет активный час этого профиля." : ""),
  };
}
