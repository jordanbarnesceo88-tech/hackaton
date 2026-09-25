import type { PrismaClient, ProductCharacteristic } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { isCharKey, isoDate, sourcedToCharRow } from "../catalog/product-for-calc";
import type { CharRow } from "../catalog/product-for-calc";
import { promoteColumns } from "../catalog/promote";
import { toCharacteristicData } from "../catalog/queries";
import type { Db } from "../catalog/queries";
import { CATALOG } from "../data/organizer/catalog";
import { isFacilitySlug, processDef, solutionTypeDef } from "../tz/processes";
import type {
  CharValue,
  Origin,
  ProductFlag,
  ProductLevel,
  ProductSeed,
  ProductStatus,
  Range,
  Scope,
  SourceType,
  Sourced,
} from "../tz/types";
import { dataVersionOf, stableJson } from "../tz/version";

/**
 * Импорт продуктов каталога через API (POST /api/v1/catalog/import, ТЗ §3.3.2 «загрузка
 * каталога», §3.3.6 «обновление по запросу», §3.8.2 «API импорта каталога»).
 *
 * Вход — список ProductSeed (та же форма, что пишет генератор данных организатора), не больше
 * IMPORT_MAX_PRODUCTS. Правила записи те же, что у синхронизации (lib/catalog/sync.ts):
 * характеристики с провенансом → ProductCharacteristic, вынесенные колонки считает
 * `promoteColumns`, правка администратора в админке (характеристика с origin 'admin') не
 * перезаписывается. Отличие одно — чей продукт:
 *
 * - импорт заводит продукт с origin ADMIN. Это продукт, который завёл администратор (через
 *   сайт или через API по его токену), а не строка данных организатора: синхронизация его не
 *   трогает и не архивирует, в каталоге он не выдаётся за данные организатора, а удалить его
 *   можно в админке;
 * - slug продукта из данных организатора импорт не принимает (отказ по позиции): такой
 *   продукт обновляет синхронизация, и правка через API молча откатилась бы следующим севом.
 *   Дополнить продукт организатора можно в админке — там правка помечается и сохраняется.
 *
 * Проверка входа строгая и всё-или-ничего: если хоть одна позиция не проходит, ничего не
 * пишется (422 со списком ошибок по позициям). Неизвестные поля — ошибка, а не молчаливая
 * подчистка. Каждая характеристика обязана нести провенанс по правилам Sourced (ТЗ §3.3.4):
 * organizer → sourceRef; research → ссылка http(s), цитата asInSource и дата; estimate, derived,
 * choice → basis; derived → formula; оценка не бывает «подтверждённой».
 */

/** Наибольшее число продуктов в одном запросе. */
export const IMPORT_MAX_PRODUCTS = 200;

/** Slug продукта: латиница в нижнем регистре, цифры и дефис, 1–80 символов, без дефиса по краям. */
export const PRODUCT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * Slug'и, которые заняты адресами API: /api/v1/catalog/import — отдельный маршрут, и продукт
 * с таким slug нельзя было бы прочитать через GET /api/v1/catalog/{slug}.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["import"]);

/** Происхождение характеристики, допустимое во входе API. */
export const API_IMPORT_ORIGINS = ["organizer", "research", "estimate", "derived", "choice"] as const satisfies readonly Origin[];

/**
 * Какие типы источника допустимы при каждом происхождении. Так же размечены данные
 * организатора (lib/data/organizer): organizer — выгрузки организатора, research — открытые
 * источники, derived — вычисление, estimate и choice — оценка или решение команды.
 */
export const SOURCE_TYPES_BY_ORIGIN: Readonly<Record<(typeof API_IMPORT_ORIGINS)[number], readonly SourceType[]>> = {
  organizer: ["organizer:dataset", "organizer:catalog", "organizer:examples"],
  research: ["manufacturer", "manufacturer-doc", "dealer", "aggregator", "press"],
  derived: ["calc"],
  estimate: ["team-estimate"],
  choice: ["team-estimate"],
};

