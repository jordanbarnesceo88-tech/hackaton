import type { CatalogFilters, CatalogSort } from "@/lib/catalog/queries";
import type { ProductLevel, ProductStatus } from "@/lib/tz/types";

/**
 * Состояние каталога в адресной строке (ТЗ §3.3.7: фильтр, поиск, сортировка, сравнение).
 * Фильтры живут в URL, а не в клиентском состоянии: ссылку на выборку можно отправить коллеге,
 * форма работает без JavaScript, а кнопка «назад» возвращает прежний список.
 *
 * Значения из URL не доверенные: берётся только строка (`typeof === "string"`), массив
 * повторяющихся параметров и мусор отбрасываются, неизвестный статус или сортировка не
 * фильтруют, а не обнуляют список. Модуль чистый — его импортирует и клиентская форма
 * сравнения, поэтому из lib/catalog/queries берутся только типы.
 */

/** searchParams страницы после `await`: значение бывает строкой, массивом или отсутствует. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Разобранные фильтры каталога — всё, что нужно форме и запросу. */
export type CatalogQuery = {
  q: string;
  facility: string;
  process: string;
  solutionType: string;
  status: ProductStatus | "";
  level: ProductLevel | "";
  /** «Только с подтверждёнными данными»: хотя бы одна характеристика подтверждена первоисточником. */
  confirmed: boolean;
  /** «Есть модель RaaS»: опубликована ставка аренды. */
  raas: boolean;
  sort: CatalogSort;
  page: number;
};

/** Сколько решений можно сравнить одновременно (§3.3.7). */
export const MAX_COMPARE = 4;

/** Предел длины текстового параметра из URL: длиннее — обрезается, а не уходит в запрос целиком. */
const MAX_PARAM_LENGTH = 100;

const STATUSES: readonly ProductStatus[] = ["operation", "piloting", "rnd"];
const LEVELS: readonly ProductLevel[] = ["identification", "enriched", "examples"];
const SORTS: readonly CatalogSort[] = ["name", "price", "throughput", "completeness"];

/** Строковое значение параметра без крайних пробелов; массив и отсутствие — пустая строка. */
export function stringParam(sp: RawSearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim().slice(0, MAX_PARAM_LENGTH) : "";
}

/** Флажок формы: «1», «on» или «true» — включён, всё остальное — выключен. */
function flagParam(sp: RawSearchParams, key: string): boolean {
  const v = stringParam(sp, key).toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

/** Значение из закрытого списка; неизвестное — пустая строка (фильтр не применяется). */
function oneOf<T extends string>(value: string, allowed: readonly T[]): T | "" {
  return (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

/** Номер страницы: целое не меньше 1; мусор — первая страница. */
function pageParam(sp: RawSearchParams): number {
  const raw = stringParam(sp, "page");
  if (!/^\d{1,6}$/.test(raw)) return 1;
  return Math.max(1, Number.parseInt(raw, 10));
}

/** Фильтры каталога из searchParams страницы. */
export function parseCatalogQuery(sp: RawSearchParams): CatalogQuery {
  const sort = oneOf(stringParam(sp, "sort"), SORTS);
  return {
    q: stringParam(sp, "q"),
    facility: stringParam(sp, "facility"),
    process: stringParam(sp, "process"),
    solutionType: stringParam(sp, "solutionType"),
    status: oneOf(stringParam(sp, "status"), STATUSES),
    level: oneOf(stringParam(sp, "level"), LEVELS),
    confirmed: flagParam(sp, "confirmed"),
    raas: flagParam(sp, "raas"),
    sort: sort === "" ? "name" : sort,
    page: pageParam(sp),
  };
}

/** Фильтры для `getCatalogList`: пустые значения не передаются. */
export function toCatalogFilters(query: CatalogQuery): CatalogFilters {
  const f: CatalogFilters = { sort: query.sort, page: query.page };
  if (query.q) f.q = query.q;
  if (query.facility) f.facility = query.facility;
  if (query.process) f.process = query.process;
  if (query.solutionType) f.solutionType = query.solutionType;
  if (query.status) f.status = query.status;
  if (query.level) f.level = query.level;
  if (query.confirmed) f.confirmedOnly = true;
  if (query.raas) f.raas = true;
  return f;
}

/** Применён ли хоть один фильтр или поиск (сортировка и страница — не фильтры). */
export function hasActiveFilters(query: CatalogQuery): boolean {
  return (
    query.q !== "" ||
    query.facility !== "" ||
    query.process !== "" ||
    query.solutionType !== "" ||
    query.status !== "" ||
    query.level !== "" ||
    query.confirmed ||
    query.raas
  );
}

/** Пустые фильтры: сортировка по названию, первая страница. */
export const EMPTY_QUERY: CatalogQuery = {
  q: "",
  facility: "",
  process: "",
  solutionType: "",
  status: "",
  level: "",
  confirmed: false,
  raas: false,
  sort: "name",
  page: 1,
};

/**
 * Ссылка на список каталога с данными фильтрами. В адрес попадают только заданные значения,
 * в постоянном порядке; сортировка по названию и первая страница — умолчания и не пишутся.
 */
export function catalogHref(patch: Partial<CatalogQuery> = {}, base: CatalogQuery = EMPTY_QUERY): string {
  const q = { ...base, ...patch };
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.facility) params.set("facility", q.facility);
  if (q.process) params.set("process", q.process);
  if (q.solutionType) params.set("solutionType", q.solutionType);
  if (q.status) params.set("status", q.status);
  if (q.level) params.set("level", q.level);
  if (q.confirmed) params.set("confirmed", "1");
  if (q.raas) params.set("raas", "1");
  if (q.sort !== "name") params.set("sort", q.sort);
  if (q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s === "" ? "/catalog" : `/catalog?${s}`;
}

/** Ссылка на карточку продукта. */
export function productHref(slug: string): string {
  return `/catalog/${encodeURIComponent(slug)}`;
}

/** Выбор для сравнения: не больше MAX_COMPARE slug'ов и число отброшенных сверх предела. */
export type CompareSelection = { slugs: string[]; overflow: number };

/**
 * Slug'и для сравнения из параметра `ids`. Принимаются обе формы: «ids=a,b» (ссылка
 * «Сравнить выбранные») и «ids=a&ids=b» (та же форма, отправленная без JavaScript). Пустые
 * элементы и повторы отбрасываются, порядок сохраняется; сверх MAX_COMPARE — в `overflow`.
 */
export function parseCompareIds(raw: string | string[] | undefined): CompareSelection {
  const parts = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).flatMap((s) => s.split(","));
  const unique: string[] = [];
  for (const p of parts) {
    const slug = p.trim().slice(0, MAX_PARAM_LENGTH);
    if (slug !== "" && !unique.includes(slug)) unique.push(slug);
  }
  return { slugs: unique.slice(0, MAX_COMPARE), overflow: Math.max(0, unique.length - MAX_COMPARE) };
}

/** Ссылка на сравнение: «/catalog/compare?ids=a,b» (запятые не кодируются — адрес читаем). */
export function compareHref(slugs: readonly string[]): string {
  const ids = slugs.map((s) => encodeURIComponent(s)).join(",");
  return ids === "" ? "/catalog/compare" : `/catalog/compare?ids=${ids}`;
}
