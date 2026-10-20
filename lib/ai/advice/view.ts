import type { AiAdviceContent } from "./types";

/**
 * Рекомендации ИИ в том виде, в каком их получает браузер и отчёт. stale — ответ к прежнему
 * расчёту: показывается с пометкой и кнопкой «Обновить». Модуль без серверных зависимостей —
 * его импортируют и клиентские компоненты.
 */
export type AdviceView = {
  content: AiAdviceContent;
  model: string;
  /** Момент ответа, ISO 8601. */
  createdAt: string;
  stale: boolean;
};

/** Подписи важности риска — та же шкала, что у рисков движка в отчёте. */
export const SEVERITY_LABEL: Readonly<Record<AiAdviceContent["risks"][number]["severity"], string>> = {
  high: "высокий",
  medium: "средний",
  low: "низкий",
};

/** Оговорка под рекомендациями — на экране и в отчёте одна. */
export const ADVICE_NOTE = "Сформировано ИИ по результатам расчёта платформы. Числа взяты из расчёта; выводы проверьте перед решением.";