const LEVELS: ReadonlySet<string> = new Set<ProductLevel>(["identification", "enriched", "examples"]);
const STATUSES: ReadonlySet<string> = new Set<ProductStatus>(["operation", "piloting", "rnd"]);
const SCOPES: ReadonlySet<string> = new Set<Scope>(["per-robot", "per-station", "per-channel", "per-fleet"]);
const FLAGS: ReadonlySet<string> = new Set<ProductFlag>([
  "duplicate-merged",
  "model-not-found",
  "variant-unpublished",
  "manufacturer-disputed",
  "price-disputed",
  "price-may-be-subscription",
  "price-placeholder",
  "case-unconfirmed",
  "values-from-other-product",
  "no-price",
  "rnd-exclude",
]);
const QUALIFIERS: ReadonlySet<string> = new Set(["до", "от", "≈"]);
const CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);

const SEED_FIELDS: ReadonlySet<string> = new Set([
  "slug",
  "organizerCatalogId",
  "organizerRows",
  "level",
  "name",
  "manufacturer",
  "country",
  "solutionType",
  "status",
  "processes",
  "facilityTypes",
  "industries",
  "description",
  "characteristics",
  "flags",
  "excludedReason",
]);
const SOURCED_FIELDS: ReadonlySet<string> = new Set([
  "value",
  "unit",
  "origin",
  "sourceType",
  "sourceUrl",
  "sourceRef",
  "date",
  "confirmed",
  "confidence",
  "asInSource",
  "basis",
  "formula",
  "scope",
  "granularity",
  "alternatives",
]);
const RANGE_FIELDS: ReadonlySet<string> = new Set(["min", "max", "typical", "qualifier"]);

/** Пределы длины текстовых полей, символов. */
const LIMITS = {
  name: 200,
  manufacturer: 200,
  country: 100,
  description: 200,
  industry: 100,
  industries: 20,
  excludedReason: 300,
  processes: 10,
  text: 2000,
  list: 50,
  listItem: 300,
  unit: 40,
  url: 2000,
  sourceRef: 300,
  asInSource: 1000,
  basis: 1000,
  formula: 500,
  alternatives: 10,
} as const;

/** Slug'и продуктов данных организатора: их обновляет синхронизация, импорт их не принимает. */
const ORGANIZER_SLUGS: ReadonlySet<string> = new Set(CATALOG.map((p) => p.slug));

/** Сообщение отказа для slug из данных организатора. */
export function organizerSlugMessage(slug: string): string {
  return (
    `«${slug}» — продукт из данных организатора: его обновляет синхронизация, и правка через API ` +
    `откатилась бы при следующем обновлении каталога. Дополните его в админке (/admin/catalog/${slug}) ` +
    "или импортируйте под другим slug"
  );
}

// ——————————————————————————— Проверка входа ———————————————————————————

/** Ошибки одной позиции входа. */
export type SeedIssue = { index: number; slug: string | null; errors: string[] };

/** Итог проверки: продукты, собранные заново только из известных полей, или ошибки. */
export type SeedsCheck = { ok: true; seeds: ProductSeed[] } | { ok: false; error: string; issues: SeedIssue[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Строка без лишних пробелов по краям и внутри. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extraFields(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k) && obj[k] !== undefined);
}

/** Дата YYYY-MM-DD, существующая в календаре (2026-02-30 — нет). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Абсолютная ссылка http(s). */
function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Необязательная строка: undefined/null → null, пустая после обрезки → null. */
function optionalText(
  v: unknown,
  label: string,
  max: number,
  errors: string[],
): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") {
    errors.push(`${label}: должно быть строкой или null`);
    return null;
  }
  const s = tidy(v);
  if (s.length > max) errors.push(`${label}: не длиннее ${max} символов, сейчас ${s.length}`);
  return s === "" ? null : s;
}

/** Список строк: undefined → [], повторы — ошибка. */
function stringList(v: unknown, label: string, maxItems: number, maxLen: number, errors: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    errors.push(`${label}: должно быть списком строк`);
    return [];
  }
  if (v.length > maxItems) errors.push(`${label}: не больше ${maxItems} значений, сейчас ${v.length}`);
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || tidy(item) === "") {
      errors.push(`${label}: каждое значение — непустая строка`);
      continue;
    }
    const s = tidy(item);
    if (s.length > maxLen) errors.push(`${label}: значение «${s.slice(0, 40)}…» длиннее ${maxLen} символов`);
    if (out.includes(s)) errors.push(`${label}: значение «${s}» повторяется`);
    else out.push(s);
  }
  return out;
}

