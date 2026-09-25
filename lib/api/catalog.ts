import type { CatalogFilters, CatalogSort } from "../catalog/queries";
import { isFacilitySlug, processDef, solutionTypeDef } from "../tz/processes";

/**
 * Разбор строки запроса GET /api/v1/catalog (ТЗ §3.3.7 — фильтр, поиск, сортировка; §3.8 —
 * выгрузка каталога для аналитики ФЦ БАС). Неизвестный параметр или значение — ошибка 422 с
 * подсказкой, а не молчаливый пустой список: интеграция должна узнать об опечатке.
 */

/** Допустимые параметры строки запроса и их описание (для сообщения и документации). */
export const CATALOG_QUERY_PARAMS = [
  "facility",
  "process",
  "solutionType",
  "status",
  "level",
  "q",
  "sort",
  "page",
  "confirmedOnly",
  "raas",
] as const;

const STATUSES = ["operation", "piloting", "rnd"] as const;
const LEVELS = ["identification", "enriched", "examples"] as const;
const SORTS: readonly CatalogSort[] = ["name", "price", "throughput", "completeness"];
const Q_MAX = 100;

/** Итог разбора: фильтры для getCatalogList или список ошибок. */
export type CatalogQueryCheck = { ok: true; filters: CatalogFilters } | { ok: false; errors: string[] };

/** Логический флаг строки запроса: 1/true/да → true, 0/false/нет → false. */
function flag(value: string, name: string, errors: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false" || v === "") return false;
  errors.push(`${name} — 1 или 0 (true или false)`);
  return false;
}

export function parseCatalogQuery(sp: URLSearchParams): CatalogQueryCheck {
  const errors: string[] = [];
  const known = new Set<string>(CATALOG_QUERY_PARAMS);
  const seen = new Set<string>();
  for (const key of sp.keys()) {
    if (!known.has(key)) errors.push(`Параметр «${key}» не поддерживается — допустимы ${CATALOG_QUERY_PARAMS.join(", ")}`);
    else if (seen.has(key)) errors.push(`Параметр «${key}» указан дважды`);
    seen.add(key);
  }
  const filters: CatalogFilters = {};
  const get = (k: (typeof CATALOG_QUERY_PARAMS)[number]) => {
    const v = sp.get(k);
    return v === null || v.trim() === "" ? null : v.trim();
  };

  const facility = get("facility");
  if (facility !== null) {
    if (!isFacilitySlug(facility)) errors.push("facility — warehouse, airport или medical");
    else filters.facility = facility;
  }
  const process = get("process");
  if (process !== null) {
    if (!processDef(process)) errors.push(`process «${process}» неизвестен — slug процесса есть в описании API`);
    else filters.process = process;
  }
  const solutionType = get("solutionType");
  if (solutionType !== null) {
    if (!solutionTypeDef(solutionType)) errors.push(`solutionType «${solutionType}» неизвестен — slug типа решения есть в описании API`);
    else filters.solutionType = solutionType;
  }
  const status = get("status");
  if (status !== null) {
    if (!(STATUSES as readonly string[]).includes(status)) errors.push(`status — ${STATUSES.join(", ")}`);
    else filters.status = status;
  }
  const level = get("level");
  if (level !== null) {
    if (!(LEVELS as readonly string[]).includes(level)) errors.push(`level — ${LEVELS.join(", ")}`);
    else filters.level = level;
  }
  const q = get("q");
  if (q !== null) {
    if (q.length > Q_MAX) errors.push(`q — не длиннее ${Q_MAX} символов`);
    else filters.q = q;
  }
  const sort = get("sort");
  if (sort !== null) {
    if (!(SORTS as readonly string[]).includes(sort)) errors.push(`sort — ${SORTS.join(", ")}`);
    else filters.sort = sort as CatalogSort;
  }
  const page = get("page");
  if (page !== null) {
    const n = /^\d{1,6}$/.test(page) ? Number(page) : NaN;
    if (!(Number.isInteger(n) && n >= 1)) errors.push("page — номер страницы, целое число от 1");
    else filters.page = n;
  }
  const confirmedOnly = sp.get("confirmedOnly");
  if (confirmedOnly !== null && flag(confirmedOnly, "confirmedOnly", errors)) filters.confirmedOnly = true;
  const raas = sp.get("raas");
  if (raas !== null && flag(raas, "raas", errors)) filters.raas = true;

  return errors.length > 0 ? { ok: false, errors } : { ok: true, filters };
}
