import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { processDef } from "../tz/processes";
import { DEFAULT_NORMS, normDef } from "../tz/norms";
import type { CharValue, ProductSeed, Sourced } from "../tz/types";
import { productForCalcFromSeed, sourcedToCharRow } from "./product-for-calc";
import { promoteColumns } from "./promote";
import {
  CATALOG_PAGE_SIZE,
  getCalcProducts,
  getCatalogList,
  getCatalogProduct,
  getCatalogProducts,
  getNormRows,
  getNorms,
  getParamDefinitions,
  getProcessesFor,
  latestDataRelease,
  mergeProcessRow,
  toCharacteristicData,
} from "./queries";
import type { CatalogFilters, Db } from "./queries";

/**
 * Запросы каталога на настоящем Postgres (набор db). Тест заводит собственные строки с
 * префиксом tzt-t18- и удаляет их до и после прогона; строки синхронизации (T2.1), если они
 * уже есть в базе, не трогает — проверки ограничены своими строками.
 *
 * Общий клиент приложения (lib/db) не импортируется: запросы принимают клиент параметром, и тест
 * проверяет ровно это — работу с собственным PrismaClient и внутри транзакции.
 */

const P = "tzt-t18-";
const PROC = `${P}proc`;
const PROC_AIRPORT = `${P}proc-airport`;
/** Два процесса склада, у которых порядок по Process.order обратен порядку по slug. */
const PROC_B = `${P}proc-b`;
const PROC_C = `${P}proc-c`;
const TYPE = `${P}type`;
const RELEASE = `${P}release`;
const NORM_UNKNOWN = `${P}norm`;

let db: PrismaClient;

async function cleanup(): Promise<void> {
  await db.catalogProduct.deleteMany({ where: { slug: { startsWith: P } } });
  await db.process.deleteMany({ where: { slug: { startsWith: P } } });
  await db.solutionType.deleteMany({ where: { slug: { startsWith: P } } });
  await db.paramDefinition.deleteMany({ where: { key: { startsWith: P } } });
  await db.norm.deleteMany({ where: { key: { startsWith: P } } });
  await db.dataRelease.deleteMany({ where: { version: { startsWith: P } } });
}

/** Метка отката: транзакция с ней откатывается, и изменения не видны никому, кроме неё. */
class Rollback extends Error {}

/**
 * Выполнить `fn` в транзакции и откатить её: так тест может менять общие строки (норматив
 * utilization), не оставляя изменений в базе и не показывая их параллельным читателям.
 */
async function inRolledBackTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  let result: { value: T } | null = null;
  await expect(
    db.$transaction(async (tx) => {
      result = { value: await fn(tx) };
      throw new Rollback("откат тестовой транзакции");
    }),
  ).rejects.toBeInstanceOf(Rollback);
  if (result === null) throw new Error("транзакция не выполнила тело");
  return (result as { value: T }).value;
}

function sourced(value: CharValue, patch: Partial<Sourced<CharValue>> = {}): Sourced<CharValue> {
  return {
    value,
    origin: "research",
    sourceType: "manufacturer",
    sourceUrl: "https://example.test/spec.pdf",
    date: "2026-09-21",
    confirmed: true,
    asInSource: "как в источнике",
    ...patch,
  };
}

/**
 * Продукт в форме данных генератора (ProductSeed): его пишут в БД так же, как синхронизация
 * T2.1 (sourcedToCharRow → toCharacteristicData, колонки — promoteColumns), и снимок из БД
 * сравнивается со снимком, собранным из самих данных. Процессы перечислены в порядке,
 * обратном общему, и в БД у PROC_C номер меньше, чем у PROC_B.
 */
