/**
 * Справочники фильтров и иерархии каталога (ТЗ §3.3.1): типы объектов с отраслью и
 * процессами, типы решений. Их читает страница из БД (app/catalog/_lib/data.ts) и передаёт
 * компонентам готовыми — компоненты к БД не обращаются.
 */

/** Звено «отрасль» иерархии. */
export type IndustryRef = { slug: string; name: string };

/** Тип объекта с отраслью и процессами в порядке объекта. */
export type FacilityOption = {
  slug: string;
  name: string;
  industry: IndustryRef | null;
  processes: { slug: string; name: string }[];
};

/** Тип решения (класс роботов). */
export type SolutionTypeOption = { slug: string; name: string };

/** Всё, что нужно форме фильтров и дереву иерархии. */
export type CatalogOptions = {
  facilities: FacilityOption[];
  solutionTypes: SolutionTypeOption[];
};

/** Название типа объекта по slug; неизвестный — сам slug. */
export function facilityName(options: CatalogOptions, slug: string): string {
  return options.facilities.find((f) => f.slug === slug)?.name ?? slug;
}

/** Название процесса по slug (из любого типа объекта); неизвестный — сам slug. */
export function processName(options: CatalogOptions, slug: string): string {
  for (const f of options.facilities) {
    const p = f.processes.find((x) => x.slug === slug);
    if (p) return p.name;
  }
  return slug;
}

/** Название типа решения по slug; неизвестный — сам slug. */
export function solutionTypeName(options: CatalogOptions, slug: string): string {
  return options.solutionTypes.find((s) => s.slug === slug)?.name ?? slug;
}
