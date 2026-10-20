import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../db/client";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { projectCsv } from "../report/tz/csv";
import * as modelModule from "../tz/model";
import { resolveNorms } from "../tz/norms";
import { TEST_CLEANER, TEST_CLEANING_PROFILE } from "../tz/econ/cleaning-fixtures";
import { buildPilotBudget, defaultPilotPlan } from "../tz/pilot-budget";
import { evaluatePilotAcceptance } from "../tz/pilot-evaluation";
import type { CleaningPlan, PilotPlanInput, ScenarioSpec } from "../tz/types";
import { getProject, persistNewProject, scenarioFromRow, storeProjectCalculation } from "./queries";
import { reproduceModel, resultsFromInputsAsync, type LiveInputs } from "./recalc";
import { validateScenarioSpecs } from "./validate";

const runId = randomUUID();
const email = `cleaning-roundtrip-${runId}@test.local`;
const live: LiveInputs = { paramDefs: paramSpecsFor("warehouse"), norms: resolveNorms(), paramDefsFrom: "code",
  products: [TEST_CLEANER, { ...TEST_CLEANER, slug: "roundtrip-second-cleaner", name: "Вторая тестовая модель" }] };
const params = { ...baseValuesFor("warehouse"), cleaningAreaM2: 800, cleaningsPerDay: 1, cleanersCount: 4, cleanerSalaryRubMonth: 65000 };
let userId = "";

function cleaningPlan(): CleaningPlan {
  return { schemaVersion: "cleaning-zones-1", source: "Синтетический DB-план: не полевой замер", disjointAreaReason: "Отдельные помещения на разных этажах",
    robots: live.products.map((p, i) => ({ id: `r${i}`, productSlug: p.slug })),
    existingMachines: [{ id: "m1", name: "Существующая машина №1", floor: 2, capacityM2PerDay: 100, operatorHoursPerDay: .5,
      baselineAnnualCostRub: 480000, retainedAnnualCostRub: 240000, source: "Тестовое допущение затрат существующей машины" }],
    zones: live.products.map((_, i) => ({ id: `z${i}`, name: `Помещение ${i + 1}`, floor: i + 1, areaM2: 400, cleaningsPerDay: 1,
      windowStartH: i * 3, windowH: 2, baselineLabourHoursPerDay: 4, retainedLabourHoursPerDay: 2, manualThroughputM2PerH: 200,
      existingMachineIds: i === 1 ? ["m1"] : [], assignments: [{ robotId: `r${i}`, profile: { ...TEST_CLEANING_PROFILE, workBeforeChargeH: 8, chargeH: 1, windowH: 2 }, transferMin: 0, transferLabourMin: 0 }] })) };
}

function specs(): ScenarioSpec[] {
  const items = live.products.map(p => ({ process: "cleaning", productSlug: p.slug, quantityOverride: 1, chargersOverride: 1 }));
  return [{ key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "mixed", name: "Покупка двух моделей", kind: "purchase", items, cleaningPlan: cleaningPlan(), cashRealizationShare: .6,
      terminalResidualRub: 123456, terminalResidualSource: "Синтетическая оценка чистой продажи собственных активов после налогов и вывоза" },
    { key: "service", name: "Услуга двух моделей", kind: "raas", cleaningPlan: cleaningPlan(), items: items.map(item => ({ ...item,
      raasPackage: { startup: { mode: "included" }, platform: { mode: "included" }, service: { mode: "included" }, consumables: { mode: "included" }, repair: { mode: "included" }, battery: { mode: "included" }, reason: "Синтетический состав полного тарифа для DB regression" } })) }];
}

function checked(input: ScenarioSpec[]): ScenarioSpec[] {
  const result = validateScenarioSpecs(input, "warehouse", live.products.map(p => p.slug), ["cleaning"]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.value;
}

function addObservation(pilot: PilotPlanInput): PilotPlanInput {
  return { ...pilot, fleet: 1, chargers: 1, durationDays: 2,
    acceptanceThresholds: { schemaVersion: "pilot-acceptance-1", scope: "Помещение 2", metric: "accepted-area-m2-day", source: "Критерии DB-пилота", date: "2026-10-01",
      minAcceptedPerUnit: 400, minPlanCompletionPct: 100, maxManualReworkPct: 5, maxDowntimePct: 10, maxIncidents: 0, maxInterventionsPerShift: 1, minCustomerScore: 4, minDurationDays: 2 },
    actualResult: { schemaVersion: "pilot-observation-1", scope: "Помещение 2", metric: "accepted-area-m2-day", productSlug: live.products[1]!.slug, fleet: 1,
      periodStart: "2026-10-05", periodEnd: "2026-10-06", observedDays: 2, dayBasis: "working", acceptedQuantity: 800, plannedQuantity: 800,
      manualReworkQuantity: 40, scheduledHours: 4, downtimeHours: .4, incidents: 0, interventions: 2, shifts: 2, customerScore: 4,
      source: "Синтетический журнал DB-пилота", date: "2026-10-07" } };
}

beforeAll(async () => {
  // DATABASE_URL must select a separate test database; only this run's UUID fixtures are removed.
  if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL?.trim()) throw new Error("Use an explicit test DATABASE_URL outside production");
  await prisma.facilityType.findUniqueOrThrow({ where: { slug: "warehouse" } });
  userId = (await prisma.user.create({ data: { email, passwordHash: "test-only" } })).id;
});

afterAll(async () => {
  // Only this run's UUID owner and cascading project/scenario/log rows belong to this test.
  if (userId) await prisma.user.delete({ where: { id: userId, email } });
});

