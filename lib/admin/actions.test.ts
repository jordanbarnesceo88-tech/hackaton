import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { charEditorDefaults, charEditorValues } from "@/components/admin/format";
import type { CharEditorDefaults, CharKind } from "@/components/admin/format";
import { prisma } from "@/lib/db/client";
import { isCharKey, isoDate } from "@/lib/catalog/product-for-calc";
import { getCatalogProduct } from "@/lib/catalog/queries";
import type { Db } from "@/lib/catalog/queries";
import { syncOrganizerData } from "@/lib/catalog/sync";
import { CATALOG, catalogProduct } from "@/lib/data/organizer/catalog";
import { CHARACTERISTIC_KEYS } from "@/lib/tz/characteristics";
import { DEFAULT_NORMS } from "@/lib/tz/norms";
import type { AdminFormState } from "./actions";

/**
 * Действия администратора (T3.4) на настоящем Postgres (набор db). Подменены только границы,
 * которые в тесте не работают: сессия (auth), навигация Next (redirect и notFound бросают
 * узнаваемые метки) и revalidatePath (нужен контекст запроса). Проверка роли, запись и журнал —
 * настоящие.
 *
 * Тест заводит собственных пользователей с префиксом tzt-t34- и трогает:
 * - продукт организатора «agrobot» — уровня «идентификация», вне процессов и типов объектов,
 *   поэтому в подбор и расчёт он не попадает; в конце он возвращается к данным организатора
 *   и сверяется с исходным состоянием поле в поле;
 * - норматив utilization и параметр склада totalAreaM2 — на мгновения: исходная строка
 *   восстанавливается в finally сразу после проверки (и ещё раз в afterAll);
 * - продукты администратора admin-tzt-t34-… — без процессов (в подбор не попадают),
 *   удаляются тестом; проект пользователя tzt-t34- со ссылкой на такой продукт удаляется
 *   тестом (и вместе с пользователем в afterAll).
 * Остальной каталог организатора, в том числе демо-продукты ronavi-h1500 и ronavi-h2000, тест
 * правит только внутри транзакции, которая откатывается (`rolledBack`): другие наборы и агенты
 * не видят их изменёнными ни на миг.
 * Строки журнала тестовых пользователей и сами пользователи удаляются в afterAll.
 */

const { mockAuth, mockRevalidate, nav } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRevalidate: vi.fn(),
  nav: {
    redirect: vi.fn((url: string): never => {
      throw new Error(`NEXT_REDIRECT ${url}`);
    }),
    notFound: vi.fn((): never => {
      throw new Error("NOT_FOUND");
    }),
  },
}));
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("next/navigation", () => nav);
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

const actions = await import("./actions");

const P = "tzt-t34-";
const ADMIN_EMAIL = `${P}admin@test.local`;
const USER_EMAIL = `${P}user@test.local`;
/** Продукт организатора вне подбора (identification, без процессов). */
const PRODUCT = "agrobot";
const NORM = "utilization";
const PARAM_KEY = "totalAreaM2";
const ADMIN_SLUG_PREFIX = `admin-${P}`;
const INIT: AdminFormState = { status: "idle", message: "", seq: 0 };
const UNCHANGED = "Изменений нет — значения совпадают с сохранёнными";

/** Откат транзакции действия с тем, что действие вернуло. */
class Rollback extends Error {
  constructor(readonly result: unknown) {
    super("откат транзакции теста");
  }
}

type TxFn = (tx: Db) => Promise<unknown>;

/**
 * Выполнить действие так, что всё записанное им откатывается: $transaction действия идёт
 * в настоящей транзакции Postgres, `inspect` читает итог изнутри неё, затем транзакция
 * откатывается, а действие получает свой результат как обычно.
 */
async function rolledBack<T>(
  run: () => Promise<AdminFormState>,
  inspect: (tx: Db) => Promise<T>,
): Promise<{ res: AdminFormState; seen: T | undefined }> {
  const real = prisma.$transaction.bind(prisma) as unknown as (fn: TxFn, opts?: unknown) => Promise<unknown>;
  let seen: T | undefined;
  const fake = async (fn: TxFn, opts?: unknown): Promise<unknown> => {
    try {
      await real(async (tx) => {
        const result = await fn(tx);
        seen = await inspect(tx);
        throw new Rollback(result);
      }, opts);
    } catch (e) {
      if (e instanceof Rollback) return e.result;
      throw e;
    }
    throw new Error("транзакция теста не откатилась");
  };
  const spy = vi.spyOn(prisma, "$transaction").mockImplementation(fake as never);
  try {
    return { res: await run(), seen };
  } finally {
    spy.mockRestore();
  }
}

