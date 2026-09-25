import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CATALOG, catalogProduct } from "../data/organizer/catalog";
import { DEFAULT_NORMS, NORM_DEFS } from "../tz/norms";
import type { ProductSeed } from "../tz/types";
import { DEMO_ACCOUNTS, demoPassword, seedV2 } from "../../scripts/seed-v2";
import { productForCalcFromSeed } from "./product-for-calc";
import { getCalcProducts } from "./queries";
import type { Db } from "./queries";
import {
  STALE_SOURCE_DAYS,
  changedTotal,
  formatSyncReport,
  organizerReleaseVersion,
  syncOrganizerData,
  syncProducts,
} from "./sync";
import type { SyncReport } from "./sync";

/**
 * Синхронизация данных организатора (T2.1) на настоящем Postgres (набор db).
 *
 * Тест работает с данными, которые засеивает сама синхронизация, и меняет только:
 * - один продукт вне демо-склада (gumich-spasatel — без процессов и типов объектов) — правка
 *   администратора и откат синхронизацией в `finally`;
 * - собственные строки с префиксом tzt-t21- (удаляются до и после прогона);
 * - нормативы и параметры — только внутри транзакции, которая откатывается, чтобы
 *   параллельные расчёты не увидели изменённый норматив.
 */

const P = "tzt-t21-";
/** Продукт для проверки правок администратора: обогащённый, но не участвует в подборе. */
const ADMIN_SLUG = "gumich-spasatel";

let db: PrismaClient;
let first: SyncReport;

async function cleanup(): Promise<void> {
  await db.catalogProduct.deleteMany({ where: { slug: { startsWith: P } } });
}

/** Метка отката: транзакция с ней откатывается, и изменения не видны никому, кроме неё. */
class Rollback extends Error {}

/** Выполнить `fn` в транзакции и откатить её. */
async function inRolledBackTx(fn: (tx: Db) => Promise<void>): Promise<void> {
  let ran = false;
  await expect(
    db.$transaction(
      async (tx) => {
        await fn(tx);
        ran = true;
        throw new Rollback("откат тестовой транзакции");
      },
      { maxWait: 10_000, timeout: 60_000 },
    ),
  ).rejects.toBeInstanceOf(Rollback);
  expect(ran).toBe(true);
}

beforeAll(async () => {
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  await cleanup();
  // На пустой базе это первый сев слоя (≈ 3 с), на засеянной — проверка без записей.
  first = await syncOrganizerData(db);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await cleanup();
  await db.$disconnect();
});

describe("syncOrganizerData: идемпотентность", () => {
  it("повторный прогон ничего не создаёт и не обновляет", async () => {
    expect(first.products.failed).toBe(0);
    expect(first.characteristics.rejected).toBe(0);

    const second = await syncOrganizerData(db);
    expect(changedTotal(second)).toBe(0);
    expect(second).toMatchObject({
      solutionTypes: { created: 0, updated: 0 },
      processes: { created: 0, updated: 0 },
      links: { created: 0, updated: 0 },
      paramDefs: { created: 0, updated: 0 },
      norms: { created: 0, updated: 0 },
      products: { created: 0, updated: 0, archived: 0, failed: 0 },
      productLinks: { created: 0, deleted: 0 },
      characteristics: { upserted: 0, deleted: 0, rejected: 0 },
      releaseCreated: false,
      dataVersion: organizerReleaseVersion(),
    });
  }, 120_000);

  it("выпуск данных записан с версией и составом выгрузок", async () => {
    const release = await db.dataRelease.findUniqueOrThrow({ where: { version: organizerReleaseVersion() } });
    expect(release.organizerVersion).toMatchObject({ products: CATALOG.length, norms: NORM_DEFS.length });
    expect(release.note).toContain("Данные организатора");
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { slug: "ronavi-h1500" } });
    expect(product.dataVersion).toBe(release.version);
  });
});