const SNAPSHOT_SEED: ProductSeed = {
  slug: `${P}snapshot`,
  organizerCatalogId: null,
  organizerRows: [],
  level: "enriched",
  name: "TZT18 Снимок",
  manufacturer: "ТЗТ Снимок",
  country: "Россия",
  solutionType: "other",
  status: "operation",
  processes: [PROC_C, PROC_B],
  facilityTypes: ["warehouse"],
  industries: ["Логистика"],
  description: "Продукт для сверки снимков",
  characteristics: {
    manufacturer: sourced("ТЗТ Снимок"),
    priceRub: sourced(2_700_000, {
      unit: "₽",
      origin: "organizer",
      sourceType: "organizer:catalog",
      sourceUrl: null,
      sourceRef: "каталог организатора",
      confirmed: false,
      alternatives: [
        { value: 3_100_000, unit: "₽", origin: "research", sourceType: "dealer", sourceUrl: "https://example.test/dealer", date: "2026-09-20", confirmed: false },
      ],
    }),
    throughput: sourced({ min: 80, max: 100, typical: 90 }, { unit: "паллет/ч", scope: "per-robot" }),
    raasRubMonth: sourced({ typical: 100_000, qualifier: "от" }, { unit: "₽/мес", confirmed: false }),
    payloadKg: sourced(1500, { unit: "кг" }),
    speedMps: sourced(1.5, { unit: "м/с", confirmed: false }),
    navigation: sourced(["лидар", "QR-коды"]),
    cases: sourced("Тестовый склад", { confirmed: false }),
    serviceLifeYears: sourced(8, {
      unit: "лет",
      origin: "estimate",
      sourceType: "team-estimate",
      sourceUrl: null,
      confirmed: false,
      basis: "тестовое основание",
    }),
  },
  flags: ["price-disputed"],
  excludedReason: null,
};

