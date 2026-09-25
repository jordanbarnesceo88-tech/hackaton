import type { HierarchyProduct } from "@/components/catalog/hierarchy";
import type { CatalogOptions, FacilityOption } from "@/components/catalog/options";
import type { Db } from "@/lib/catalog/queries";
import { FACILITY_PROCESSES, SOLUTION_TYPE_DEFS } from "@/lib/tz/processes";

/**
 * Чтения для страниц публичного каталога, которых нет в lib/catalog/queries: справочники
 * фильтров, числа для дерева иерархии и связи «процесс — тип объекта» для «хлебных крошек».
 * Папка `_lib` приватная — Next не делает из неё маршрут. Клиент БД передаётся аргументом,
 * как в lib/catalog/queries.
 */

/** Порядок типов объектов: как в модели процессов (склад, аэропорт, медучреждение), прочие — по названию. */
const FACILITY_ORDER: readonly string[] = Object.keys(FACILITY_PROCESSES);
const SOLUTION_ORDER: ReadonlyMap<string, number> = new Map(SOLUTION_TYPE_DEFS.map((d, i) => [d.slug, i]));

function orderIndex(order: readonly string[], slug: string): number {
  const i = order.indexOf(slug);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Справочники фильтров: типы объектов, у которых есть процессы модели (с отраслью и процессами
 * в порядке объекта), и все типы решений (в порядке модели). Названия — из БД, то есть с
 * правками администратора.
 */
export async function getCatalogOptions(db: Db): Promise<CatalogOptions> {
  const facilityRows = await db.facilityType.findMany({
    where: { processes: { some: {} } },
    select: {
      slug: true,
      name: true,
      industry: { select: { slug: true, name: true } },
      processes: {
        select: { process: { select: { slug: true, name: true } } },
        orderBy: [{ order: "asc" }, { process: { order: "asc" } }, { process: { slug: "asc" } }],
      },
    },
  });
  const solutionRows = await db.solutionType.findMany({ select: { slug: true, name: true } });

  const facilities: FacilityOption[] = facilityRows
    .map((f) => ({
      slug: f.slug,
      name: f.name,
      industry: f.industry ? { slug: f.industry.slug, name: f.industry.name } : null,
      processes: f.processes.map((l) => ({ slug: l.process.slug, name: l.process.name })),
    }))
    .sort(
      (a, b) =>
        orderIndex(FACILITY_ORDER, a.slug) - orderIndex(FACILITY_ORDER, b.slug) || a.name.localeCompare(b.name, "ru"),
    );

  const solutionTypes = solutionRows
    .map((s) => ({ slug: s.slug, name: s.name }))
    .sort(
      (a, b) =>
        (SOLUTION_ORDER.get(a.slug) ?? Number.MAX_SAFE_INTEGER) - (SOLUTION_ORDER.get(b.slug) ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name, "ru"),
    );

  return { facilities, solutionTypes };
}

/**
 * Неархивные продукты в форме для подсчёта дерева иерархии: привязка к типам объектов,
 * процессы и тип решения. Каталог — пара сотен строк, читается одним лёгким запросом.
 */
export async function getHierarchyProducts(db: Db): Promise<HierarchyProduct[]> {
  const rows = await db.catalogProduct.findMany({
    where: { archived: false },
    select: {
      facilityTypeSlugs: true,
      solutionType: { select: { slug: true, name: true } },
      processes: { select: { process: { select: { slug: true } } } },
    },
  });
  return rows.map((r) => ({
    facilityTypeSlugs: r.facilityTypeSlugs,
    processSlugs: r.processes.map((l) => l.process.slug),
    solutionType: r.solutionType ? { slug: r.solutionType.slug, name: r.solutionType.name } : null,
  }));
}

/** Предел списка «Добавить к сравнению» — выпадающий список, а не второй каталог. */
const COMPARE_CANDIDATES_LIMIT = 100;

/**
 * Кандидаты «Добавить к сравнению»: неархивные продукты тех же процессов, что уже сравниваемые
 * (сравнивать осмысленно решения одной задачи), кроме уже выбранных. Если у выбранных нет
 * процессов — продукты с характеристиками (enriched, examples). По названию.
 */
export async function getCompareCandidates(
  db: Db,
  selected: readonly string[],
  processSlugs: readonly string[],
): Promise<{ slug: string; name: string; manufacturer: string | null }[]> {
  return db.catalogProduct.findMany({
    where: {
      archived: false,
      slug: { notIn: [...selected] },
      ...(processSlugs.length > 0
        ? { processes: { some: { process: { slug: { in: [...processSlugs] } } } } }
        : { level: { in: ["enriched", "examples"] } }),
    },
    select: { slug: true, name: true, manufacturer: true },
    orderBy: [{ name: "asc" }, { slug: "asc" }],
    take: COMPARE_CANDIDATES_LIMIT,
  });
}

/** К каким типам объектов относится каждый из процессов (связи FacilityTypeProcess). */
export async function getProcessFacilities(db: Db, processSlugs: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (processSlugs.length === 0) return out;
  const links = await db.facilityTypeProcess.findMany({
    where: { process: { slug: { in: [...processSlugs] } } },
    select: { process: { select: { slug: true } }, facilityType: { select: { slug: true } } },
  });
  for (const l of links) {
    const list = out.get(l.process.slug) ?? [];
    list.push(l.facilityType.slug);
    out.set(l.process.slug, list);
  }
  return out;
}
