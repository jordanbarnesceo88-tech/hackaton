import { Prisma } from "@prisma/client";
import type { PrismaClient, ProductCharacteristic } from "@prisma/client";
import { CATALOG } from "../data/organizer/catalog";
import { PARAM_SPECS } from "../data/organizer/params";
import { CATALOG_COUNTS, ORGANIZER_DATA_VERSION } from "../data/organizer/version.generated";
import { NORM_DEFS } from "../tz/norms";
import type { NormDef } from "../tz/norms";
import { PROCESS_DEFS, SOLUTION_TYPE_DEFS } from "../tz/processes";
import type { ProductSeed } from "../tz/types";
import { dataVersionOf, stableJson } from "../tz/version";
import { isoDate, sourcedToCharRow } from "./product-for-calc";
import type { CharRow } from "./product-for-calc";
import { promoteColumns } from "./promote";
import { toCharacteristicData } from "./queries";
import type { Db } from "./queries";

/**
 * Синхронизация данных организатора в таблицы модели tz-1.0.0 (ТЗ §3.3.2 «загрузка таблицы
 * организатора», §3.3.5 «администратор управляет каталогом», §3.3.6 «обновление по запросу»).
 * Одна функция на два входа: сев (`npm run db:seed` → scripts/seed-v2.ts) и кнопка
 * администратора «Обновить каталог» (T3.4). Порядок шагов:
 *
 * 1. Типы решений (SOLUTION_TYPE_DEFS) и процессы (PROCESS_DEFS) — upsert по slug.
 * 2. Связи «тип объекта — процесс» (FacilityTypeProcess). Тип объекта, которого нет в БД,
 *    пропускается с предупреждением: его заводит v1-сев (таксономия), а не эта функция.
 * 3. Описания параметров (PARAM_SPECS → ParamDefinition) по (тип объекта, ключ). Строка
 *    с правкой администратора (editedByAdmin) не трогается целиком.
 * 4. Нормативы (NORM_DEFS → Norm): метаданные (подпись, границы, основание, источник)
 *    обновляются всегда, значение — только если его не правил администратор.
 * 5. Продукты каталога (CATALOG), каждый в своей транзакции:
 *    - продукт — upsert по slug; у продукта с правкой администратора меняются только поля
 *      связи с данными организатора (organizerCatalogId, organizerRows) и dataVersion, а его
 *      процессы не переписываются;
 *    - характеристики — upsert по (продукт, ключ); строки с origin 'admin' (правка
 *      администратора) не трогаются, неадминские строки с ключом, которого больше нет
 *      в данных, удаляются;
 *    - вынесенные колонки (priceRub, throughputPerH, …) пересчитываются `promoteColumns` из
 *      итогового набора характеристик — включая правки администратора, потому что колонки —
 *      копии характеристик, и разойтись с ними они не должны.
 * 6. Продукт организатора, которого больше нет в данных, уходит в архив (archived = true) и не
 *    удаляется: на его снимок может ссылаться сохранённый проект (ТЗ §3.1.5).
 * 7. Выпуск данных (DataRelease) — запись с версией данных, если такой версии ещё нет.
 *
 * Идемпотентность: запись выполняется, только если значение отличается от того, что уже
 * в БД, поэтому повторный прогон на тех же данных ничего не создаёт и не обновляет (отчёт —
 * одни нули, updatedAt строк не меняется). Это проверяется тестом и шлюзом (сев дважды).
 *
 * Модуль принимает клиент БД параметром (сев создаёт собственный PrismaClient) и использует
 * только относительные импорты — он работает и под tsx без алиаса «@/». Клиент может быть
 * транзакционным: тогда продукты пишутся прямо в нём, без вложенных транзакций, а ошибка
 * записи продукта не перехватывается (Postgres всё равно прервал бы внешнюю транзакцию).
 */

// ——————————————————————————— Параметры и отчёт ———————————————————————————

/** Параметры синхронизации. */
export type SyncOptions = {
  /**
   * Уважать правки администратора (по умолчанию true). false — данные организатора
   * перезаписывают правленые строки параметров, нормативов и продуктов и снимают с них
   * признак editedByAdmin, а характеристики с origin 'admin' заменяются значениями
   * организатора там, где у организатора есть такой ключ. Характеристики администратора
   * по ключам, которых у организатора нет, синхронизация не удаляет никогда.
   */
  respectAdminEdits?: boolean;
  /**
   * Ограничить шаг продуктов этими slug'ами (кнопка «Вернуть данные организатора» у одного
   * продукта). Справочники (типы решений, процессы, параметры, нормативы) синхронизируются
   * всё равно — они маленькие и нужны продуктам. Slug из списка, которого нет в данных
   * организатора, считается пропавшим продуктом и уходит в архив. Пустой список — продукты
   * не синхронизируются вовсе.
   */
  only?: readonly string[];
  /** Момент, от которого считается возраст источников; по умолчанию — сейчас. */
  now?: Date;
};

