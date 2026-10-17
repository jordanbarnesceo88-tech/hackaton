import { simInputIdentity } from "../sim/identity";
import { createSpatialProjectSnapshot, SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { calculateProjectPreview } from "../../experiments/warehouse-3d/project-input";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { toCharacteristicData } from "../catalog/queries";
import { sourcedToCharRow } from "../catalog/product-for-calc";
import { promoteColumns } from "../catalog/promote";
import { catalogProduct } from "../data/organizer/catalog";
import { processDef, solutionTypeDef } from "../tz/processes";
import { AUTO_MANUAL_SUFFIX, expectedSpatialInputFromStored } from "../tz/model";
import type { ProductSeed, ProjectResults, ScenarioSpec } from "../tz/types";
import { stableJson } from "../tz/version";
import { bestPaybackYears, getProject, getProjectChanges, insertProject, listProjects, storeProjectCalculation } from "./queries";
import { computeProjectResults, liveDataVersion, loadLiveInputs, reproduceModel } from "./recalc";

/**
 * Серверные действия проектов на настоящем Postgres (набор db). Подменены только границы,
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
// Ordinary fixtures send a current precondition; conflict/legacy-client tests call serverActions directly.
const actions = { ...serverActions,
  saveProjectAction: async (id: string, input: Parameters<typeof serverActions.saveProjectAction>[1]) => serverActions.saveProjectAction(id, { expectedRevision: await currentRevision(id), ...input }),
  recalcProjectAction: async (id: string) => serverActions.recalcProjectAction(id, await currentRevision(id)),
  deleteProjectAction: async (id: string) => serverActions.deleteProjectAction(id, await currentRevision(id)),
};

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

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

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

const asUser = (id: string | null) => mockAuth.mockResolvedValue(id ? { user: { id, role: "USER" } } : null);

describe("действия проектов", () => {
  let projectId = "";

  it("без входа — отказ unauthenticated, ничего не записано", async () => {
    asUser(null);
    const created = await actions.createProjectAction({ error: null }, form({ name: "X", facility: "warehouse", source: "demo" }));
    expect(created.error).toMatch(/Войдите/);
    const saved = await actions.saveProjectAction("нет", { params: {}, scenarios: SPECS, changes: [] });
    expect(saved).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(await actions.copyProjectAction("нет")).toMatchObject({ reason: "unauthenticated" });
    expect(await actions.deleteProjectAction("нет")).toMatchObject({ reason: "unauthenticated" });
  });

  it("создание: неверный ввод отклоняется с объяснением", async () => {
    asUser(userA);
    const bad = (fields: Record<string, string>) => actions.createProjectAction({ error: null }, form(fields));
    expect((await bad({ name: " ", facility: "warehouse", source: "demo" })).error).toMatch(/название проекта/);
    expect((await bad({ name: "X", facility: "port", source: "demo" })).error).toMatch(/тип объекта/);
    expect((await bad({ name: "X", facility: "warehouse", source: "fax" })).error).toMatch(/источник/);
    expect((await bad({ name: "X", facility: "warehouse", source: "upload", paramsJson: "{" })).error).toMatch(/прочитать/);
    const withIssues = await bad({
      name: "X",
      facility: "warehouse",
      source: "upload",
      paramsJson: JSON.stringify({ forkliftSalaryRubMonth: "много" }),
    });
    expect(withIssues.error).toMatch(/не прошёл проверку/);
    expect(withIssues.issues?.some((i) => i.key === "forkliftSalaryRubMonth" && i.severity === "error")).toBe(true);
  });

  it("создание на демо-данных: проект со сценариями по умолчанию и результатами", async () => {
    asUser(userA);
    const url = await redirected(() =>
      actions.createProjectAction({ error: null }, form({ name: "TZT22 Склад", facility: "warehouse", source: "demo" })),
    );
    expect(url).toMatch(/^\/projects\/[^/]+$/);
    projectId = new URL(url, "http://localhost").pathname.split("/").pop() ?? "";
    expect(mockRevalidate).toHaveBeenCalledWith("/projects");

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
    const saved = await actions.saveProjectAction(projectId, {
      name: "TZT22 Склад — вариант",
      params,
      scenarios: SPECS,
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
    expect(mockRevalidate).toHaveBeenCalledWith("/projects/[projectId]", "page");

    const p = await getProject(prisma, projectId, userA);
    const results = p?.results;
    if (!p || !results) throw new Error("проект не сохранён");
    expect(p.name).toBe("TZT22 Склад — вариант");
    expect(results.calculatedAt).toBe(saved.calculatedAt);
    expect(results.dataVersion).toBe(saved.dataVersion);
    expect(p.dataVersion).toBe(saved.dataVersion);
    expect(results.scenarios).toEqual(SPECS);
    expect(p.scenarios).toEqual(SPECS);
    expect(results.paramsUsed.forkliftSalaryRubMonth).toBe(130_000);
    expect(p.params.forkliftSalaryRubMonth).toBe(130_000);
    expect(Object.keys(results.productSnapshots).sort()).toEqual([C, H].sort());

    const p1 = results.results.find((r) => r.key === "p1");
    const item = p1?.items[0];
    expect(item?.n).toBe(12);
    expect(item?.nOverridden).toBe(true);
    expect(typeof item?.nAuto).toBe("number");

    const rows = await prisma.changeLog.findMany({ where: { projectId }, orderBy: { field: "asc" } });
    expect(rows).toHaveLength(3);
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

    const changes = await getProjectChanges(prisma, projectId, userA);
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
    expect(await actions.saveProjectAction(projectId, input)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await actions.recalcProjectAction(projectId)).toMatchObject({ ok: false, reason: "not_found" });
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
    const two = await actions.saveProjectAction(projectId, { params, scenarios: SPECS.slice(0, 2), changes: [] });
    expect(two).toMatchObject({ ok: false, reason: "invalid" });
    if (!two.ok) expect(two.message).toMatch(/от 3 до 10 сценариев/);
    const injected = SPECS.map((s) => ({ ...s, results: { npvRub: 1e12 } })) as unknown as ScenarioSpec[];
    expect(await actions.saveProjectAction(projectId, { params, scenarios: injected, changes: [] })).toMatchObject({
      reason: "invalid",
    });
    const badParam = await actions.saveProjectAction(projectId, {
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

    const r = await actions.recalcProjectAction(projectId);
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
    const saved = await actions.saveProjectAction(demoId, { params: src.results.paramsUsed, scenarios: SPECS, changes: [] });
    expect(saved).toMatchObject({ ok: false, reason: "invalid" });
    if (!saved.ok) expect(saved.message).toMatch(/Демо-проект.*Скопируйте проект/);
    expect(await actions.recalcProjectAction(demoId)).toMatchObject({ ok: false, reason: "invalid" });
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
    const params = Object.fromEntries(live.paramDefs.filter(d => d.facility === "warehouse").map(d => [d.key, d.base]));
    const { id } = await insertProject(prisma, live, { userId: userA, name: "TZT22 spatial roundtrip", objectName: null, facility: "warehouse", params, paramsSource: { kind: "demo" }, scenarios: SPECS });
    const initial = await getProject(prisma, id, userA);
    if (!initial?.results) throw new Error("No initial calculation");
    const input = expectedSpatialInputFromStored(initial.results, "p1");
    if (!input) throw new Error("No warehouse input");
    const specs = structuredClone(SPECS), spec = specs.find(s => s.key === "p1")!;
    spec.cashRealizationShare = 0;
    spec.operationsStaffing = { mode: "integrator", billing: "separate", annualFeeRub: 900_000, reason: "Оценка дополнительных расходов на всю площадку" };
    spec.items[0]!.costPackage = { softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 0, reason: "Условный пакет покупки для проверки сохранения" };
    spec.items[0]!.chargersOverride = input.layout.chargers;
    spec.items[0]!.automationCoverageOverride = 0.5;
    spec.spatialEvidence = { input, sourceInputKey: simInputIdentity(input), executionInputKey: "test-prepared-input", simModelVersion: SPATIAL_MODEL_VERSION,
      assessment: { status: "PARTIAL", headline: "Выполнена часть нагрузки", terminal: true },
      summary: { fleet: input.robots.count, requiredPerH: input.demand.peakPerH, achievedPerH: input.demand.peakPerH / 2, queueEnd: 20, waitP95Min: 5 } };
    const saved = await actions.saveProjectAction(id, { params, scenarios: specs, changes: [
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
    const receipt = await actions.saveProjectAction(id, { params, scenarios: specs, changes: [] });
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
    const outcomes = await Promise.all(requests.map(request => serverActions.saveProjectAction(id, request)));
    expect(outcomes.filter(r => r.ok)).toHaveLength(1);
    expect(outcomes.filter(r => !r.ok && r.reason === "conflict")).toHaveLength(1);
    const winner = outcomes.findIndex(r => r.ok), saved = await getProject(prisma, id, userA);
    expect(saved?.revision).toBe(project.revision + 1);
    expect(saved?.name).toBe(requests[winner]!.name);
    expect(saved?.params.forkliftSalaryRubMonth).toBe(requests[winner]!.params.forkliftSalaryRubMonth);
    expect(saved?.scenarios).toEqual(requests[winner]!.scenarios);
    expect(saved?.results?.paramsUsed.forkliftSalaryRubMonth).toBe(requests[winner]!.params.forkliftSalaryRubMonth);
    const log = await prisma.changeLog.findMany({ where: { projectId: id } });
    expect(log).toHaveLength(1); expect(log[0]!.reason).toBe(`tab-${winner}`);
    expect(await serverActions.recalcProjectAction(id, project.revision)).toMatchObject({ reason: "conflict" });
    expect(await serverActions.deleteProjectAction(id, project.revision)).toMatchObject({ reason: "conflict" });
    expect((await getProject(prisma, id, userA))?.revision).toBe(project.revision + 1);
  }, 120_000);

  it("legacy writes without a precondition fail explicitly, including rename, recalc and delete", async () => {
    const { id, params, project } = await example("TZT22 missing revision");
    expect(await serverActions.saveProjectAction(id, { name: "Must not rename", params, scenarios: SPECS, changes: [] })).toMatchObject({ reason: "precondition_required" });
    expect(await serverActions.recalcProjectAction(id)).toMatchObject({ reason: "precondition_required" });
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