/** Значение характеристики: число, диапазон {min?, max?, typical, qualifier?}, текст или список. */
function checkCharValue(v: unknown, where: string, errors: string[]): CharValue | null {
  if (finite(v)) return v;
  if (typeof v === "number") {
    errors.push(`${where}: число должно быть конечным`);
    return null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") errors.push(`${where}: пустой текст — не передавайте характеристику без значения`);
    else if (s.length > LIMITS.text) errors.push(`${where}: текст не длиннее ${LIMITS.text} символов`);
    return s;
  }
  if (Array.isArray(v)) {
    const list = stringList(v, where, LIMITS.list, LIMITS.listItem, errors);
    if (list.length === 0) errors.push(`${where}: пустой список — не передавайте характеристику без значения`);
    return list;
  }
  if (isPlainObject(v)) {
    const before = errors.length;
    const extra = extraFields(v, RANGE_FIELDS);
    if (extra.length > 0) errors.push(`${where}: в диапазоне неизвестные поля ${extra.join(", ")} (допустимы min, max, typical, qualifier)`);
    if (!finite(v.typical)) errors.push(`${where}: у диапазона нужно число typical — значение, которое идёт в расчёт`);
    for (const k of ["min", "max"] as const) {
      if (v[k] !== undefined && !finite(v[k])) errors.push(`${where}: ${k} диапазона — число`);
    }
    if (v.qualifier !== undefined && (typeof v.qualifier !== "string" || !QUALIFIERS.has(v.qualifier))) {
      errors.push(`${where}: оговорка qualifier — «до», «от» или «≈»`);
    }
    if (errors.length !== before) return null;
    const range: Range = { typical: v.typical as number };
    if (v.min !== undefined) range.min = v.min as number;
    if (v.max !== undefined) range.max = v.max as number;
    if (v.qualifier !== undefined) range.qualifier = v.qualifier as Range["qualifier"];
    if (
      (range.min !== undefined && range.min > range.typical) ||
      (range.max !== undefined && range.max < range.typical) ||
      (range.min !== undefined && range.max !== undefined && range.min > range.max)
    ) {
      errors.push(`${where}: в диапазоне должно выполняться min ≤ typical ≤ max`);
      return null;
    }
    return range;
  }
  errors.push(`${where}: значение — число, диапазон {min, max, typical, qualifier}, текст или список строк`);
  return null;
}

/**
 * Характеристика с провенансом (Sourced). `nested` — альтернатива внутри характеристики: у неё
 * своих альтернатив быть не может.
 */