/** Счётчик записей справочника: сколько строк создано и сколько изменено. */
export type SyncCounts = { created: number; updated: number };

/** Отчёт синхронизации — его печатает сев и показывает страница администратора. */
export type SyncReport = {
  solutionTypes: SyncCounts;
  processes: SyncCounts;
  /** Связи «тип объекта — процесс» (FacilityTypeProcess). */
  links: SyncCounts;
  paramDefs: SyncCounts & { skippedAdmin: number };
  norms: SyncCounts & { skippedAdmin: number };
  products: SyncCounts & {
    /** Продукты с правкой администратора (и продукты администратора с тем же slug). */
    skippedAdmin: number;
    /** Ушли в архив в этом прогоне: их больше нет в данных организатора. */
    archived: number;
    /** Не записаны из-за ошибки (текст — в warnings). */
    failed: number;
  };
  /** Изменения связей «продукт — процесс» (ProductProcess). */
  productLinks: { created: number; deleted: number };
  characteristics: {
    /** Созданные и изменённые строки (неизменные не считаются). */
    upserted: number;
    /** Строки с origin 'admin', которые синхронизация оставила как есть. */
    skippedAdmin: number;
    deleted: number;
    /** Отклонены при записи: ключ вне словаря ТЗ или дата не в формате ГГГГ-ММ-ДД. */
    rejected: number;
  };
  /** Характеристик действующих продуктов с датой проверки старше STALE_SOURCE_DAYS дней. */
  staleSources: number;
  /** Версия данных выпуска (DataRelease.version, она же CatalogProduct.dataVersion). */
  dataVersion: string;
  /** Выпуск с этой версией записан в этом прогоне (false — он уже был). */
  releaseCreated: boolean;
  /** Предупреждения по-русски: пропущенные связи, отклонённые строки, ошибки продуктов. */
  warnings: string[];
};

/**
 * Возраст источника, после которого он считается устаревшим, дней. Тот же порог, что
 * у проверки цитат прежней модели (DEFAULT_MAX_AGE_DAYS в lib/sources/registry.ts, 180 дней —
 * «срок, за который спека успевает пережить смену ревизии»); отдельная константа, чтобы новый
 * слой не зависел от модулей v1.
 */
export const STALE_SOURCE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyReport(dataVersion: string): SyncReport {
  return {
    solutionTypes: { created: 0, updated: 0 },
    processes: { created: 0, updated: 0 },
    links: { created: 0, updated: 0 },
    paramDefs: { created: 0, updated: 0, skippedAdmin: 0 },
    norms: { created: 0, updated: 0, skippedAdmin: 0 },
    products: { created: 0, updated: 0, skippedAdmin: 0, archived: 0, failed: 0 },
    productLinks: { created: 0, deleted: 0 },
    characteristics: { upserted: 0, skippedAdmin: 0, deleted: 0, rejected: 0 },
    staleSources: 0,
    dataVersion,
    releaseCreated: false,
    warnings: [],
  };
}

/**
 * Сколько записей синхронизация изменила: созданные, обновлённые, удалённые и ушедшие
 * в архив строки всех таблиц, плюс новый выпуск данных. 0 — прогон ничего не менял (так
 * должен выглядеть повторный сев на тех же данных).
 */
export function changedTotal(r: SyncReport): number {
  return (
    r.solutionTypes.created +
    r.solutionTypes.updated +
    r.processes.created +
    r.processes.updated +
    r.links.created +
    r.links.updated +
    r.paramDefs.created +
    r.paramDefs.updated +
    r.norms.created +
    r.norms.updated +
    r.products.created +
    r.products.updated +
    r.products.archived +
    r.productLinks.created +
    r.productLinks.deleted +
    r.characteristics.upserted +
    r.characteristics.deleted +
    (r.releaseCreated ? 1 : 0)
  );
}

