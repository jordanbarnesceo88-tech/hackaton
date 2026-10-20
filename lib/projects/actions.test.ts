import { randomUUID } from "node:crypto";
import { CalculationRequestError, enqueueCalculation, computeFrozenCalculation, publishFrozenCalculation, type FrozenCalculationInput } from "../calculation-jobs/service";
import { claimJob, completeJob, failJob, getOwnedJobResult, reapExpiredJobs } from "../calculation-jobs/store";
import { engineRelease } from "../calculation-jobs/types";
import { drainOwnReceipt, serialTestCommands } from "./test-support/durable-driver";
import type { SaveProjectInput, SaveProjectResult } from "./action-types";
import { simInputIdentity } from "../sim/identity";
import { spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import { createSpatialProjectSnapshot, SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { calculateProjectPreview } from "../../experiments/warehouse-3d/project-input";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { toCharacteristicData } from "../catalog/queries";
import { sourcedToCharRow } from "../catalog/product-for-calc";
import { promoteColumns } from "../catalog/promote";
import { catalogProduct } from "../data/organizer/catalog";
import { processDef, solutionTypeDef } from "../tz/processes";
import { AUTO_MANUAL_SUFFIX, buildProjectModel, expectedSpatialInputFromStored, storedPartOf } from "../tz/model";
import type { ProductSeed, ProjectResults, ScenarioSpec } from "../tz/types";
import { stableJson } from "../tz/version";
import { buildPilotBudget, defaultPilotPlan } from "../tz/pilot-budget";
import { TEST_CLEANING_PROFILE } from "../tz/econ/cleaning-fixtures";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { projectCsv } from "../report/tz/csv";
import { bestPaybackYears, getProject, getProjectChanges, getOwnedProjectSnapshot, persistNewProject, listProjects, persistProjectCalculation, scenarioFromRow, type NewProject, type ProjectCalculation } from "./queries";
import { resultsFromInputsAsync, type LiveInputs, type ComputeProjectInput, liveDataVersion, loadLiveInputs, reproduceModel } from "./recalc";

/**
 * Durable команды и атомарная публикация проектов на настоящем Postgres (набор db). Подменены только границы,
 * которые в тесте не работают: сессия (auth), перенаправление (бросает исключение
 * NEXT_REDIRECT) и revalidatePath (нужен контекст запроса Next). Расчёт, имитация и БД —
 * настоящие.
 *
 * Тест заводит собственные строки с префиксом tzt-t22-: двух пользователей и два продукта —
 * копии Ronavi H1500 и DMR Carrier P из данных организатора (origin ADMIN, чтобы синхронизация
 * не отправила их в архив). Если процесса «Перемещение паллет» и типов решений ещё нет (данные
 * не засеяны), они создаются из определений в коде — ровно так, как их создаёт синхронизация,
 * — и остаются: это общая таксономия, а не данные теста. Описания параметров берутся из БД,
 * а до сева — из кода (loadLiveInputs).
 */

const { mockAuth, mockRedirect, mockRevalidate, RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  return {
    RedirectSignal,
    mockAuth: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new RedirectSignal(url);
    }),
    mockRevalidate: vi.fn(),
  };
});
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

const serverActions = await import("./actions");
const currentRevision = async (id: string) => (await prisma.project.findUnique({ where: { id }, select: { revision: true } }))?.revision ?? 0;
let actingUser: string | null = null;
const serialCommand = serialTestCommands();

