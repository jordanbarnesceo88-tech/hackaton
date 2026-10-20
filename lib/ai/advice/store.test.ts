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
    expect(await saveAdvice(prisma, projectId, ownerId, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") })).toBe(true);
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "a", model: "m", content: { summary: "первый" } });
  });

  it("новый расчёт вытесняет прежний ответ, тот же ключ — перезаписывает", async () => {
    await saveAdvice(prisma, projectId, ownerId, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") });
    await saveAdvice(prisma, projectId, ownerId, { factsHash: "b", model: "m", promptVersion: "advice-3", content: content("второй") });
    await saveAdvice(prisma, projectId, ownerId, { factsHash: "b", model: "m", promptVersion: "advice-3", content: content("третий") });
    expect(await prisma.aiAdvice.count({ where: { projectId } })).toBe(1);
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "b", content: { summary: "третий" } });
  });

  it("чужой проект неотличим от несуществующего", async () => {
    await saveAdvice(prisma, projectId, ownerId, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") });
    expect(await latestAdvice(prisma, projectId, otherId)).toBeNull();
    expect(await saveAdvice(prisma, projectId, otherId, { factsHash: "x", model: "m", promptVersion: "advice-3", content: content("чужой") })).toBe(false);
    expect(await latestAdvice(prisma, projectId, ownerId)).toMatchObject({ factsHash: "a" });
  });

  it("удаляется вместе с проектом", async () => {
    await saveAdvice(prisma, projectId, ownerId, { factsHash: "a", model: "m", promptVersion: "advice-3", content: content("первый") });
    await prisma.project.delete({ where: { id: projectId } });
    expect(await prisma.aiAdvice.count({ where: { projectId } })).toBe(0);
  });
});