/** Отчёт по-русски, по строке на таблицу, — для сева и страницы администратора. */
export function formatSyncReport(r: SyncReport): string[] {
  const admin = (n: number) => `пропущено (правки администратора) ${n}`;
  const lines = [
    `Выпуск данных ${r.dataVersion}: ${r.releaseCreated ? "записан новый" : "уже был записан"}`,
    `Типы решений: создано ${r.solutionTypes.created}, обновлено ${r.solutionTypes.updated}`,
    `Процессы: создано ${r.processes.created}, обновлено ${r.processes.updated}`,
    `Связи «тип объекта — процесс»: создано ${r.links.created}, обновлено ${r.links.updated}`,
    `Параметры объектов: создано ${r.paramDefs.created}, обновлено ${r.paramDefs.updated}, ` +
      admin(r.paramDefs.skippedAdmin),
    `Нормативы: создано ${r.norms.created}, обновлено ${r.norms.updated}, ${admin(r.norms.skippedAdmin)}`,
    `Продукты: создано ${r.products.created}, обновлено ${r.products.updated}, ` +
      `${admin(r.products.skippedAdmin)}, в архив ${r.products.archived}` +
      (r.products.failed > 0 ? `, НЕ ЗАПИСАНО ${r.products.failed}` : ""),
    `Связи «продукт — процесс»: создано ${r.productLinks.created}, удалено ${r.productLinks.deleted}`,
    `Характеристики: записано ${r.characteristics.upserted}, ${admin(r.characteristics.skippedAdmin)}, ` +
      `удалено ${r.characteristics.deleted}, отклонено ${r.characteristics.rejected}`,
    `Устаревших источников (> ${STALE_SOURCE_DAYS} дней): ${r.staleSources}`,
  ];
  for (const w of r.warnings) lines.push(`Предупреждение: ${w}`);
  return lines;
}

// ——————————————————————————— Версия выпуска ———————————————————————————

/**
 * Версия выпуска данных организатора: хэш версий исходных выгрузок и ПОЛНОГО содержимого
 * того, что синхронизация переносит в БД (нормативы, параметры, процессы, типы решений,
 * продукты с характеристиками). Одинаковые данные — одна версия, поэтому повторный сев
 * выпуск не плодит; любая правка генератора или decisions.ts — новая версия, даже если
 * версии оригиналов организатора не изменились.
 */
export function organizerReleaseVersion(): string {
  return dataVersionOf({
    organizer: ORGANIZER_DATA_VERSION,
    norms: NORM_DEFS,
    params: PARAM_SPECS,
    processes: PROCESS_DEFS,
    solutionTypes: SOLUTION_TYPE_DEFS,
    catalog: CATALOG,
  });
}

/** Состав выпуска для DataRelease.organizerVersion: версии выгрузок и число записей. */
function releaseManifest(): Prisma.InputJsonObject {
  return {
    ...ORGANIZER_DATA_VERSION,
    products: CATALOG.length,
    productsByLevel: { ...CATALOG_COUNTS },
    params: PARAM_SPECS.length,
    norms: NORM_DEFS.length,
    processes: PROCESS_DEFS.length,
    solutionTypes: SOLUTION_TYPE_DEFS.length,
  };
}

// ——————————————————————————— Сравнение значений ———————————————————————————

/** Приводит значение к сравнимому виду: DbNull/JsonNull/undefined → null, дата → ISO. */
function comparable(v: unknown): unknown {
  if (v === undefined || v === Prisma.DbNull || v === Prisma.JsonNull) return null;
  if (v instanceof Date) return { $date: v.toISOString() };
  return v;
}

/**
 * Совпадает ли желаемое значение с тем, что в БД. Канонический JSON: порядок ключей в JSON-
 * колонке (jsonb его не хранит) на результат не влияет, массивы сравниваются поэлементно.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(comparable(a)) === stableJson(comparable(b));
}

/** Поля `desired`, значение которых отличается от строки БД. */
function diffKeys(existing: object, desired: object): string[] {
  const row = existing as Record<string, unknown>;
  return Object.entries(desired)
    .filter(([key, value]) => !sameValue(row[key], value))
    .map(([key]) => key);
}

