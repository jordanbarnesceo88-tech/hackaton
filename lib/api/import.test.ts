import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "../data/organizer/catalog";
import type { ProductSeed } from "../tz/types";
import { apiProductDataVersion, IMPORT_MAX_PRODUCTS, importProducts, isIsoDate, validateProductSeeds } from "./import";
import { exampleImportSeed } from "./openapi";

// Импорт каталога через API: строгая проверка входа (всё-или-ничего, провенанс по правилам
// Sourced) и запись по правилам синхронизации с origin ADMIN. Запись проверяется на
// подменённом клиенте БД — набор unit не ходит в Postgres.

/** Продукт организатора в форме входа API: без полей, которые задаёт только синхронизация. */
function asApiSeed(seed: ProductSeed, slug = `api-${seed.slug}`): ProductSeed {
  return { ...structuredClone(seed), slug, organizerCatalogId: null, organizerRows: [] };
}

/** Проверка одного продукта: ошибки или []. */
function errorsOf(raw: unknown): string[] {
  const res = validateProductSeeds([raw]);
  return res.ok ? [] : res.issues.flatMap((i) => i.errors);
}

const base = exampleImportSeed();

describe("validateProductSeeds", () => {
  it("принимает каждый продукт данных организатора (та же форма и те же правила провенанса)", () => {
    const res = validateProductSeeds(CATALOG.slice(0, IMPORT_MAX_PRODUCTS).map((s) => asApiSeed(s)));
    expect(res.ok ? [] : res.issues.slice(0, 5)).toEqual([]);
  });

  it("собирает продукт заново без изменений значений (кроме полей синхронизации)", () => {
    const src = CATALOG.find((p) => p.slug === "ronavi-h1500");
    expect(src).toBeDefined();
    const seed = asApiSeed(src as ProductSeed);
    const res = validateProductSeeds([seed]);
    expect(res.ok && res.seeds[0]).toEqual(seed);
  });

  it("тело — непустой список не длиннее предела", () => {
    expect(validateProductSeeds({}).ok).toBe(false);
    expect(validateProductSeeds([]).ok).toBe(false);
    const many = Array.from({ length: IMPORT_MAX_PRODUCTS + 1 }, (_, i) => ({ ...base, slug: `p-${i}` }));
    const res = validateProductSeeds(many);
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/разбейте/);
  });

  it("всё-или-ничего: одна плохая позиция — ни одного продукта, ошибка с номером позиции", () => {
    const res = validateProductSeeds([base, { ...base, slug: "Bad Slug" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toHaveLength(1);
      expect(res.issues[0]?.index).toBe(1);
      expect(res.issues[0]?.errors.join(" ")).toMatch(/Продукт 2: slug/);
    }
  });

  it("повтор slug, зарезервированный slug, неизвестные поля и поля синхронизации — ошибки", () => {
    const dup = validateProductSeeds([base, { ...base }]);
    expect(dup.ok ? [] : dup.issues.flatMap((i) => i.errors)).toEqual([expect.stringMatching(/уже был в позиции 1/)]);
    expect(errorsOf({ ...base, slug: "import" }).join(" ")).toMatch(/занят адресом API/);
    expect(errorsOf({ ...base, price: 1 }).join(" ")).toMatch(/неизвестные поля price/);
    expect(errorsOf({ ...base, organizerCatalogId: "x" }).join(" ")).toMatch(/organizerCatalogId/);
    expect(errorsOf({ ...base, organizerRows: [1] }).join(" ")).toMatch(/organizerRows/);
  });

  it("справочники: тип решения, статус, уровень, процесс и его тип объекта", () => {
    expect(errorsOf({ ...base, solutionType: "teleporter" }).join(" ")).toMatch(/solutionType/);
    expect(errorsOf({ ...base, status: "prod" }).join(" ")).toMatch(/status/);
    expect(errorsOf({ ...base, level: "full" }).join(" ")).toMatch(/level/);
    expect(errorsOf({ ...base, processes: ["no-such-process"] }).join(" ")).toMatch(/неизвестен/);
    expect(errorsOf({ ...base, facilityTypes: ["airport"] }).join(" ")).toMatch(/добавьте этот тип в facilityTypes/);
    expect(errorsOf({ ...base, facilityTypes: ["factory"] }).join(" ")).toMatch(/warehouse, airport, medical/);
    expect(errorsOf({ ...base, flags: ["shiny"] }).join(" ")).toMatch(/пометка «shiny»/);
    expect(errorsOf({ ...base, description: "х".repeat(201) }).join(" ")).toMatch(/не длиннее 200/);
  });

  const withChar = (key: string, value: unknown) => ({ ...base, characteristics: { ...base.characteristics, [key]: value } });
  const research = {
    value: 1.5,
    unit: "м/с",
    origin: "research",
    sourceType: "manufacturer",
    sourceUrl: "https://example.org/spec",
    date: "2026-09-23",
    confirmed: true,
    asInSource: "Скорость до 1,5 м/с",
  };

  it("правила провенанса Sourced (ТЗ §3.3.4)", () => {
    expect(errorsOf(withChar("speedMps", research))).toEqual([]);
    expect(errorsOf(withChar("speedMps", { ...research, sourceUrl: null })).join(" ")).toMatch(/нужна ссылка sourceUrl/);
    expect(errorsOf(withChar("speedMps", { ...research, sourceUrl: "ftp://x" })).join(" ")).toMatch(/http\(s\)/);
    expect(errorsOf(withChar("speedMps", { ...research, asInSource: undefined })).join(" ")).toMatch(/asInSource/);
    expect(errorsOf(withChar("speedMps", { ...research, sourceType: "calc" })).join(" ")).toMatch(/sourceType/);
    expect(errorsOf(withChar("speedMps", { ...research, date: "2026-02-30" })).join(" ")).toMatch(/ГГГГ-ММ-ДД/);
    expect(errorsOf(withChar("speedMps", { ...research, origin: "admin" })).join(" ")).toMatch(/origin/);
    const estimate = { value: 1, origin: "estimate", sourceType: "team-estimate", sourceUrl: null, date: "2026-09-23", confirmed: false };
    expect(errorsOf(withChar("speedMps", estimate)).join(" ")).toMatch(/обоснование basis/);
    expect(errorsOf(withChar("speedMps", { ...estimate, basis: "Аналог", confirmed: true })).join(" ")).toMatch(/confirmed: false/);
    const derived = { ...estimate, origin: "derived", sourceType: "calc", basis: "Из паспорта" };
    expect(errorsOf(withChar("speedMps", derived)).join(" ")).toMatch(/формула formula/);
    const organizer = { value: 1, origin: "organizer", sourceType: "organizer:catalog", sourceUrl: null, date: "2026-09-22", confirmed: false };
    expect(errorsOf(withChar("speedMps", organizer)).join(" ")).toMatch(/sourceRef/);
  });

  it("значение: конечное число, диапазон min ≤ typical ≤ max, непустой текст или список; ключ из словаря", () => {
    const ok = { ...research, value: { min: 1, max: 2, typical: 1.5, qualifier: "до" } };
    expect(errorsOf(withChar("speedMps", ok))).toEqual([]);
    expect(errorsOf(withChar("speedMps", { ...ok, value: { min: 2, max: 1, typical: 1.5 } })).join(" ")).toMatch(/min ≤ typical ≤ max/);
    expect(errorsOf(withChar("speedMps", { ...ok, value: { typical: 1, extra: 2 } })).join(" ")).toMatch(/неизвестные поля extra/);
    expect(errorsOf(withChar("speedMps", { ...ok, value: { typical: 1, qualifier: "около" } })).join(" ")).toMatch(/qualifier/);
    expect(errorsOf(withChar("speedMps", { ...ok, value: "" })).join(" ")).toMatch(/пустой текст/);
    expect(errorsOf(withChar("speedMps", { ...ok, value: [] })).join(" ")).toMatch(/пустой список/);
    expect(errorsOf(withChar("speedMps", { ...ok, value: null })).join(" ")).toMatch(/значение/);
    expect(errorsOf(withChar("warpFactor", ok)).join(" ")).toMatch(/словарь характеристик/);
    expect(errorsOf(withChar("speedMps", { ...ok, alternatives: [{ ...research, alternatives: [] }] })).join(" ")).toMatch(
      /неизвестные поля alternatives/,
    );
  });

  it("дата проверки — существующая дата календаря", () => {
    expect(isIsoDate("2026-09-23")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("23.09.2026")).toBe(false);
  });
});

// ——————————————————————————— Запись на подменённом клиенте ———————————————————————————

type Row = Record<string, unknown>;

/** Клиент БД без транзакций: хранит один продукт и записывает вызовы. */
function fakeDb(opts: { existing?: Row | null; origins?: Record<string, "ORGANIZER" | "ADMIN">; processes?: string[] } = {}) {
  const calls: { op: string; args: unknown }[] = [];
  const log = (op: string) =>
    vi.fn(async (args: unknown) => {
      calls.push({ op, args });
      return { id: "new-id" };
    });
  const db = {
    solutionType: { findMany: vi.fn(async () => [{ id: "st-pallet-amr", slug: "pallet-amr" }]) },
    process: {
      findMany: vi.fn(async () => (opts.processes ?? ["pallet-transport"]).map((slug) => ({ id: `pr-${slug}`, slug }))),
    },
    catalogProduct: {
      findMany: vi.fn(async () => Object.entries(opts.origins ?? {}).map(([slug, origin]) => ({ slug, origin }))),
      findUnique: vi.fn(async () => opts.existing ?? null),
      create: log("product.create"),
      update: log("product.update"),
    },
    productCharacteristic: { update: log("char.update"), createMany: log("char.createMany"), deleteMany: log("char.deleteMany") },
    productProcess: { createMany: log("process.createMany"), deleteMany: log("process.deleteMany") },
  };
  return { db, calls };
}

type CreateArgs = {
  data: Row & {
    processes: { create: { processId: string }[] };
    characteristics: { create: Row[] };
  };
};

/** Строка продукта «в БД» из данных create — как её вернул бы findUnique с include. */
function rowFromCreate(args: CreateArgs): Row {
  const { processes, characteristics, ...fields } = args.data;
  return {
    ...fields,
    id: "p1",
    processes: processes.create.map((p) => ({ processId: p.processId })),
    characteristics: characteristics.create.map((c, i) => ({
      id: `c${i}`,
      productId: "p1",
      ...c,
      alternatives: c.alternatives && typeof c.alternatives === "object" && Array.isArray(c.alternatives) ? c.alternatives : null,
    })),
  };
}

describe("importProducts", () => {
  it("пробный прогон: ничего не пишет, отказывает slug организатора и незасеянным справочникам", async () => {
    const organizer = asApiSeed(base, "ronavi-h1500");
    const noProcess = { ...base, slug: "api-no-process", processes: ["pallet-transport", "tugging"] } as ProductSeed;
    const { db, calls } = fakeDb({ processes: ["pallet-transport"] });
    const report = await importProducts(db as never, [base, organizer, noProcess], { dryRun: true });
    expect(calls).toEqual([]);
    expect(report).toMatchObject({ dryRun: true, total: 3, valid: 1, refused: 2, created: 0 });
    expect(report.items.map((i) => [i.slug, i.status, i.action ?? null])).toEqual([
      [base.slug, "valid", "create"],
      ["ronavi-h1500", "refused", null],
      ["api-no-process", "refused", null],
    ]);
    expect(report.items[1]?.message).toMatch(/данных организатора/);
    expect(report.items[2]?.message).toMatch(/db:seed/);
  });

  it("создаёт продукт с origin ADMIN, характеристиками, процессами и вынесенными колонками", async () => {
    const { db, calls } = fakeDb();
    const report = await importProducts(db as never, [base]);
    expect(report).toMatchObject({ created: 1, updated: 0, failed: 0 });
    const create = calls.find((c) => c.op === "product.create")?.args as CreateArgs;
    expect(create.data).toMatchObject({
      slug: base.slug,
      origin: "ADMIN",
      organizerCatalogId: null,
      organizerRows: [],
      archived: false,
      editedByAdmin: false,
      solutionTypeId: "st-pallet-amr",
      dataVersion: apiProductDataVersion(base),
      level: "identification",
    });
    expect(create.data.processes.create).toEqual([{ processId: "pr-pallet-transport" }]);
    expect(create.data.characteristics.create.map((c) => c.key).sort()).toEqual(Object.keys(base.characteristics).sort());
    // Цена в колонке — из характеристики, как при синхронизации.
    expect(create.data.priceRub).toBeTypeOf("number");
  });

  it("повторный импорт той же карточки ничего не пишет; правка администратора сохраняется", async () => {
    const first = fakeDb();
    await importProducts(first.db as never, [base]);
    const row = rowFromCreate(first.calls.find((c) => c.op === "product.create")?.args as CreateArgs);
    row.origin = "ADMIN";

    const again = fakeDb({ existing: row, origins: { [base.slug]: "ADMIN" } });
    const report = await importProducts(again.db as never, [base]);
    expect(report.items[0]).toMatchObject({ status: "unchanged", action: "update" });
    expect(again.calls).toEqual([]);

    // Характеристика, правленная в админке, остаётся; пропавшая из входа — удаляется.
    const edited = structuredClone(row) as Row & { characteristics: Row[] };
    const manufacturer = edited.characteristics.find((c) => c.key === "manufacturer");
    if (manufacturer) manufacturer.origin = "admin";
    const shorter = { ...base, characteristics: { ...base.characteristics } };
    delete shorter.characteristics.countryOfOrigin;
    const third = fakeDb({ existing: edited, origins: { [base.slug]: "ADMIN" } });
    const r3 = await importProducts(third.db as never, [shorter]);
    expect(r3.items[0]).toMatchObject({ status: "updated", adminCharacteristicsKept: 1 });
    const deleted = third.calls.find((c) => c.op === "char.deleteMany")?.args as { where: { id: { in: string[] } } };
    const country = edited.characteristics.find((c) => c.key === "countryOfOrigin");
    expect(deleted.where.id.in).toEqual([country?.id]);
    expect(third.calls.some((c) => c.op === "char.update")).toBe(false);
  });

  it("продукт организатора в БД под тем же slug — отказ, запись не выполняется", async () => {
    const seed = { ...base, slug: "api-collides" };
    const { db, calls } = fakeDb({ existing: { id: "p9", origin: "ORGANIZER", processes: [], characteristics: [] } });
    const report = await importProducts(db as never, [seed]);
    expect(report.items[0]).toMatchObject({ status: "refused" });
    expect(calls).toEqual([]);
  });
});