describe("syncOrganizerData: данные в БД", () => {
  it("Ronavi H1500: цена 2 700 000 ₽ организатора, полнота выше 60 %", async () => {
    const h1500 = await db.catalogProduct.findUniqueOrThrow({
      where: { slug: "ronavi-h1500" },
      include: { characteristics: { where: { key: "priceRub" } }, solutionType: true },
    });
    expect(h1500).toMatchObject({
      priceRub: 2_700_000,
      level: "enriched",
      origin: "ORGANIZER",
      archived: false,
      editedByAdmin: false,
    });
    expect(h1500.completenessPct).toBeGreaterThan(60);
    expect(h1500.solutionType?.slug).toBe("pallet-amr");
    expect(h1500.characteristics[0]).toMatchObject({ origin: "organizer", confirmed: true, valueNum: 2_700_000 });
  });

  it("у склада есть процесс «перемещение паллет» с пятью и более обогащёнными продуктами", async () => {
    const link = await db.facilityTypeProcess.findFirst({
      where: { facilityType: { slug: "warehouse" }, process: { slug: "pallet-transport" } },
    });
    expect(link).not.toBeNull();
    const enriched = await db.productProcess.count({
      where: { process: { slug: "pallet-transport" }, product: { level: "enriched", archived: false } },
    });
    expect(enriched).toBeGreaterThanOrEqual(5);
  });

  it("снимок продукта из БД совпадает со снимком из данных организатора", async () => {
    for (const facility of ["warehouse", "airport", "medical"]) {
      const fromDb = (await getCalcProducts(db, facility)).filter((p) => catalogProduct(p.slug) !== undefined);
      expect(fromDb.length).toBeGreaterThan(0);
      for (const p of fromDb) {
        expect(p, p.slug).toEqual(productForCalcFromSeed(catalogProduct(p.slug)!));
      }
    }
  }, 60_000);

  it("параметры объектов и нормативы засеяны полностью", async () => {
    const warehouseParams = await db.paramDefinition.count({ where: { facilityType: { slug: "warehouse" } } });
    expect(warehouseParams).toBeGreaterThanOrEqual(42);
    const norms = await db.norm.findMany({ where: { key: { in: NORM_DEFS.map((d) => d.key) } } });
    expect(norms).toHaveLength(NORM_DEFS.length);
  });

  it("устаревшие источники считаются от переданной даты", async () => {
    const now = await syncOrganizerData(db, { only: [], now: new Date("2026-09-25T00:00:00Z") });
    expect(now.staleSources).toBe(0);
    const later = await syncOrganizerData(db, {
      only: [],
      now: new Date(Date.UTC(2026, 8, 25) + (STALE_SOURCE_DAYS + 30) * 24 * 3600 * 1000),
    });
    expect(later.staleSources).toBeGreaterThan(0);
    expect(changedTotal(later)).toBe(0);
  }, 60_000);
});

