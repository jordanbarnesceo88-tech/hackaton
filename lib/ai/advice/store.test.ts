import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { latestAdvice, saveAdvice } from "./store";
import type { AiAdviceContent } from "./types";

// Настоящий Postgres: изоляция по владельцу и «только последний ответ» — свойства запросов,
// а не кода вокруг них, поэтому проверяются на базе.

const OWNER = "ai-advice-owner@example.com", OTHER = "ai-advice-other@example.com";
let ownerId = "", otherId = "", projectId = "";

const content = (summary: string): AiAdviceContent => ({
  summary,
  whyThisScenario: "—",
  recommendations: [{ action: "Запросите КП", why: "Цена не подтверждена" }],
  risks: [],
  whenConclusionChanges: [],
  nextSteps: ["Обследование", "КП", "Пилот"],
  missingData: [],
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
  ownerId = (await prisma.user.create({ data: { email: OWNER, passwordHash: "x" } })).id;
  otherId = (await prisma.user.create({ data: { email: OTHER, passwordHash: "x" } })).id;
  projectId = (await prisma.project.create({ data: { userId: ownerId, name: "ИИ", facilityTypeSlug: "warehouse", params: {}, paramsSource: { kind: "manual" } } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
});

describe("рекомендации ИИ в базе", () => {
  it("сохраняет и отдаёт последний ответ владельцу", async () => {
    expect(await latestAdvice(prisma, projectId, ownerId)).toBeNull();
    const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") })).toBe("saved");
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "a", model: "m", content: { summary: "первый" } });
    const after = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("новый расчёт вытесняет прежний ответ, тот же ключ — перезаписывает", async () => {
    await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") });
    await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "b", model: "m", promptVersion: "advice-3", content: content("второй") });
    await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "b", model: "m", promptVersion: "advice-3", content: content("третий") });
    expect(await prisma.aiAdvice.count({ where: { projectId } })).toBe(1);
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "b", content: { summary: "третий" } });
  });

  it("чужой проект неотличим от несуществующего", async () => {
    await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") });
    expect(await latestAdvice(prisma, projectId, otherId)).toBeNull();
    expect(await saveAdvice(prisma, projectId, otherId, 0, { factsHash: "x", model: "m", promptVersion: "advice-3", content: content("чужой") })).toBe("not_found");
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "a" });
  });

  it("удаляется вместе с проектом", async () => {
    await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") });
    await prisma.project.delete({ where: { id: projectId } });
    expect(await prisma.aiAdvice.count({ where: { projectId } })).toBe(0);
  });

  it("поздний ответ прежней ревизии не удаляет актуальные рекомендации", async () => {
    await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "old", model: "m", promptVersion: "advice-4", content: content("old") });
    await prisma.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    await saveAdvice(prisma, projectId, ownerId, 1, { factsHash: "new", model: "m", promptVersion: "advice-4", content: content("new") });
    expect(await saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "old", model: "m", promptVersion: "advice-4", content: content("late old") })).toBe("conflict");
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "new", content: { summary: "new" } });
    expect(await prisma.aiAdvice.count({ where: { projectId } })).toBe(1);
  });

  it("ожидает конкурентную публикацию проекта и проверяет ревизию после снятия блокировки", async () => {
    let locked!: (pid: number) => void, release!: () => void;
    const ready = new Promise<number>(resolve => { locked = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const publication = prisma.$transaction(async tx => {
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      locked(backend!.pid);
      await unlock;
    });
    const lockingPid = await ready;
    const late = saveAdvice(prisma, projectId, ownerId, 0, { factsHash: "late", model: "m", promptVersion: "advice-4", content: content("late") });
    try {
      const deadline = Date.now() + 2000;
      let waiting = false;
      do {
        const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${lockingPid}::integer = ANY(pg_blocking_pids(pid))) AS blocked`;
        waiting = row!.blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      } while (!waiting && Date.now() < deadline);
      expect(waiting).toBe(true);
    } finally {
      release();
      await publication;
    }
    expect(await late).toBe("conflict");
    expect(await prisma.aiAdvice.count({ where: { projectId } })).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).revision).toBe(1);
  });
});
