import { apiError } from "@/lib/api/http";
import { AiError, type AiErrorCode } from "../client";

/**
 * Ответы маршрутов рекомендаций ИИ при сбое: пользователю — что случилось и что делать, без
 * подробностей сервиса ИИ. Сбой ИИ — 502 (виноват внешний сервис, не запрос), обрыв запроса
 * пользователем — 499, остальное — 503.
 */

const MESSAGES: Readonly<Record<AiErrorCode, string>> = {
  AI_UNAVAILABLE: "Сервис ИИ сейчас недоступен. Повторите попытку позже.",
  AI_TIMEOUT: "Сервис ИИ не ответил вовремя. Повторите попытку.",
  AI_HTTP: "Сервис ИИ ответил ошибкой. Повторите попытку позже.",
  AI_BAD_RESPONSE: "ИИ ответил не по формату. Повторите попытку.",
  AI_TRUNCATED: "Ответ ИИ оборвался. Повторите попытку.",
  AI_UNVERIFIED_NUMBERS: "ИИ упомянул числа, которых нет в расчёте, поэтому ответ не показан. Повторите попытку.",
};

export const AI_NOT_CONFIGURED = "Рекомендации ИИ не настроены на этом сервере";

export function adviceErrorResponse(error: unknown, signal: AbortSignal): Response {
  if (error instanceof AiError) return apiError(502, MESSAGES[error.code]);
  if (signal.aborted) return apiError(499, "Запрос отменён");
  console.error("ai-advice:", error instanceof Error ? error.message : error);
  return apiError(503, "Не удалось подготовить рекомендации. Повторите попытку позже.");
}