describe("syncOrganizerData: правки администратора", () => {
  it("сохраняет правленый продукт и характеристику администратора, остальное приводит к данным", async () => {
    const seed = catalogProduct(ADMIN_SLUG)!;
    expect(seed).toBeDefined();
    const before = await db.catalogProduct.findUniqueOrThrow({
      where: { slug: ADMIN_SLUG },
      include: { characteristics: true, processes: true },
    });
    const id = before.id;
    const patrol = await db.process.findUniqueOrThrow({ where: { slug: "patrol" } });
    expect(seed.characteristics.positioningMm).toBeUndefined();
    expect(seed.characteristics.liftHeightMm).toBeUndefined();
    const seedSpeed = seed.characteristics.speedMps!.value;

    try {
      await db.catalogProduct.update({
        where: { id },
        data: { editedByAdmin: true, name: "Спасатель (правка администратора)", flags: ["price-disputed"] },
      });
      // Администратор переписал цену организатора и добавил характеристику, которой у
      // организатора нет, и привязал продукт к процессу.
      await db.productCharacteristic.update({
        where: { productId_key: { productId: id, key: "priceRub" } },
        data: {
          origin: "admin",
          sourceType: "admin-edit",
          valueNum: 4_900_000,
          valueMin: null,
          valueMax: null,
          qualifier: null,
          sourceUrl: null,
          sourceRef: "правка администратора (тест T2.1)",
          confirmed: true,
          alternatives: Prisma.DbNull,
        },
      });
      await db.productCharacteristic.create({
        data: {
          productId: id,
          key: "positioningMm",
          group: "TECHNICAL",
          valueNum: 10,
          unit: "мм",
          origin: "admin",
          sourceType: "admin-edit",
        },
      });
      await db.productProcess.create({ data: { productId: id, processId: patrol.id } });
      // Неадминская строка с ключом, которого нет в данных, и испорченное значение данных.
      await db.productCharacteristic.create({
        data: {
          productId: id,
          key: "liftHeightMm",
          group: "TECHNICAL",
          valueNum: 1000,
          unit: "мм",
          origin: "research",
          sourceType: "manufacturer",
          sourceUrl: "https://example.test/spec",
        },
      });
      await db.productCharacteristic.update({
        where: { productId_key: { productId: id, key: "speedMps" } },
        data: { valueNum: 99 },
      });

      const report = await syncOrganizerData(db, { only: [ADMIN_SLUG] });
      expect(report.products).toMatchObject({ created: 0, skippedAdmin: 1, archived: 0, failed: 0 });
      expect(report.characteristics).toMatchObject({ upserted: 1, skippedAdmin: 1, deleted: 1, rejected: 0 });
      expect(report.productLinks).toEqual({ created: 0, deleted: 0 });

      const after = await db.catalogProduct.findUniqueOrThrow({
        where: { id },
        include: { characteristics: true, processes: true },
      });
      const char = (key: string) => after.characteristics.find((c) => c.key === key);
      // Поля продукта и процессы — как оставил администратор.
      expect(after).toMatchObject({
        name: "Спасатель (правка администратора)",
        editedByAdmin: true,
        flags: ["price-disputed"],
        archived: false,
      });
      expect(after.processes.map((p) => p.processId)).toContain(patrol.id);
      // Характеристики администратора сохранены, вынесенная цена взята из правки.
      expect(char("priceRub")).toMatchObject({ origin: "admin", valueNum: 4_900_000 });
      expect(char("positioningMm")).toMatchObject({ origin: "admin", valueNum: 10 });
      expect(after.priceRub).toBe(4_900_000);
      expect(after.needsVerification).toBe(true);
      // Неадминское приведено к данным организатора.
      expect(char("liftHeightMm")).toBeUndefined();
      expect(char("speedMps")?.valueNum).toBe(seedSpeed);
    } finally {
      // «Вернуть данные организатора»: снять правки администратора и синхронизировать продукт.
      await db.productCharacteristic.deleteMany({ where: { productId: id, origin: "admin" } });
      await db.catalogProduct.update({ where: { id }, data: { editedByAdmin: false } });
      await syncOrganizerData(db, { only: [ADMIN_SLUG] });
    }

    const restored = await db.catalogProduct.findUniqueOrThrow({
      where: { id },
      include: { characteristics: true, processes: true },
    });
    const strip = (p: typeof before) => ({
      ...p,
      updatedAt: null,
      characteristics: p.characteristics
        .map((c) => ({ ...c, id: null }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      processes: p.processes.map((l) => l.processId).sort(),
    });
    expect(strip(restored)).toEqual(strip(before));
  }, 120_000);

  it("нормативы и параметры: правка администратора сохраняется, respectAdminEdits: false её снимает", async () => {
    await inRolledBackTx(async (tx) => {
      const warehouse = await tx.facilityType.findUniqueOrThrow({ where: { slug: "warehouse" } });
      const paramWhere = { facilityTypeId_key: { facilityTypeId: warehouse.id, key: "totalAreaM2" } };
      const organizerArea = (await tx.paramDefinition.findUniqueOrThrow({ where: paramWhere })).baseNum;
      await tx.norm.update({ where: { key: "utilization" }, data: { value: 0.8, editedByAdmin: true } });
      await tx.paramDefinition.update({ where: paramWhere, data: { baseNum: 12_345, editedByAdmin: true } });

      // Транзакционный клиент: продукты пишутся без вложенных транзакций.
      const kept = await syncOrganizerData(tx, { only: [ADMIN_SLUG] });
      expect(kept.norms.skippedAdmin).toBeGreaterThanOrEqual(1);
      expect(kept.paramDefs.skippedAdmin).toBeGreaterThanOrEqual(1);
      // Продукт записан прямо в транзакции (без вложенной), и ошибок нет.
      expect(kept.products.failed).toBe(0);
      expect(kept.warnings).toEqual([]);
      expect(changedTotal(kept)).toBe(0);
      expect((await tx.norm.findUniqueOrThrow({ where: { key: "utilization" } })).value).toBe(0.8);
      expect((await tx.paramDefinition.findUniqueOrThrow({ where: paramWhere })).baseNum).toBe(12_345);

      const reset = await syncOrganizerData(tx, { only: [], respectAdminEdits: false });
      expect(reset.norms.updated).toBeGreaterThanOrEqual(1);
      expect(reset.paramDefs.updated).toBeGreaterThanOrEqual(1);
      expect(await tx.norm.findUniqueOrThrow({ where: { key: "utilization" } })).toMatchObject({
        value: DEFAULT_NORMS.utilization,
        editedByAdmin: false,
      });
      expect(await tx.paramDefinition.findUniqueOrThrow({ where: paramWhere })).toMatchObject({
        baseNum: organizerArea,
        editedByAdmin: false,
      });
    });
  }, 120_000);

  it("выпуск данных записывается один раз и не переписывает момент сева", async () => {
    await inRolledBackTx(async (tx) => {
      const version = organizerReleaseVersion();
      await tx.dataRelease.delete({ where: { version } });
      const created = await syncOrganizerData(tx, { only: [] });
      expect(created.releaseCreated).toBe(true);
      const seededAt = (await tx.dataRelease.findUniqueOrThrow({ where: { version } })).seededAt;
      const again = await syncOrganizerData(tx, { only: [] });
      expect(again.releaseCreated).toBe(false);
      expect((await tx.dataRelease.findUniqueOrThrow({ where: { version } })).seededAt).toEqual(seededAt);
    });
  }, 60_000);
});

/** Минимальный продукт-заготовка с префиксом теста. */
function fixtureSeed(slug: string, patch: Partial<ProductSeed> = {}): ProductSeed {
  return {
    slug: `${P}${slug}`,
    organizerCatalogId: null,
    organizerRows: [],
    level: "identification",
    name: `ТЗТ-Т21 ${slug}`,
    manufacturer: "ТЗТ Роботикс",
    country: "Россия",
    solutionType: "other",
    status: "operation",
    processes: [],
    facilityTypes: [],
    industries: ["Тест"],
    description: "Тестовый продукт синхронизации T2.1",
    characteristics: {
      manufacturer: {
        value: "ТЗТ Роботикс",
        origin: "organizer",
        sourceType: "organizer:catalog",
        sourceUrl: null,
        sourceRef: "тест T2.1",
        date: "2026-09-22",
        confirmed: true,
      },
      priceRub: {
        value: 1_000_000,
        unit: "₽",
        origin: "organizer",
        sourceType: "organizer:catalog",
        sourceUrl: null,
        sourceRef: "тест T2.1",
        date: "2026-09-22",
        confirmed: false,
      },
    },
    flags: [],
    excludedReason: null,
    ...patch,
  };
}

describe("syncProducts и архивация", () => {
  const V = `${P}v1`;

  it("отклоняет строку вне словаря и с испорченной датой, не теряя продукт", async () => {
    const seed = fixtureSeed("rejects");
    const manufacturer = seed.characteristics.manufacturer!;
    seed.characteristics.notAKey = { ...manufacturer, value: "что-то" };
    seed.characteristics.modelName = { ...manufacturer, value: "Модель", date: "2026-02-30" };
    const report = await syncProducts(db, [seed], { respectAdminEdits: true, dataVersion: V });
    expect(report.products).toMatchObject({ created: 1, failed: 0 });
    expect(report.characteristics).toMatchObject({ upserted: 2, rejected: 2 });
    expect(report.warnings.join("\n")).toContain("notAKey");
    const row = await db.catalogProduct.findUniqueOrThrow({
      where: { slug: seed.slug },
      include: { characteristics: true },
    });
    expect(row.characteristics.map((c) => c.key).sort()).toEqual(["manufacturer", "priceRub"]);
    expect(row).toMatchObject({ priceRub: 1_000_000, dataVersion: V, solutionTypeId: expect.any(String) });

    const again = await syncProducts(db, [seed], { respectAdminEdits: true, dataVersion: V });
    expect(again.products).toMatchObject({ created: 0, updated: 0 });
    expect(again.characteristics.upserted).toBe(0);
  });

  it("ошибка одного продукта не останавливает остальные", async () => {
    // Нулевой байт Postgres в тексте не принимает — запись продукта падает в самой базе.
    const bad = fixtureSeed("bad", { name: `Сломанное${String.fromCharCode(0)}имя` });
    const good = fixtureSeed("good", { solutionType: `${P}unknown-type` });
    const report = await syncProducts(db, [bad, good], { respectAdminEdits: true, dataVersion: V });
    expect(report.products).toMatchObject({ created: 1, failed: 1 });
    expect(report.warnings.join("\n")).toContain(`«${bad.slug}»: продукт не записан`);
    expect(report.warnings.join("\n")).toContain(`тип решения «${P}unknown-type» не найден`);
    expect(await db.catalogProduct.findUnique({ where: { slug: bad.slug } })).toBeNull();
    expect(await db.catalogProduct.findUniqueOrThrow({ where: { slug: good.slug } })).toMatchObject({
      solutionTypeId: null,
    });
  });

  it("id каталога организатора переходит к переименованному продукту", async () => {
    const orgId = `${P}org-id`;
    await syncProducts(db, [fixtureSeed("old-name", { organizerCatalogId: orgId })], {
      respectAdminEdits: true,
      dataVersion: V,
    });
    const report = await syncProducts(db, [fixtureSeed("new-name", { organizerCatalogId: orgId })], {
      respectAdminEdits: true,
      dataVersion: V,
    });
    expect(report.products).toMatchObject({ created: 1, failed: 0 });
    expect(report.warnings.join("\n")).toContain("перешёл");
    expect((await db.catalogProduct.findUniqueOrThrow({ where: { slug: `${P}old-name` } })).organizerCatalogId).toBeNull();
    expect((await db.catalogProduct.findUniqueOrThrow({ where: { slug: `${P}new-name` } })).organizerCatalogId).toBe(orgId);
  });

  it("продукт администратора с тем же slug не перезаписывается", async () => {
    const seed = fixtureSeed("admin-owned");
    await db.catalogProduct.create({
      data: { slug: seed.slug, name: "Продукт администратора", status: "operation", origin: "ADMIN" },
    });
    const report = await syncProducts(db, [seed], { respectAdminEdits: false, dataVersion: V });
    expect(report.products).toMatchObject({ created: 0, updated: 0, skippedAdmin: 1 });
    expect((await db.catalogProduct.findUniqueOrThrow({ where: { slug: seed.slug } })).name).toBe("Продукт администратора");
  });

  it("пропавший продукт организатора уходит в архив, чужие строки — нет", async () => {
    // Записан синхронизацией (dataVersion не пуст) и пропал из данных — в архив.
    await syncProducts(db, [fixtureSeed("gone")], { respectAdminEdits: true, dataVersion: V });
    // Заведён мимо синхронизации (как тестовые строки других наборов) — не трогается.
    await db.catalogProduct.create({ data: { slug: `${P}foreign`, name: "Чужая строка", status: "operation" } });
    // Правка администратора — не трогается при respectAdminEdits.
    await syncProducts(db, [fixtureSeed("edited")], { respectAdminEdits: true, dataVersion: V });
    await db.catalogProduct.update({ where: { slug: `${P}edited` }, data: { editedByAdmin: true } });

    const slugs = [`${P}gone`, `${P}foreign`, `${P}edited`];
    const report = await syncOrganizerData(db, { only: slugs });
    expect(report.products.archived).toBe(1);
    expect(report.warnings.join("\n")).toContain(`${P}gone`);
    const rows = await db.catalogProduct.findMany({ where: { slug: { in: slugs } }, orderBy: { slug: "asc" } });
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.archived]))).toEqual({
      [`${P}edited`]: false,
      [`${P}foreign`]: false,
      [`${P}gone`]: true,
    });
    // Архивный продукт не удалён и больше не архивируется повторно.
    const again = await syncOrganizerData(db, { only: slugs });
    expect(again.products.archived).toBe(0);
  }, 60_000);
});