// Test driver runs the real durable boundary and worker publication, without a web compute alias.
async function executeCommand(request: unknown): Promise<SaveProjectResult> {
  if (!actingUser) return { ok: false, reason: "unauthenticated", message: "Войдите" };
  const ownerId = actingUser;
  try {
    const receipt = await enqueueCalculation(prisma, ownerId, request, randomUUID());
    const startedAt = new Date();
    const diagnostics = async () => ({ receiptId: receipt.id, ownerId, workerRelease: engineRelease(),
      own: await prisma.calculationJob.findFirst({ where: { id: receipt.id, ownerId }, select: {
        status: true, diagnosticCode: true, attempts: true, leaseUntil: true, nextAttemptAt: true,
        run: { select: { ownerId: true, engineRelease: true, publicationState: true } },
      } }),
      queue: await prisma.calculationJob.findMany({ where: { OR: [
        { status: { in: ["QUEUED", "RUNNING"] } }, { status: "FAILED", finishedAt: { gte: startedAt } },
      ] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10, select: {
        id: true, ownerId: true, status: true, diagnosticCode: true, leaseUntil: true, nextAttemptAt: true,
        run: { select: { engineRelease: true } },
      } }),
    });
    let emptyClaims = 0;
    const completed = await serialCommand(() => drainOwnReceipt({
      inspect: async () => {
        const result = await getOwnedJobResult(prisma, ownerId, receipt.id);
        return result ? { status: result.job.status, diagnosticCode: result.job.diagnosticCode, value: result } : null;
      },
      recover: () => reapExpiredJobs(prisma),
      claim: () => claimJob(prisma, { workerId: "project-data-test", leaseMs: 120_000 }),
      execute: async claim => {
        try {
          const computed = await computeFrozenCalculation(claim.run.input);
          expect(await completeJob(prisma, claim, computed, publishFrozenCalculation)).toBe(true);
        } catch (error) {
          await failJob(prisma, claim, "TEST_COMPUTATION_FAILED", "Test calculation failed");
          if (claim.job.id === receipt.id) throw error;
          console.error(`project_test_foreign_job_failed job=${claim.job.id} owner=${claim.run.ownerId}`);
        }
      },
      diagnostics,
      onEmptyClaim: snapshot => { if (emptyClaims++ === 0) console.error(`project_test_null_claim ${JSON.stringify(snapshot)}`); },
    }));
    if (!completed.run.results) throw new Error(`SUCCEEDED durable receipt has no stored result; ${JSON.stringify(await diagnostics())}`);
    if (completed.job.publicationState === "STALE") return { ok: false, reason: "conflict", message: "Проект изменился" };
    const results = completed.run.results as unknown as ProjectResults;
    return { ok: true, results, revision: completed.job.publishedRevision ?? 0, calculatedAt: results.calculatedAt, dataVersion: results.dataVersion };
  } catch (error) {
    if (!(error instanceof CalculationRequestError)) throw error;
    const reason = ({ 401: "unauthenticated", 404: "not_found", 409: "conflict", 428: "precondition_required" } as const)[error.status as 401 | 404 | 409 | 428] ?? "invalid";
    return { ok: false, reason, message: error.message + " " + JSON.stringify(error.details ?? {}) };
  }
}
const commands = {
  ...serverActions,
  save: (id: string, input: SaveProjectInput) => executeCommand({ ...input, operation: "SAVE", projectId: id }),
  recalculate: (id: string, expectedRevision?: number) => executeCommand({ operation: "RECALCULATE", projectId: id, expectedRevision }),
};
const actions = { ...serverActions,
  save: async (id: string, input: SaveProjectInput) => commands.save(id, { expectedRevision: await currentRevision(id), ...input }),
  recalculate: async (id: string) => commands.recalculate(id, await currentRevision(id)),
  deleteProjectAction: async (id: string) => serverActions.deleteProjectAction(id, await currentRevision(id)),
};

// Pure-engine setup/fault injection remains local to the DB test, never exported to HTTP.
async function computeProjectResults(db: typeof prisma, input: ComputeProjectInput) {
  return resultsFromInputsAsync(await loadLiveInputs(db, input.facility), input);
}
async function insertProject(db: typeof prisma, live: LiveInputs, input: NewProject) {
  const computed = await resultsFromInputsAsync(live, input);
  return persistNewProject(db, input, computed.results);
}
async function storeProjectCalculation(db: typeof prisma, input: ProjectCalculation) {
  const computed = await resultsFromInputsAsync(input.live, input);
  return db.$transaction(tx => persistProjectCalculation(tx, input, computed));
}

const P = "tzt-t22-";
const PT = "pallet-transport";
const H = `${P}h1500`;
const C = `${P}carrier-p`;
let userA = "";
let userB = "";

/** Копия продукта данных организатора под тестовым slug и названием. */
function fixtureSeed(slug: string, as: string, name: string): ProductSeed {
  const seed = catalogProduct(slug);
  if (!seed) throw new Error(`нет продукта ${slug} в данных организатора`);
  return { ...seed, slug: as, name, organizerCatalogId: null, processes: [PT] };
}

async function writeProduct(seed: ProductSeed): Promise<void> {
  const rows = Object.entries(seed.characteristics).map(([key, s]) => sourcedToCharRow(key, s));
  await prisma.catalogProduct.create({
    data: {
      slug: seed.slug,
      name: seed.name,
      manufacturer: seed.manufacturer,
      country: seed.country,
      level: seed.level,
      status: seed.status,
      origin: "ADMIN",
      solutionType: { connect: { slug: seed.solutionType } },
      facilityTypeSlugs: seed.facilityTypes,
      industries: seed.industries,
      description: seed.description,
      flags: seed.flags,
      excluded: seed.excludedReason !== null,
      excludedReason: seed.excludedReason,
      ...promoteColumns(rows, { flags: seed.flags }),
      processes: { create: seed.processes.map((s) => ({ process: { connect: { slug: s } } })) },
      characteristics: { create: rows.map(toCharacteristicData) },
    },
  });
}

/** Процесс и типы решений из кода, если синхронизация их ещё не создала. */
async function ensureTaxonomy(): Promise<void> {
  const def = processDef(PT);
  if (!def) throw new Error("нет процесса pallet-transport");
  const process = await prisma.process.upsert({
    where: { slug: PT },
    create: {
      slug: def.slug,
      name: def.name,
      description: def.description,
      demandUnit: def.demandUnit,
      demandFormula: def.demandFormula,
      throughputUnit: def.throughputUnit,
      calcSupported: def.calcSupported,
      simSupported: def.simSupported,
      order: def.order,
    },
    update: {},
  });
  const warehouse = await prisma.facilityType.findUniqueOrThrow({ where: { slug: "warehouse" } });
  await prisma.facilityTypeProcess.upsert({
    where: { facilityTypeId_processId: { facilityTypeId: warehouse.id, processId: process.id } },
    create: { facilityTypeId: warehouse.id, processId: process.id, order: def.order },
    update: {},
  });
  for (const slug of ["pallet-amr", "fmr"]) {
    const st = solutionTypeDef(slug);
    if (!st) throw new Error(`нет типа решения ${slug}`);
    await prisma.solutionType.upsert({
      where: { slug },
      create: { slug, name: st.name, purpose: st.purpose, handlingClass: st.handlingClass, mobile: st.mobile },
      update: {},
    });
  }
}

async function cleanup(): Promise<void> {
  await prisma.project.deleteMany({ where: { user: { email: { startsWith: P } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  await prisma.catalogProduct.deleteMany({ where: { slug: { startsWith: P } } });
}

/** Вызов действия, которое при успехе перенаправляет: возвращает адрес перенаправления. */
async function redirected(fn: () => Promise<unknown>): Promise<string> {
  try {
    const r = await fn();
    throw new Error(`ожидалось перенаправление, получено ${JSON.stringify(r)}`);
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
}

/** Результаты без настенного времени: момент расчёта и длительность прогонов имитации. */
function withoutClock(r: ProjectResults): unknown {
  const sim = Object.fromEntries(
    Object.entries(r.sim).map(([k, s]) => [k, s === null ? null : { ...s, durationMs: 0 }]),
  );
  return { ...r, calculatedAt: "", sim };
}

function submittedSpecs(specs: readonly ScenarioSpec[]): ScenarioSpec[] {
  return specs.map(({ spatialEvidence: _receipt, ...spec }) => { void _receipt; return spec; });
}

function expectCanonicalProofs(results: ProjectResults): void {
  for (const spec of results.scenarios) {
    const expected = expectedSpatialInputFromStored(results, spec.key);
    if (expected?.transportWorkflow === "closed-pod-1") {
      expect(spatialEvidenceMatchesInput(spec.spatialEvidence, expected), spec.key).toBe(true);
      expect(spec.spatialEvidence!.executionInputKey).not.toBe("server-replay-request");
    }
  }
}

const SPECS: ScenarioSpec[] = [
  { key: "asis", name: "Как есть", kind: "asis", items: [] },
  { key: "p1", name: "Покупка — TZT22 H1500", kind: "purchase", items: [{ process: PT, productSlug: H, quantityOverride: 12 }] },
  { key: "r1", name: "Услуга (RaaS) — TZT22 H1500", kind: "raas", items: [{ process: PT, productSlug: H }] },
  { key: "p2", name: "Покупка — TZT22 Carrier P", kind: "purchase", items: [{ process: PT, productSlug: C }] },
];

beforeAll(async () => {
  await cleanup();
  await ensureTaxonomy();
  await writeProduct(fixtureSeed("ronavi-h1500", H, "TZT22 H1500"));
  await writeProduct(fixtureSeed("dikom-dmr-carrier-p", C, "TZT22 Carrier P"));
  const stamp = Date.now();
  userA = (await prisma.user.create({ data: { email: `${P}a-${stamp}@test.local`, passwordHash: "x" } })).id;
  userB = (await prisma.user.create({ data: { email: `${P}b-${stamp}@test.local`, passwordHash: "x" } })).id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidate.mockClear();
});

const asUser = (id: string | null) => { actingUser = id; return mockAuth.mockResolvedValue(id ? { user: { id, role: "USER" } } : null); };

describe("действия проектов", () => {
  let projectId = "";

  it("без входа — отказ unauthenticated, ничего не записано", async () => {
    asUser(null);
    await expect(enqueueCalculation(prisma, "", { operation: "CREATE", name: "X", facility: "warehouse" }, randomUUID())).rejects.toMatchObject({ status: 401 });
    const saved = await actions.save("нет", { params: {}, scenarios: SPECS, changes: [] });
    expect(saved).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(await actions.copyProjectAction("нет")).toMatchObject({ reason: "unauthenticated" });
    expect(await actions.deleteProjectAction("нет")).toMatchObject({ reason: "unauthenticated" });
  });

  it("создание: общий durable validator отклоняет неверные данные", async () => {
    for (const request of [
      { operation: "CREATE", name: " ", facility: "warehouse" },
      { operation: "CREATE", name: "X", facility: "port" },
      { operation: "CREATE", name: "X", facility: "warehouse", paramsSource: { kind: "fax" } },
      { operation: "CREATE", name: "X", facility: "warehouse", params: { forkliftSalaryRubMonth: "много" } },
    ]) await expect(enqueueCalculation(prisma, userA, request, randomUUID())).rejects.toMatchObject({ status: 422 });
  });

  it("создание на демо-данных: проект со сценариями по умолчанию и результатами", async () => {
    asUser(userA);
    const receipt = await enqueueCalculation(prisma, userA, { operation: "CREATE", name: "TZT22 Склад", facility: "warehouse", paramsSource: { kind: "demo" } }, randomUUID());
    expect(await prisma.project.findUnique({ where: { id: receipt.reservedProjectId! } })).toBeNull();
    const claim = await claimJob(prisma, { workerId: "project-create-test", leaseMs: 120_000 });
    if (!claim || claim.job.id !== receipt.id) throw new Error("Wrong durable claim");
    expect(await completeJob(prisma, claim, await computeFrozenCalculation(claim.run.input), publishFrozenCalculation)).toBe(true);
    projectId = receipt.reservedProjectId!;

    const p = await getProject(prisma, projectId, userA);
    expect(p).not.toBeNull();
    const results = p?.results;
    expect(results).not.toBeNull();
    if (!p || !results) return;
    expect(p.name).toBe("TZT22 Склад");
    expect(p.paramsSource).toEqual({ kind: "demo" });
    expect(p.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(p.scenarios.map((s) => s.key).slice(0, 3)).toEqual(["asis", "p1", "r1"]);
    expect(results.scenarios).toEqual(p.scenarios);
    expect(results.results.map((r) => r.key)).toEqual(p.scenarios.map((s) => s.key));
    expect(p.modelVersion).toBe(results.modelVersion);
    expect(p.dataVersion).toBe(results.dataVersion);
    expect(p.calculatedAt?.toISOString()).toBe(results.calculatedAt);
    expect(results.results.find((r) => r.key === "p1")?.status).toBe("ok");
    // Имитация выполнена на сервере для рассчитанной покупки.
    expect(results.sim.p1?.verdict).toMatch(/CONFIRMED|NOT_CONFIRMED/);
    expect(results.sim.asis).toBeNull();
  }, 60_000);

  it("сохранение: сервер пересчитывает, getProject возвращает те же результаты, журнал с серверным авто", async () => {
    asUser(userA);
    const before = await getProject(prisma, projectId, userA);
    if (!before?.results) throw new Error("нет результатов");
    const params = { ...before.results.paramsUsed, forkliftSalaryRubMonth: 130_000 };
    const scenarios = structuredClone(SPECS);
    scenarios.find(s => s.key === "r1")!.normOverrides = { utilization: .8 };
    const saved = await actions.save(projectId, {
      name: "TZT22 Склад — вариант",
      params,
      scenarios,
      changes: [
        // Клиент прислал «авто» 999 — сервер его не принимает.
        { scenarioKey: "p1", field: `item:${PT}:quantity`, auto: 999, old: null, new: 12, unit: "шт.", reason: "проверка" },
        { field: "param:forkliftSalaryRubMonth", auto: 1, old: 120_000, new: 130_000, unit: "₽/мес" },
        // Норматив переопределяется в сценарии — запись журнала относится к сценарию.
        { scenarioKey: "r1", field: "norm:utilization", auto: 0.5, old: 0.775, new: 0.8, unit: "доля" },
      ],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const p = await getProject(prisma, projectId, userA);
    const results = p?.results;
    if (!p || !results) throw new Error("проект не сохранён");
    expect(p.name).toBe("TZT22 Склад — вариант");
    expect(results.calculatedAt).toBe(saved.calculatedAt);
    expect(results.dataVersion).toBe(saved.dataVersion);
    expect(p.dataVersion).toBe(saved.dataVersion);
    expect(submittedSpecs(results.scenarios)).toEqual(scenarios);
    expect(p.scenarios).toEqual(results.scenarios);
    expectCanonicalProofs(results);
    expect(results.paramsUsed.forkliftSalaryRubMonth).toBe(130_000);
    expect(p.params.forkliftSalaryRubMonth).toBe(130_000);
    expect(Object.keys(results.productSnapshots).sort()).toEqual([C, H].sort());

    const p1 = results.results.find((r) => r.key === "p1");
    const item = p1?.items[0];
    expect(item?.n).toBe(12);
    expect(item?.nOverridden).toBe(true);
    expect(typeof item?.nAuto).toBe("number");

    const rows = await prisma.changeLog.findMany({ where: { projectId }, orderBy: { field: "asc" } });
    // The server also records real input changes omitted from the client's notes,
    // including a renamed project or a switched catalogue product.
    expect(rows.map(row => row.field)).toEqual(expect.arrayContaining(["project:name", "param:forkliftSalaryRubMonth", `item:${PT}:quantity`, "norm:utilization"]));
    const norm = rows.find((r) => r.field === "norm:utilization");
    expect(norm?.entity).toBe("scenario");
    expect(norm?.scenarioId).toBe(p.scenarioRows.find((s) => s.key === "r1")?.id);
    expect(norm?.autoValue).toBe(0.775);
    const qty = rows.find((r) => r.field === `item:${PT}:quantity`);
    expect(qty?.autoValue).toBe(item?.nAuto);
    expect(qty?.autoValue).not.toBe(999);
    expect(qty?.entity).toBe("scenario");
    expect(qty?.scenarioId).toBe(p.scenarioRows.find((s) => s.key === "p1")?.id);
    expect(qty?.newValue).toBe(12);
    expect(qty?.reason).toBe("проверка");
    expect(qty?.userId).toBe(userA);
    const param = rows.find((r) => r.field === "param:forkliftSalaryRubMonth");
    expect(param?.entity).toBe("project");
    expect(param?.autoValue).toBe(120_000);

    const unlabelled = await getProjectChanges(prisma, projectId, userA);
    expect(unlabelled?.find(c => c.field === "param:forkliftSalaryRubMonth")?.fieldLabel).toBe("Параметр: forkliftSalaryRubMonth");
    const changes = (await getOwnedProjectSnapshot(prisma, projectId, userA))?.changes;
    const labels = new Map(changes?.map((c) => [c.field, c.fieldLabel]));
    expect(labels.get(`item:${PT}:quantity`)).toBe(
      "Число роботов (Перемещение паллет: приёмка → хранение → отгрузка)",
    );
    expect(labels.get("param:forkliftSalaryRubMonth")).toMatch(/^Параметр: Средняя з\/п оператора погрузчика/);
    expect(changes?.find((c) => c.field === `item:${PT}:quantity`)?.scenarioKey).toBe("p1");
    expect(changes?.find((c) => c.field === "norm:utilization")?.scenarioKey).toBe("r1");

    // Список проектов: лучшая окупаемость из jsonb совпадает с расчётом по полным результатам.
    const list = await listProjects(prisma, userA);
    const row = list.find((x) => x.id === projectId);
    expect(row?.scenarioCount).toBe(SPECS.length);
    expect(row?.bestPaybackYears).not.toBeNull();
    expect(row?.bestPaybackYears).toBe(bestPaybackYears(results));
    expect(await listProjects(prisma, userB)).toEqual([]);
  }, 60_000);

  it("решение, исключённое подбором, сервер помечает сам и не рекомендует", async () => {
    const p = await getProject(prisma, projectId, userA);
    if (!p?.results) throw new Error("нет результатов");
    // Паллета 1 600 кг тяжелее обоих роботов (1 500 кг): подбор исключает их правилом R3.
    const heavy = await computeProjectResults(prisma, {
      facility: p.facility,
      params: { ...p.results.paramsUsed, avgPalletMassKg: 1600 },
      scenarios: SPECS,
    });
    for (const s of heavy.results.scenarios.filter((x) => x.kind !== "asis")) {
      expect(s.items[0]?.manuallyAdded).toBe(true);
      expect(s.items[0]?.manualReason).toMatch(/грузоподъёмность 1\s?500 кг < масса груза 1\s?600 кг/);
      expect(s.items[0]?.manualReason?.endsWith(AUTO_MANUAL_SUFFIX)).toBe(true);
    }
    const p1 = heavy.results.results.find((r) => r.key === "p1");
    expect(p1?.status === "ok" && p1.risks.some((r) => r.code === "MANUAL_ADD")).toBe(true);
    expect(heavy.results.conclusion.recommendedScenarioKey).toBeNull();
    expect(heavy.results.conclusion.headline).toMatch(/^Рекомендации нет/);
  }, 60_000);

  it("повторный расчёт из снимка совпадает с сохранённым бит-в-бит", async () => {
    asUser(userA);
    const p = await getProject(prisma, projectId, userA);
    const stored = p?.results;
    if (!p || !stored) throw new Error("нет результатов");
    const again = await computeProjectResults(prisma, {
      facility: p.facility,
      params: stored.paramsUsed,
      scenarios: stored.scenarios,
      snapshot: { productSnapshots: stored.productSnapshots, normsUsed: stored.normsUsed },
    });
    expect(stableJson(withoutClock(again.results))).toBe(stableJson(withoutClock(stored)));
    // Модель страницы проекта, воспроизведённая из снимка, даёт те же сценарии и вывод.
    const live = await loadLiveInputs(prisma, p.facility);
    const model = reproduceModel(live, stored);
    expect(stableJson(model.results)).toBe(stableJson(stored.results));
    expect(stableJson(model.conclusion)).toBe(stableJson(stored.conclusion));
    expect(await liveDataVersion(prisma, stored)).toBe(stored.dataVersion);
  }, 60_000);

  it("чужой проект неотличим от несуществующего", async () => {
    asUser(userB);
    const input = { params: {}, scenarios: SPECS, changes: [] };
    expect(await actions.save(projectId, input)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await actions.recalculate(projectId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await actions.copyProjectAction(projectId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await actions.deleteProjectAction(projectId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getProject(prisma, projectId, userB)).toBeNull();
    expect(await getProjectChanges(prisma, projectId, userB)).toBeNull();
    expect(await getProject(prisma, projectId, userA)).not.toBeNull();
  });

  it("меньше трёх сценариев и посторонние поля — invalid, проект не меняется", async () => {
    asUser(userA);
    const before = await getProject(prisma, projectId, userA);
    const params = before?.results?.paramsUsed ?? {};
    const two = await actions.save(projectId, { params, scenarios: SPECS.slice(0, 2), changes: [] });
    expect(two).toMatchObject({ ok: false, reason: "invalid" });
    if (!two.ok) expect(two.message).toMatch(/от 3 до 10 сценариев/);
    const injected = SPECS.map((s) => ({ ...s, results: { npvRub: 1e12 } })) as unknown as ScenarioSpec[];
    expect(await actions.save(projectId, { params, scenarios: injected, changes: [] })).toMatchObject({
      reason: "invalid",
    });
    const badParam = await actions.save(projectId, {
      params: { ...params, shiftsPerDay: "две" },
      scenarios: SPECS,
      changes: [],
    });
    expect(badParam).toMatchObject({ ok: false, reason: "invalid" });
    const after = await getProject(prisma, projectId, userA);
    expect(after?.results?.calculatedAt).toBe(before?.results?.calculatedAt);
  }, 60_000);

  it("пересчёт на актуальных данных: изменение каталога видно по версии данных", async () => {
    asUser(userA);
    const before = await getProject(prisma, projectId, userA);
    if (!before?.results) throw new Error("нет результатов");
    const product = await prisma.catalogProduct.findUniqueOrThrow({ where: { slug: H } });
    await prisma.productCharacteristic.update({
      where: { productId_key: { productId: product.id, key: "priceRub" } },
      data: { valueNum: 2_500_000 },
    });
    const live = await liveDataVersion(prisma, before.results);
    expect(live).not.toBe(before.results.dataVersion);

    const r = await actions.recalculate(projectId);
    expect(r.ok).toBe(true);
    const after = await getProject(prisma, projectId, userA);
    expect(after?.results?.dataVersion).toBe(live);
    expect(after?.results?.productSnapshots[H]?.priceRub).toBe(2_500_000);
    const capex = (res: ProjectResults | null | undefined) => {
      const s = res?.results.find((x) => x.key === "p1");
      return s && s.status === "ok" ? s.capexRub : null;
    };
    expect(capex(after?.results)).toBeLessThan(capex(before.results) ?? 0);
  }, 60_000);

  it("демо-проект общего аккаунта нельзя сохранить, пересчитать или удалить — только скопировать", async () => {
    asUser(userA);
    const src = await getProject(prisma, projectId, userA);
    if (!src?.results) throw new Error("нет результатов");
    const live = await loadLiveInputs(prisma, "warehouse");
    const { id: demoId } = await insertProject(prisma, live, {
      userId: userA,
      name: "TZT22 Демо-склад",
      objectName: null,
      facility: "warehouse",
      params: src.results.paramsUsed,
      paramsSource: { kind: "demo" },
      scenarios: SPECS,
      isDemo: true,
    });
    const before = await getProject(prisma, demoId, userA);
    const saved = await actions.save(demoId, { params: src.results.paramsUsed, scenarios: SPECS, changes: [] });
    expect(saved).toMatchObject({ ok: false, reason: "invalid" });
    if (!saved.ok) expect(saved.message).toMatch(/только для чтения/);
    expect(await actions.recalculate(demoId)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await actions.deleteProjectAction(demoId)).toMatchObject({ ok: false, reason: "invalid" });
    const after = await getProject(prisma, demoId, userA);
    expect(after?.results?.calculatedAt).toBe(before?.results?.calculatedAt);
    expect(after?.isDemo).toBe(true);

    const copyId = (await redirected(() => actions.copyProjectAction(demoId))).split("/").pop() ?? "";
    const copy = await getProject(prisma, copyId, userA);
    expect(copy?.isDemo).toBe(false);
    expect(copy?.copiedFromId).toBe(demoId);
    expect(await redirected(() => actions.deleteProjectAction(copyId))).toBe("/projects");
    await prisma.project.delete({ where: { id: demoId } });
  }, 120_000);

  it("копия: те же параметры, сценарии и результаты, журнал не копируется", async () => {
    asUser(userA);
    const url = await redirected(() => actions.copyProjectAction(projectId));
    const copyId = url.split("/").pop() ?? "";
    expect(copyId).not.toBe(projectId);
    const [src, copy] = await Promise.all([getProject(prisma, projectId, userA), getProject(prisma, copyId, userA)]);
    expect(copy?.name).toBe(`${src?.name} (копия)`);
    expect(copy?.copiedFromId).toBe(projectId);
    expect(copy?.params).toEqual(src?.params);
    expect(copy?.scenarios).toEqual(src?.scenarios);
    expect(copy?.results).toEqual(src?.results);
    expect(copy?.isDemo).toBe(false);
    expect(await prisma.changeLog.count({ where: { projectId: copyId } })).toBe(0);

    // Удаление копии и исходного проекта — со сценариями и журналом.
    expect(await redirected(() => actions.deleteProjectAction(copyId))).toBe("/projects");
    expect(await getProject(prisma, copyId, userA)).toBeNull();
    expect(await prisma.scenario.count({ where: { projectId: copyId } })).toBe(0);
    expect(await redirected(() => actions.deleteProjectAction(projectId))).toBe("/projects");
    expect(await prisma.changeLog.count({ where: { projectId } })).toBe(0);
    expect(await prisma.scenario.count({ where: { projectId } })).toBe(0);
    expect(await actions.deleteProjectAction(projectId)).toMatchObject({ reason: "not_found" });
  }, 60_000);
});


describe("spatial financial scenario persistence", () => {
  it("retains cash, staffing, package and exact spatial evidence through save, reopen and reproduction", async () => {
    asUser(userA);
    const live = await loadLiveInputs(prisma, "warehouse");
    // Persistence needs a complete real replay, not three repeats of the full-size stress fixture.
    const params = { ...Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base])),
      activeAreaM2: 5000, totalAreaM2: 10000, inboundPalletsPerDay: 500, outboundPalletsPerDay: 500, peakFactor: 1.2 };
    const roundtripSpecs = SPECS.map(s => ({ ...s, items: s.items.map(i => ({ ...i, quantityOverride: 6, chargersOverride: 2 })) }));
    const { id } = await insertProject(prisma, live, { userId: userA, name: "TZT22 spatial roundtrip", objectName: null, facility: "warehouse", params, paramsSource: { kind: "demo" }, scenarios: roundtripSpecs });
    const initial = await getProject(prisma, id, userA);
    if (!initial?.results) throw new Error("No initial calculation");
    const input = expectedSpatialInputFromStored(initial.results, "p1");
    if (!input) throw new Error("No warehouse input");
    expect(input.transportWorkflow).toBe("closed-pod-1");
    const specs = structuredClone(roundtripSpecs), spec = specs.find(s => s.key === "p1")!;
    spec.cashRealizationShare = 0;
    spec.operationsStaffing = { mode: "integrator", billing: "separate", annualFeeRub: 900_000, reason: "Оценка дополнительных расходов на всю площадку" };
    spec.items[0]!.costPackage = { softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 0, reason: "Условный пакет покупки для проверки сохранения" };
    spec.items[0]!.chargersOverride = input.layout.chargers;
    spec.items[0]!.automationCoverageOverride = 0.5;
    spec.spatialEvidence = { input, sourceInputKey: simInputIdentity(input), executionInputKey: "test-prepared-input", simModelVersion: SPATIAL_MODEL_VERSION,
      assessment: { status: "PARTIAL", headline: "Выполнена часть нагрузки", terminal: true },
      summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: input.demand.peakPerH / 2, queueEnd: 20, waitP95Min: 5 } };
    const saved = await actions.save(id, { params, scenarios: specs, changes: [
      { scenarioKey: "p1", field: "scenario:staffing", auto: null, old: null, new: spec.operationsStaffing, reason: spec.operationsStaffing.reason },
      { scenarioKey: "p1", field: "item:pallet-transport:package", auto: null, old: null, new: spec.items[0]!.costPackage, reason: spec.items[0]!.costPackage.reason },
    ] });
    expect(saved.ok).toBe(true);
    const reopened = await getProject(prisma, id, userA);
    if (!reopened?.results) throw new Error("No reopened result");
    const reopenedSpec = reopened.scenarios.find(s => s.key === "p1")!;
    expect(reopenedSpec).toMatchObject({ cashRealizationShare: spec.cashRealizationShare, operationsStaffing: spec.operationsStaffing, items: spec.items });
    const canonical = calculateProjectPreview(createSpatialProjectSnapshot({ requestId: "db-check", scenarioKey: "p1", scenarioName: spec.name, variantId: "calculated", input }));
    expect(reopenedSpec.spatialEvidence).toEqual({ input, sourceInputKey: simInputIdentity(input), executionInputKey: simInputIdentity(canonical.input), simModelVersion: SPATIAL_MODEL_VERSION,
      assessment: { status: canonical.assessment.status, headline: canonical.assessment.headline, terminal: true },
      summary: { fleet: canonical.summary.fleet, requiredPerH: canonical.summary.requiredPerH, achievedPerH: canonical.summary.achievedPerH, queueEnd: canonical.summary.queueEnd, waitP95Min: canonical.summary.waitP95Min } });
    const reproduced = reproduceModel(live, { ...reopened.results, scenarios: reopened.scenarios });
    const persistedResult = reopened.results.results.find(r => r.key === "p1"), reproducedResult = reproduced.results.find(r => r.key === "p1");
    expect(reproducedResult).toEqual(persistedResult);
    if (reproducedResult?.status !== "ok") throw new Error("Refused calculation");
    expect(reproducedResult.operationsStaffing?.annualCostRub).toBe(900_000);
    expect(reproducedResult.capexLines.find(line => line.key === "software")?.valueRub).toBe(0);
    expect(reproducedResult.opexLines.find(line => line.key === "repair")?.valueRub).toBe(0);
    expect(reproducedResult.items[0]!.remainingLabourRub).toBe(reproducedResult.items[0]!.baselineLabourRub);
    expect(reproducedResult.risks.some(r => r.code === "SIM_NOT_CONFIRMED")).toBe(true);
    expect(reproduced.conclusion.recommendedScenarioKey).not.toBe("p1");
  }, 120_000);

  it("replaces a forged client OK with an actual server check before storage", async () => {
    asUser(userA);
    const live = await loadLiveInputs(prisma, "warehouse");
    const params = Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base]));
    const specs = structuredClone(SPECS);
    const spec = specs.find(s => s.key === "p1")!;
    spec.items[0]!.quantityOverride = 1;
    spec.items[0]!.chargersOverride = 1;
    spec.items[0]!.automationCoverageOverride = 0.4;
    spec.cashRealizationShare = 0;
    const { id } = await insertProject(prisma, live, { userId: userA, name: "TZT22 forged spatial OK", objectName: null, facility: "warehouse", params, paramsSource: { kind: "demo" }, scenarios: specs });
    const initial = await getProject(prisma, id, userA);
    if (!initial?.results) throw new Error("No initial calculation");
    const input = expectedSpatialInputFromStored(initial.results, "p1");
    if (!input) throw new Error("No source input");
    spec.spatialEvidence = { input, sourceInputKey: simInputIdentity(input), executionInputKey: "never-executed", simModelVersion: SPATIAL_MODEL_VERSION,
      assessment: { status: "OK", headline: "Поддельный положительный статус", terminal: true },
      summary: { fleet: 1, requiredPerH: input.demand.peakPerH, achievedPerH: 999999, queueEnd: 0, waitP95Min: 0 } };
    const receipt = await actions.save(id, { params, scenarios: specs, changes: [] });
    expect(receipt).toMatchObject({ ok: true });
    const reopened = await getProject(prisma, id, userA);
    if (!reopened?.results) throw new Error("No saved calculation");
    if (!receipt.ok) throw new Error("No canonical save receipt");
    expect(receipt.results).toEqual(reopened.results);
    expect(receipt.results.scenarios.find(s => s.key === "p1")!.spatialEvidence!.assessment.status).toBe("PARTIAL");
    const saved = reopened.scenarios.find(s => s.key === "p1")!;
    expect(saved.spatialEvidence!.assessment.status).toBe("PARTIAL");
    expect(saved.spatialEvidence!.executionInputKey).not.toBe("never-executed");
    expect(saved.spatialEvidence!.summary.achievedPerH).not.toBe(999999);
    expect(saved.cashRealizationShare).toBe(0);
    expect(saved.items[0]!.automationCoverageOverride).toBe(0.4);
    const result = reopened.results.results.find(r => r.key === "p1");
    expect(result?.risks.some(r => r.code === "SIM_NOT_CONFIRMED")).toBe(true);
    expect(reopened.results.conclusion.recommendedScenarioKey).not.toBe("p1");
  }, 120_000);
});

describe("P0 project revision and immutable archive", () => {
  async function example(name: string) {
    asUser(userA);
    const live = await loadLiveInputs(prisma, "warehouse");
    const params = Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base]));
    const { id } = await insertProject(prisma, live, { userId: userA, name, objectName: null, facility: "warehouse", params, paramsSource: { kind: "demo" }, scenarios: SPECS });
    const project = await getProject(prisma, id, userA);
    if (!project?.results) throw new Error("No initial project");
    return { id, live, params: project.results.paramsUsed, project };
  }

  it("two tabs with the same revision have one winner, without mixing scenarios, money or log writes", async () => {
    const { id, params, project } = await example("TZT22 CAS two tabs");
    const requests = [130000, 140000].map((salary, index) => ({ expectedRevision: project.revision,
      name: `TZT22 tab ${index}`, params: { ...params, forkliftSalaryRubMonth: salary },
      scenarios: SPECS.map(s => s.key === "p1" ? { ...s, items: s.items.map(i => ({ ...i, quantityOverride: 7 + index })) } : s),
      changes: [{ field: "param:forkliftSalaryRubMonth", auto: 0, old: params.forkliftSalaryRubMonth ?? null, new: salary, reason: `tab-${index}` }],
    }));
    const outcomes = await Promise.all(requests.map(request => commands.save(id, request)));
    expect(outcomes.filter(r => r.ok)).toHaveLength(1);
    expect(outcomes.filter(r => !r.ok && r.reason === "conflict")).toHaveLength(1);
    const winner = outcomes.findIndex(r => r.ok), saved = await getProject(prisma, id, userA);
    expect(saved?.revision).toBe(project.revision + 1);
    expect(saved?.name).toBe(requests[winner]!.name);
    expect(saved?.params.forkliftSalaryRubMonth).toBe(requests[winner]!.params.forkliftSalaryRubMonth);
    expect(submittedSpecs(saved!.scenarios)).toEqual(requests[winner]!.scenarios);
    expectCanonicalProofs(saved!.results!);
    expect(saved?.results?.paramsUsed.forkliftSalaryRubMonth).toBe(requests[winner]!.params.forkliftSalaryRubMonth);
    const log = await prisma.changeLog.findMany({ where: { projectId: id } });
    expect(log.map(row => row.field).sort()).toEqual([`item:${PT}:quantity`, "param:forkliftSalaryRubMonth", "project:name"].sort());
    expect(log.find(row => row.field === "param:forkliftSalaryRubMonth")!.reason).toBe(`tab-${winner}`);
    expect(log.find(row => row.field === `item:${PT}:quantity`)!.newValue).toBe(7 + winner);
    expect(await commands.recalculate(id, project.revision)).toMatchObject({ reason: "conflict" });
    expect(await serverActions.deleteProjectAction(id, project.revision)).toMatchObject({ reason: "conflict" });
    expect((await getProject(prisma, id, userA))?.revision).toBe(project.revision + 1);
  }, 120_000);

  it("legacy writes without a precondition fail explicitly, including rename, recalc and delete", async () => {
    const { id, params, project } = await example("TZT22 missing revision");
    expect(await commands.save(id, { name: "Must not rename", params, scenarios: SPECS, changes: [] })).toMatchObject({ reason: "precondition_required" });
    expect(await commands.recalculate(id)).toMatchObject({ reason: "precondition_required" });
    expect(await serverActions.deleteProjectAction(id)).toMatchObject({ reason: "precondition_required" });
    const after = await getProject(prisma, id, userA);
    expect(after?.revision).toBe(0); expect(after?.name).toBe(project.name); expect(after?.results).toEqual(project.results);
  }, 120_000);

  it("a failure after the atomic claim rolls back revision, result, scenarios and log", async () => {
    const { id, params, project, live } = await example("TZT22 CAS rollback");
    const invalid = SPECS.map(s => s.kind === "asis" ? s : { ...s, name: "Duplicate name must fail the DB constraint" });
    await expect(storeProjectCalculation(prisma, { projectId: id, userId: userA, expectedRevision: project.revision,
      facility: "warehouse", name: "Must roll back", params: { ...params, forkliftSalaryRubMonth: 190000 }, scenarios: invalid,
      changes: [{ field: "param:forkliftSalaryRubMonth", auto: 0, old: 120000, new: 190000 }], live, snapshot: project.results,
    })).rejects.toMatchObject({ code: "P2002" });
    const after = await getProject(prisma, id, userA);
    expect(after?.revision).toBe(project.revision); expect(after?.name).toBe(project.name);
    expect(after?.results).toEqual(project.results); expect(after?.scenarios).toEqual(project.scenarios);
    expect(await prisma.changeLog.count({ where: { projectId: id } })).toBe(0);
  }, 120_000);

  it("opening an old archive after current bounds/catalog changes leaves results, conclusion and runtime unchanged", async () => {
    const { id, live, project } = await example("TZT22 immutable historical archive");
    const historic = structuredClone(project.results!);
    historic.modelVersion = "unsupported-historic-economy";
    historic.simModelVersion = "unsupported-historic-simulation";
    historic.conclusion.headline = "Immutable historical conclusion";
    const row = historic.results.find(r => r.kind !== "asis" && r.status === "ok");
    if (row?.status === "ok") row.npvRub = 123456789.123456;
    await prisma.project.update({ where: { id }, data: { results: historic as unknown as import("@prisma/client").Prisma.InputJsonValue, modelVersion: historic.modelVersion } });
    const reopened = await getProject(prisma, id, userA);
    if (!reopened?.results) throw new Error("No historical archive");
    const current = { ...live, products: [], paramDefs: live.paramDefs.map(d => ({ ...d, min: 1, max: 2, base: 1 })) };
    const archived = reproduceModel(current, reopened.results);
    expect(archived.results).toEqual(historic.results); expect(archived.conclusion).toEqual(historic.conclusion);
    expect(archived.layout).toEqual(historic.runtime!.layout);
    expect(archived.simInputs).toEqual(historic.runtime!.simInputs);
    expect((await getProject(prisma, id, userA))?.results).toEqual(historic);
    expect((await getProject(prisma, id, userA))?.revision).toBe(0);
  }, 120_000);

  it("cancellation during cooperative calculation leaves revision, archive, scenarios and journal intact", async () => {
    const { id, live, params, project } = await example("TZT22 cancelled async save");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(storeProjectCalculation(prisma, { projectId: id, userId: userA, expectedRevision: project.revision,
        signal: controller.signal, facility: "warehouse", name: "Must not be written", params: { ...params, forkliftSalaryRubMonth: 190000 },
        scenarios: SPECS, changes: [{ field: "param:forkliftSalaryRubMonth", auto: 0, old: 120000, new: 190000 }], live, snapshot: project.results,
      })).rejects.toMatchObject({ name: "AbortError" });
    } finally { clearTimeout(timer); }
    const after = await getProject(prisma, id, userA);
    expect(after?.revision).toBe(project.revision); expect(after?.name).toBe(project.name);
    expect(after?.results).toEqual(project.results); expect(after?.scenarios).toEqual(project.scenarios);
    expect(await prisma.changeLog.count({ where: { projectId: id } })).toBe(0);
  }, 120_000);

  it("an abort observed after the actual SQL claim rolls back the entire transaction", async () => {
    const { id, live, params, project } = await example("TZT22 abort after SQL claim");
    const controller = new AbortController();
    let claimed = false;
    const abortingDb = { $transaction: (callback: Parameters<typeof prisma.$transaction>[0]) => prisma.$transaction(async tx => {
      const intercepted = new Proxy(tx, { get(target, key, receiver) {
        if (key !== "project") return Reflect.get(target, key, receiver);
        return new Proxy(target.project, { get(model, method, rec) {
          if (method === "updateMany") return async (args: Parameters<typeof model.updateMany>[0]) => {
            const result = await model.updateMany(args);
            claimed = result.count === 1; controller.abort(); return result;
          };
          const value = Reflect.get(model, method, rec);
          return typeof value === "function" ? value.bind(model) : value;
        } });
      } });
      return (callback as (client: typeof tx) => Promise<unknown>)(intercepted);
    }) } as unknown as typeof prisma;
    await expect(storeProjectCalculation(abortingDb, { projectId: id, userId: userA, expectedRevision: project.revision,
      signal: controller.signal, facility: "warehouse", name: "Must roll back after claim", params: { ...params, forkliftSalaryRubMonth: 190000 },
      scenarios: SPECS, changes: [{ field: "param:forkliftSalaryRubMonth", auto: 0, old: 120000, new: 190000 }], live, snapshot: project.results,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(claimed).toBe(true);
    const after = await getProject(prisma, id, userA);
    expect(after?.revision).toBe(project.revision); expect(after?.name).toBe(project.name);
    expect(after?.results).toEqual(project.results); expect(after?.scenarios).toEqual(project.scenarios);
    expect(await prisma.changeLog.count({ where: { projectId: id } })).toBe(0);
  }, 120_000);
});

describe("server-derived audit and consistent report snapshot", () => {
  // These fixtures exercise real validation, PostgreSQL publication/CAS and MVCC.
  // The compute boundary supplies a real financial model without a costly spatial replay;
  // physical acceptance is covered separately by the canonical engine tests.
  function computation(frozen: FrozenCalculationInput) {
    const model = buildProjectModel({ ...frozen.live, ...frozen.input,
      products: frozen.input.snapshot ? Object.values(frozen.input.snapshot.productSnapshots) : frozen.live.products,
      norms: frozen.input.snapshot?.normsUsed ?? frozen.live.norms, scenarios: frozen.input.scenarios ?? SPECS });
    return { model, results: { ...storedPartOf(model, frozen.live.paramDefs), calculatedAt: new Date().toISOString(), sim: {} } };
  }
  async function fixture() {
    const live = await loadLiveInputs(prisma, "warehouse");
    const params = Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base]));
    const frozen: FrozenCalculationInput = { schemaVersion: 1, operation: "CREATE", live,
      input: { facility: "warehouse", params, scenarios: structuredClone(SPECS) } };
    const computed = computation(frozen);
    const created = await persistNewProject(prisma, { userId: userA, name: "TZT22 server audit fixture",
      objectName: null, facility: "warehouse", params, paramsSource: { kind: "demo" } }, computed.results);
    const project = await getProject(prisma, created.id, userA);
    if (!project) throw new Error("Missing audit fixture");
    return project;
  }
  async function enqueue(project: NonNullable<Awaited<ReturnType<typeof getProject>>>, patch: Partial<SaveProjectInput>) {
    return enqueueCalculation(prisma, userA, { operation: "SAVE", projectId: project.id, expectedRevision: project.revision,
      params: project.params, scenarios: project.scenarios, ...patch }, randomUUID());
  }
  async function finish(jobId: string) {
    const claim = await claimJob(prisma, { workerId: "audit-contract-test", leaseMs: 120_000 });
    if (!claim) throw new Error("Missing audit claim");
    expect(claim.job.id).toBe(jobId);
    const computed = computation(claim.run.input as unknown as FrozenCalculationInput);
    expect(await completeJob(prisma, claim, computed, publishFrozenCalculation)).toBe(true);
    return (await getOwnedJobResult(prisma, userA, jobId))!;
  }

  it("round-trips cleaning financial profiles through the actual worker engine, JSONB, archive and CSV", async () => {
    // Only this isolated review fixture temporarily enables its existing taxonomy feature flag.
    const definition = processDef("cleaning")!, solution = solutionTypeDef("cleaner")!;
    const previous = await prisma.process.findUnique({ where: { slug: definition.slug } });
    const process = await prisma.process.upsert({ where: { slug: definition.slug }, update: { calcSupported: true }, create: {
      slug: definition.slug, name: definition.name, description: definition.description, demandUnit: definition.demandUnit,
      demandFormula: definition.demandFormula, throughputUnit: definition.throughputUnit, calcSupported: true, simSupported: false, order: definition.order,
    } });
    try {
      await prisma.solutionType.upsert({ where: { slug: solution.slug }, update: {}, create: { slug: solution.slug, name: solution.name, purpose: solution.purpose, handlingClass: solution.handlingClass, mobile: solution.mobile } });
      const warehouse = await prisma.facilityType.findUniqueOrThrow({ where: { slug: "warehouse" } });
      await prisma.facilityTypeProcess.upsert({ where: { facilityTypeId_processId: { facilityTypeId: warehouse.id, processId: process.id } }, update: {}, create: { facilityTypeId: warehouse.id, processId: process.id, order: definition.order } });
      const slug = `${P}cc1-profile`;
      await writeProduct({ ...VENDOR_CLEANING_PRODUCTS[0]!, slug, name: "TZT22 CC1 cleaning fixture", processes: ["cleaning"], facilityTypes: ["warehouse"] });
      const live = await loadLiveInputs(prisma, "warehouse"), included = { mode: "included" } as const;
      expect(live.products.find(row => row.slug === slug)!.handlingClass).toBe("cleaner");
      const params = { ...Object.fromEntries(live.paramDefs.map(d => [d.key, d.base])), cleaningAreaM2: 4400, cleaningsPerDay: 1, cleanersCount: 4, cleanerSalaryRubMonth: 65000 };
      const scope = { softwareIncludedInIntegration: true, repairsIncludedInService: false, includedChargers: 0, allChargersIncluded: true,
        startup: { mode: "separate" as const, amountRub: 80000, basis: "per-site" as const }, platformMonthly: { mode: "separate" as const, amountRub: 12200, basis: "per-robot" as const }, reason: "Синтетическая DB-оценка комплекта, запуска и платформы, не КП" };
      const specs: ScenarioSpec[] = [
        { key: "asis", name: "Ручная уборка", kind: "asis", items: [] },
        { key: "p1", name: "Покупка уборщика", kind: "purchase", items: [{ process: "cleaning", productSlug: slug, cleaningProfile: TEST_CLEANING_PROFILE, priceRubOverride: 2790000, serviceRubYearOverride: 112000, costPackage: scope }] },
        { key: "r1", name: "Услуга уборщика", kind: "raas", items: [{ process: "cleaning", productSlug: slug, cleaningProfile: TEST_CLEANING_PROFILE, raasRubMonthOverride: 185000,
          raasPackage: { firstMonthRub: 250000, startup: included, platform: included, service: included, consumables: included, repair: included, battery: included, reason: "Синтетическая полная DB-оценка состава услуги, не КП" } }] },
      ];
      const created = await insertProject(prisma, live, { userId: userA, name: "TZT22 cleaning profile archive", objectName: null, facility: "warehouse", params, paramsSource: { kind: "demo" }, scenarios: specs });
      const edited = structuredClone(specs);
      for (const spec of edited.filter(row => row.kind !== "asis")) spec.items[0]!.cleaningProfile = { ...TEST_CLEANING_PROFILE, throughputM2PerH: 600, dailyCareMin: 20, source: "Сохранённая синтетическая DB-оценка 600 м²/активный ч" };
      asUser(userA);
      const saved = await commands.save(created.id, { expectedRevision: 0, params, scenarios: edited, changes: [] });
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw new Error(saved.message);
      expect(saved.results.modelVersion).toBe("tz-1.0.10");
      expect(Object.values(saved.results.sim).every(value => value === null)).toBe(true);
      const result = saved.results.results.find(row => row.key === "p1");
      if (result?.status !== "ok") throw new Error(JSON.stringify(result));
      const item = result.items[0]!;
      expect(item.cleaning!.capacityM2PerDay).toBe(2400);
      const comparison = saved.results.comparison.find(row => row.process === "cleaning" && row.productSlug === slug)!;
      expect(comparison.calculationBasis).toContain("Покупка уборщика");
      expect(comparison.thrEff).toBe(item.thrEff);
      expect(comparison.thrEff).toBe(2400 / TEST_CLEANING_PROFILE.windowH);
      const throughput = result.sensitivity.find(row => row.lever === "throughput")!;
      expect(throughput.base).toBe(600);
      expect(throughput.unit).toBe("м²/активный ч");
      for (const endpoint of [throughput.npvLow, throughput.npvHigh]) {
        expect(endpoint).not.toBeNull(); expect(Number.isFinite(endpoint)).toBe(true);
      }
      const raasResult = saved.results.results.find(row => row.key === "r1");
      if (raasResult?.status !== "ok") throw new Error("Expected persisted RaaS sensitivity");
      const rate = raasResult.sensitivity.find(row => row.lever === "raasRate")!;
      expect(rate.base).toBe(185000); expect(rate.high).toBeLessThanOrEqual(250000);
      for (const endpoint of [rate.npvLow, rate.npvHigh]) {
        expect(endpoint).not.toBeNull(); expect(Number.isFinite(endpoint)).toBe(true);
      }
      expect(result.capexLines.find(row => row.key === "startup")!.valueRub).toBe(80000);
      expect(result.capexLines.find(row => row.key === "chargers")!.valueRub).toBe(0);
      expect(result.opexLines.find(row => row.key === "licences")!.valueRub).toBe(item.n! * 12 * 12200);
      const raw = await prisma.project.findUniqueOrThrow({ where: { id: created.id }, include: { scenarios: true } });
      expect(raw.results as unknown as ProjectResults).toEqual(saved.results);
      expect((raw.results as unknown as ProjectResults).scenarios.find(row => row.key === "p1")!.items[0]!.cleaningProfile).toEqual(edited[1]!.items[0]!.cleaningProfile);
      const rawSpec = scenarioFromRow(raw.scenarios.find(row => row.key === "p1")!);
      expect(rawSpec.items[0]!.costPackage).toEqual(scope);
      expect(rawSpec.items[0]!.cleaningProfile).toEqual(edited[1]!.items[0]!.cleaningProfile);
      const countBefore = await prisma.calculationJob.count({ where: { ownerId: userA } });
      if (previous) await prisma.process.update({ where: { id: process.id }, data: { calcSupported: previous.calcSupported } });
      const reopened = (await getProject(prisma, created.id, userA))!;
      expect(reopened.results).toEqual(saved.results);
      const archive = reproduceModel({ ...live, products: [] }, reopened.results!);
      expect(archive.results).toEqual(saved.results.results);
      expect(archive.comparison).toEqual(saved.results.comparison);
      const csv = projectCsv(reopened.results!, { projectName: reopened.name });
      expect(csv).toContain(edited[1]!.items[0]!.cleaningProfile!.source);
      expect(csv).toContain("2400 м²/робот/день"); expect(csv).toContain(scope.reason);
      expect(await prisma.calculationJob.count({ where: { ownerId: userA } })).toBe(countBefore);
      expect((await getProjectChanges(prisma, created.id, userA))!.some(row => row.field === "item:cleaning:cleaningProfile")).toBe(true);
    } finally {
      if (previous) await prisma.process.update({ where: { id: process.id }, data: { calcSupported: previous.calcSupported } });
    }
  }, 120_000);

  it("persists explicit RaaS scope and a pilot's own first month through durable SAVE and immutable archive reopening", async () => {
    const project = await fixture(), live = await loadLiveInputs(prisma, "warehouse");
    const specs = structuredClone(project.scenarios), raas = specs.find(row => row.key === "r1")!;
    const included = { mode: "included" } as const;
    raas.items[0] = { ...raas.items[0]!, quantityOverride: 2, chargersOverride: 1, raasRubMonthOverride: 185000,
      raasPackage: { firstMonthRub: 250000, startup: { mode: "separate", amountRub: 80000, basis: "per-site" },
        platform: { mode: "separate", amountRub: 12200, basis: "per-site" }, service: included,
        consumables: included, repair: included, battery: included, reason: "Синтетическая оценка интеграционного теста, не КП" } };
    const edited = buildProjectModel({ ...live, facility: "warehouse", params: project.params, scenarios: specs });
    const pilot = defaultPilotPlan(edited, "r1");
    pilot.equipmentUnitRubOverride = 300000;
    pilot.raasFirstMonthRubOverride = 400000;
    raas.pilotPlan = pilot;
    const accepted = await enqueue(project, { scenarios: specs, changes: [] });
    expect((await finish(accepted.id)).job.publicationState).toBe("PUBLISHED");
    const saved = (await getProject(prisma, project.id, userA))!;
    const savedSpec = saved.scenarios.find(row => row.key === "r1")!;
    expect(savedSpec.items[0]!.raasPackage).toEqual(raas.items[0]!.raasPackage);
    expect(savedSpec.pilotPlan).toEqual(pilot);
    expect(saved.results!.scenarios.find(row => row.key === "r1")).toEqual(savedSpec);
    const finance = saved.results!.results.find(row => row.key === "r1");
    if (finance?.status !== "ok") throw new Error("Expected canonical RaaS financial result");
    expect(finance.capexLines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(130000);
    expect(finance.opexLines.find(line => line.key === "platform")!.valueRub).toBe(146400);
    const journal = await getProjectChanges(prisma, project.id, userA);
    expect(journal!.find(row => row.field === `item:${PT}:raasPackage`)!.new).toEqual(raas.items[0]!.raasPackage);
    const jobsBefore = await prisma.calculationJob.count({ where: { ownerId: userA } });
    const reopened = (await getProject(prisma, project.id, userA))!;
    expect(reopened.results).toEqual(saved.results);
    expect(reopened.revision).toBe(project.revision + 1);
    const archived = reproduceModel({ ...live, products: [] }, reopened.results!);
    expect(archived.results).toEqual(saved.results!.results);
    expect(archived.scenarios.find(row => row.key === "r1")!.pilotPlan).toEqual(pilot);
    const budget = buildPilotBudget(archived, "r1");
    expect(budget.lines.find(line => line.key === "equipment")!.valueRub).toBe(600000);
    expect(budget.lines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(200000);
    expect(await prisma.calculationJob.count({ where: { ownerId: userA } })).toBe(jobsBefore);
  });

  it("server-derived audit records omitted changes through the real SAVE publication path", async () => {
    const project = await fixture(), specs = structuredClone(project.scenarios);
    specs.find(s => s.key === "p1")!.items[0]!.quantityOverride = 13;
    const receipt = await enqueue(project, { params: { ...project.params, forkliftSalaryRubMonth: 130000 }, scenarios: specs });
    expect((await finish(receipt.id)).job.publicationState).toBe("PUBLISHED");
    const rows = await prisma.changeLog.findMany({ where: { projectId: project.id } });
    expect(rows.map(row => row.field).sort()).toEqual(["item:pallet-transport:quantity", "param:forkliftSalaryRubMonth"].sort());
    expect(rows.find(row => row.field === "item:pallet-transport:quantity")).toMatchObject({ oldValue: 12, newValue: 13, userId: userA });
    expect(rows.find(row => row.field === "param:forkliftSalaryRubMonth")).toMatchObject({ oldValue: project.params.forkliftSalaryRubMonth, newValue: 130000 });
  });

  it("server-derived audit ignores invented values and unchanged notes, keeping only the real reason", async () => {
    const project = await fixture(), specs = structuredClone(project.scenarios);
    specs.find(s => s.key === "p1")!.items[0]!.quantityOverride = 13;
    const changes = [
      { scenarioKey: "p1", field: "item:pallet-transport:quantity", auto: 999999, old: 999999, new: -9, unit: "forged", reason: "Уточнение парка" },
      { field: "param:activeAreaM2", auto: 0, old: 1, new: 999, reason: "Этого изменения не было" },
    ];
    await finish((await enqueue(project, { scenarios: specs, changes })).id);
    const rows = await prisma.changeLog.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "item:pallet-transport:quantity", oldValue: 12, newValue: 13,
      unit: "шт.", reason: "Уточнение парка", userId: userA });
    expect(rows[0]!.autoValue).not.toBe(999999);
    const saved = await getProject(prisma, project.id, userA);
    await finish((await enqueue(saved!, { changes })).id);
    expect(await prisma.changeLog.findMany({ where: { projectId: project.id } })).toEqual(rows);
  }, 60_000); // Two real SAVE calculations/publications, not a store-only audit assertion.

  it("server-derived audit survives scenario deletion and a stale removal cannot detach the winner's history", async () => {
    const project = await fixture(), specs = structuredClone(project.scenarios);
    specs.find(s => s.key === "p1")!.items[0]!.quantityOverride = 13;
    const winner = await enqueue(project, { scenarios: specs, changes: [] });
    const stale = await enqueue(project, { scenarios: project.scenarios.filter(s => s.key !== "p1"), changes: [] });
    await finish(winner.id);
    expect((await finish(stale.id)).job.publicationState).toBe("STALE");
    const before = await prisma.changeLog.findMany({ where: { projectId: project.id } });
    expect(before).toHaveLength(1); expect(before[0]!.scenarioId).not.toBeNull();
    const saved = (await getProject(prisma, project.id, userA))!;
    await finish((await enqueue(saved, { scenarios: saved.scenarios.filter(s => s.key !== "p1"), changes: [] })).id);
    const rows = await prisma.changeLog.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === before[0]!.id)).toMatchObject({ oldValue: 12, newValue: 13, scenarioId: null, entityId: "p1" });
    expect(rows.find(row => row.field === "scenario:remove")).toMatchObject({ scenarioId: null, entityId: "p1" });
    expect((await getProjectChanges(prisma, project.id, userA))!.every(row => row.scenarioKey === "p1")).toBe(true);
  }, 60_000); // Three real SAVE attempts, including stale-revision publication and removal.

  it("server-derived audit and report RepeatableRead do not mix a newly committed journal with old numbers", async () => {
    const project = await fixture();
    const receipt = await enqueue(project, { params: { ...project.params, forkliftSalaryRubMonth: 130000 }, changes: [] });
    let wrote = false;
    const wrapped = new Proxy(prisma, { get(target, property) {
      if (property !== "$transaction") return Reflect.get(target, property);
      return async (read: (tx: typeof prisma) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
        const projectReader = new Proxy(tx.project, { get(delegate, method) {
          if (method !== "findFirst") return Reflect.get(delegate, method);
          return async (args: Parameters<typeof tx.project.findFirst>[0]) => {
            const row = await tx.project.findFirst(args);
            if (!wrote && args?.include) { wrote = true; await finish(receipt.id); }
            return row;
          };
        } });
        return read(new Proxy(tx, { get(client, key) { return key === "project" ? projectReader : Reflect.get(client, key); } }) as typeof prisma);
      }, options as { isolationLevel: "RepeatableRead" });
    } });
    const snapshot = await getOwnedProjectSnapshot(wrapped, project.id, userA);
    expect(wrote).toBe(true);
    expect(snapshot?.project.revision).toBe(0);
    expect(snapshot?.project.params.forkliftSalaryRubMonth).toBe(project.params.forkliftSalaryRubMonth);
    expect(snapshot?.changes).toEqual([]);
    const current = (await getProject(prisma, project.id, userA))!;
    expect(current.revision).toBe(1); expect(current.params.forkliftSalaryRubMonth).toBe(130000);
    expect(await prisma.changeLog.count({ where: { projectId: project.id } })).toBe(1);
  });
});
