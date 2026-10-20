import { buildAdviceFacts } from "@/lib/ai/advice/facts";
import { adviceFactsHash } from "@/lib/ai/advice/hash";
import { generateAdvice } from "@/lib/ai/advice/generate";
import { adviceErrorResponse, AI_NOT_CONFIGURED } from "@/lib/ai/advice/http";
import { ADVICE_PROMPT_VERSION } from "@/lib/ai/advice/prompt";
import { latestAdvice, saveAdvice } from "@/lib/ai/advice/store";
import type { AdviceView } from "@/lib/ai/advice/view";
import { readAiConfig } from "@/lib/ai/config";
import { apiError, apiJson, isPlainObject, readJsonBody, tooManyRequests, unknownFields } from "@/lib/api/http";
import { getSessionUser } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rate-limit";
import { foreignOrigin } from "@/lib/calculation-jobs/http";
import { prisma } from "@/lib/db/client";
import { getProject } from "@/lib/projects/queries";
import { validProjectRevision } from "@/lib/projects/validate";

/**
 * Рекомендации ИИ по сохранённому расчёту проекта — кнопка «Рекомендации ИИ» под выводом.
 * Только владельцу; факты — из сохранённого расчёта, поэтому экран и отчёт показывают один и
 * тот же текст. Тот же расчёт — ответ из хранилища без нового вызова ИИ и без расхода лимита.
 * Маршрут не в /api/v1: это не публичный API (openapi.test.ts требует описывать каждый v1).
 */

export const runtime = "nodejs";
/** Две попытки по AI_TIMEOUT_MS (60 с) и запас на загрузку проекта. */
export const maxDuration = 130;

/** Вызовы ИИ на пользователя: ответ занимает до 40 с работы модели. */
const RATE = { limit: 12, windowMs: 60 * 60 * 1000 } as const;
const FIELDS: ReadonlySet<string> = new Set(["expectedRevision"]);
const conflict = () => apiError(409, "Расчёт проекта изменился. Обновите проект и запросите рекомендации для актуальной версии.");

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  if (foreignOrigin(request)) return apiError(403, "Запросите рекомендации из этой платформы");
  const user = await getSessionUser();
  if (!user) return apiError(401, "Войдите, чтобы получить рекомендации по проекту");
  const config = readAiConfig();
  if (!config) return apiError(503, AI_NOT_CONFIGURED);
  const { projectId } = await params;
  try {
    const body = await readJsonBody(request, 4 * 1024);
    if (!body.ok) return body.response;
    if (!isPlainObject(body.value)) return apiError(422, "Тело запроса — объект { expectedRevision }");
    if (unknownFields(body.value, FIELDS).length) return apiError(422, "Неизвестные поля запроса");
    if (!Object.hasOwn(body.value, "expectedRevision")) return apiError(428, "Передайте ревизию показанного расчёта: expectedRevision");
    const expectedRevision = body.value.expectedRevision;
    if (!validProjectRevision(expectedRevision)) return apiError(422, "expectedRevision — целая неотрицательная ревизия проекта");
    const project = await getProject(prisma, projectId, user.userId);
    if (!project) return apiError(404, "Проект не найден");
    if (project.revision !== expectedRevision) return conflict();
    if (!project.results) return apiError(409, "Сначала рассчитайте и сохраните проект");
    const facts = buildAdviceFacts(project.results);
    const factsHash = adviceFactsHash(facts, config.model);
    const stored = await latestAdvice(prisma, projectId, user.userId);
    if (stored?.factsHash === factsHash) {
      const current = await prisma.project.findFirst({ where: { id: projectId, userId: user.userId }, select: { revision: true } });
      if (!current) return apiError(404, "Проект не найден");
      if (current.revision !== expectedRevision) return conflict();
      return apiJson({ advice: { content: stored.content, model: stored.model, createdAt: stored.createdAt.toISOString(), stale: false } satisfies AdviceView });
    }
    const limited = await rateLimit(`ai-advice:user:${user.userId}`, RATE);
    if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
    const { content } = await generateAdvice(facts, config, { signal: request.signal });
    const saved = await saveAdvice(prisma, projectId, user.userId, expectedRevision, { factsHash, model: config.model, promptVersion: ADVICE_PROMPT_VERSION, content });
    if (saved === "not_found") return apiError(404, "Проект не найден");
    if (saved === "conflict") return conflict();
    return apiJson({ advice: { content, model: config.model, createdAt: new Date().toISOString(), stale: false } satisfies AdviceView });
  } catch (error) {
    return adviceErrorResponse(error, request.signal);
  }
}