function checkSourced(
  raw: unknown,
  where: string,
  nested: boolean,
  errors: string[],
): Sourced<CharValue> | null {
  if (!isPlainObject(raw)) {
    errors.push(`${where}: должно быть объектом {value, origin, sourceType, sourceUrl, date, confirmed, …}`);
    return null;
  }
  const before = errors.length;
  const allowed = nested ? new Set([...SOURCED_FIELDS].filter((f) => f !== "alternatives")) : SOURCED_FIELDS;
  const extra = extraFields(raw, allowed);
  if (extra.length > 0) errors.push(`${where}: неизвестные поля ${extra.join(", ")}`);

  const value = checkCharValue(raw.value, `${where}.value`, errors);

  const origin = raw.origin;
  const originOk = typeof origin === "string" && (API_IMPORT_ORIGINS as readonly string[]).includes(origin);
  if (!originOk) {
    errors.push(
      `${where}: origin — одно из ${API_IMPORT_ORIGINS.join(", ")} (правки admin и user ставит сама платформа)`,
    );
  }
  const o = origin as (typeof API_IMPORT_ORIGINS)[number];
  const sourceType = raw.sourceType;
  if (originOk && (typeof sourceType !== "string" || !SOURCE_TYPES_BY_ORIGIN[o].includes(sourceType as SourceType))) {
    errors.push(`${where}: при origin «${o}» sourceType — одно из ${SOURCE_TYPES_BY_ORIGIN[o].join(", ")}`);
  }

  let sourceUrl: string | null = null;
  if (raw.sourceUrl !== undefined && raw.sourceUrl !== null) {
    if (typeof raw.sourceUrl !== "string" || !isHttpUrl(raw.sourceUrl) || raw.sourceUrl.length > LIMITS.url) {
      errors.push(`${where}: sourceUrl — абсолютная ссылка http(s) не длиннее ${LIMITS.url} символов или null`);
    } else sourceUrl = raw.sourceUrl;
  }
  const sourceRef = optionalText(raw.sourceRef, `${where}.sourceRef`, LIMITS.sourceRef, errors);
  const asInSource = optionalText(raw.asInSource, `${where}.asInSource`, LIMITS.asInSource, errors);
  const basis = optionalText(raw.basis, `${where}.basis`, LIMITS.basis, errors);
  const formula = optionalText(raw.formula, `${where}.formula`, LIMITS.formula, errors);
  const unit = optionalText(raw.unit, `${where}.unit`, LIMITS.unit, errors);

  const date = raw.date;
  if (typeof date !== "string" || !isIsoDate(date)) {
    errors.push(`${where}: date — дата проверки значения в формате ГГГГ-ММ-ДД, например 2026-09-23`);
  }
  if (typeof raw.confirmed !== "boolean") errors.push(`${where}: confirmed — true или false (подтверждено первоисточником)`);
  if (raw.confidence !== undefined && (typeof raw.confidence !== "string" || !CONFIDENCES.has(raw.confidence))) {
    errors.push(`${where}: confidence — high, medium или low`);
  }
  if (raw.scope !== undefined && (typeof raw.scope !== "string" || !SCOPES.has(raw.scope))) {
    errors.push(`${where}: scope — ${[...SCOPES].join(", ")}`);
  }
  if (raw.granularity !== undefined && raw.granularity !== "field" && raw.granularity !== "row") {
    errors.push(`${where}: granularity — field или row`);
  }

  // Правила провенанса (ТЗ §3.3.4: у каждой характеристики источник, дата и подтверждение).
  if (originOk) {
    if (o === "organizer" && !sourceRef) errors.push(`${where}: у значения организатора нужен sourceRef — где именно (файл, лист, строка)`);
    if (o === "research") {
      if (!sourceUrl) errors.push(`${where}: у значения из открытого источника нужна ссылка sourceUrl`);
      if (!asInSource) errors.push(`${where}: у значения из открытого источника нужна цитата asInSource — как в источнике`);
    }
    if ((o === "estimate" || o === "derived" || o === "choice") && !basis) {
      errors.push(`${where}: у оценки, вычисления или решения нужно обоснование basis`);
    }
    if (o === "derived" && !formula) errors.push(`${where}: у вычисленного значения нужна формула formula`);
    if (o === "estimate" && raw.confirmed === true) {
      errors.push(`${where}: оценка не может быть подтверждённой — confirmed: false`);
    }
  }

  let alternatives: Omit<Sourced<CharValue>, "alternatives">[] | undefined;
  if (!nested && raw.alternatives !== undefined) {
    if (!Array.isArray(raw.alternatives) || raw.alternatives.length > LIMITS.alternatives) {
      errors.push(`${where}: alternatives — список не больше ${LIMITS.alternatives} значений`);
    } else {
      const list: Omit<Sourced<CharValue>, "alternatives">[] = [];
      raw.alternatives.forEach((a, i) => {
        const alt = checkSourced(a, `${where}.alternatives[${i}]`, true, errors);
        if (alt) list.push(alt);
      });
      if (list.length > 0) alternatives = list;
    }
  }

  if (errors.length !== before || value === null) return null;
  const out: Sourced<CharValue> = {
    value,
    origin: o,
    sourceType: sourceType as SourceType,
    sourceUrl,
    date: date as string,
    confirmed: raw.confirmed as boolean,
  };
  if (unit !== null) out.unit = unit;
  if (sourceRef !== null) out.sourceRef = sourceRef;
  if (raw.confidence !== undefined) out.confidence = raw.confidence as Sourced<CharValue>["confidence"];
  if (asInSource !== null) out.asInSource = asInSource;
  if (basis !== null) out.basis = basis;
  if (formula !== null) out.formula = formula;
  if (raw.scope !== undefined) out.scope = raw.scope as Scope;
  if (raw.granularity !== undefined) out.granularity = raw.granularity as "field" | "row";
  if (alternatives) out.alternatives = alternatives;
  return out;
}

