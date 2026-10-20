import type { Prisma, PrismaClient } from "@prisma/client";
import type { AiAdviceContent } from "./types";

/**
 * Хранение рекомендаций ИИ проекта (модель AiAdvice). Изоляция — как у проектов (§4.4.2):
 * запись читается и пишется только через проект этого пользователя, чужой проект неотличим
 * от несуществующего. У проекта хранится только последний ответ: показывается всегда он —
 * актуальным, если ключ совпал с фактами текущего расчёта, иначе устаревшим.
 */

export type StoredAdvice = {
  factsHash: string;
  model: string;
  promptVersion: string;
  content: AiAdviceContent;
  createdAt: Date;
};

type Db = Pick<PrismaClient, "aiAdvice" | "project" | "$transaction">;

function toStored(row: { factsHash: string; model: string; promptVersion: string; content: Prisma.JsonValue; createdAt: Date }): StoredAdvice {
  return { factsHash: row.factsHash, model: row.model, promptVersion: row.promptVersion, content: row.content as AiAdviceContent, createdAt: row.createdAt };
}

/** Последние рекомендации проекта пользователя; null — нет или проект чужой. */
export async function latestAdvice(db: Db, projectId: string, userId: string): Promise<StoredAdvice | null> {
  const row = await db.aiAdvice.findFirst({ where: { projectId, project: { userId } }, orderBy: { createdAt: "desc" } });
  return row ? toStored(row) : null;
}

/**
 * Serialize with durable publication: an old generation must never delete newer advice.
 */
export async function saveAdvice(
  db: Db,
  projectId: string,
  userId: string,
  expectedRevision: number,
  advice: Omit<StoredAdvice, "createdAt">,
): Promise<"saved" | "not_found" | "conflict"> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; revision: number }[]>`SELECT id, revision FROM "Project" WHERE id = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
    const owned = rows[0];
    if (!owned) return "not_found";
    if (owned.revision !== expectedRevision) return "conflict";
    await tx.aiAdvice.deleteMany({ where: { projectId, NOT: { factsHash: advice.factsHash } } });
    const data = { model: advice.model, promptVersion: advice.promptVersion, content: advice.content as unknown as Prisma.InputJsonValue, createdAt: new Date() };
    await tx.aiAdvice.upsert({
      where: { projectId_factsHash: { projectId, factsHash: advice.factsHash } },
      create: { projectId, factsHash: advice.factsHash, ...data },
      update: data,
    });
    return "saved";
  });
}