describe("cleaning plan DB acceptance", () => {
  it("validates, stores and reloads both same-process models, residual basis and selected-model pilot observations into the immutable archive and CSV", async () => {
    const initial = checked(specs());
    const draft = await resultsFromInputsAsync(live, { facility: "warehouse", params, scenarios: initial });
    expect(draft.results.results.map(r => r.status)).toEqual(["ok", "ok", "ok"]);
    const pilot = addObservation(defaultPilotPlan(draft.results, "mixed", "purchase", live.products[1]!.slug));
    const scenarios = checked(initial.map(s => s.key === "mixed" ? { ...s, pilotPlan: pilot } : s));
    const computed = await resultsFromInputsAsync(live, { facility: "warehouse", params, scenarios });
    expect(Object.values(computed.results.sim).every(s => s === null)).toBe(true);
    const saved = await persistNewProject(prisma, { userId, name: `Cleaning roundtrip ${runId}`, objectName: null, facility: "warehouse", params,
      paramsSource: { kind: "manual" }, scenarios }, computed.results);
    const loaded = await getProject(prisma, saved.id, userId);
    expect(loaded).not.toBeNull();
    expect(loaded!.scenarios).toEqual(computed.results.scenarios);
    expect(loaded!.results).toEqual(JSON.parse(JSON.stringify(computed.results)));
    const rows = await prisma.scenario.findMany({ where: { projectId: saved.id }, orderBy: { order: "asc" } });
    expect(rows.map(scenarioFromRow)).toEqual(computed.results.scenarios);
    const mixed = loaded!.scenarios.find(s => s.key === "mixed")!;
    expect(mixed.items.map(i => i.productSlug)).toEqual(live.products.map(p => p.slug));
    expect(mixed.cleaningPlan).toEqual(cleaningPlan());
    expect(mixed.pilotPlan).toEqual(pilot);
    expect(evaluatePilotAcceptance(mixed.pilotPlan!, { metric: "accepted-area-m2-day", productSlug: live.products[1]!.slug }).status).toBe("PASS");
    expect(buildPilotBudget(loaded!.results!, "mixed").product.slug).toBe(live.products[1]!.slug);

    const before = structuredClone(loaded!.results!);
    const calculation = vi.spyOn(modelModule, "buildProjectModel").mockImplementation(() => { throw new Error("archive must not recalculate"); });
    try {
      const archive = reproduceModel({ ...live, products: [], paramDefs: [], norms: resolveNorms([{ key: "discountRate", value: .1 }]) }, loaded!.results!);
      expect(archive.scenarios).toEqual(computed.results.scenarios);
      expect(archive.productSnapshots).toEqual(JSON.parse(JSON.stringify(computed.results.productSnapshots)));
      const csv = projectCsv({ ...modelModule.storedPartOf(archive), calculatedAt: loaded!.results!.calculatedAt, sim: loaded!.results!.sim }, { projectName: "DB roundtrip" });
      expect(csv).toBe(projectCsv(computed.results, { projectName: "DB roundtrip" }));
      for (const text of ["Помещение 1", "Помещение 2", "Существующая машина №1", mixed.terminalResidualSource!, "Критерии DB-пилота", "Синтетический журнал DB-пилота", "PASS", live.products[1]!.name]) expect(csv).toContain(text);
      expect(calculation).not.toHaveBeenCalled();
      expect(loaded!.results).toEqual(before);
    } finally { calculation.mockRestore(); }

    // Exercise the update path too: one changed threshold must survive rows + snapshot and alter acceptance.
    const edited = checked(loaded!.scenarios.map(s => s.key === "mixed" ? { ...s, pilotPlan: { ...s.pilotPlan!, acceptanceThresholds: { ...s.pilotPlan!.acceptanceThresholds!, minAcceptedPerUnit: 401 } } } : s));
    await storeProjectCalculation(prisma, { projectId: saved.id, userId, expectedRevision: loaded!.revision, facility: "warehouse", params,
      scenarios: edited, live, snapshot: loaded!.results, changes: [] });
    const updated = await getProject(prisma, saved.id, userId);
    expect(updated!.revision).toBe(loaded!.revision + 1);
    expect(updated!.scenarios.find(s => s.key === "mixed")!.pilotPlan!.acceptanceThresholds!.minAcceptedPerUnit).toBe(401);
    expect(evaluatePilotAcceptance(updated!.scenarios.find(s => s.key === "mixed")!.pilotPlan!, { metric: "accepted-area-m2-day", productSlug: live.products[1]!.slug }).status).toBe("FAIL");
    expect(projectCsv(updated!.results!, { projectName: "DB roundtrip" })).toContain("FAIL");
    const updatedRows = await prisma.scenario.findMany({ where: { projectId: saved.id }, orderBy: { order: "asc" } });
    expect(updatedRows.map(scenarioFromRow)).toEqual(updated!.results!.scenarios);
  }, 30_000);

  it("rejects duplicate-process alternatives without a plan before any project write, and still rejects a duplicate product with a plan", async () => {
    const before = await prisma.project.count({ where: { userId } });
    for (const duplicate of [specs().map(({ cleaningPlan: _plan, ...s }) => { void _plan; return s; }),
      specs().map(s => s.key === "mixed" ? { ...s, items: [s.items[0]!, s.items[0]!] } : s)]) {
      const result = validateScenarioSpecs(duplicate, "warehouse", live.products.map(p => p.slug), ["cleaning"]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("уже выбрано решение");
    }
    const missingResidualBasis = validateScenarioSpecs(specs().map(s => ({ ...s, terminalResidualSource: undefined })), "warehouse", live.products.map(p => p.slug), ["cleaning"]);
    expect(missingResidualBasis.ok).toBe(false);
    if (!missingResidualBasis.ok) expect(missingResidualBasis.errors.join(" ")).toContain("остаточной стоимости");
    expect(await prisma.project.count({ where: { userId } })).toBe(before);
  });
});