/** Проверка одной позиции; ошибки — в `errors`, результат — продукт из известных полей. */
function checkSeed(raw: unknown, where: string, errors: string[]): ProductSeed | null {
  if (!isPlainObject(raw)) {
    errors.push(`${where}: продукт должен быть объектом`);
    return null;
  }
  const extra = extraFields(raw, SEED_FIELDS);
  if (extra.length > 0) errors.push(`${where}: неизвестные поля ${extra.join(", ")}`);

  const slug = raw.slug;
  if (typeof slug !== "string" || !PRODUCT_SLUG_RE.test(slug)) {
    errors.push(`${where}: slug — латиница в нижнем регистре, цифры и дефис, 1–80 символов, например «vendor-model-1500»`);
  } else if (RESERVED_SLUGS.has(slug)) {
    errors.push(`${where}: slug «${slug}» занят адресом API — выберите другой`);
  }
  if (raw.organizerCatalogId !== undefined && raw.organizerCatalogId !== null) {
    errors.push(`${where}: organizerCatalogId задаёт только синхронизация данных организатора — передайте null или уберите поле`);
  }
  if (raw.organizerRows !== undefined && !(Array.isArray(raw.organizerRows) && raw.organizerRows.length === 0)) {
    errors.push(`${where}: organizerRows задаёт только синхронизация данных организатора — передайте [] или уберите поле`);
  }
  const level = raw.level;
  if (typeof level !== "string" || !LEVELS.has(level)) {
    errors.push(`${where}: level — identification (только идентификация), enriched (характеристики с источниками) или examples`);
  }
  const name = typeof raw.name === "string" ? tidy(raw.name) : "";
  if (name.length < 1 || name.length > LIMITS.name) errors.push(`${where}: name — название от 1 до ${LIMITS.name} символов`);
  const manufacturer = optionalText(raw.manufacturer, `${where}.manufacturer`, LIMITS.manufacturer, errors);
  const country = optionalText(raw.country, `${where}.country`, LIMITS.country, errors);

  const solutionType = raw.solutionType;
  if (typeof solutionType !== "string" || !solutionTypeDef(solutionType)) {
    errors.push(`${where}: solutionType «${String(solutionType)}» неизвестен — список типов решений в описании API (GET /api/v1/openapi.json)`);
  }
  const status = raw.status;
  if (typeof status !== "string" || !STATUSES.has(status)) {
    errors.push(`${where}: status — operation (эксплуатация), piloting (пилот) или rnd (НИОКР)`);
  }

  const facilityTypes = stringList(raw.facilityTypes, `${where}.facilityTypes`, 3, 40, errors);
  for (const f of facilityTypes) {
    if (!isFacilitySlug(f)) errors.push(`${where}.facilityTypes: «${f}» — допустимы warehouse, airport, medical`);
  }
  const processes = stringList(raw.processes, `${where}.processes`, LIMITS.processes, 60, errors);
  for (const p of processes) {
    const def = processDef(p);
    if (!def) errors.push(`${where}.processes: процесс «${p}» неизвестен`);
    else if (!def.facilityTypes.some((f) => facilityTypes.includes(f))) {
      errors.push(`${where}.processes: процесс «${def.name}» (${p}) относится к ${def.facilityTypes.join(", ")} — добавьте этот тип в facilityTypes`);
    }
  }
  const industries = stringList(raw.industries, `${where}.industries`, LIMITS.industries, LIMITS.industry, errors);
  let description = "";
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") errors.push(`${where}.description: должно быть строкой`);
    else {
      description = raw.description.trim();
      if (description.length > LIMITS.description) {
        errors.push(`${where}.description: не длиннее ${LIMITS.description} символов, сейчас ${description.length}`);
      }
    }
  }
  const flags = stringList(raw.flags, `${where}.flags`, FLAGS.size, 40, errors);
  for (const f of flags) if (!FLAGS.has(f)) errors.push(`${where}.flags: пометка «${f}» неизвестна`);
  const excludedReason = optionalText(raw.excludedReason, `${where}.excludedReason`, LIMITS.excludedReason, errors);

  const characteristics: Record<string, Sourced<CharValue>> = {};
  if (!isPlainObject(raw.characteristics)) {
    errors.push(`${where}: characteristics — объект «ключ характеристики → значение с источником» (может быть пустым {})`);
  } else {
    for (const [key, s] of Object.entries(raw.characteristics)) {
      if (s === undefined) continue;
      if (!isCharKey(key)) {
        errors.push(`${where}.characteristics: ключ «${key}» не входит в словарь характеристик ТЗ §3.3.4`);
        continue;
      }
      const checked = checkSourced(s, `${where}.characteristics.${key}`, false, errors);
      if (checked) characteristics[key] = checked;
    }
  }

  if (errors.length > 0) return null;
  return {
    slug: slug as string,
    organizerCatalogId: null,
    organizerRows: [],
    level: level as ProductLevel,
    name,
    manufacturer,
    country,
    solutionType: solutionType as string,
    status: status as ProductStatus,
    processes,
    facilityTypes,
    industries,
    description,
    characteristics,
    flags: flags as ProductFlag[],
    excludedReason,
  };
}