/** Только изменившиеся поля — данные для update; пустой объект — обновлять нечего. */
function changedData<T extends object>(existing: object, desired: T): Partial<T> {
  const keys = new Set(diffKeys(existing, desired));
  return Object.fromEntries(Object.entries(desired).filter(([key]) => keys.has(key))) as Partial<T>;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ——————————————————————————— Справочники ———————————————————————————

async function syncSolutionTypes(db: Db, report: SyncReport): Promise<void> {
  const existing = new Map((await db.solutionType.findMany()).map((r) => [r.slug, r]));
  for (const def of SOLUTION_TYPE_DEFS) {
    const desired = { name: def.name, purpose: def.purpose, handlingClass: def.handlingClass, mobile: def.mobile };
    const row = existing.get(def.slug);
    if (!row) {
      await db.solutionType.create({ data: { slug: def.slug, ...desired } });
      report.solutionTypes.created++;
      continue;
    }
    const data = changedData(row, desired);
    if (Object.keys(data).length === 0) continue;
    await db.solutionType.update({ where: { id: row.id }, data });
    report.solutionTypes.updated++;
  }
}

async function syncProcesses(db: Db, report: SyncReport): Promise<void> {
  const existing = new Map((await db.process.findMany()).map((r) => [r.slug, r]));
  for (const def of PROCESS_DEFS) {
    const desired = {
      name: def.name,
      description: def.description,
      demandUnit: def.demandUnit,
      demandFormula: def.demandFormula,
      throughputUnit: def.throughputUnit,
      calcSupported: def.calcSupported,
      simSupported: def.simSupported,
      order: def.order,
    };
    const row = existing.get(def.slug);
    if (!row) {
      await db.process.create({ data: { slug: def.slug, ...desired } });
      report.processes.created++;
      continue;
    }
    const data = changedData(row, desired);
    if (Object.keys(data).length === 0) continue;
    await db.process.update({ where: { id: row.id }, data });
    report.processes.updated++;
  }
}

/** Типы объектов из БД по slug (заводит v1-сев таксономии). */
async function facilityIds(db: Db, slugs: readonly string[]): Promise<Map<string, string>> {
  const rows = await db.facilityType.findMany({ where: { slug: { in: [...new Set(slugs)] } }, select: { id: true, slug: true } });
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/**
 * Связи «тип объекта — процесс»: порядок — Process.order. Лишние связи в БД (например,
 * заведённые тестом или администратором) не удаляются — синхронизация добавляет и
 * исправляет, но не чистит чужое.
 */
async function syncFacilityProcessLinks(db: Db, report: SyncReport): Promise<void> {
  const facilities = await facilityIds(
    db,
    PROCESS_DEFS.flatMap((p) => p.facilityTypes),
  );
  const processes = new Map(
    (await db.process.findMany({ where: { slug: { in: PROCESS_DEFS.map((p) => p.slug) } }, select: { id: true, slug: true } })).map(
      (r) => [r.slug, r.id],
    ),
  );
  const existing = new Map(
    (await db.facilityTypeProcess.findMany({ where: { processId: { in: [...processes.values()] } } })).map((r) => [
      `${r.facilityTypeId}/${r.processId}`,
      r,
    ]),
  );
  const missing = new Set<string>();
  for (const def of PROCESS_DEFS) {
    const processId = processes.get(def.slug);
    if (!processId) continue; // Недостижимо: процессы записаны шагом выше.
    for (const facility of def.facilityTypes) {
      const facilityTypeId = facilities.get(facility);
      if (!facilityTypeId) {
        missing.add(facility);
        continue;
      }
      const row = existing.get(`${facilityTypeId}/${processId}`);
      if (!row) {
        await db.facilityTypeProcess.create({ data: { facilityTypeId, processId, order: def.order } });
        report.links.created++;
      } else if (row.order !== def.order) {
        await db.facilityTypeProcess.update({
          where: { facilityTypeId_processId: { facilityTypeId, processId } },
          data: { order: def.order },
        });
        report.links.updated++;
      }
    }
  }
  for (const facility of missing) {
    report.warnings.push(
      `тип объекта «${facility}» не найден в БД — его процессы к нему не привязаны (сначала нужен сев таксономии v1)`,
    );
  }
}

/** Описания параметров объектов (ParamDefinition) по (тип объекта, ключ). */
async function syncParamDefinitions(db: Db, report: SyncReport, respect: boolean): Promise<void> {
  const facilities = await facilityIds(
    db,
    PARAM_SPECS.map((s) => s.facility),
  );
  const existing = new Map(
    (await db.paramDefinition.findMany({ where: { facilityTypeId: { in: [...facilities.values()] } } })).map((r) => [
      `${r.facilityTypeId}/${r.key}`,
      r,
    ]),
  );
  const missing = new Set<string>();
  for (const spec of PARAM_SPECS) {
    const facilityTypeId = facilities.get(spec.facility);
    if (!facilityTypeId) {
      missing.add(spec.facility);
      continue;
    }
    const desired = {
      section: spec.section,
      label: spec.label,
      unit: spec.unit,
      kind: spec.kind,
      options: [...spec.options],
      baseNum: typeof spec.base === "number" ? spec.base : null,
      baseText: typeof spec.base === "string" ? spec.base : null,
      min: spec.min,
      max: spec.max,
      locked: spec.locked,
      required: spec.required,
      tzMinimum: spec.tzMinimum,
      usedBy: [...spec.usedBy],
      hint: spec.hint,
      example: spec.example,
      organizerNote: spec.organizerNote,
      origin: spec.origin,
      sourceRef: spec.sourceRef,
      sourceUrl: spec.sourceUrl,
      basis: spec.basis,
      formula: spec.formula,
      order: spec.order,
      editedByAdmin: false,
    };
    const row = existing.get(`${facilityTypeId}/${spec.key}`);
    if (!row) {
      await db.paramDefinition.create({ data: { facilityTypeId, key: spec.key, ...desired } });
      report.paramDefs.created++;
      continue;
    }
    if (row.editedByAdmin && respect) {
      report.paramDefs.skippedAdmin++;
      continue;
    }
    const data = changedData(row, desired);
    if (Object.keys(data).length === 0) continue;
    await db.paramDefinition.update({ where: { id: row.id }, data });
    report.paramDefs.updated++;
  }
  for (const facility of missing) {
    report.warnings.push(`тип объекта «${facility}» не найден в БД — его параметры не записаны`);
  }
}

/**
 * Нормативы: метаданные — всегда (подпись, границы и основание принадлежат коду), значение —
 * только у строк без правки администратора. Лишние ключи в БД не удаляются: `resolveNorms`
 * их не читает, а администратор их видит (getNormRows).
 */
async function syncNorms(db: Db, report: SyncReport, respect: boolean): Promise<void> {
  const existing = new Map((await db.norm.findMany()).map((r) => [r.key, r]));
  for (const def of NORM_DEFS as readonly NormDef[]) {
    const meta = {
      label: def.label,
      min: def.min,
      max: def.max,
      unit: def.unit,
      origin: def.origin,
      basis: def.basis,
      sourceRef: def.sourceRef ?? null,
      sourceUrl: def.sourceUrl ?? null,
      group: def.group,
      order: def.order,
    };
    const row = existing.get(def.key);
    if (!row) {
      await db.norm.create({ data: { key: def.key, value: def.value, ...meta } });
      report.norms.created++;
      continue;
    }
    const keepValue = row.editedByAdmin && respect;
    if (keepValue) report.norms.skippedAdmin++;
    const desired = keepValue ? meta : { ...meta, value: def.value, editedByAdmin: false };
    const data = changedData(row, desired);
    if (Object.keys(data).length === 0) continue;
    await db.norm.update({ where: { key: def.key }, data });
    report.norms.updated++;
  }
}

// ——————————————————————————— Продукты ———————————————————————————

/** Параметры записи продуктов. */
export type SyncProductsOptions = {
  respectAdminEdits: boolean;
  /** Версия данных, которая пишется в CatalogProduct.dataVersion. */
  dataVersion: string;
};

/** Итог записи продуктов — часть `SyncReport`. */
export type SyncProductsReport = Pick<SyncReport, "productLinks" | "characteristics" | "warnings"> & {
  products: Omit<SyncReport["products"], "archived">;
};

/** Строка характеристики из БД → CharRow для пересчёта вынесенных колонок. */
function charRowFromDb(c: ProductCharacteristic): CharRow {
  return {
    key: c.key,
    valueNum: c.valueNum,
    valueMin: c.valueMin,
    valueMax: c.valueMax,
    qualifier: c.qualifier,
    valueText: c.valueText,
    valueList: c.valueList,
    unit: c.unit,
    scope: c.scope,
    origin: c.origin,
    sourceUrl: c.sourceUrl,
    sourceRef: c.sourceRef,
    verifiedAt: isoDate(c.verifiedAt),
    confirmed: c.confirmed,
    alternatives: c.alternatives,
  };
}

/** Поля продукта из данных организатора (без вынесенных колонок). */
function productFields(seed: ProductSeed, solutionTypeId: string | null, dataVersion: string) {
  return {
    organizerCatalogId: seed.organizerCatalogId,
    organizerRows: [...seed.organizerRows],
    level: seed.level,
    name: seed.name,
    manufacturer: seed.manufacturer,
    country: seed.country,
    solutionTypeId,
    status: seed.status,
    facilityTypeSlugs: [...seed.facilityTypes],
    industries: [...seed.industries],
    description: seed.description,
    flags: [...seed.flags],
    excluded: seed.excludedReason !== null,
    excludedReason: seed.excludedReason,
    origin: "ORGANIZER" as const,
    editedByAdmin: false,
    // Продукт, вернувшийся в данные организатора, выходит из архива.
    archived: false,
    dataVersion,
  };
}

/** Характеристики продукта из данных в форме записи; ошибочные строки — в `rejected`. */
function seedCharacteristics(seed: ProductSeed): {
  rows: { row: CharRow; data: Prisma.ProductCharacteristicCreateWithoutProductInput }[];
  rejected: { key: string; message: string }[];
} {
  const rows: { row: CharRow; data: Prisma.ProductCharacteristicCreateWithoutProductInput }[] = [];
  const rejected: { key: string; message: string }[] = [];
  for (const [key, sourced] of Object.entries(seed.characteristics)) {
    try {
      const full = sourcedToCharRow(key, sourced);
      rows.push({ row: full, data: toCharacteristicData(full) });
    } catch (e) {
      rejected.push({ key, message: errorText(e) });
    }
  }
  return { rows, rejected };
}

/**
 * Освобождает id каталога организатора, если его держит продукт с другим slug (генератор
 * переименовал продукт): иначе запись упадёт на уникальности organizerCatalogId. Старая строка
 * остаётся и, раз её slug пропал из данных, уходит в архив шагом архивации.
 */
async function releaseOrganizerId(tx: Db, seed: ProductSeed, warnings: string[]): Promise<void> {
  if (seed.organizerCatalogId === null) return;
  const holder = await tx.catalogProduct.findUnique({
    where: { organizerCatalogId: seed.organizerCatalogId },
    select: { id: true, slug: true },
  });
  if (!holder || holder.slug === seed.slug) return;
  await tx.catalogProduct.update({ where: { id: holder.id }, data: { organizerCatalogId: null } });
  warnings.push(
    `id каталога организатора ${seed.organizerCatalogId} перешёл от «${holder.slug}» к «${seed.slug}»`,
  );
}

type ProductRefs = {
  solutionTypes: ReadonlyMap<string, string>;
  processes: ReadonlyMap<string, string>;
};

/** Итог записи одного продукта; складывается в отчёт только после успешной транзакции. */
type ProductOutcome = {
  product: "created" | "updated" | "unchanged";
  /**
   * Правка администратора сохранена (поля продукта и его процессы не переписаны) или под
   * этим slug продукт администратора. Считается отдельно от «обновлено»: у правленого
   * продукта синхронизация всё равно обновляет поля связи с данными и вынесенные колонки.
   */
  skippedAdmin: boolean;
  linksCreated: number;
  linksDeleted: number;
  charsUpserted: number;
  charsSkippedAdmin: number;
  charsDeleted: number;
  charsRejected: number;
  warnings: string[];
};

/** Записывает один продукт организатора (вызывается внутри транзакции). */
async function syncOneProduct(
  tx: Db,
  seed: ProductSeed,
  refs: ProductRefs,
  opts: SyncProductsOptions,
): Promise<ProductOutcome> {
  const out: ProductOutcome = {
    product: "unchanged",
    skippedAdmin: false,
    linksCreated: 0,
    linksDeleted: 0,
    charsUpserted: 0,
    charsSkippedAdmin: 0,
    charsDeleted: 0,
    charsRejected: 0,
    warnings: [],
  };
  const solutionTypeId = refs.solutionTypes.get(seed.solutionType) ?? null;
  if (solutionTypeId === null) {
    out.warnings.push(`«${seed.slug}»: тип решения «${seed.solutionType}» не найден — продукт записан без типа`);
  }
  const processIds: string[] = [];
  for (const slug of new Set(seed.processes)) {
    const id = refs.processes.get(slug);
    if (id) processIds.push(id);
    else out.warnings.push(`«${seed.slug}»: процесс «${slug}» не найден — связь не записана`);
  }
  const chars = seedCharacteristics(seed);
  out.charsRejected = chars.rejected.length;
  for (const r of chars.rejected) out.warnings.push(`«${seed.slug}»: характеристика «${r.key}» отклонена — ${r.message}`);

  const existing = await tx.catalogProduct.findUnique({
    where: { slug: seed.slug },
    include: { processes: { select: { processId: true } }, characteristics: true },
  });
  const fields = productFields(seed, solutionTypeId, opts.dataVersion);

  // ——— Новый продукт ———
  if (!existing) {
    await releaseOrganizerId(tx, seed, out.warnings);
    await tx.catalogProduct.create({
      data: {
        slug: seed.slug,
        ...fields,
        ...promoteColumns(
          chars.rows.map((c) => c.row),
          { flags: seed.flags },
        ),
        processes: { create: processIds.map((processId) => ({ processId })) },
        characteristics: { create: chars.rows.map((c) => c.data) },
      },
    });
    out.product = "created";
    out.linksCreated = processIds.length;
    out.charsUpserted = chars.rows.length;
    return out;
  }

  // ——— Продукт администратора с тем же slug: не наш, не трогаем ———
  if (existing.origin === "ADMIN") {
    out.skippedAdmin = true;
    out.warnings.push(
      `«${seed.slug}»: под этим slug уже есть продукт, заведённый администратором, — данные организатора не записаны`,
    );
    return out;
  }

  const keepAdmin = existing.editedByAdmin && opts.respectAdminEdits;
  out.skippedAdmin = keepAdmin;
  if (existing.organizerCatalogId !== seed.organizerCatalogId) await releaseOrganizerId(tx, seed, out.warnings);

  // ——— Характеристики ———
  const current = new Map(existing.characteristics.map((c) => [c.key, c]));
  /** Итоговый набор характеристик после записи — из него считаются вынесенные колонки. */
  const final = new Map<string, CharRow>(existing.characteristics.map((c) => [c.key, charRowFromDb(c)]));
  const toCreate: Prisma.ProductCharacteristicCreateManyInput[] = [];
  for (const { row, data } of chars.rows) {
    const old = current.get(row.key);
    if (old && old.origin === "admin" && opts.respectAdminEdits) {
      out.charsSkippedAdmin++;
      continue;
    }
    final.set(row.key, row);
    if (!old) {
      toCreate.push({ ...data, productId: existing.id });
      continue;
    }
    const changed = changedData(old, data);
    if (Object.keys(changed).length === 0) continue;
    await tx.productCharacteristic.update({ where: { id: old.id }, data: changed });
    out.charsUpserted++;
  }
  if (toCreate.length > 0) {
    await tx.productCharacteristic.createMany({ data: toCreate });
    out.charsUpserted += toCreate.length;
  }
  // Ключи, которые есть в данных, но отклонены, не удаляются: старое значение остаётся
  // до исправления данных, а предупреждение уже в отчёте.
  const seedKeys = new Set(Object.keys(seed.characteristics));
  const vanished = existing.characteristics.filter((c) => c.origin !== "admin" && !seedKeys.has(c.key));
  if (vanished.length > 0) {
    await tx.productCharacteristic.deleteMany({ where: { id: { in: vanished.map((c) => c.id) } } });
    for (const c of vanished) final.delete(c.key);
    out.charsDeleted = vanished.length;
  }

  // ——— Процессы продукта ———
  let linksChanged = false;
  if (!keepAdmin) {
    const want = new Set(processIds);
    const have = new Set(existing.processes.map((p) => p.processId));
    const drop = [...have].filter((id) => !want.has(id));
    const add = [...want].filter((id) => !have.has(id));
    if (drop.length > 0) {
      await tx.productProcess.deleteMany({ where: { productId: existing.id, processId: { in: drop } } });
    }
    if (add.length > 0) {
      await tx.productProcess.createMany({ data: add.map((processId) => ({ productId: existing.id, processId })) });
    }
    out.linksCreated = add.length;
    out.linksDeleted = drop.length;
    linksChanged = add.length + drop.length > 0;
  }

  // ——— Поля продукта и вынесенные колонки ———
  const base = keepAdmin
    ? {
        organizerCatalogId: fields.organizerCatalogId,
        organizerRows: fields.organizerRows,
        dataVersion: fields.dataVersion,
      }
    : fields;
  const flags = keepAdmin ? existing.flags : fields.flags;
  const desired = { ...base, ...promoteColumns([...final.values()], { flags }) };
  const data = changedData(existing, desired);
  if (Object.keys(data).length > 0) {
    await tx.catalogProduct.update({ where: { id: existing.id }, data });
  }
  if (Object.keys(data).length > 0 || linksChanged) out.product = "updated";
  return out;
}

/** Есть ли у клиента собственные транзакции (обычный клиент, а не транзакционный). */
function hasTransactions(db: Db): db is PrismaClient {
  return typeof (db as { $transaction?: unknown }).$transaction === "function";
}

/**
 * Записывает продукты из данных (ProductSeed) — каждый в своей транзакции, если клиент это
 * позволяет. Ошибка одного продукта не останавливает остальные: она попадает в отчёт
 * (products.failed и warnings), а продукт остаётся в прежнем состоянии. Экспортируется для
 * импорта каталога через API (T3.5) — те же правила, что у синхронизации.
 */
export async function syncProducts(
  db: Db,
  seeds: readonly ProductSeed[],
  opts: SyncProductsOptions,
): Promise<SyncProductsReport> {
  const report: SyncProductsReport = {
    products: { created: 0, updated: 0, skippedAdmin: 0, failed: 0 },
    productLinks: { created: 0, deleted: 0 },
    characteristics: { upserted: 0, skippedAdmin: 0, deleted: 0, rejected: 0 },
    warnings: [],
  };
  if (seeds.length === 0) return report;
  const refs: ProductRefs = {
    solutionTypes: new Map((await db.solutionType.findMany({ select: { id: true, slug: true } })).map((r) => [r.slug, r.id])),
    processes: new Map((await db.process.findMany({ select: { id: true, slug: true } })).map((r) => [r.slug, r.id])),
  };
  for (const seed of seeds) {
    let outcome: ProductOutcome;
    if (hasTransactions(db)) {
      try {
        // Тайм-аут с запасом: продукт — до сорока характеристик, но база может быть занята
        // параллельными запросами; умолчание Prisma (5 с) на первом севе впритык.
        outcome = await db.$transaction((tx) => syncOneProduct(tx, seed, refs, opts), {
          maxWait: 10_000,
          timeout: 60_000,
        });
      } catch (e) {
        report.products.failed++;
        report.warnings.push(`«${seed.slug}»: продукт не записан — ${errorText(e)}`);
        continue;
      }
    } else {
      outcome = await syncOneProduct(db, seed, refs, opts);
    }
    if (outcome.product !== "unchanged") report.products[outcome.product]++;
    if (outcome.skippedAdmin) report.products.skippedAdmin++;
    report.productLinks.created += outcome.linksCreated;
    report.productLinks.deleted += outcome.linksDeleted;
    report.characteristics.upserted += outcome.charsUpserted;
    report.characteristics.skippedAdmin += outcome.charsSkippedAdmin;
    report.characteristics.deleted += outcome.charsDeleted;
    report.characteristics.rejected += outcome.charsRejected;
    report.warnings.push(...outcome.warnings);
  }
  return report;
}

/**
 * Архивирует продукты организатора, которых больше нет в данных. Кандидат — строка
 * с origin ORGANIZER, которую синхронизация хоть раз записала (dataVersion не пуст): так
 * строки, заведённые мимо синхронизации (тестовые данные, ручные вставки), не архивируются
 * по ошибке. Продукт с правкой администратора при respectAdminEdits остаётся как есть:
 * администратор мог вернуть его из архива сознательно.
 */
async function archiveVanished(
  db: Db,
  report: SyncReport,
  respect: boolean,
  only: readonly string[] | undefined,
): Promise<void> {
  const present = CATALOG.map((p) => p.slug);
  const presentSet = new Set(present);
  const slugFilter = only ? { in: only.filter((s) => !presentSet.has(s)) } : { notIn: present };
  const where: Prisma.CatalogProductWhereInput = {
    origin: "ORGANIZER",
    archived: false,
    dataVersion: { not: "" },
    slug: slugFilter,
    ...(respect ? { editedByAdmin: false } : {}),
  };
  const gone = await db.catalogProduct.findMany({ where, select: { slug: true }, orderBy: { slug: "asc" } });
  if (gone.length === 0) return;
  const res = await db.catalogProduct.updateMany({ where, data: { archived: true } });
  report.products.archived += res.count;
  report.warnings.push(
    `в архив (нет в данных организатора): ${gone.map((g) => g.slug).join(", ")}`,
  );
}

/**
 * Записывает выпуск данных, если выпуска с этой версией ещё нет. skipDuplicates — вставка
 * «если нет» одним запросом: два одновременных прогона (сев и кнопка администратора) не
 * падают на уникальности версии, а момент первого сева выпуска (seededAt) не переписывается.
 */
async function upsertRelease(db: Db, report: SyncReport): Promise<void> {
  const res = await db.dataRelease.createMany({
    data: [
      {
        version: report.dataVersion,
        organizerVersion: releaseManifest(),
        note:
          `Данные организатора: датасеты ${ORGANIZER_DATA_VERSION.datasets}, каталог ${ORGANIZER_DATA_VERSION.catalog}, ` +
          `«Примеры решений» ${ORGANIZER_DATA_VERSION.examples}; открытые источники: ${ORGANIZER_DATA_VERSION.research}`,
      },
    ],
    skipDuplicates: true,
  });
  report.releaseCreated = res.count > 0;
}

/** Характеристики действующих продуктов с датой проверки старше STALE_SOURCE_DAYS. */
async function countStaleSources(db: Db, now: Date): Promise<number> {
  return db.productCharacteristic.count({
    where: {
      verifiedAt: { lt: new Date(now.getTime() - STALE_SOURCE_DAYS * DAY_MS) },
      product: { archived: false },
    },
  });
}

// ——————————————————————————— Точка входа ———————————————————————————

/**
 * Синхронизирует данные организатора в БД (см. комментарий к модулю) и возвращает отчёт.
 * Порядок шагов важен: продуктам нужны типы решений и процессы, архивации — полный список
 * продуктов данных, а выпуск пишется последним, когда всё остальное уже записано.
 */
export async function syncOrganizerData(db: Db, opts: SyncOptions = {}): Promise<SyncReport> {
  const respect = opts.respectAdminEdits ?? true;
  const report = emptyReport(organizerReleaseVersion());

  await syncSolutionTypes(db, report);
  await syncProcesses(db, report);
  await syncFacilityProcessLinks(db, report);
  await syncParamDefinitions(db, report, respect);
  await syncNorms(db, report, respect);

  const only = opts.only ? new Set(opts.only) : null;
  const seeds = only ? CATALOG.filter((p) => only.has(p.slug)) : CATALOG;
  const products = await syncProducts(db, seeds, { respectAdminEdits: respect, dataVersion: report.dataVersion });
  report.products = { ...products.products, archived: 0 };
  report.productLinks = products.productLinks;
  report.characteristics = products.characteristics;
  report.warnings.push(...products.warnings);

  await archiveVanished(db, report, respect, opts.only);
  await upsertRelease(db, report);
  report.staleSources = await countStaleSources(db, opts.now ?? new Date());
  return report;
}
