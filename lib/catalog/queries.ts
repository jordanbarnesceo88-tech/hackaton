import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { CHAR_GROUP_LABELS } from "../tz/characteristics";
import type { CharGroup } from "../tz/characteristics";
import { NORM_DEFS, resolveNorms } from "../tz/norms";
import type { NormValues } from "../tz/norms";
import { processDef } from "../tz/processes";
import type { ProcessDef } from "../tz/processes";
import type { Origin, ParamKind, ParamSpec, ProductFlag, ProductForCalc, ProductLevel, ProductStatus } from "../tz/types";
import {
  asFlags,
  asHandlingClass,
  asLevel,
  asOrigin,
  asStatus,
  charLabel,
  compareCharKeys,
  compareProcessSlugs,
  formatCharValue,
  fromCharacteristics,
  isoDate,
  sortProcessSlugs,
} from "./product-for-calc";
import type { CharRow, CharRowFull } from "./product-for-calc";
import { hasConflictingAlternatives } from "./promote";

/**
 * Доступ к данным модели tz-1.0.0 в БД: параметры объекта, нормативы, процессы, продукты для
 * расчёта и каталог (ТЗ §3.2, §3.3, §3.5).
 *
 * Каждая функция принимает клиент БД первым аргументом, а не импортирует общий клиент
 * приложения (lib/db): сев (scripts/seed.ts) создаёт собственный PrismaClient, а синхронизация
 * и действия администратора вызывают эти запросы внутри транзакции. Импорты — только
 * относительные, чтобы модуль работал и под tsx без алиаса «@/».
 */

/** Клиент БД: обычный или транзакционный (внутри `$transaction`). */
export type Db = PrismaClient | Prisma.TransactionClient;

// ——————————————————————————— Параметры объекта ———————————————————————————

const PARAM_KINDS: ReadonlySet<string> = new Set<ParamKind>(["number", "integer", "percent", "enum", "text", "dims"]);

/**
 * Вид поля из строки БД. Неизвестный вид считается текстом: форма примет значение как есть
 * и не станет молча приводить его к числу.
 */
function asParamKind(value: string): ParamKind {
  return PARAM_KINDS.has(value) ? (value as ParamKind) : "text";
}

/**
 * Описания параметров типа объекта (ТЗ §3.2) из администрируемой таблицы ParamDefinition
 * в порядке показа. По ним строятся форма ввода, шаблон файла и проверки загрузки (§3.2.4).
 * Неизвестный тип объекта — пустой список.
 */
export async function getParamDefinitions(db: Db, facilitySlug: string): Promise<ParamSpec[]> {
  const rows = await db.paramDefinition.findMany({
    where: { facilityType: { slug: facilitySlug } },
    orderBy: [{ order: "asc" }, { key: "asc" }],
  });
  return rows.map((r) => ({
    key: r.key,
    facility: facilitySlug,
    section: r.section,
    label: r.label,
    unit: r.unit,
    kind: asParamKind(r.kind),
    options: [...r.options],
    base: r.baseNum ?? r.baseText ?? null,
    min: r.min,
    max: r.max,
    locked: r.locked,
    required: r.required,
    tzMinimum: r.tzMinimum,
    usedBy: [...r.usedBy],
    hint: r.hint,
    example: r.example,
    organizerNote: r.organizerNote,
    origin: asOrigin(r.origin),
    sourceRef: r.sourceRef,
    sourceUrl: r.sourceUrl,
    basis: r.basis,
    formula: r.formula,
    order: r.order,
  }));
}

// ——————————————————————————— Нормативы ———————————————————————————

/** Строка таблицы Norm с метаданными — для страниц «Нормативы», методики и API. */
export type NormRow = {
  key: string;
  value: number;
  label: string;
  unit: string | null;
  origin: Origin;
  basis: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  min: number | null;
  max: number | null;
  group: string;
  order: number;
  editedByAdmin: boolean;
  updatedAt: Date;
};

const NORM_ORDER: ReadonlyMap<string, number> = new Map(NORM_DEFS.map((d, i) => [d.key, i]));

/**
 * Нормативы из БД в порядке NORM_DEFS; строки с ключами, которых нет в коде (устаревшие),
 * идут в конце по алфавиту — они видны администратору, но расчёт их не читает.
 */