/**
 * Проверка тела запроса импорта: список от 1 до IMPORT_MAX_PRODUCTS продуктов без повторов
 * slug. Всё-или-ничего: при любой ошибке возвращаются ошибки по позициям, продукты — нет.
 */
export function validateProductSeeds(body: unknown): SeedsCheck {
  if (!Array.isArray(body)) {
    return { ok: false, error: "Тело запроса — список продуктов (JSON-массив ProductSeed)", issues: [] };
  }
  if (body.length === 0 || body.length > IMPORT_MAX_PRODUCTS) {
    return {
      ok: false,
      error: `В одном запросе от 1 до ${IMPORT_MAX_PRODUCTS} продуктов, сейчас ${body.length} — разбейте список на части`,
      issues: [],
    };
  }
  const issues: SeedIssue[] = [];
  const seeds: ProductSeed[] = [];
  const seen = new Map<string, number>();
  body.forEach((raw, index) => {
    const errors: string[] = [];
    const seed = checkSeed(raw, `Продукт ${index + 1}`, errors);
    const slug = isPlainObject(raw) && typeof raw.slug === "string" ? raw.slug : null;
    if (slug !== null) {
      const first = seen.get(slug);
      if (first !== undefined) errors.push(`Продукт ${index + 1}: slug «${slug}» уже был в позиции ${first + 1}`);
      else seen.set(slug, index);
    }
    if (errors.length > 0 || !seed) issues.push({ index, slug, errors });
    else seeds.push(seed);
  });
  if (issues.length > 0) {
    return { ok: false, error: `Импорт не выполнен: ошибки в ${issues.length} из ${body.length} продуктов — исправьте и повторите`, issues };
  }
  return { ok: true, seeds };
}

// ——————————————————————————— Запись ———————————————————————————

/** Итог по одному продукту. `valid` — только в пробном прогоне (dryRun). */
export type ImportItem = {
  index: number;
  slug: string;
  status: "created" | "updated" | "unchanged" | "refused" | "failed" | "valid";
  /** Что сделал бы импорт (пробный прогон) или сделал. */
  action?: "create" | "update";
  message?: string;
  /** Характеристики, правленные в админке (origin 'admin'), которые импорт не тронул. */
  adminCharacteristicsKept?: number;
};

/** Отчёт импорта. */
export type ImportReport = {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  refused: number;
  failed: number;
  /** Прошли проверку в пробном прогоне. */
  valid: number;
  items: ImportItem[];
};

/** Отказ по позиции, обнаруженный внутри транзакции (гонка с другим писателем). */
class ImportRefusal extends Error {}

/** Версия данных строки импорта: хэш присланной карточки — видно, какой вход записан. */
export function apiProductDataVersion(seed: ProductSeed): string {
  return `api:${dataVersionOf(seed)}`;
}

/** Приводит значение к сравнимому виду: DbNull/JsonNull/undefined → null, дата → ISO. */
function comparable(v: unknown): unknown {
  if (v === undefined || v === Prisma.DbNull || v === Prisma.JsonNull) return null;
  if (v instanceof Date) return { $date: v.toISOString() };
  return v;
}