describe("отчёт синхронизации", () => {
  it("печатается по-русски со всеми счётчиками", () => {
    const text = formatSyncReport({ ...first, warnings: ["проверка"] }).join("\n");
    expect(text).toContain("Продукты: создано");
    expect(text).toContain("пропущено (правки администратора)");
    expect(text).toContain("в архив");
    expect(text).toContain(`Устаревших источников (> ${STALE_SOURCE_DAYS} дней)`);
    expect(text).toContain("Предупреждение: проверка");
  });
});

describe("сев v2: демо-аккаунты", () => {
  it("пароль из окружения, пустая переменная — пароль по умолчанию", () => {
    const user = DEMO_ACCOUNTS.find((a) => a.role === "USER")!;
    const admin = DEMO_ACCOUNTS.find((a) => a.role === "ADMIN")!;
    expect(user.email).toBe("demo@demo.local");
    expect(admin.email).toBe("admin@demo.local");
    expect(demoPassword(user, {})).toBe("demo-user-2026");
    expect(demoPassword(admin, { DEMO_ADMIN_PASSWORD: "  " })).toBe("demo-admin-2026");
    expect(demoPassword(admin, { DEMO_ADMIN_PASSWORD: "s3cret-пароль" })).toBe("s3cret-пароль");
    expect(() => demoPassword(user, { DEMO_USER_PASSWORD: "ж".repeat(40) })).toThrow(/72 байт/);
  });

  it("заводит demo (USER) и admin (ADMIN); повторный сев не меняет хэш пароля", async () => {
    // Заготовки других тестов не в данных организатора: без уборки полный сев отправил бы их
    // в архив, а проверяются здесь только аккаунты.
    await cleanup();
    await seedV2(db);
    const users = await db.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((a) => a.email) } },
      select: { email: true, role: true, passwordHash: true },
      orderBy: { email: "asc" },
    });
    expect(users.map((u) => [u.email, u.role])).toEqual([
      ["admin@demo.local", "ADMIN"],
      ["demo@demo.local", "USER"],
    ]);
    await seedV2(db);
    const again = await db.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((a) => a.email) } },
      select: { email: true, passwordHash: true },
      orderBy: { email: "asc" },
    });
    expect(again.map((u) => u.passwordHash)).toEqual(users.map((u) => u.passwordHash));
  }, 60_000);
});
