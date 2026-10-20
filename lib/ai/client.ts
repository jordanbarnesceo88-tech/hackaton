import type { AiConfig } from "./config";

/**
 * Вызов OpenAI-совместимого /chat/completions обычным fetch, без SDK: новая зависимость
 * поменяла бы отпечаток расчётного движка (см. config.ts).
 *
 * Ответ всегда просится строгим JSON по схеме (response_format: json_schema, strict) —
 * сервис ИИ на MLX поддерживает только json_schema и text, json_object он отклоняет. Ошибки
 * сведены к кодам AiErrorCode; ключ и тело ответа в сообщения не попадают.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiErrorCode =
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_HTTP"
  | "AI_BAD_RESPONSE"
  | "AI_TRUNCATED"
  | "AI_UNVERIFIED_NUMBERS";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    /** HTTP-статус ответа сервиса ИИ, если он был. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export type ChatJsonRequest = {
  messages: readonly ChatMessage[];
  /** Имя и JSON-схема ответа. */
  schemaName: string;
  schema: Readonly<Record<string, unknown>>;
  maxTokens: number;
};

export type ChatJsonOptions = {
  signal?: AbortSignal;
  /** Предел ожидания ответа, мс. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Предел одной попытки: полные рекомендации на этой модели — 11–41 с (живой прогон на четырёх
 * демо-проектах и фикстуре), запас на очередь сервиса. Две попытки укладываются в maxDuration
 * маршрута.
 */
export const AI_TIMEOUT_MS = 60_000;

/** Текст ответа модели (строка JSON по схеме). */
export async function chatJson(config: AiConfig, request: ChatJsonRequest, options: ChatJsonOptions = {}): Promise<string> {
  const { signal, timeoutMs = AI_TIMEOUT_MS, fetchImpl = fetch } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        temperature: 0,
        max_tokens: request.maxTokens,
        response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch (error) {
    if (timeout.aborted) throw new AiError("AI_TIMEOUT", "Сервис ИИ не ответил за отведённое время");
    if (signal?.aborted) throw error;
    throw new AiError("AI_UNAVAILABLE", "Нет связи с сервисом ИИ");
  }
  if (!response.ok) throw new AiError("AI_HTTP", `Сервис ИИ ответил ошибкой ${response.status}`, response.status);
  const body: unknown = await response.json().catch(() => null);
  const choice = (body as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | null)?.choices?.[0];
  if (choice?.finish_reason === "length") throw new AiError("AI_TRUNCATED", "Ответ ИИ оборвался на пределе длины");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiError("AI_BAD_RESPONSE", "Сервис ИИ вернул пустой ответ");
  return content;
}