/** Только изменившиеся поля (как в синхронизации): повторный импорт того же входа ничего не пишет. */
function changedData<T extends object>(existing: object, desired: T): Partial<T> {
  const row = existing as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => stableJson(comparable(row[key])) !== stableJson(comparable(value))),
  ) as Partial<T>;
}

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

type Refs = { solutionTypes: ReadonlyMap<string, string>; processes: ReadonlyMap<string, string> };

/** Поля продукта импорта (без вынесенных колонок). */
function productFields(seed: ProductSeed, solutionTypeId: string) {
  return {
    organizerCatalogId: null,
    organizerRows: [] as number[],
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
    origin: "ADMIN" as const,
    // Повторный импорт — явное намерение: продукт, отправленный администратором в архив, выходит из него.
    archived: false,
    dataVersion: apiProductDataVersion(seed),
  };
}

/** Записывает один продукт (внутри транзакции). */
async function writeOne(
  tx: Db,
  seed: ProductSeed,
  refs: Refs,
): Promise<{ status: "created" | "updated" | "unchanged"; kept: number }> {
  const solutionTypeId = refs.solutionTypes.get(seed.solutionType);
  if (!solutionTypeId) throw new ImportRefusal(`тип решения «${seed.solutionType}» не найден в базе`);
  const processIds = seed.processes.map((p) => refs.processes.get(p)).filter((id): id is string => typeof id === "string");
  const chars = Object.entries(seed.characteristics).map(([key, s]) => {
    const row = sourcedToCharRow(key, s);
    return { row, data: toCharacteristicData(row) };
  });
  const existing = await tx.catalogProduct.findUnique({
    where: { slug: seed.slug },
    include: { processes: { select: { processId: true } }, characteristics: true },
  });
  const fields = productFields(seed, solutionTypeId);

  if (!existing) {
    await tx.catalogProduct.create({
      data: {
        slug: seed.slug,
        ...fields,
        editedByAdmin: false,
        ...promoteColumns(
          chars.map((c) => c.row),
          { flags: seed.flags },
        ),
        processes: { create: processIds.map((processId) => ({ processId })) },
        characteristics: { create: chars.map((c) => c.data) },
      },
    });
    return { status: "created", kept: 0 };
  }
  if (existing.origin !== "ADMIN") throw new ImportRefusal(organizerSlugMessage(seed.slug));

  let changed = false;
  let kept = 0;
  const current = new Map(existing.characteristics.map((c) => [c.key, c]));
  const final = new Map<string, CharRow>(existing.characteristics.map((c) => [c.key, charRowFromDb(c)]));
  const toCreate: Prisma.ProductCharacteristicCreateManyInput[] = [];
  for (const { row, data } of chars) {
    const old = current.get(row.key);
    // Правка в админке — последнее слово администратора: импорт её не перезаписывает.
    if (old && old.origin === "admin") {
      kept++;
      continue;
    }
    final.set(row.key, row);
    if (!old) {
      toCreate.push({ ...data, productId: existing.id });
      continue;
    }
    const diff = changedData(old, data);
    if (Object.keys(diff).length > 0) {
      await tx.productCharacteristic.update({ where: { id: old.id }, data: diff });
      changed = true;
    }
  }
  if (toCreate.length > 0) {
    await tx.productCharacteristic.createMany({ data: toCreate });
    changed = true;
  }
  // Карточка присылается целиком: характеристики, которых во входе больше нет, удаляются —
  // кроме правок администратора.
  const seedKeys = new Set(Object.keys(seed.characteristics));
  const vanished = existing.characteristics.filter((c) => c.origin !== "admin" && !seedKeys.has(c.key));
  if (vanished.length > 0) {
    await tx.productCharacteristic.deleteMany({ where: { id: { in: vanished.map((c) => c.id) } } });
    for (const c of vanished) final.delete(c.key);
    changed = true;
  }

  const want = new Set(processIds);
  const have = new Set(existing.processes.map((p) => p.processId));
  const drop = [...have].filter((id) => !want.has(id));
  const add = [...want].filter((id) => !have.has(id));
  if (drop.length > 0) await tx.productProcess.deleteMany({ where: { productId: existing.id, processId: { in: drop } } });
  if (add.length > 0) await tx.productProcess.createMany({ data: add.map((processId) => ({ productId: existing.id, processId })) });
  if (drop.length + add.length > 0) changed = true;

  const desired = { ...fields, ...promoteColumns([...final.values()], { flags: seed.flags }) };
  const data = changedData(existing, desired);
  if (Object.keys(data).length > 0) {
    await tx.catalogProduct.update({ where: { id: existing.id }, data });
    changed = true;
  }
  return { status: changed ? "updated" : "unchanged", kept };
}

