/** A report hour is not silently promoted to an active-cleaning or paid-shift hour. */
export type CleaningReportObservation = {
  vendor: "pudu" | "agibot" | "viggo";
  /** Exact catalogue model from a matched registry title; null never borrows a vendor's model. */
  productSlug: string | null;
  from: string;
  through: string;
  mode: "all" | "scrubbing" | "sweeping";
  basis: "reported-task-hour";
  robotsSelected: number;
  robotsWithTasks: number;
  zeroOutputRobotsWithTasks: number;
  tasks: number;
  reportedAreaM2: number;
  recordedTaskHours: number;
  m2PerRecordedTaskHour: number | null;
  recordedRobotDays: number;
  sourceFiles: { file: string; sha256: string }[];
  timeBasisCheck?: { sampledRecords: number; shorterThanElapsed: number; equalToElapsed: number; greaterThanElapsed: number; gapMinSeconds: number; gapMaxSeconds: number; sampleCleaningSeconds: number; sampleElapsedSeconds: number };
};

export type CleaningEvidenceBlocker = {
  code: "EXACT_MODEL_UNRESOLVED" | "MODE_UNRESOLVED" | "TASK_TIME_NOT_ACTIVE_OR_SHIFT" | "ACCEPTED_AREA_UNVERIFIED" | "FACILITY_SCOPE_UNVERIFIED" | "CYCLE_AND_CARE_NOT_MEASURED";
  detail: string;
  confirmation: string;
};

export type CleaningOperatingReadiness = {
  productSlug: string;
  observations: readonly CleaningReportObservation[];
  applicable: false;
  blockers: CleaningEvidenceBlocker[];
};

export function cleaningReportReadiness(productSlug: string, observations: readonly CleaningReportObservation[]): CleaningOperatingReadiness {
  const vendor = ({ "pudu-cc1": "pudu", "agibot-c5": "agibot", "viggo-sc80": "viggo" } as Record<string, string>)[productSlug];
  const matching = vendor ? observations.filter(row => row.productSlug === productSlug) : [];
  return {
    productSlug, observations: matching, applicable: false,
    blockers: matching.length ? [
      ...(vendor === "pudu" ? [] : [{ code: "MODE_UNRESOLVED" as const, detail: "Общий отчёт содержит все задания; конкретный режим влажной уборки не выделен.", confirmation: "Выделить одинаковый режим по первичным заданиям; не считать vendor или значение общего фильтра 0 режимом мойки." }]),
      { code: "TASK_TIME_NOT_ACTIVE_OR_SHIFT", detail: vendor === "pudu" ? "clean_time — секунды уборки. В проверенных 20 записях он меньше end_time − start_time: время вне уборки частично исключено. Состав пауз и дозаправки в этом счётчике пока не установлен." : "duration = сумма минут заданий / 60. Состав рабочего времени и пауз в spentTime / total_time_min отдельно не установлен.", confirmation: "Сопоставить счётчик с состояниями в пределах того же задания; не считать его целым окном смены и не добавлять повторно уже включённые простои." },
      { code: "ACCEPTED_AREA_UNVERIFIED", detail: "Экспорт показывает сообщённую площадь; повторные проезды, прерванные задания и приёмка качества отдельно не выделены.", confirmation: "Сверить статусы и принятую площадь по секциям; определить правила повторных проходов и отменённых заданий." },
      { code: "FACILITY_SCOPE_UNVERIFIED", detail: "Агрегат семейства объединяет объекты; текущая локация не устанавливает тип и условия исторического участка.", confirmation: "Привязать наблюдения к историческому участку и типу объекта через location_id заданий, не через текущий адрес машины." },
      { code: "CYCLE_AND_CARE_NOT_MEASURED", detail: "Сводки заданий не содержат измеренный цикл работа/зарядка, ресурс воды и минуты ежедневного ухода.", confirmation: "Использовать состояния/сессии зарядки и отдельный журнал ухода; рабочие оценки команды остаются отдельно от измерений." },
    ] : [],
  };
}
