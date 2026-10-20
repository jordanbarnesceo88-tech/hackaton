import { AiError, chatJson, type ChatJsonOptions, type ChatMessage } from "../client";
import type { AiConfig } from "../config";
import { adviceSchema, ADVICE_SYSTEM_PROMPT } from "./prompt";
import type { AdviceFacts, AiAdviceContent } from "./types";
import { adviceScenarioNames, parseAdvice, unknownNumbers } from "./validate";

/**
 * Рекомендации ИИ по фактам расчёта. Ответ не по схеме или с числами, которых нет в фактах, —
 * одна повторная попытка с подсказкой, что исправить; не помогло — ошибка, а не сомнительный
 * текст: в продукте у каждой цифры есть источник, и рекомендации ИИ не исключение.
 */

/** Ответ полных рекомендаций на этой модели — ~900 токенов; предел с запасом, но без бесконечного текста. */
const MAX_TOKENS = 3000;

export type GeneratedAdvice = { content: AiAdviceContent; attempts: number };

export async function generateAdvice(facts: AdviceFacts, config: AiConfig, options: ChatJsonOptions = {}): Promise<GeneratedAdvice> {
  const names = adviceScenarioNames(facts);
  const schema = adviceSchema(names);
  const messages: ChatMessage[] = [
    { role: "system", content: ADVICE_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(facts) },
  ];
  for (let attempt = 1; ; attempt++) {
    const raw = await chatJson(config, { messages, schemaName: "advice", schema, maxTokens: MAX_TOKENS }, options);
    const parsed = parseAdvice(raw, names);
    const unknown = parsed.ok ? unknownNumbers(parsed.content, facts) : [];
    if (parsed.ok && unknown.length === 0) return { content: parsed.content, attempts: attempt };
    if (attempt >= 2) {
      throw parsed.ok
        ? new AiError("AI_UNVERIFIED_NUMBERS", "В ответе ИИ числа, которых нет в расчёте")
        : new AiError("AI_BAD_RESPONSE", `Ответ ИИ не по схеме: ${parsed.reason}`);
    }
    const fix = parsed.ok
      ? `В ответе есть числа, которых нет во входных данных: ${unknown.join("; ")}. Перепиши ответ, используя только числа из входа в том же написании.`
      : "Ответ не соответствует схеме. Верни JSON строго по схеме.";
    messages.push({ role: "assistant", content: raw }, { role: "user", content: fix });
  }
}