/** Есть ли у клиента собственные транзакции (обычный клиент, а не транзакционный). */
function hasTransactions(db: Db): db is PrismaClient {
  return typeof (db as { $transaction?: unknown }).$transaction === "function";
}

/**
 * Записывает проверенные продукты (validateProductSeeds) — каждый в своей транзакции, если
 * клиент это позволяет; ошибка одного продукта не останавливает остальные. `dryRun` — только
 * проверки, которым нужна база (slug организатора, справочники), без записи.
 *
 * Отказ по позиции (refused): slug из данных организатора или продукт организатора в БД;
 * процесс или тип решения, которых нет в базе (данные не засеяны).
 */
export async function importProducts(
  db: Db,
  seeds: readonly ProductSeed[],
  opts: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const dryRun = opts.dryRun === true;
  const report: ImportReport = {
    dryRun,
    total: seeds.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    refused: 0,
    failed: 0,
    valid: 0,
    items: [],
  };
  if (seeds.length === 0) return report;
  // Запросы по очереди: внутри интерактивной транзакции параллельные запросы на одном
  // соединении не поддерживаются.
  const solutionTypes = await db.solutionType.findMany({ select: { id: true, slug: true } });
  const processes = await db.process.findMany({ select: { id: true, slug: true } });
  const existing = await db.catalogProduct.findMany({
    where: { slug: { in: seeds.map((s) => s.slug) } },
    select: { slug: true, origin: true },
  });
  const refs: Refs = {
    solutionTypes: new Map(solutionTypes.map((r) => [r.slug, r.id])),
    processes: new Map(processes.map((r) => [r.slug, r.id])),
  };
  const originBySlug = new Map(existing.map((r) => [r.slug, r.origin]));

  for (const [index, seed] of seeds.entries()) {
    const item: ImportItem = { index, slug: seed.slug, status: "valid" };
    const refusal =
      ORGANIZER_SLUGS.has(seed.slug) || originBySlug.get(seed.slug) === "ORGANIZER"
        ? organizerSlugMessage(seed.slug)
        : !refs.solutionTypes.has(seed.solutionType)
          ? `тип решения «${seed.solutionType}» не найден в базе — данные не засеяны: выполните npm run db:seed`
          : seed.processes.find((p) => !refs.processes.has(p)) !== undefined
            ? `процесс «${seed.processes.find((p) => !refs.processes.has(p))}» не найден в базе — данные не засеяны: выполните npm run db:seed`
            : null;
    if (refusal !== null) {
      item.status = "refused";
      item.message = refusal;
      report.refused++;
      report.items.push(item);
      continue;
    }
    item.action = originBySlug.has(seed.slug) ? "update" : "create";
    if (dryRun) {
      report.valid++;
      report.items.push(item);
      continue;
    }
    try {
      const res = hasTransactions(db)
        ? await db.$transaction((tx) => writeOne(tx, seed, refs), { maxWait: 10_000, timeout: 60_000 })
        : await writeOne(db, seed, refs);
      item.status = res.status;
      if (res.kept > 0) item.adminCharacteristicsKept = res.kept;
      report[res.status]++;
    } catch (e) {
      if (e instanceof ImportRefusal) {
        item.status = "refused";
        item.message = e.message;
        report.refused++;
      } else {
        console.error(`importProducts: продукт «${seed.slug}» не записан`, e);
        item.status = "failed";
        item.message = "не записан из-за ошибки базы — повторите импорт этого продукта";
        report.failed++;
        // Внутри внешней транзакции Postgres уже прервал её — продолжать бессмысленно.
        if (!hasTransactions(db)) throw e;
      }
    }
    report.items.push(item);
  }
  return report;
}