export async function getNormRows(db: Db): Promise<NormRow[]> {
  const rows = await db.norm.findMany();
  return rows
    .map((r) => ({
      key: r.key,
      value: r.value,
      label: r.label,
      unit: r.unit,
      origin: asOrigin(r.origin),
      basis: r.basis,
      sourceUrl: r.sourceUrl,
      sourceRef: r.sourceRef,
      min: r.min,
      max: r.max,
      group: r.group,
      order: r.order,
      editedByAdmin: r.editedByAdmin,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => {
      const ia = NORM_ORDER.get(a.key) ?? Number.MAX_SAFE_INTEGER;
      const ib = NORM_ORDER.get(b.key) ?? Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

/**
 * Итоговые нормативы расчёта: значения из кода, перекрытые строками БД (правки
 * администратора) в пределах [min, max] каждого норматива, с восстановленными взаимными
 * ограничениями — всё это делает `resolveNorms`; здесь нормативы не исправляются повторно.
 */
export async function getNorms(db: Db): Promise<NormValues> {
  const rows = await db.norm.findMany({ select: { key: true, value: true } });
  return resolveNorms(rows);
}

// ——————————————————————————— Процессы ———————————————————————————

/** Строка Process из БД в той форме, которую нужно слить с PROCESS_DEFS. */
export type ProcessRow = {
  slug: string;
  name: string;
  description: string;
  demandUnit: string;
  demandFormula: string;
  throughputUnit: string;
  calcSupported: boolean;
  simSupported: boolean;
};

/**
 * Процесс из БД, соединённый с определением в коде по slug.
 * - Модель спроса, единицы, параметры персонала и ограничений, типы решений — из кода
 *   (PROCESS_DEFS): движок и подбор написаны под них, и строка БД не может их подменить.
 * - Название и описание — из БД (то, что видит пользователь после синхронизации).
 * - calcSupported/simSupported — И кода, И БД: признак «реализовано» не может появиться у
 *   процесса, для которого в коде нет расчёта, а отключение в БД уважается.
 * - Процесс, которого нет в коде, возвращается без модели: спроса нет, расчёт и имитация
 *   не поддерживаются — страница покажет его на уровне подбора, но не посчитает.
 * `facilityTypes` — связи из БД, `order` — порядок процесса у запрошенного типа объекта.
 */
export function mergeProcessRow(row: ProcessRow, facilityTypes: readonly string[], order: number): ProcessDef {
  const def = processDef(row.slug);
  if (!def) {
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      facilityTypes: [...facilityTypes],
      order,
      demandUnit: row.demandUnit,
      throughputUnit: row.throughputUnit,
      demandFormula: row.demandFormula,
      demand: null,
      peakFactorParam: null,
      headcountParam: null,
      salaryParam: null,
      constraints: {},
      calcSupported: false,
      simSupported: false,
      solutionTypes: [],
    };
  }
  // Глубокая копия: результат уходит в снимок проекта и не должен ссылаться на PROCESS_DEFS.
  const copy = structuredClone(def);
  return {
    ...copy,
    name: row.name.trim() !== "" ? row.name : copy.name,
    description: row.description.trim() !== "" ? row.description : copy.description,
    facilityTypes: [...facilityTypes],
    order,
    calcSupported: copy.calcSupported && row.calcSupported,
    simSupported: copy.simSupported && row.simSupported,
  };
}

/**
 * Процессы типа объекта из БД (связи FacilityTypeProcess в их порядке), соединённые
 * с PROCESS_DEFS — см. `mergeProcessRow`. До синхронизации данных список пуст.
 */
export async function getProcessesFor(db: Db, facilitySlug: string): Promise<ProcessDef[]> {
  const links = await db.facilityTypeProcess.findMany({
    where: { facilityType: { slug: facilitySlug } },
    include: {
      process: { include: { facilityTypes: { select: { facilityType: { select: { slug: true } } } } } },
    },
    orderBy: [{ order: "asc" }, { process: { order: "asc" } }, { process: { slug: "asc" } }],
  });
  return links.map((link) =>
    mergeProcessRow(
      link.process,
      link.process.facilityTypes.map((l) => l.facilityType.slug).sort(),
      link.order,
    ),
  );
}

// ——————————————————————————— Продукты для расчёта ———————————————————————————

/** Характеристика из БД → строка для сборки снимка (дата — YYYY-MM-DD). */
function toCharRow(c: {
  key: string;
  valueNum: number | null;
  valueMin: number | null;
  valueMax: number | null;
  qualifier: string | null;
  valueText: string | null;
  valueList: string[];
  unit: string | null;
  scope: string | null;
  origin: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  verifiedAt: Date | null;
  confirmed: boolean;
  alternatives: Prisma.JsonValue | null;
}): CharRow {
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

/**
 * Характеристика в форме `CharRowFull` (её даёт `sourcedToCharRow`) → данные для записи
 * в ProductCharacteristic (create, update, а с productId — createMany). Преобразуются три поля:
 * - `verifiedAt` YYYY-MM-DD → полночь UTC этой даты (при чтении `isoDate` вернёт ту же строку);
 * - `alternatives: null` → `Prisma.DbNull` (nullable-колонка Json не принимает простой null),
 *   массив — как JSON;
 * - `group: null` (ключ вне словаря характеристик) — ошибка: колонка обязательная, и класть
 *   такую строку в случайную группу нельзя; вызывающий должен отклонить её и показать в отчёте.
 * Дата не в формате YYYY-MM-DD — тоже ошибка, а не тихий null: дата проверки — часть
 * провенанса (ТЗ §3.3.4), и терять её молча нельзя.
 */
export function toCharacteristicData(row: CharRowFull): Prisma.ProductCharacteristicCreateWithoutProductInput {
  if (row.group === null) {
    throw new Error(`Характеристика «${row.key}» не описана в словаре характеристик — группа ТЗ неизвестна`);
  }
  let verifiedAt: Date | null = null;
  if (row.verifiedAt !== null) {
    verifiedAt = new Date(`${row.verifiedAt}T00:00:00Z`);
    // Сверка в обе стороны отсекает и не-даты, и несуществующие даты (2026-02-30).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.verifiedAt) || isoDate(verifiedAt) !== row.verifiedAt) {
      throw new Error(`Характеристика «${row.key}»: дата проверки «${row.verifiedAt}» не в формате ГГГГ-ММ-ДД`);
    }
  }
  return {
    key: row.key,
    group: row.group,
    valueNum: row.valueNum,
    valueMin: row.valueMin,
    valueMax: row.valueMax,
    qualifier: row.qualifier,
    valueText: row.valueText,
    valueList: [...row.valueList],
    unit: row.unit,
    scope: row.scope,
    origin: row.origin,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceRef: row.sourceRef,
    verifiedAt,
    confirmed: row.confirmed,
    confidence: row.confidence,
    asInSource: row.asInSource,
    basis: row.basis,
    formula: row.formula,
    note: row.note,
    granularity: row.granularity,
    alternatives: row.alternatives === null ? Prisma.DbNull : (row.alternatives as Prisma.InputJsonValue),
  };
}

/** Slug'и процессов продукта — в общем порядке `sortProcessSlugs` (как в снимке из данных). */
function processSlugs(links: readonly { process: { slug: string } }[]): string[] {
  return sortProcessSlugs(links.map((l) => l.process.slug));
}

/**
 * Продукты, которые идут в подбор и расчёт для типа объекта: не в архиве, с глубиной
 * описания enriched или examples, связанные хотя бы с одним процессом этого объекта.
 * Исключённые продукты возвращаются тоже — подбор показывает их с причиной (ТЗ §3.4).
 * Полнота и доля подтверждённых берутся из вынесенных колонок, остальное — из характеристик.
 */
export async function getCalcProducts(db: Db, facilitySlug: string): Promise<ProductForCalc[]> {
  const rows = await db.catalogProduct.findMany({
    where: {
      archived: false,
      level: { in: ["enriched", "examples"] },
      processes: { some: { process: { facilityTypes: { some: { facilityType: { slug: facilitySlug } } } } } },
    },
    include: {
      solutionType: true,
      processes: { select: { process: { select: { slug: true } } } },
      characteristics: true,
    },
    orderBy: [{ name: "asc" }, { slug: "asc" }],
  });
  return rows.map((r) =>
    fromCharacteristics(
      {
        slug: r.slug,
        name: r.name,
        manufacturer: r.manufacturer,
        // Без типа решения продукт относится к «прочим»; мобильность — как умолчание колонки
        // SolutionType.mobile: мобильному роботу движок добавляет зарядки (осторожная сторона).
        solutionTypeSlug: r.solutionType?.slug ?? "other",
        handlingClass: asHandlingClass(r.solutionType?.handlingClass),
        mobile: r.solutionType?.mobile ?? true,
        status: asStatus(r.status),
        level: asLevel(r.level),
        flags: asFlags(r.flags),
        excluded: r.excluded,
        excludedReason: r.excludedReason,
        processes: processSlugs(r.processes),
        facilityTypes: r.facilityTypeSlugs,
        completenessPct: r.completenessPct,
        confirmedSharePct: r.confirmedSharePct,
      },
      r.characteristics.map(toCharRow),
    ),
  );
}

// ——————————————————————————— Каталог: список ———————————————————————————

/** Сортировка списка каталога (ТЗ §3.3.7). */
export type CatalogSort = "price" | "throughput" | "completeness" | "name";

/** Фильтры списка каталога; всё необязательно, страницы нумеруются с 1. */
export type CatalogFilters = {
  /** Поиск: все слова запроса в названии, производителе, описании или slug, без учёта регистра. */
  q?: string;
  /** Тип объекта (warehouse, airport, medical). */
  facility?: string;
  /** Slug процесса. */
  process?: string;
  /** Slug типа решения. */
  solutionType?: string;
  status?: string;
  /** Глубина описания: identification, enriched, examples. */
  level?: string;
  /**
   * «Только подтверждённые данные»: продукты, у которых хотя бы одна характеристика
   * подтверждена первоисточником (confirmedSharePct > 0, ТЗ §3.3.4 — признак подтверждения
   * у каждой характеристики). Это не «проверка не нужна» (needsVerification = false): на
   * данных организатора проверки требуют все продукты (почти у всех цена взята из каталога
   * организатора без подтверждения первоисточником), и такой фильтр давал бы пустой список.
   * Числа по текущей выгрузке — в CHANGELOG.md, запись T1.8.
   */
  confirmedOnly?: boolean;
  /** Только продукты с опубликованной ставкой RaaS. */
  raas?: boolean;
  sort?: CatalogSort;
  page?: number;
};

/** Строк на странице каталога. */
export const CATALOG_PAGE_SIZE = 50;

/** Строка списка каталога — вынесенные колонки продукта без характеристик. */
export type CatalogListItem = {
  slug: string;
  name: string;
  manufacturer: string | null;
  country: string | null;
  level: ProductLevel;
  status: ProductStatus;
  origin: "ORGANIZER" | "ADMIN";
  solutionType: { slug: string; name: string } | null;
  processes: { slug: string; name: string }[];
  facilityTypes: string[];
  description: string;
  priceRub: number | null;
  raasRubMonth: number | null;
  throughputPerH: number | null;
  throughputUnit: string | null;
  payloadKg: number | null;
  speedMps: number | null;
  completenessPct: number;
  confirmedSharePct: number;
  needsVerification: boolean;
  excluded: boolean;
  excludedReason: string | null;
  flags: ProductFlag[];
};

/** Результат списка: страница строк и общее число найденных. */
export type CatalogList = {
  items: CatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const STATUS_VALUES: ReadonlySet<string> = new Set<ProductStatus>(["operation", "piloting", "rnd"]);
const LEVEL_VALUES: ReadonlySet<string> = new Set<ProductLevel>(["identification", "enriched", "examples"]);
const MAX_QUERY_LENGTH = 100;

/**
 * Нормализация текста для поиска: строчные буквы по правилам русской локали и «ё» → «е»
 * («Самоходный» и «самоходный», «тягач» и «ТЯГАЧ», «ёмкость» и «емкость» совпадают).
 */
function foldForSearch(s: string): string {
  return s.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

/** Слова запроса после нормализации; пустой запрос — пустой список. */
function queryTokens(q: string | undefined): string[] {
  const text = foldForSearch((q ?? "").trim().slice(0, MAX_QUERY_LENGTH));
  return text.split(/\s+/).filter((t) => t !== "");
}

/**
 * id продуктов, в названии, производителе, описании или slug которых встречаются все слова
 * запроса (в любом поле и порядке: «Ronavi H1500» находит модель H1500 производителя Ronavi).
 *
 * Регистр сворачивается в JS, а не через ILIKE: в базе с локалью C (так развёрнута локальная
 * база) ILIKE и lower() сворачивают только латиницу, и «альфа» не находит «Альфа». Текстовые
 * поля остальных отфильтрованных продуктов читаются одним лёгким запросом — каталог
 * организатора это пара сотен строк, и поиск остаётся верным при любой локали сервера.
 */
async function matchingIds(db: Db, where: Prisma.CatalogProductWhereInput, tokens: readonly string[]): Promise<string[]> {
  const rows = await db.catalogProduct.findMany({
    where,
    select: { id: true, slug: true, name: true, manufacturer: true, description: true },
  });
  return rows
    .filter((r) => {
      const haystack = foldForSearch([r.name, r.manufacturer ?? "", r.description, r.slug].join("\n"));
      return tokens.every((t) => haystack.includes(t));
    })
    .map((r) => r.id);
}

/**
 * Условия фильтров списка каталога, кроме поиска по тексту. Архивные продукты в списке не
 * показываются.
 */
function filterConditions(filters: CatalogFilters): Prisma.CatalogProductWhereInput[] {
  const and: Prisma.CatalogProductWhereInput[] = [{ archived: false }];
  if (filters.facility) and.push({ facilityTypeSlugs: { has: filters.facility } });
  if (filters.process) and.push({ processes: { some: { process: { slug: filters.process } } } });
  if (filters.solutionType) and.push({ solutionType: { slug: filters.solutionType } });
  // Неизвестное значение статуса или глубины (строка из URL) не фильтрует, а не обнуляет список.
  if (filters.status && STATUS_VALUES.has(filters.status)) and.push({ status: filters.status });
  if (filters.level && LEVEL_VALUES.has(filters.level)) and.push({ level: filters.level });
  if (filters.confirmedOnly) and.push({ confirmedSharePct: { gt: 0 } });
  if (filters.raas) and.push({ raasRubMonth: { not: null } });
  return and;
}

/**
 * Порядок списка. Продукты без значения — в конце при любом направлении, чтобы «нет данных»
 * не открывало список; при равенстве — по названию, затем по slug (порядок устойчив).
 * Производительность сравнима только в одной единице (паллет/ч, м²/ч, строк/ч), поэтому
 * сортировку по ней осмысленно применять вместе с фильтром по процессу.
 */
function catalogOrder(sort: CatalogSort | undefined): Prisma.CatalogProductOrderByWithRelationInput[] {
  const tail: Prisma.CatalogProductOrderByWithRelationInput[] = [{ name: "asc" }, { slug: "asc" }];
  switch (sort) {
    case "price":
      return [{ priceRub: { sort: "asc", nulls: "last" } }, ...tail];
    case "throughput":
      return [{ throughputPerH: { sort: "desc", nulls: "last" } }, ...tail];
    case "completeness":
      return [{ completenessPct: "desc" }, ...tail];
    default:
      return tail;
  }
}

/** Номер страницы: целое не меньше 1; мусор из URL — первая страница. */
function normPage(page: number | undefined): number {
  if (typeof page !== "number" || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.trunc(page));
}

/**
 * Список каталога с фильтрами, поиском, сортировкой и страницами по 50 (ТЗ §3.3.7). Работает
 * по вынесенным колонкам, без характеристик: это быстро и на всём каталоге организатора.
 */
export async function getCatalogList(db: Db, filters: CatalogFilters = {}): Promise<CatalogList> {
  const and = filterConditions(filters);
  const tokens = queryTokens(filters.q);
  if (tokens.length > 0) and.push({ id: { in: await matchingIds(db, { AND: [...and] }, tokens) } });
  const where: Prisma.CatalogProductWhereInput = { AND: and };
  const page = normPage(filters.page);
  // Запросы по очереди, а не Promise.all: внутри интерактивной транзакции (Db может быть
  // TransactionClient) параллельные запросы на одном соединении не поддерживаются.
  const total = await db.catalogProduct.count({ where });
  const rows = await db.catalogProduct.findMany({
    where,
    orderBy: catalogOrder(filters.sort),
    skip: (page - 1) * CATALOG_PAGE_SIZE,
    take: CATALOG_PAGE_SIZE,
    include: {
      solutionType: { select: { slug: true, name: true } },
      processes: { select: { process: { select: { slug: true, name: true } } } },
    },
  });
  return {
    items: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      manufacturer: r.manufacturer,
      country: r.country,
      level: asLevel(r.level),
      status: asStatus(r.status),
      origin: r.origin,
      solutionType: r.solutionType ? { slug: r.solutionType.slug, name: r.solutionType.name } : null,
      processes: [...r.processes]
        .sort((a, b) => compareProcessSlugs(a.process.slug, b.process.slug))
        .map((l) => ({ slug: l.process.slug, name: l.process.name })),
      facilityTypes: r.facilityTypeSlugs,
      description: r.description,
      priceRub: r.priceRub,
      raasRubMonth: r.raasRubMonth,
      throughputPerH: r.throughputPerH,
      throughputUnit: r.throughputUnit,
      payloadKg: r.payloadKg,
      speedMps: r.speedMps,
      completenessPct: r.completenessPct,
      confirmedSharePct: r.confirmedSharePct,
      needsVerification: r.needsVerification,
      excluded: r.excluded,
      excludedReason: r.excludedReason,
      flags: asFlags(r.flags),
    })),
    total,
    page,
    pageSize: CATALOG_PAGE_SIZE,
    pageCount: Math.ceil(total / CATALOG_PAGE_SIZE),
  };
}

// ——————————————————————————— Каталог: карточка ———————————————————————————

/** Другое найденное значение характеристики — «альтернатива», проигравшая по приоритету. */
export type CatalogAlternative = {
  value: string;
  origin: Origin;
  sourceType: string | null;
  sourceUrl: string | null;
  sourceRef: string | null;
  date: string | null;
  confirmed: boolean;
  confidence: string | null;
  asInSource: string | null;
};

/** Характеристика в карточке продукта: значение, как в источнике и полный провенанс (§3.3.4). */
export type CatalogCharacteristic = {
  key: string;
  label: string;
  group: CharGroup;
  /** Значение строкой для людей («80–100 паллет/ч (на робота)»). */
  display: string;
  valueNum: number | null;
  valueMin: number | null;
  valueMax: number | null;
  qualifier: string | null;
  valueText: string | null;
  valueList: string[];
  unit: string | null;
  scope: string | null;
  origin: Origin;
  sourceType: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  /** Дата проверки, YYYY-MM-DD. */
  verifiedAt: string | null;
  confirmed: boolean;
  confidence: string | null;
  asInSource: string | null;
  basis: string | null;
  formula: string | null;
  note: string | null;
  granularity: string;
  alternatives: CatalogAlternative[];
  /** Источники расходятся сильнее допуска — показать «⚠ есть расхождения». */
  hasConflict: boolean;
};

/**
 * Карточка продукта: вынесенные колонки, характеристики по группам ТЗ §3.3.4 (все шесть
 * групп присутствуют, пустая — пустой массив) и звенья иерархии §3.3.1 для «хлебных крошек»:
 * отрасль → тип объекта → процесс → тип решения → продукт.
 */
export type CatalogProductDetail = Omit<CatalogListItem, "processes" | "facilityTypes" | "solutionType"> & {
  organizerCatalogId: string | null;
  organizerRows: number[];
  industries: string[];
  archived: boolean;
  editedByAdmin: boolean;
  dataVersion: string;
  updatedAt: Date;
  solutionType: {
    slug: string;
    name: string;
    purpose: string;
    handlingClass: string;
    mobile: boolean;
  } | null;
  processes: { slug: string; name: string; order: number }[];
  /** Типы объектов с отраслью; тип, которого нет в БД, — со slug вместо названия и без отрасли. */
  facilityTypes: { slug: string; name: string; industry: { slug: string; name: string } | null }[];
  characteristics: Record<CharGroup, CatalogCharacteristic[]>;
};

/** Разбор JSON-колонки alternatives: только объекты, всё остальное отбрасывается. */
function parseAlternatives(json: Prisma.JsonValue | null): CatalogAlternative[] {
  if (!Array.isArray(json)) return [];
  const out: CatalogAlternative[] = [];
  for (const item of json) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const a = item as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
    const value = a.value;
    let display = "—";
    if (typeof value === "number") display = formatCharValue(altRow({ valueNum: value }, a));
    else if (typeof value === "string") display = value.trim() !== "" ? value.trim() : "—";
    else if (Array.isArray(value)) display = formatCharValue(altRow({ valueList: value.filter((v): v is string => typeof v === "string") }, a));
    else if (value !== null && typeof value === "object") {
      const r = value as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      display = formatCharValue(
        altRow({ valueNum: num(r.typical), valueMin: num(r.min), valueMax: num(r.max), qualifier: str(r.qualifier) }, a),
      );
    }
    out.push({
      value: display,
      origin: asOrigin(str(a.origin)),
      sourceType: str(a.sourceType),
      sourceUrl: str(a.sourceUrl),
      sourceRef: str(a.sourceRef),
      date: str(a.date),
      confirmed: a.confirmed === true,
      confidence: str(a.confidence),
      asInSource: str(a.asInSource),
    });
  }
  return out;
}

/** Значение альтернативы в форме строки характеристики — для общего форматтера. */
function altRow(
  v: Partial<Pick<CharRow, "valueNum" | "valueMin" | "valueMax" | "qualifier" | "valueList">>,
  a: Record<string, unknown>,
): Pick<CharRow, "valueNum" | "valueMin" | "valueMax" | "qualifier" | "valueText" | "valueList" | "unit" | "scope"> {
  return {
    valueNum: v.valueNum ?? null,
    valueMin: v.valueMin ?? null,
    valueMax: v.valueMax ?? null,
    qualifier: v.qualifier ?? null,
    valueText: null,
    valueList: v.valueList ?? [],
    unit: typeof a.unit === "string" ? a.unit : null,
    scope: typeof a.scope === "string" ? a.scope : null,
  };
}

const CHAR_GROUPS = Object.keys(CHAR_GROUP_LABELS) as CharGroup[];

/** Пустая раскладка по группам — все шесть групп ТЗ в порядке показа. */
function emptyGroups(): Record<CharGroup, CatalogCharacteristic[]> {
  return Object.fromEntries(CHAR_GROUPS.map((g) => [g, []])) as unknown as Record<CharGroup, CatalogCharacteristic[]>;
}

const DETAIL_INCLUDE = {
  solutionType: true,
  processes: { select: { process: { select: { slug: true, name: true, order: true } } } },
  characteristics: true,
} satisfies Prisma.CatalogProductInclude;

type DetailRow = Prisma.CatalogProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type FacilityRow = { slug: string; name: string; industry: { slug: string; name: string } };

function toDetail(r: DetailRow, facilities: ReadonlyMap<string, FacilityRow>): CatalogProductDetail {
  const characteristics = emptyGroups();
  for (const c of [...r.characteristics].sort((a, b) => compareCharKeys(a.key, b.key))) {
    const row = toCharRow(c);
    characteristics[c.group].push({
      key: c.key,
      label: charLabel(c.key),
      group: c.group,
      display: formatCharValue(row),
      valueNum: c.valueNum,
      valueMin: c.valueMin,
      valueMax: c.valueMax,
      qualifier: c.qualifier,
      valueText: c.valueText,
      valueList: [...c.valueList],
      unit: c.unit,
      scope: c.scope,
      origin: asOrigin(c.origin),
      sourceType: c.sourceType,
      sourceUrl: c.sourceUrl,
      sourceRef: c.sourceRef,
      verifiedAt: row.verifiedAt,
      confirmed: c.confirmed,
      confidence: c.confidence,
      asInSource: c.asInSource,
      basis: c.basis,
      formula: c.formula,
      note: c.note,
      granularity: c.granularity,
      alternatives: parseAlternatives(c.alternatives),
      hasConflict: hasConflictingAlternatives(row),
    });
  }
  return {
    slug: r.slug,
    name: r.name,
    manufacturer: r.manufacturer,
    country: r.country,
    level: asLevel(r.level),
    status: asStatus(r.status),
    origin: r.origin,
    description: r.description,
    priceRub: r.priceRub,
    raasRubMonth: r.raasRubMonth,
    throughputPerH: r.throughputPerH,
    throughputUnit: r.throughputUnit,
    payloadKg: r.payloadKg,
    speedMps: r.speedMps,
    completenessPct: r.completenessPct,
    confirmedSharePct: r.confirmedSharePct,
    needsVerification: r.needsVerification,
    excluded: r.excluded,
    excludedReason: r.excludedReason,
    flags: asFlags(r.flags),
    organizerCatalogId: r.organizerCatalogId,
    organizerRows: [...r.organizerRows],
    industries: [...r.industries],
    archived: r.archived,
    editedByAdmin: r.editedByAdmin,
    dataVersion: r.dataVersion,
    updatedAt: r.updatedAt,
    solutionType: r.solutionType
      ? {
          slug: r.solutionType.slug,
          name: r.solutionType.name,
          purpose: r.solutionType.purpose,
          handlingClass: r.solutionType.handlingClass,
          mobile: r.solutionType.mobile,
        }
      : null,
    processes: [...r.processes]
      .sort((a, b) => compareProcessSlugs(a.process.slug, b.process.slug))
      .map((l) => ({ slug: l.process.slug, name: l.process.name, order: l.process.order })),
    facilityTypes: r.facilityTypeSlugs.map((slug) => {
      const f = facilities.get(slug);
      return f ? { slug, name: f.name, industry: { slug: f.industry.slug, name: f.industry.name } } : { slug, name: slug, industry: null };
    }),
    characteristics,
  };
}

/** Типы объектов с отраслями по slug'ам — один запрос на все карточки. */
async function facilitiesBySlug(db: Db, slugs: readonly string[]): Promise<Map<string, FacilityRow>> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return new Map();
  const rows = await db.facilityType.findMany({
    where: { slug: { in: unique } },
    select: { slug: true, name: true, industry: { select: { slug: true, name: true } } },
  });
  return new Map(rows.map((f) => [f.slug, f]));
}

/**
 * Карточка продукта по slug (ТЗ §3.3.4): характеристики по группам с провенансом и звенья
 * иерархии. Архивный продукт тоже возвращается (с `archived: true`) — на него может ссылаться
 * сохранённый проект. null — такого продукта нет.
 */
export async function getCatalogProduct(db: Db, slug: string): Promise<CatalogProductDetail | null> {
  const row = await db.catalogProduct.findUnique({ where: { slug }, include: DETAIL_INCLUDE });
  if (!row) return null;
  return toDetail(row, await facilitiesBySlug(db, row.facilityTypeSlugs));
}

/**
 * Несколько карточек для сравнения (ТЗ §3.3.7) в порядке переданных slug'ов, без повторов;
 * отсутствующие slug'и пропускаются.
 */
export async function getCatalogProducts(db: Db, slugs: readonly string[]): Promise<CatalogProductDetail[]> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return [];
  const rows = await db.catalogProduct.findMany({ where: { slug: { in: unique } }, include: DETAIL_INCLUDE });
  const facilities = await facilitiesBySlug(
    db,
    rows.flatMap((r) => r.facilityTypeSlugs),
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return unique.flatMap((slug) => {
    const row = bySlug.get(slug);
    return row ? [toDetail(row, facilities)] : [];
  });
}

// ——————————————————————————— Выпуск данных ———————————————————————————

/** Выпуск данных организатора (ТЗ §3.1.5): версия, момент синхронизации, состав выгрузок. */
export type DataReleaseRow = {
  version: string;
  seededAt: Date;
  organizerVersion: Prisma.JsonValue;
  note: string | null;
};

/** Последний выпуск данных; null — синхронизация ещё не выполнялась. */
export async function latestDataRelease(db: Db): Promise<DataReleaseRow | null> {
  const row = await db.dataRelease.findFirst({ orderBy: [{ seededAt: "desc" }, { version: "desc" }] });
  return row ? { version: row.version, seededAt: row.seededAt, organizerVersion: row.organizerVersion, note: row.note } : null;
}
