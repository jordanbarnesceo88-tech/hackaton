import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { toCharacteristicData } from "../catalog/queries";
import { sourcedToCharRow } from "../catalog/product-for-calc";
import { promoteColumns } from "../catalog/promote";
import { catalogProduct } from "../data/organizer/catalog";
import { processDef, solutionTypeDef } from "../tz/processes";
import { AUTO_MANUAL_SUFFIX } from "../tz/model";
import type { ProductSeed, ProjectResults, ScenarioSpec } from "../tz/types";
import { stableJson } from "../tz/version";
import { bestPaybackYears, getProject, getProjectChanges, insertProject, listProjects } from "./queries";
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

const actions = await import("./actions");

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
    projectId = url.split("/").pop() ?? "";
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
      "Количество роботов (Перемещение паллет: приёмка → хранение → отгрузка)",
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