/**
 * Форма правки характеристики с начальными значениями — ровно то, что отправит браузер по
 * «Сохранить» без правок: поля по виду ключа, textarea с «\r\n», флажок только отмеченный.
 */
function editorForm(
  slug: string,
  key: string,
  kind: CharKind,
  d: CharEditorDefaults,
  overrides: Record<string, string> = {},
): FormData {
  const numeric = kind === "num" || kind === "range";
  const crlf = (s: string) => s.replace(/\n/g, "\r\n");
  const fields: Record<string, string> = {
    slug,
    key,
    ...(numeric
      ? { valueNum: d.valueNum, valueMin: d.valueMin, valueMax: d.valueMax, qualifier: d.qualifier, scope: d.scope }
      : {}),
    ...(kind !== "list" ? { unit: d.unit } : {}),
    valueText: crlf(d.valueText),
    sourceUrl: d.sourceUrl,
    verifiedAt: d.verifiedAt,
    ...(d.confirmed ? { confirmed: "on" } : {}),
    note: crlf(d.note),
    ...overrides,
  };
  return form(fields);
}

/** Характеристики продукта карточки каталога — с видом ключа и единицей словаря; нет продукта — []. */
async function editorRows(slug: string) {
  const detail = await getCatalogProduct(prisma, slug);
  if (!detail) return [];
  return Object.values(detail.characteristics)
    .flat()
    .flatMap((c) => {
      if (!isCharKey(c.key)) return [];
      const def = CHARACTERISTIC_KEYS[c.key];
      const values = charEditorValues(c);
      return [{ key: c.key, kind: def.kind as CharKind, dictUnit: def.unit as string | null, values }];
    });
}

let adminId = "";
let userId = "";
let paramId = "";

type NormRow = Awaited<ReturnType<typeof prisma.norm.findUniqueOrThrow>>;
type ParamRow = Awaited<ReturnType<typeof prisma.paramDefinition.findUniqueOrThrow>>;
let normBefore: NormRow | null = null;
let paramBefore: ParamRow | null = null;

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

function signIn(id: string, role: "USER" | "ADMIN", email: string): void {
  mockAuth.mockResolvedValue({ user: { id, email, role }, expires: "2099-01-01T00:00:00.000Z" });
}

const asAdmin = () => signIn(adminId, "ADMIN", ADMIN_EMAIL);

