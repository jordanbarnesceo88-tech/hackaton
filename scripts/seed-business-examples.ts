import type { Prisma, PrismaClient } from "@prisma/client";
import { buildBusinessExampleOffline } from "../lib/projects/business-example-offline";
import { BUSINESS_EXAMPLE_OWNER, businessExampleProjectId, compatibleBusinessExampleSnapshot } from "../lib/projects/business-example-snapshot";
import { BUSINESS_EXAMPLES } from "../lib/projects/business-examples";
import { asProjectResults, DB_SCENARIO_KIND, persistNewProject, scenarioSpecJson } from "../lib/projects/queries";
import { loadLiveInputs } from "../lib/projects/recalc";

/** Prepare public examples outside requests and persist each completed snapshot atomically. */
export async function seedBusinessExamples(db: PrismaClient): Promise<void> {
  const owner = await db.user.findUnique({ where: { email: BUSINESS_EXAMPLE_OWNER }, select: { id: true } });
  if (!owner) throw new Error("Для учебных примеров нужен демо-аккаунт");
  const live = await loadLiveInputs(db, "warehouse");
  for (const example of BUSINESS_EXAMPLES) {
    const id = businessExampleProjectId(example.id);
    const current = await db.project.findUnique({ where: { id }, select: { userId: true, isDemo: true, results: true } });
    if (current && (!current.isDemo || current.userId !== owner.id)) throw new Error(`ID учебного примера занят: ${id}`);
    const previous = asProjectResults(current?.results);
    if (previous && compatibleBusinessExampleSnapshot(live, example.id, previous)) continue;
    const prepared = buildBusinessExampleOffline(live, example.id);
    if (!compatibleBusinessExampleSnapshot(live, example.id, prepared.results)) throw new Error(`Учебный пример не прошёл проверку: ${id}`);
    await db.$transaction(async tx => {
      const existing = await tx.project.findUnique({ where: { id }, select: { userId: true, isDemo: true } });
      if (existing && (!existing.isDemo || existing.userId !== owner.id)) throw new Error(`ID учебного примера занят: ${id}`);
      const input = {
        id, userId: owner.id, name: example.title, objectName: "Учебный склад: публичные исходные данные",
        facility: "warehouse", params: prepared.params, scenarios: prepared.model.scenarios,
        paramsSource: { kind: "demo" as const }, isDemo: true,
      };
      if (!existing) {
        await persistNewProject(tx, input, prepared.results);
        return;
      }
      // Keep the project identity and links from users' copies when refreshing prepared data.
      await tx.scenario.deleteMany({ where: { projectId: id } });
      await tx.project.update({ where: { id }, data: {
        name: input.name, params: prepared.results.paramsUsed as Prisma.InputJsonValue,
        results: prepared.results as unknown as Prisma.InputJsonValue,
        modelVersion: prepared.results.modelVersion, dataVersion: prepared.results.dataVersion,
        calculatedAt: new Date(prepared.results.calculatedAt), revision: { increment: 1 },
        scenarios: { create: prepared.results.scenarios.map((spec, order) => ({
          key: spec.key, name: spec.name, kind: DB_SCENARIO_KIND[spec.kind], order, spec: scenarioSpecJson(spec),
        })) },
      } });
    });
    console.log(`  Учебный пример ${id}: подготовлен ${prepared.results.calculatedAt}`);
  }
}
