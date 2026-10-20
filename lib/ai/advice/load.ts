import type { PrismaClient } from "@prisma/client";
import type { ReportResults } from "@/lib/report/tz/rows";
import { buildAdviceFacts } from "./facts";
import { adviceFactsHash } from "./hash";
import { latestAdvice } from "./store";
import type { AdviceView } from "./view";

/**
 * Рекомендации проекта для страницы и отчёта. Актуальны, если ключ ответа совпадает с ключом
 * фактов сохранённого расчёта при той же модели, что дала ответ: смена модели в настройках не
 * делает прежний ответ ложным, а новый запрос просто даст новый ключ. null — ответа нет.
 */
export async function projectAdviceView(
  db: Pick<PrismaClient, "aiAdvice" | "project" | "$transaction">,
  projectId: string,
  userId: string,
  results: ReportResults | null,
): Promise<AdviceView | null> {
  const stored = await latestAdvice(db, projectId, userId);
  if (!stored) return null;
  const fresh = results !== null && stored.factsHash === adviceFactsHash(buildAdviceFacts(results), stored.model);
  return { content: stored.content, model: stored.model, createdAt: stored.createdAt.toISOString(), stale: !fresh };
}
