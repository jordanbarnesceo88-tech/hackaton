import { createHash } from "node:crypto";
import { ADVICE_PROMPT_VERSION } from "./prompt";
import type { AdviceFacts } from "./types";

/**
 * Ключ рекомендаций: те же факты, модель и версия инструкции — тот же ответ из хранилища, без
 * нового вызова ИИ. Новый расчёт с другими числами даёт другой ключ, и старый ответ — устаревший.
 */
export function adviceFactsHash(facts: AdviceFacts, model: string): string {
  return createHash("sha256").update(`${ADVICE_PROMPT_VERSION}\n${model}\n${JSON.stringify(facts)}`).digest("hex");
}