/** Запись продукта из данных генератора — так, как это делает синхронизация. */
async function productFromSeed(seed: ProductSeed): Promise<void> {
  const rows = Object.entries(seed.characteristics).map(([key, s]) => sourcedToCharRow(key, s));
  await db.catalogProduct.create({
    data: {
      slug: seed.slug,
      name: seed.name,
      manufacturer: seed.manufacturer,
      country: seed.country,
      level: seed.level,
      status: seed.status,
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

type CharInput = Omit<Prisma.ProductCharacteristicCreateWithoutProductInput, "origin" | "sourceType"> &
  Partial<Pick<Prisma.ProductCharacteristicCreateWithoutProductInput, "origin" | "sourceType">>;

async function product(
  slug: string,
  data: Omit<Prisma.CatalogProductCreateInput, "slug" | "processes" | "characteristics" | "status"> & {
    status?: string;
  },
  processSlugs: string[],
  chars: CharInput[] = [],
): Promise<void> {
  await db.catalogProduct.create({
    data: {
      slug: `${P}${slug}`,
      status: "operation",
      ...data,
      processes: { create: processSlugs.map((s) => ({ process: { connect: { slug: s } } })) },
      characteristics: {
        create: chars.map((c) => ({ origin: "research", sourceType: "manufacturer", ...c })),
      },
    },
  });
}

beforeAll(async () => {
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  await cleanup();

  const warehouse = await db.facilityType.findUniqueOrThrow({ where: { slug: "warehouse" } });
  const airport = await db.facilityType.findUniqueOrThrow({ where: { slug: "airport" } });

  const processData = {
    description: "Тестовый процесс T1.8",
    demandUnit: "паллет/сут",
    demandFormula: "тест",
    throughputUnit: "паллет/ч",
    calcSupported: true,
    simSupported: true,
    order: 9000,
  };
  const proc = await db.process.upsert({
    where: { slug: PROC },
    create: { slug: PROC, name: "ТЗТ-Т18: процесс склада", ...processData },
    update: {},
  });
  const procAirport = await db.process.upsert({
    where: { slug: PROC_AIRPORT },
    create: { slug: PROC_AIRPORT, name: "ТЗТ-Т18: процесс аэропорта", ...processData },
    update: {},
  });
  // Номер в БД у PROC_C меньше, чем у PROC_B, а по slug — наоборот: сортировка по
  // Process.order дала бы другой порядок, чем в снимке из данных.
  const procB = await db.process.upsert({
    where: { slug: PROC_B },
    create: { slug: PROC_B, name: "ТЗТ-Т18: процесс Б", ...processData, order: 8000 },
    update: {},
  });
  const procC = await db.process.upsert({
    where: { slug: PROC_C },
    create: { slug: PROC_C, name: "ТЗТ-Т18: процесс В", ...processData, order: 7000 },
    update: {},
  });
  await db.facilityTypeProcess.create({ data: { facilityTypeId: warehouse.id, processId: proc.id, order: 9000 } });
  await db.facilityTypeProcess.create({ data: { facilityTypeId: airport.id, processId: procAirport.id, order: 9000 } });
  await db.facilityTypeProcess.create({ data: { facilityTypeId: warehouse.id, processId: procB.id, order: 9001 } });
  await db.facilityTypeProcess.create({ data: { facilityTypeId: warehouse.id, processId: procC.id, order: 9002 } });

  await db.solutionType.create({
    data: { slug: TYPE, name: "ТЗТ-Т18: вилочный", purpose: "тест", handlingClass: "fork", mobile: false },
  });

  // Альфа: обогащённый, подтверждённый, с RaaS; характеристики во всех группах, кроме
  // «Инфраструктуры», и с расхождением источников по цене.
  await product(
    "alpha",
    {
      name: "TZT18 Альфа",
      manufacturer: "ТЗТ Роботикс",
      level: "enriched",
      solutionType: { connect: { slug: TYPE } },
      facilityTypeSlugs: ["warehouse"],
      industries: ["Логистика"],
      description: "Тестовый вилочный робот, ёмкость 1 т",
      priceRub: 2_000_000,
      raasRubMonth: 90_000,
      throughputPerH: 50,
      throughputUnit: "паллет/ч",
      payloadKg: 1200,
      completenessPct: 70,
      confirmedSharePct: 50,
      needsVerification: false,
      flags: ["duplicate-merged", "not-a-flag"],
    },
    [PROC],
    [
      {
        key: "priceRub",
        group: "ECONOMICS",
        valueNum: 2_000_000,
        unit: "₽",
        confirmed: true,
        verifiedAt: new Date("2026-09-23T00:00:00Z"),
        alternatives: [{ value: 2_600_000, unit: "₽", origin: "research", sourceType: "dealer", date: "2026-09-20" }],
      },
      { key: "raasRubMonth", group: "ECONOMICS", valueNum: 90_000, qualifier: "от", unit: "₽/мес" },
      {
        key: "throughput",
        group: "TECHNICAL",
        valueNum: 50,
        valueMin: 40,
        valueMax: 60,
        unit: "паллет/ч",
        scope: "per-robot",
        confirmed: true,
        asInSource: "40–60 паллет/ч",
      },
      { key: "navigation", group: "TECHNICAL", valueList: ["лидар"] },
      { key: "payloadKg", group: "TECHNICAL", valueNum: 1200, unit: "кг", confirmed: true },
      { key: "manufacturer", group: "IDENTIFICATION", valueText: "ТЗТ Роботикс", confirmed: true },
      { key: "cases", group: "APPLICABILITY", valueText: "Тестовый склад" },
      { key: "primarySourceUrl", group: "DATA_QUALITY", valueText: "https://example.test" },
    ],
  );
  // Бета: примеры организатора, пилот, без цены, производительность «до 100» — в расчёт не идёт.
  // Требует проверки, но часть данных подтверждена первоисточником.
  await product(
    "beta",
    {
      name: "TZT18 Бета",
      level: "examples",
      status: "piloting",
      facilityTypeSlugs: ["warehouse"],
      completenessPct: 30,
      confirmedSharePct: 20,
      needsVerification: true,
    },
    [PROC],
    [
      {
        key: "throughput",
        group: "TECHNICAL",
        valueNum: 100,
        valueMax: 100,
        qualifier: "до",
        unit: "паллет/ч",
        origin: "organizer",
        sourceType: "organizer:examples",
        sourceRef: "Примеры решений",
      },
    ],
  );
  // Гамма: только идентификация — в каталоге есть, в расчёт не идёт.
  await product(
    "gamma",
    { name: "TZT18 Гамма", level: "identification", facilityTypeSlugs: ["warehouse"], priceRub: 5_000_000, completenessPct: 10 },
    [PROC],
  );
  // НИОКР: исключённый — в расчёт передаётся с причиной (подбор покажет, почему исключён).
  await product(
    "rnd",
    {
      name: "TZT18 НИОКР",
      level: "enriched",
      status: "rnd",
      facilityTypeSlugs: ["warehouse"],
      excluded: true,
      excludedReason: "Статус НИОКР",
      completenessPct: 20,
    },
    [PROC],
  );
  // Архивный: нет ни в списке, ни в расчёте, но карточка открывается.
  await product(
    "archived",
    { name: "TZT18 Архив", level: "enriched", archived: true, facilityTypeSlugs: ["warehouse"], completenessPct: 90 },
    [PROC],
  );
  // Аэропорт: связан только с процессом аэропорта — не попадает в расчёт склада.
  await product(
    "airport",
    { name: "TZT18 Аэро", level: "enriched", facilityTypeSlugs: ["airport", "tzt-t18-nowhere"], completenessPct: 40 },
    [PROC_AIRPORT],
  );
  // Снимок: записан из данных генератора так же, как это делает синхронизация.
  await productFromSeed(SNAPSHOT_SEED);

  await db.paramDefinition.createMany({
    data: [
      {
        facilityTypeId: warehouse.id,
        key: `${P}param-b`,
        section: "Тест",
        label: "Параметр Б",
        unit: "шт.",
        kind: "integer",
        baseNum: 4,
        min: 1,
        max: 10,
        required: true,
        usedBy: ["fleet"],
        origin: "estimate",
        basis: "тестовое основание",
        order: 100_001,
      },
      {
        facilityTypeId: warehouse.id,
        key: `${P}param-a`,
        section: "Тест",
        label: "Параметр А",
        kind: "enum",
        options: ["Да", "Нет"],
        baseText: "Да",
        origin: "organizer",
        sourceRef: "Датасеты › тест",
        order: 100_000,
      },
      {
        facilityTypeId: warehouse.id,
        key: `${P}param-c`,
        section: "Тест",
        label: "Параметр В",
        kind: "slider",
        origin: "nonsense",
        order: 100_002,
      },
    ],
  });

  await db.norm.create({
    data: { key: NORM_UNKNOWN, label: "Устаревший норматив", value: 42, origin: "estimate", basis: "тест" },
  });

  await db.dataRelease.create({
    data: { version: RELEASE, seededAt: new Date(Date.now() + 60_000), organizerVersion: { test: true }, note: "T1.8" },
  });
});

afterAll(async () => {
  if (!db) return;
  await cleanup();
  await db.$disconnect();
});

/** Slug'и из выдачи без префикса — только свои строки. */
const own = (slugs: string[]) => slugs.filter((s) => s.startsWith(P)).map((s) => s.slice(P.length));

describe("getCatalogList", () => {
  const list = (filters: CatalogFilters) => getCatalogList(db, { process: PROC, ...filters });

  it("по умолчанию — по названию, без архивных", async () => {
    const res = await list({});
    expect(own(res.items.map((i) => i.slug))).toEqual(["alpha", "beta", "gamma", "rnd"]);
    expect(res.total).toBe(4);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(CATALOG_PAGE_SIZE);
    expect(res.pageCount).toBe(1);
  });

  it("строка несёт вынесенные колонки, тип решения и процессы", async () => {
    const alpha = (await list({})).items.find((i) => i.slug === `${P}alpha`)!;
    expect(alpha).toMatchObject({
      name: "TZT18 Альфа",
      manufacturer: "ТЗТ Роботикс",
      level: "enriched",
      status: "operation",
      origin: "ORGANIZER",
      solutionType: { slug: TYPE, name: "ТЗТ-Т18: вилочный" },
      processes: [{ slug: PROC, name: "ТЗТ-Т18: процесс склада" }],
      facilityTypes: ["warehouse"],
      priceRub: 2_000_000,
      raasRubMonth: 90_000,
      throughputPerH: 50,
      throughputUnit: "паллет/ч",
      payloadKg: 1200,
      completenessPct: 70,
      needsVerification: false,
      // Неизвестная пометка отброшена.
      flags: ["duplicate-merged"],
    });
  });

  it("сортировка по цене и производительности: без значения — в конце", async () => {
    expect(own((await list({ sort: "price" })).items.map((i) => i.slug))).toEqual(["alpha", "gamma", "beta", "rnd"]);
    expect(own((await list({ sort: "throughput" })).items.map((i) => i.slug))).toEqual(["alpha", "beta", "gamma", "rnd"]);
    expect(own((await list({ sort: "completeness" })).items.map((i) => i.slug))).toEqual(["alpha", "beta", "rnd", "gamma"]);
    expect(own((await list({ sort: "name" })).items.map((i) => i.slug))).toEqual(["alpha", "beta", "gamma", "rnd"]);
  });

  it("поиск без учёта регистра — и для кириллицы в базе с локалью C", async () => {
    expect(own((await list({ q: "альфа" })).items.map((i) => i.slug))).toEqual(["alpha"]);
    expect(own((await list({ q: "БЕТА" })).items.map((i) => i.slug))).toEqual(["beta"]);
    expect(own((await list({ q: "тзт роботикс" })).items.map((i) => i.slug))).toEqual(["alpha"]);
    expect(own((await list({ q: "tzt18" })).items.map((i) => i.slug))).toHaveLength(4);
    // Слова ищутся в любом поле и порядке; «ё» и «е» не различаются.
    expect(own((await list({ q: "роботикс  альфа" })).items.map((i) => i.slug))).toEqual(["alpha"]);
    expect(own((await list({ q: "Емкость" })).items.map((i) => i.slug))).toEqual(["alpha"]);
    expect((await list({ q: "альфа бета" })).total).toBe(0);
    expect(own((await getCatalogList(db, { q: "вилочный робот" })).items.map((i) => i.slug))).toEqual(["alpha"]);
    expect((await list({ q: "   " })).total).toBe(4);
  });

  it("фильтры: тип объекта, тип решения, статус, глубина, подтверждённые, RaaS", async () => {
    expect(own((await getCatalogList(db, { q: "TZT18", facility: "airport" })).items.map((i) => i.slug))).toEqual([
      "airport",
    ]);
    expect(own((await list({ solutionType: TYPE })).items.map((i) => i.slug))).toEqual(["alpha"]);
    expect(own((await list({ status: "piloting" })).items.map((i) => i.slug))).toEqual(["beta"]);
    expect(own((await list({ level: "identification" })).items.map((i) => i.slug))).toEqual(["gamma"]);
    // «Только подтверждённые данные» — есть подтверждённые характеристики (доля > 0), а не
    // «проверка не нужна»: бета требует проверки, но в выдаче остаётся.
    expect(own((await list({ confirmedOnly: true })).items.map((i) => i.slug))).toEqual(["alpha", "beta"]);
    expect(own((await list({ raas: true })).items.map((i) => i.slug))).toEqual(["alpha"]);
    // Неизвестные значения из URL не фильтруют (а не обнуляют список).
    expect((await list({ status: "retired", level: "full" })).total).toBe(4);
  });

  it("страницы: вторая пустая, мусорный номер — первая", async () => {
    const second = await list({ page: 2 });
    expect(second.items).toEqual([]);
    expect(second.total).toBe(4);
    expect(second.page).toBe(2);
    expect((await list({ page: Number.NaN })).page).toBe(1);
    expect((await list({ page: -3 })).page).toBe(1);
    expect((await list({ page: 1.7 })).page).toBe(1);
  });
});

describe("getCatalogProduct / getCatalogProducts", () => {
  it("характеристики разложены по шести группам ТЗ в порядке словаря", async () => {
    const p = (await getCatalogProduct(db, `${P}alpha`))!;
    expect(Object.keys(p.characteristics)).toEqual([
      "IDENTIFICATION",
      "TECHNICAL",
      "INFRASTRUCTURE",
      "ECONOMICS",
      "APPLICABILITY",
      "DATA_QUALITY",
    ]);
    expect(p.characteristics.IDENTIFICATION.map((c) => c.key)).toEqual(["manufacturer"]);
    expect(p.characteristics.TECHNICAL.map((c) => c.key)).toEqual(["payloadKg", "throughput", "navigation"]);
    expect(p.characteristics.INFRASTRUCTURE).toEqual([]);
    expect(p.characteristics.ECONOMICS.map((c) => c.key)).toEqual(["priceRub", "raasRubMonth"]);
    expect(p.characteristics.APPLICABILITY.map((c) => c.key)).toEqual(["cases"]);
    expect(p.characteristics.DATA_QUALITY.map((c) => c.key)).toEqual(["primarySourceUrl"]);
  });

  it("у характеристики — подпись, значение строкой, провенанс и расхождения", async () => {
    const p = (await getCatalogProduct(db, `${P}alpha`))!;
    const price = p.characteristics.ECONOMICS.find((c) => c.key === "priceRub")!;
    expect(price.label).toBe("Цена оборудования");
    expect(price.display.replace(/\s/g, " ")).toBe("2 000 000 ₽");
    expect(price.verifiedAt).toBe("2026-09-23");
    expect(price.confirmed).toBe(true);
    expect(price.origin).toBe("research");
    expect(price.hasConflict).toBe(true);
    expect(price.alternatives).toHaveLength(1);
    expect(price.alternatives[0]!.value.replace(/\s/g, " ")).toBe("2 600 000 ₽");
    expect(price.alternatives[0]!.sourceType).toBe("dealer");
    expect(price.alternatives[0]!.date).toBe("2026-09-20");

    const thr = p.characteristics.TECHNICAL.find((c) => c.key === "throughput")!;
    expect(thr.display).toBe("40–60 паллет/ч (на робота)");
    expect(thr.asInSource).toBe("40–60 паллет/ч");
    expect(thr.hasConflict).toBe(false);
  });

  it("звенья иерархии: отрасль, тип объекта, процесс, тип решения", async () => {
    const p = (await getCatalogProduct(db, `${P}alpha`))!;
    expect(p.solutionType).toMatchObject({ slug: TYPE, handlingClass: "fork", mobile: false });
    expect(p.processes).toEqual([{ slug: PROC, name: "ТЗТ-Т18: процесс склада", order: 9000 }]);
    expect(p.facilityTypes).toHaveLength(1);
    expect(p.facilityTypes[0]!.slug).toBe("warehouse");
    expect(p.facilityTypes[0]!.industry).not.toBeNull();
    expect(p.industries).toEqual(["Логистика"]);
  });

  it("тип объекта, которого нет в БД, показывается slug'ом и без отрасли", async () => {
    const p = (await getCatalogProduct(db, `${P}airport`))!;
    expect(p.facilityTypes.map((f) => f.slug)).toEqual(["airport", "tzt-t18-nowhere"]);
    expect(p.facilityTypes[1]).toEqual({ slug: "tzt-t18-nowhere", name: "tzt-t18-nowhere", industry: null });
  });

  it("архивный продукт открывается с признаком архива; несуществующий — null", async () => {
    expect((await getCatalogProduct(db, `${P}archived`))!.archived).toBe(true);
    expect(await getCatalogProduct(db, `${P}nope`)).toBeNull();
  });

  it("процессы продукта — в общем порядке (PROCESS_DEFS, затем slug), а не по Process.order", async () => {
    const p = (await getCatalogProduct(db, SNAPSHOT_SEED.slug))!;
    expect(p.processes.map((x) => x.slug)).toEqual([PROC_B, PROC_C]);
    const listed = (await getCatalogList(db, { process: PROC_B })).items.find((i) => i.slug === SNAPSHOT_SEED.slug)!;
    expect(listed.processes.map((x) => x.slug)).toEqual([PROC_B, PROC_C]);
  });

  it("несколько карточек — в порядке запроса, без повторов и пропущенных", async () => {
    const res = await getCatalogProducts(db, [`${P}gamma`, `${P}alpha`, `${P}gamma`, `${P}nope`]);
    expect(res.map((r) => r.slug)).toEqual([`${P}gamma`, `${P}alpha`]);
    expect(await getCatalogProducts(db, [])).toEqual([]);
  });
});

describe("getCalcProducts", () => {
  it("только enriched и examples, не в архиве, связанные с процессом объекта", async () => {
    const products = await getCalcProducts(db, "warehouse");
    expect(own(products.map((p) => p.slug))).toEqual(["alpha", "beta", "rnd", "snapshot"]);
  });

  it("снимок из БД совпадает со снимком из данных генератора — и по порядку процессов", async () => {
    const fromDb = (await getCalcProducts(db, "warehouse")).find((p) => p.slug === SNAPSHOT_SEED.slug)!;
    const fromSeed = productForCalcFromSeed(SNAPSHOT_SEED);
    expect(fromDb).toEqual(fromSeed);
    // Сверка не пустая: процессы переупорядочены, цена, диапазон, оговорка и даты дошли до снимка.
    expect(fromDb.processes).toEqual([PROC_B, PROC_C]);
    expect(fromDb).toMatchObject({
      priceRub: 2_700_000,
      priceConfirmed: false,
      priceOrigin: "organizer",
      throughputPerH: 90,
      throughputConfirmed: true,
      raasQualifier: "от",
      serviceLifeYears: 8,
      flags: ["price-disputed"],
      handlingClass: "other",
      mobile: true,
    });
    expect(fromDb.sources.find((s) => s.key === "throughput")!.date).toBe("2026-09-21");
  });

  it("снимок собран из характеристик и вынесенной полноты", async () => {
    const products = await getCalcProducts(db, "warehouse");
    const alpha = products.find((p) => p.slug === `${P}alpha`)!;
    expect(alpha).toMatchObject({
      solutionType: TYPE,
      handlingClass: "fork",
      mobile: false,
      status: "operation",
      level: "enriched",
      priceRub: 2_000_000,
      priceConfirmed: true,
      priceOrigin: "research",
      throughputPerH: 50,
      throughputScope: "per-robot",
      throughputConfirmed: true,
      raasRubMonth: 90_000,
      raasQualifier: "от",
      payloadKg: 1200,
      hasCases: true,
      completenessPct: 70,
      confirmedSharePct: 50,
      processes: [PROC],
      facilityTypes: ["warehouse"],
      flags: ["duplicate-merged"],
    });
    expect(alpha.sources.map((s) => s.key)).toContain("priceRub");

    const beta = products.find((p) => p.slug === `${P}beta`)!;
    expect(beta.throughputPerH).toBeNull();
    expect(beta.throughputQualifier).toBe("до");
    expect(beta.priceRub).toBeNull();
    expect(beta.status).toBe("piloting");
    // Без типа решения — «прочие» и мобильный (осторожная сторона: зарядки в CAPEX).
    expect(beta.solutionType).toBe("other");
    expect(beta.handlingClass).toBe("other");
    expect(beta.mobile).toBe(true);

    const rnd = products.find((p) => p.slug === `${P}rnd`)!;
    expect(rnd.excluded).toBe(true);
    expect(rnd.excludedReason).toBe("Статус НИОКР");
  });

  it("продукты аэропорта — только в расчёте аэропорта", async () => {
    expect(own((await getCalcProducts(db, "airport")).map((p) => p.slug))).toEqual(["airport"]);
    expect(await getCalcProducts(db, "tzt-t18-no-facility")).toEqual([]);
  });
});

describe("getParamDefinitions", () => {
  it("в порядке order, с базовым значением и сужением вида и происхождения", async () => {
    const defs = (await getParamDefinitions(db, "warehouse")).filter((d) => d.key.startsWith(P));
    expect(defs.map((d) => d.key)).toEqual([`${P}param-a`, `${P}param-b`, `${P}param-c`]);
    expect(defs[0]).toMatchObject({
      facility: "warehouse",
      label: "Параметр А",
      kind: "enum",
      options: ["Да", "Нет"],
      base: "Да",
      origin: "organizer",
      sourceRef: "Датасеты › тест",
      locked: false,
      required: false,
    });
    expect(defs[1]).toMatchObject({ kind: "integer", base: 4, min: 1, max: 10, required: true, usedBy: ["fleet"] });
    // Неизвестный вид — текст, неизвестное происхождение — оценка.
    expect(defs[2]).toMatchObject({ kind: "text", origin: "estimate", base: null });
  });

  it("работает и с транзакционным клиентом; неизвестный тип объекта — пусто", async () => {
    const inTx = await db.$transaction(async (tx) => getParamDefinitions(tx, "warehouse"));
    expect(inTx.filter((d) => d.key.startsWith(P))).toHaveLength(3);
    expect(await getParamDefinitions(db, "tzt-t18-no-facility")).toEqual([]);
  });
});

describe("нормативы", () => {
  const utilization = normDef("utilization");

  /** Задать значение норматива utilization внутри транзакции (строки может и не быть). */
  const setUtilization = (tx: Db, value: number) =>
    tx.norm.upsert({
      where: { key: "utilization" },
      create: {
        key: "utilization",
        label: utilization.label,
        value,
        min: utilization.min,
        max: utilization.max,
        origin: utilization.origin,
        basis: utilization.basis,
      },
      update: { value },
    });

  it("getNormRows: строки в порядке NORM_DEFS, устаревшие ключи — в конце", async () => {
    const rows = await inRolledBackTx(async (tx) => {
      await setUtilization(tx, utilization.value);
      return getNormRows(tx);
    });
    const keys = rows.map((r) => r.key);
    expect(keys).toContain(NORM_UNKNOWN);
    expect(keys).toContain("utilization");
    expect(keys.indexOf("utilization")).toBeLessThan(keys.indexOf(NORM_UNKNOWN));
    const unknown = rows.find((r) => r.key === NORM_UNKNOWN)!;
    expect(unknown).toMatchObject({ value: 42, label: "Устаревший норматив", origin: "estimate", basis: "тест" });
  });

  it("getNorms: значение из БД вне границ прижимается к границе — всегда, в откатываемой транзакции", async () => {
    const above = await inRolledBackTx(async (tx) => {
      await setUtilization(tx, 0.99);
      return getNorms(tx);
    });
    expect(above.utilization).toBe(utilization.max);
    const below = await inRolledBackTx(async (tx) => {
      await setUtilization(tx, 0.1);
      return getNorms(tx);
    });
    expect(below.utilization).toBe(utilization.min);
    // Значение внутри границ (правка администратора) доходит до расчёта как есть.
    const inside = await inRolledBackTx(async (tx) => {
      await setUtilization(tx, 0.8);
      return getNorms(tx);
    });
    expect(inside.utilization).toBe(0.8);
  });

  it("getNorms: неизвестные ключи игнорируются, набор ключей — как в коде", async () => {
    const norms = await getNorms(db);
    expect(NORM_UNKNOWN in norms).toBe(false);
    expect(Object.keys(norms).sort()).toEqual(Object.keys(DEFAULT_NORMS).sort());
  });

  it("откат не оставляет изменений: строка utilization в базе та же, что до теста", async () => {
    const before = await db.norm.findUnique({ where: { key: "utilization" } });
    await inRolledBackTx((tx) => setUtilization(tx, 0.99));
    const after = await db.norm.findUnique({ where: { key: "utilization" } });
    expect(after).toEqual(before);
  });
});

describe("toCharacteristicData", () => {
  const base = sourcedToCharRow("payloadKg", sourced(1500, { unit: "кг" }));

  it("дата — полночь UTC, пустые альтернативы — DbNull, список альтернатив — как есть", () => {
    const data = toCharacteristicData(base);
    expect(data.verifiedAt).toEqual(new Date("2026-09-21T00:00:00Z"));
    expect(data.alternatives).toBe(Prisma.DbNull);
    expect(data.group).toBe("TECHNICAL");
    const withAlt = toCharacteristicData(sourcedToCharRow("priceRub", SNAPSHOT_SEED.characteristics.priceRub!));
    expect(Array.isArray(withAlt.alternatives)).toBe(true);
    expect(toCharacteristicData({ ...base, verifiedAt: null }).verifiedAt).toBeNull();
  });

  it("ключ вне словаря и дата не в формате ГГГГ-ММ-ДД — ошибка, а не тихая запись", () => {
    expect(() => toCharacteristicData(sourcedToCharRow("zzzCustom", sourced("x")))).toThrow(/zzzCustom/);
    expect(() => toCharacteristicData({ ...base, verifiedAt: "2026-09" })).toThrow(/ГГГГ-ММ-ДД/);
    expect(() => toCharacteristicData({ ...base, verifiedAt: "2026-02-30" })).toThrow(/ГГГГ-ММ-ДД/);
    expect(() => toCharacteristicData({ ...base, verifiedAt: "23.09.2026" })).toThrow(/ГГГГ-ММ-ДД/);
  });
});

describe("getProcessesFor", () => {
  it("процессы объекта в порядке связей; процесс без модели в коде — без расчёта и имитации", async () => {
    const procs = await getProcessesFor(db, "warehouse");
    const mine = procs.find((p) => p.slug === PROC)!;
    expect(mine).toMatchObject({
      name: "ТЗТ-Т18: процесс склада",
      facilityTypes: ["warehouse"],
      order: 9000,
      demand: null,
      constraints: {},
      calcSupported: false,
      simSupported: false,
      solutionTypes: [],
    });
    expect(procs.map((p) => p.slug)).not.toContain(PROC_AIRPORT);
    expect(procs.map((p) => p.order)).toEqual([...procs.map((p) => p.order)].sort((a, b) => a - b));
  });

  it("если синхронизация уже засеяла pallet-transport — модель спроса берётся из кода", async () => {
    const procs = await getProcessesFor(db, "warehouse");
    const pallet = procs.find((p) => p.slug === "pallet-transport");
    if (pallet) expect(pallet.demand).toEqual(processDef("pallet-transport")!.demand);
  });
});

describe("mergeProcessRow", () => {
  const def = processDef("pallet-transport")!;
  const dbRow = {
    slug: "pallet-transport",
    name: "Название из БД",
    description: "",
    demandUnit: "что-то другое",
    demandFormula: "другая формула",
    throughputUnit: "ящик/ч",
    calcSupported: true,
    simSupported: false,
  };

  it("модель — из кода, название — из БД, признаки реализации — И кода, И БД", () => {
    const merged = mergeProcessRow(dbRow, ["warehouse"], 3);
    expect(merged.name).toBe("Название из БД");
    expect(merged.description).toBe(def.description);
    expect(merged.demandUnit).toBe(def.demandUnit);
    expect(merged.throughputUnit).toBe(def.throughputUnit);
    expect(merged.demandFormula).toBe(def.demandFormula);
    expect(merged.demand).toEqual(def.demand);
    expect(merged.constraints).toEqual(def.constraints);
    expect(merged.calcSupported).toBe(true);
    expect(merged.simSupported).toBe(false);
    expect(merged.order).toBe(3);
  });

  it("результат не делит объекты с PROCESS_DEFS", () => {
    const merged = mergeProcessRow(dbRow, ["warehouse"], 1);
    expect(merged.demand).not.toBe(def.demand);
    expect(merged.solutionTypes).not.toBe(def.solutionTypes);
    merged.solutionTypes.push("mutated");
    expect(def.solutionTypes).not.toContain("mutated");
  });
});

describe("latestDataRelease", () => {
  it("последний выпуск данных по времени синхронизации", async () => {
    const rel = await latestDataRelease(db);
    expect(rel).toMatchObject({ version: RELEASE, organizerVersion: { test: true }, note: "T1.8" });
  });
});
