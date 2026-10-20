/**
 * Рекомендации ИИ по расчёту проекта: что получает модель (факты) и что она возвращает.
 * Факты — только посчитанное движком и уже показанное пользователю, в той же записи чисел,
 * что в таблице сценариев отчёта; ответ проверяется по схеме и по числам (validate.ts).
 */

/** Важность риска — шкала рисков движка. */
export type AdviceSeverity = "high" | "medium" | "low";

export type AdviceRisk = { severity: AdviceSeverity; text: string };

/** Сценарий в фактах: показатели — строки таблицы сценариев отчёта «подпись → ячейка». */
export type AdviceScenarioFacts = {
  name: string;
  kind: string;
  metrics: Record<string, string>;
  risks: AdviceRisk[];
};

export type AdviceFacts = {
  /** Тип объекта: «Склад», «Магазин»… */
  object: string;
  /** Сценарий, выбранный платформой; null — платформа ни один не выбрала. */
  recommended: AdviceScenarioFacts | null;
  /** Остальные сценарии, включая «Как есть». */
  alternatives: AdviceScenarioFacts[];
  platformConclusion: { headline: string; points: string[] };
  limitations: string[];
};

/** Ответ ИИ после проверки — так он хранится и показывается. */
export type AiAdviceContent = {
  summary: string;
  /** Чем выбранный сценарий лучше; если выбора нет — почему платформа его не сделала. */
  whyThisScenario: string;
  recommendations: { action: string; why: string }[];
  risks: { scenario: string; severity: AdviceSeverity; risk: string; mitigation: string; checkOnPilot: string }[];
  whenConclusionChanges: string[];
  nextSteps: string[];
  missingData: string[];
};