/** Продукт со всеми полями, характеристиками и процессами — без id строк и updatedAt. */
async function productSnapshot(slug: string) {
  const p = await prisma.catalogProduct.findUniqueOrThrow({
    where: { slug },
    include: { characteristics: true, processes: true },
  });
  return {
    ...p,
    updatedAt: null,
    characteristics: p.characteristics
      .map((c) => ({ ...c, id: null }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    processes: p.processes.map((l) => l.processId).sort(),
  };
}

/** Число подтверждённых из текста «Подтверждение» («9 из 31 подтверждены; …»); нет — null. */
function confirmedCount(text: string | null | undefined): number | null {
  const m = /^(\d+) из \d+ подтверждены/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Производные строки «Качества данных» продукта и то, что они должны показывать по формулам
 * генератора данных: подтверждённые / все характеристики без строк качества и самая поздняя
 * дата проверки.
 */
async function derivedQuality(slug: string) {
  const rows = await prisma.productCharacteristic.findMany({ where: { product: { slug } } });
  const base = rows.filter((c) => !["primarySourceUrl", "verifiedAt", "confirmation"].includes(c.key));
  const dates = base.map((c) => isoDate(c.verifiedAt)).filter((d): d is string => d !== null).sort();
  const text = rows.find((c) => c.key === "confirmation")?.valueText ?? "";
  const m = /^(\d+) из (\d+) подтверждены/.exec(text);
  return {
    confirmed: base.filter((c) => c.confirmed).length,
    total: base.length,
    latest: dates[dates.length - 1] ?? null,
    confirmedInText: m ? Number(m[1]) : null,
    totalInText: m ? Number(m[2]) : null,
    verifiedAtText: rows.find((c) => c.key === "verifiedAt")?.valueText ?? null,
  };
}

/** Вернуть продукт к данным организатора в обход действий (страховка на случай падения). */
async function forceRevertProduct(): Promise<void> {
  const p = await prisma.catalogProduct.findUnique({
    where: { slug: PRODUCT },
    select: { id: true, editedByAdmin: true, characteristics: { where: { origin: "admin" }, select: { id: true } } },
  });
  if (!p || (!p.editedByAdmin && p.characteristics.length === 0)) return;
  await prisma.productCharacteristic.deleteMany({ where: { productId: p.id, origin: "admin" } });
  await prisma.catalogProduct.update({ where: { id: p.id }, data: { editedByAdmin: false } });
  await syncOrganizerData(prisma, { only: [PRODUCT] });
}

async function restoreNorm(): Promise<void> {
  if (!normBefore) return;
  await prisma.norm.update({
    where: { key: NORM },
    data: { value: normBefore.value, editedByAdmin: normBefore.editedByAdmin, updatedById: normBefore.updatedById },
  });
}

async function restoreParam(): Promise<void> {
  if (!paramBefore) return;
  const b = paramBefore;
  await prisma.paramDefinition.update({
    where: { id: b.id },
    data: {
      baseNum: b.baseNum,
      baseText: b.baseText,
      min: b.min,
      max: b.max,
      locked: b.locked,
      required: b.required,
      hint: b.hint,
      example: b.example,
      editedByAdmin: b.editedByAdmin,
    },
  });
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.catalogProduct.deleteMany({ where: { slug: { startsWith: ADMIN_SLUG_PREFIX } } });
  if (ids.length > 0) await prisma.changeLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  adminId = (await prisma.user.create({ data: { email: ADMIN_EMAIL, passwordHash: "не-хэш", role: "ADMIN" } })).id;
  userId = (await prisma.user.create({ data: { email: USER_EMAIL, passwordHash: "не-хэш", role: "USER" } })).id;
  normBefore = await prisma.norm.findUniqueOrThrow({ where: { key: NORM } });
  paramBefore = await prisma.paramDefinition.findFirstOrThrow({
    where: { key: PARAM_KEY, facilityType: { slug: "warehouse" } },
  });
  paramId = paramBefore.id;
  // Продукт для проверки: данные организатора без правок администратора.
  expect(catalogProduct(PRODUCT)).toBeDefined();
  await forceRevertProduct();
}, 120_000);

afterAll(async () => {
  await restoreNorm();
  await restoreParam();
  await forceRevertProduct();
  await cleanup();
}, 120_000);

/** Все действия с правдоподобными полями — для проверки доступа. */
function everyAction(): [string, (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>, FormData][] {
  return [
    ["updateProductAction", actions.updateProductAction, form({ slug: PRODUCT, name: "Взлом", status: "operation" })],
    [
      "updateCharacteristicAction",
      actions.updateCharacteristicAction,
      form({ slug: PRODUCT, key: "priceRub", valueNum: "1" }),
    ],
    ["createProductAction", actions.createProductAction, form({ name: `${P}взлом`, status: "operation" })],
    ["archiveProductAction", actions.archiveProductAction, form({ slug: PRODUCT, archived: "1" })],
    ["deleteProductAction", actions.deleteProductAction, form({ slug: PRODUCT, confirm: "yes" })],
    ["revertProductAction", actions.revertProductAction, form({ slug: PRODUCT })],
    ["updateNormAction", actions.updateNormAction, form({ key: NORM, value: "0,8" })],
    ["resetNormAction", actions.resetNormAction, form({ key: NORM })],
    ["updateParamDefinitionAction", actions.updateParamDefinitionAction, form({ id: paramId, base: "1", hint: "взлом" })],
    ["refreshCatalogAction", actions.refreshCatalogAction, form({})],
  ];
}

describe("доступ: только администратор по базе", () => {
  it("пользователь без роли ADMIN (даже с ADMIN в устаревшем токене) получает 404 во всех действиях", async () => {
    const before = await productSnapshot(PRODUCT);
    const norm = await prisma.norm.findUniqueOrThrow({ where: { key: NORM } });
    signIn(userId, "ADMIN", USER_EMAIL);
    const list = everyAction();
    expect(list).toHaveLength(10);
    for (const [name, action, fd] of list) {
      await expect(action(INIT, fd), name).rejects.toThrow("NOT_FOUND");
    }
    expect(await productSnapshot(PRODUCT)).toEqual(before);
    expect((await prisma.norm.findUniqueOrThrow({ where: { key: NORM } })).value).toBe(norm.value);
    expect(await prisma.changeLog.count({ where: { userId } })).toBe(0);
    expect(await prisma.catalogProduct.count({ where: { slug: { startsWith: ADMIN_SLUG_PREFIX } } })).toBe(0);
  });

  it("гость перенаправляется на /login во всех действиях", async () => {
    mockAuth.mockResolvedValue(null);
    for (const [name, action, fd] of everyAction()) {
      await expect(action(INIT, fd), name).rejects.toThrow("NEXT_REDIRECT /login");
    }
  });
});

describe("нормативы", () => {
  it("updateNormAction прижимает 0,99 к 0,85, пишет журнал; resetNormAction возвращает умолчание", async () => {
    asAdmin();
    try {
      const saved = await actions.updateNormAction(INIT, form({ key: NORM, value: "0,99" }));
      expect(saved).toMatchObject({ status: "ok", seq: 1 });
      expect(saved.message).toContain("0,85");
      expect(await prisma.norm.findUniqueOrThrow({ where: { key: NORM } })).toMatchObject({
        value: 0.85,
        editedByAdmin: true,
        updatedById: adminId,
      });
      const log = await prisma.changeLog.findFirstOrThrow({
        where: { entity: "norm", entityId: NORM, userId: adminId },
        orderBy: { createdAt: "desc" },
      });
      expect(log).toMatchObject({
        field: "value",
        oldValue: normBefore?.value,
        newValue: 0.85,
        autoValue: DEFAULT_NORMS.utilization,
        projectId: null,
        scenarioId: null,
      });

      // Мусор и неизвестный ключ отклоняются, номер сохранения не растёт.
      const junk = await actions.updateNormAction(saved, form({ key: NORM, value: "много" }));
      expect(junk).toMatchObject({ status: "error", seq: 1 });
      const unknown = await actions.updateNormAction(saved, form({ key: "noSuchNorm", value: "1" }));
      expect(unknown.status).toBe("error");

      const reset = await actions.resetNormAction(saved, form({ key: NORM }));
      expect(reset).toMatchObject({ status: "ok", seq: 2 });
      expect(await prisma.norm.findUniqueOrThrow({ where: { key: NORM } })).toMatchObject({
        value: DEFAULT_NORMS.utilization,
        editedByAdmin: false,
      });
      expect(await prisma.changeLog.count({ where: { entity: "norm", entityId: NORM, userId: adminId } })).toBe(2);
    } finally {
      await restoreNorm();
    }
  });
});

describe("каталог: правки администратора и данные организатора", () => {
  it("правка характеристики ставит editedByAdmin, синхронизация её сохраняет, возврат восстанавливает продукт", async () => {
    asAdmin();
    const before = await productSnapshot(PRODUCT);
    expect(before).toMatchObject({ origin: "ORGANIZER", editedByAdmin: false, archived: false });
    const solutionType = before.solutionTypeId
      ? (await prisma.solutionType.findUniqueOrThrow({ where: { id: before.solutionTypeId } })).slug
      : "";
    const confirmedBefore = confirmedCount(before.characteristics.find((c) => c.key === "confirmation")?.valueText);
    // Предпосылки: цена организатора не подтверждена, «Подтверждение» — производная строка.
    expect(before.characteristics.find((c) => c.key === "priceRub")).toMatchObject({ confirmed: false });
    expect(confirmedBefore).not.toBeNull();
    try {
      const saved = await actions.updateCharacteristicAction(
        INIT,
        form({
          slug: PRODUCT,
          key: "priceRub",
          valueNum: "4 200 000",
          unit: "₽",
          sourceUrl: "https://example.com/agrobot/price",
          verifiedAt: "2026-09-20",
          confirmed: "on",
          note: "тест T3.4",
        }),
      );
      expect(saved).toMatchObject({ status: "ok", seq: 1 });
      const edited = await prisma.catalogProduct.findUniqueOrThrow({
        where: { slug: PRODUCT },
        include: { characteristics: { where: { key: "priceRub" } } },
      });
      expect(edited).toMatchObject({ editedByAdmin: true, priceRub: 4_200_000 });
      expect(edited.characteristics[0]).toMatchObject({
        origin: "admin",
        sourceType: "admin-edit",
        valueNum: 4_200_000,
        unit: "₽",
        confirmed: true,
        sourceUrl: "https://example.com/agrobot/price",
        // Место в каталоге организатора и цитата описывали прежнее число.
        sourceRef: null,
        asInSource: null,
        note: "тест T3.4",
      });
      const log = await prisma.changeLog.findFirstOrThrow({
        where: { entity: "characteristic", entityId: edited.id, field: "priceRub", userId: adminId },
      });
      expect(log.newValue).toMatchObject({ confirmed: true, sourceUrl: "https://example.com/agrobot/price" });

      // «Качество данных» пересчитано по итоговому набору: подтверждённых стало на одно больше.
      const quality = await derivedQuality(PRODUCT);
      expect(quality.confirmedInText).toBe((confirmedBefore ?? 0) + 1);
      expect(quality.confirmedInText).toBe(quality.confirmed);
      expect(quality.totalInText).toBe(quality.total);
      expect(quality.verifiedAtText).toBe(quality.latest);

      // «Подтверждено» без ссылки на первоисточник не принимается; граница «от» > «до» — тоже.
      const noUrl = await actions.updateCharacteristicAction(
        saved,
        form({ slug: PRODUCT, key: "priceRub", valueNum: "1", confirmed: "on" }),
      );
      expect(noUrl).toMatchObject({ status: "error", seq: 1 });
      const swapped = await actions.updateCharacteristicAction(
        saved,
        form({ slug: PRODUCT, key: "priceRub", valueMin: "10", valueMax: "5" }),
      );
      expect(swapped.status).toBe("error");

      // Идентификация и архив. Переименование и страна меняют и характеристики, которые
      // повторяют эти поля в карточке.
      const renamed = `${before.name} (тест T3.4)`;
      const ident = await actions.updateProductAction(
        INIT,
        form({
          slug: PRODUCT,
          name: renamed,
          manufacturer: before.manufacturer ?? "",
          country: "Тестландия",
          solutionType,
          status: before.status,
        }),
      );
      expect(ident).toMatchObject({ status: "ok", message: "Записано: изменено полей — 2" });
      const identity = await prisma.catalogProduct.findUniqueOrThrow({
        where: { slug: PRODUCT },
        include: { characteristics: { where: { key: { in: ["modelName", "countryOfOrigin", "manufacturer"] } } } },
      });
      expect(identity).toMatchObject({ name: renamed, country: "Тестландия" });
      const identityChar = (key: string) => identity.characteristics.find((c) => c.key === key);
      expect(identityChar("modelName")).toMatchObject({ valueText: renamed, origin: "admin", confirmed: false });
      expect(identityChar("countryOfOrigin")).toMatchObject({ valueText: "Тестландия", origin: "admin" });
      // Неизменённое поле свою характеристику не трогает.
      expect(identityChar("manufacturer")).toMatchObject({ origin: "organizer" });
      const afterIdentity = await derivedQuality(PRODUCT);
      expect(afterIdentity.confirmedInText).toBe(afterIdentity.confirmed);
      expect(afterIdentity.totalInText).toBe(afterIdentity.total);
      const noReason = await actions.updateProductAction(
        INIT,
        form({ slug: PRODUCT, name: before.name, status: before.status, solutionType, excluded: "on" }),
      );
      expect(noReason.status).toBe("error");
      expect(await actions.archiveProductAction(INIT, form({ slug: PRODUCT, archived: "1" }))).toMatchObject({
        status: "ok",
      });

      // Синхронизация данных организатора правки администратора не трогает.
      const report = await syncOrganizerData(prisma, { only: [PRODUCT] });
      expect(report.products).toMatchObject({ skippedAdmin: 1, failed: 0 });
      expect(report.characteristics.skippedAdmin).toBeGreaterThanOrEqual(1);
      const kept = await prisma.catalogProduct.findUniqueOrThrow({
        where: { slug: PRODUCT },
        include: { characteristics: { where: { key: "priceRub" } } },
      });
      expect(kept).toMatchObject({ editedByAdmin: true, country: "Тестландия", archived: true, priceRub: 4_200_000 });
      expect(kept.characteristics[0]).toMatchObject({ origin: "admin", valueNum: 4_200_000 });

      // Синхронизация вернула производные строки к данным организатора, «Обновить каталог»
      // пересчитывает их по правкам администратора.
      const refreshed = await actions.refreshCatalogAction(INIT, form({}));
      expect(refreshed.status).toBe("ok");
      expect(refreshed.report?.some((l) => l.startsWith("«Качество данных» пересчитано по правкам администратора"))).toBe(
        true,
      );
      const afterRefresh = await derivedQuality(PRODUCT);
      expect(afterRefresh.confirmedInText).toBe(afterRefresh.confirmed);
      expect(afterRefresh.confirmedInText).toBe((confirmedBefore ?? 0) + 1);

      // Продукт организатора удалить нельзя — только в архив.
      const del = await actions.deleteProductAction(INIT, form({ slug: PRODUCT, confirm: "yes" }));
      expect(del.status).toBe("error");
      expect(del.message).toContain("Удалить нельзя");
      expect(await prisma.catalogProduct.count({ where: { slug: PRODUCT } })).toBe(1);

      // «Вернуть данные организатора».
      const reverted = await actions.revertProductAction(INIT, form({ slug: PRODUCT }));
      expect(reverted).toMatchObject({ status: "ok" });
      expect(
        await prisma.changeLog.count({ where: { entity: "product", entityId: edited.id, field: "revert", userId: adminId } }),
      ).toBe(1);
    } finally {
      await forceRevertProduct();
    }
    expect(await productSnapshot(PRODUCT)).toEqual(before);
  }, 120_000);

  it("deleteProductAction отказывает для продукта организатора", async () => {
    asAdmin();
    const res = await actions.deleteProductAction(INIT, form({ slug: PRODUCT, confirm: "yes" }));
    expect(res).toMatchObject({ status: "error", seq: 0 });
    expect(res.message).toBe("Удалить нельзя: данные организатора — используйте «В архив»");
    expect(await prisma.catalogProduct.count({ where: { slug: PRODUCT } })).toBe(1);
  });

  it("создание продукта администратора, свободный slug и удаление только с подтверждением", async () => {
    asAdmin();
    const name = `${P}Тестовый робот`;
    const slug = `${ADMIN_SLUG_PREFIX}testovyy-robot`;
    await expect(
      actions.createProductAction(INIT, form({ name, manufacturer: "Тест", country: "Россия", status: "piloting" })),
    ).rejects.toThrow(`NEXT_REDIRECT /admin/catalog/${slug}`);
    await expect(actions.createProductAction(INIT, form({ name, status: "piloting" }))).rejects.toThrow(
      `NEXT_REDIRECT /admin/catalog/${slug}-2`,
    );
    const created = await prisma.catalogProduct.findUniqueOrThrow({
      where: { slug },
      include: { characteristics: true, processes: true },
    });
    expect(created).toMatchObject({
      origin: "ADMIN",
      level: "enriched",
      status: "piloting",
      editedByAdmin: true,
      facilityTypeSlugs: [],
      needsVerification: true,
    });
    expect(created.processes).toHaveLength(0);
    expect(created.characteristics.map((c) => c.key).sort()).toEqual(
      ["availabilityStatus", "countryOfOrigin", "manufacturer", "modelName"].sort(),
    );
    expect(created.characteristics.every((c) => c.origin === "admin" && !c.confirmed)).toBe(true);
    expect(
      await prisma.changeLog.count({ where: { entity: "product", entityId: created.id, field: "create", userId: adminId } }),
    ).toBe(1);

    // Неизвестный процесс и пустое название — отказ без записи.
    const badProcess = await actions.createProductAction(
      INIT,
      form({ name: `${P}ещё`, status: "operation", process: ["no-such-process"] }),
    );
    expect(badProcess.status).toBe("error");
    expect((await actions.createProductAction(INIT, form({ name: "", status: "operation" }))).status).toBe("error");

    // Без отметки «подтверждаю» не удаляется.
    const unconfirmed = await actions.deleteProductAction(INIT, form({ slug }));
    expect(unconfirmed.status).toBe("error");

    // Продукт в сценарии сохранённого проекта не удаляется: ссылка на него — slug в JSON
    // сценария, внешнего ключа нет, и «Пересчитать на актуальных данных» его бы не нашёл.
    const project = await prisma.project.create({
      data: {
        userId,
        name: `${P}проект`,
        facilityTypeSlug: "warehouse",
        params: {},
        paramsSource: {},
        scenarios: {
          create: {
            key: "purchase-1",
            name: "Покупка",
            kind: "PURCHASE",
            spec: { items: [{ process: "pallet-transport", productSlug: slug }], normOverrides: {} },
          },
        },
      },
    });
    const inProject = await actions.deleteProductAction(INIT, form({ slug, confirm: "yes" }));
    expect(inProject).toMatchObject({
      status: "error",
      message: "Продукт используется в проектах — переведите его в архив вместо удаления",
    });
    expect(await prisma.catalogProduct.count({ where: { slug } })).toBe(1);
    // Проект удалён (сценарий — вместе с ним) — удаление проходит.
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.scenario.count({ where: { projectId: project.id } })).toBe(0);

    await expect(actions.deleteProductAction(INIT, form({ slug, confirm: "yes" }))).rejects.toThrow(
      "NEXT_REDIRECT /admin/catalog",
    );
    await expect(actions.deleteProductAction(INIT, form({ slug: `${slug}-2`, confirm: "yes" }))).rejects.toThrow(
      "NEXT_REDIRECT /admin/catalog",
    );
    expect(await prisma.catalogProduct.count({ where: { slug: { startsWith: ADMIN_SLUG_PREFIX } } })).toBe(0);
    expect(
      await prisma.changeLog.count({ where: { entity: "product", entityId: created.id, field: "delete", userId: adminId } }),
    ).toBe(1);
  });
});

describe("параметры объектов", () => {
  it("границы проверяются; правка подсказки ставит editedByAdmin и пишет журнал", async () => {
    asAdmin();
    const b = paramBefore!;
    const text = (n: number | null) => (n === null ? "" : String(n));
    const current = {
      id: b.id,
      base: b.baseNum !== null ? String(b.baseNum) : (b.baseText ?? ""),
      min: text(b.min),
      max: text(b.max),
      hint: b.hint,
      example: b.example,
      ...(b.required ? { required: "on" } : {}),
    };
    try {
      const swapped = await actions.updateParamDefinitionAction(INIT, form({ ...current, min: "100", max: "10" }));
      expect(swapped.status).toBe("error");
      if (b.max !== null) {
        const out = await actions.updateParamDefinitionAction(INIT, form({ ...current, base: String(b.max * 10 + 1) }));
        expect(out.status).toBe("error");
        expect(out.message).toContain("вне диапазона");
      }
      const same = await actions.updateParamDefinitionAction(INIT, form(current));
      expect(same).toMatchObject({ status: "error", message: "Изменений нет — значения совпадают с сохранёнными" });

      const saved = await actions.updateParamDefinitionAction(
        INIT,
        form({ ...current, hint: "Подсказка теста T3.4", reason: "проверка" }),
      );
      expect(saved).toMatchObject({ status: "ok", seq: 1 });
      expect(await prisma.paramDefinition.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
        hint: "Подсказка теста T3.4",
        editedByAdmin: true,
        baseNum: b.baseNum,
        min: b.min,
        max: b.max,
      });
      const logs = await prisma.changeLog.findMany({ where: { entity: "paramDefinition", entityId: b.id, userId: adminId } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ field: "hint", newValue: "Подсказка теста T3.4", reason: "проверка" });
    } finally {
      await restoreParam();
    }
  });
});

describe("форма правки характеристики", () => {
  it("«Сохранить» без правок отвечает «Изменений нет» по каждой строке каталога организатора", async () => {
    asAdmin();
    const changed: string[] = [];
    let rowsSeen = 0;
    let semicolonItems = 0;
    let emptyUnits = 0;
    // Весь каталог организатора (около 2 600 строк, несколько секунд): каждая правка идёт
    // в транзакции, которая откатывается, — данные не меняются ни на миг.
    for (const { slug } of CATALOG) {
      for (const r of await editorRows(slug)) {
        rowsSeen++;
        if (r.values.valueList.some((s) => s.includes(";"))) semicolonItems++;
        if (r.kind !== "list" && r.values.unit === null && r.dictUnit !== null) emptyUnits++;
        const d = charEditorDefaults(r.kind, r.values, r.dictUnit);
        const { res } = await rolledBack(
          () => actions.updateCharacteristicAction(INIT, editorForm(slug, r.key, r.kind, d)),
          async () => null,
        );
        if (res.message !== UNCHANGED) changed.push(`${slug} · ${r.key}: ${res.message}`);
      }
    }
    expect(changed).toEqual([]);
    // Проверка не пустая: каталог в базе, и в нём есть оба случая, на которых форма раньше
    // меняла значение, — пункт перечня с «;» и строка без единицы при единице в словаре.
    expect(rowsSeen).toBeGreaterThan(1000);
    expect(semicolonItems).toBeGreaterThan(0);
    expect(emptyUnits).toBeGreaterThan(0);
  }, 120_000);

  it("новое значение перечня: пункт с «;» остаётся одним пунктом, пустая единица строки — пустой", async () => {
    asAdmin();
    const slug = "ronavi-h2000";
    const rows = await editorRows(slug);
    const connectivity = rows.find((r) => r.key === "connectivity");
    const dims = rows.find((r) => r.key === "dimensionsMm");
    expect(connectivity).toBeDefined();
    expect(dims?.values.unit).toBeNull();
    const items = ["Wi-Fi 5 ГГц 802.11 a/c/n; открытое API", "4G"];
    const list = await rolledBack(
      () =>
        actions.updateCharacteristicAction(
          INIT,
          editorForm(slug, "connectivity", "list", charEditorDefaults("list", connectivity!.values, null), {
            valueText: items.join("\r\n"),
          }),
        ),
      (tx) => tx.productCharacteristic.findFirstOrThrow({ where: { product: { slug }, key: "connectivity" } }),
    );
    expect(list.res.status).toBe("ok");
    expect(list.seen?.valueList).toEqual(items);

    // Правка одного примечания у строки без единицы: единица остаётся пустой, а цитата
    // источника и основание — на месте (значение не менялось).
    const before = await prisma.productCharacteristic.findFirstOrThrow({ where: { product: { slug }, key: "dimensionsMm" } });
    const note = await rolledBack(
      () =>
        actions.updateCharacteristicAction(
          INIT,
          editorForm(slug, "dimensionsMm", dims!.kind, charEditorDefaults(dims!.kind, dims!.values, dims!.dictUnit), {
            note: "Сверено (тест T3.4)",
          }),
        ),
      (tx) => tx.productCharacteristic.findFirstOrThrow({ where: { id: before.id } }),
    );
    expect(note.res.status).toBe("ok");
    expect(note.seen).toMatchObject({
      unit: null,
      valueText: before.valueText,
      sourceRef: before.sourceRef,
      asInSource: before.asInSource,
      basis: before.basis,
      confidence: before.confidence,
      note: "Сверено (тест T3.4)",
    });
    expect(await prisma.productCharacteristic.findFirstOrThrow({ where: { id: before.id } })).toEqual(before);
  });

  it("примечание к подтверждённой цене организатора без ссылки: отметка и цитата остаются", async () => {
    asAdmin();
    const slug = "ronavi-h1500";
    const row = (await editorRows(slug)).find((r) => r.key === "priceRub");
    expect(row).toBeDefined();
    const product = await prisma.catalogProduct.findUniqueOrThrow({
      where: { slug },
      include: { characteristics: { where: { key: { in: ["priceRub", "confirmation"] } } } },
    });
    const price = product.characteristics.find((c) => c.key === "priceRub")!;
    const confirmation = product.characteristics.find((c) => c.key === "confirmation")!;
    // Предпосылка: цена подтверждена по месту в данных организатора, ссылки на страницу нет.
    expect(price).toMatchObject({ confirmed: true, sourceUrl: null });
    expect(price.sourceRef).not.toBeNull();
    const d = charEditorDefaults(row!.kind, row!.values, row!.dictUnit);

    const noteText = "Сверено с каталогом организатора (тест T3.4)";
    const { res, seen } = await rolledBack(
      () => actions.updateCharacteristicAction(INIT, editorForm(slug, "priceRub", row!.kind, d, { note: noteText })),
      (tx) =>
        tx.catalogProduct.findUniqueOrThrow({
          where: { slug },
          include: { characteristics: { where: { key: { in: ["priceRub", "confirmation"] } } } },
        }),
    );
    expect(res).toMatchObject({ status: "ok", seq: 1 });
    expect(seen?.characteristics.find((c) => c.key === "priceRub")).toMatchObject({
      origin: "admin",
      confirmed: true,
      sourceUrl: null,
      sourceRef: price.sourceRef,
      asInSource: price.asInSource,
      valueNum: price.valueNum,
      unit: price.unit,
      note: noteText,
    });
    // Цена осталась подтверждённой: «требует проверки» и «Подтверждение» не изменились.
    expect(seen).toMatchObject({
      priceRub: product.priceRub,
      needsVerification: product.needsVerification,
      editedByAdmin: true,
    });
    expect(seen?.characteristics.find((c) => c.key === "confirmation")?.valueText).toBe(confirmation.valueText);

    // Новое число с отметкой «подтверждено» и без ссылки — отказ.
    const changedValue = await rolledBack(
      () =>
        actions.updateCharacteristicAction(
          INIT,
          editorForm(slug, "priceRub", row!.kind, d, { valueNum: "2 800 000", valueMin: "", valueMax: "" }),
        ),
      async () => null,
    );
    expect(changedValue.res.status).toBe("error");
    expect(changedValue.res.message).toContain("требует ссылки на первоисточник");
    // Вне откатанной транзакции демо-продукт не менялся.
    expect(await prisma.productCharacteristic.findUniqueOrThrow({ where: { id: price.id } })).toEqual(price);
  });
});

describe("обновление каталога", () => {
  it("refreshCatalogAction синхронизирует с сохранением правок и отдаёт отчёт по-русски", async () => {
    asAdmin();
    const logged = () => prisma.changeLog.count({ where: { entity: "catalog", field: "refresh", userId: adminId } });
    const before = await logged();
    const res = await actions.refreshCatalogAction(INIT, form({}));
    expect(res).toMatchObject({ status: "ok", seq: 1 });
    expect(res.message).toContain("пропущено (правки администратора)");
    expect(res.message).toContain("в архив");
    expect(res.message).toContain("устаревших источников (> 180 дней)");
    expect(res.report?.some((l) => l.startsWith("Устаревших источников (> 180 дней)"))).toBe(true);
    expect(await logged()).toBe(before + 1);
  }, 120_000);
});
