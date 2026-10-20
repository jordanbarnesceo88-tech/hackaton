import { parseAdviceFacts } from "@/lib/ai/advice/facts-check";
import { generateAdvice } from "@/lib/ai/advice/generate";
import { adviceErrorResponse, AI_NOT_CONFIGURED } from "@/lib/ai/advice/http";
import type { AdviceView } from "@/lib/ai/advice/view";
import { readAiConfig } from "@/lib/ai/config";
import { apiError, apiJson, isPlainObject, readJsonBody, tooManyRequests, unknownFields } from "@/lib/api/http";
import { clientIp, rateLimit } from "@/lib/auth/rate-limit";
import { foreignOrigin } from "@/lib/calculation-jobs/http";

/**
 * Рекомендации ИИ гостю в демо. Гостевой расчёт ничего не сохраняет, поэтому факты строит браузер
 * той же функцией buildAdviceFacts из результатов серверного гостевого расчёта и присылает их
 * сюда; маршрут их строго проверяет (facts-check.ts) и ничего не хранит.
 *
 * Почему не пересчёт на сервере: он повторяет тяжёлую 3D-проверку (в контейнере разработки не
 * уложился в 45 с) — каждый запрос к ИИ удваивал бы нагрузку и давал бы простой способ её
 * поднять. Почему не подпись результатов: публичный контракт /api/v1/demo-calculation закреплён
 * тестом и не меняется. Подменённые факты влияют только на ответ самому гостю; схема ответа и
 * сверка чисел с фактами работают так же, лимит — по адресу.
 */

export const runtime = "nodejs";
/** Две попытки ИИ по AI_TIMEOUT_MS (60 с) и запас. */
export const maxDuration = 130;

const FIELDS: ReadonlySet<string> = new Set(["facts"]);
/** Факты демо-проектов — 5–7 тыс. символов; предел тела с запасом. */
const MAX_BYTES = 64 * 1024;
/** Вызовы ИИ с одного адреса: ответ занимает до 40 с работы модели. */
const RATE = { limit: 6, windowMs: 10 * 60 * 1000 } as const;

export async function POST(request: Request): Promise<Response> {
  if (foreignOrigin(request)) return apiError(403, "Запросите рекомендации из этой платформы");
  const config = readAiConfig();
  if (!config) return apiError(503, AI_NOT_CONFIGURED);
  try {
    const body = await readJsonBody(request, MAX_BYTES);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value)) return apiError(422, "Тело запроса — объект { facts }");
    const extra = unknownFields(body.value, FIELDS);
    if (extra.length) return apiError(422, `Неизвестные поля: ${extra.join(", ")}`);
    const facts = parseAdviceFacts(body.value.facts);
    if (!facts) return apiError(422, "Факты расчёта не прошли проверку. Пересчитайте демо и повторите");
    const limited = await rateLimit(`ai-advice:guest:ip:${clientIp(request.headers)}`, RATE);
    if (limited.unavailable) return apiError(503, "Не удалось проверить лимит рекомендаций ИИ. Повторите попытку позже.");
    if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
    const { content } = await generateAdvice(facts, config, { signal: request.signal });
    return apiJson({ advice: { content, model: config.model, createdAt: new Date().toISOString(), stale: false } satisfies AdviceView });
  } catch (error) {
    return adviceErrorResponse(error, request.signal);
  }
}
