import Link from "next/link";
import { pluralRu } from "@/lib/format/plural";
import { formatNum } from "@/lib/format/rub";
import type { FacilityOption, IndustryRef } from "./options";
import { catalogHref } from "./search-params";

/**
 * Дерево иерархии каталога (ТЗ §3.3.1): отрасль → тип объекта → процесс → тип решения, с числом
 * продуктов на каждом звене. Каждое звено — ссылка на список с теми же фильтрами, поэтому число
 * в дереве и число найденных после перехода совпадают: оба считаются по одним правилам
 * (тип объекта — по привязке продукта к объекту, процесс — по связи продукта с процессом, тип
 * решения — по типу продукта; архивные продукты не считаются).
 */

/** Продукт в той форме, которая нужна для подсчёта по дереву. */
export type HierarchyProduct = {
  facilityTypeSlugs: readonly string[];
  processSlugs: readonly string[];
  solutionType: { slug: string; name: string } | null;
};

export type HierarchySolutionNode = { slug: string; name: string; count: number };
export type HierarchyProcessNode = { slug: string; name: string; count: number; solutionTypes: HierarchySolutionNode[] };
export type HierarchyFacilityNode = { slug: string; name: string; count: number; processes: HierarchyProcessNode[] };
export type HierarchyIndustryNode = { industry: IndustryRef | null; facilities: HierarchyFacilityNode[] };

/**
 * Дерево с числами продуктов. Типы объектов идут в порядке `facilities`, отрасли — в порядке
 * первого появления; типы решений внутри процесса — по убыванию числа, затем по названию.
 * Продукт без типа решения учитывается в числе процесса, но не в разбивке по типам.
 */
export function buildHierarchy(
  facilities: readonly FacilityOption[],
  products: readonly HierarchyProduct[],
): HierarchyIndustryNode[] {
  const industries: HierarchyIndustryNode[] = [];
  for (const f of facilities) {
    const inFacility = products.filter((p) => p.facilityTypeSlugs.includes(f.slug));
    const processes: HierarchyProcessNode[] = f.processes.map((proc) => {
      const inProcess = inFacility.filter((p) => p.processSlugs.includes(proc.slug));
      const bySolution = new Map<string, HierarchySolutionNode>();
      for (const p of inProcess) {
        if (!p.solutionType) continue;
        const node = bySolution.get(p.solutionType.slug) ?? { slug: p.solutionType.slug, name: p.solutionType.name, count: 0 };
        node.count += 1;
        bySolution.set(p.solutionType.slug, node);
      }
      const solutionTypes = [...bySolution.values()].sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"),
      );
      return { slug: proc.slug, name: proc.name, count: inProcess.length, solutionTypes };
    });
    const node: HierarchyFacilityNode = { slug: f.slug, name: f.name, count: inFacility.length, processes };
    const key = f.industry?.slug ?? null;
    const group = industries.find((g) => (g.industry?.slug ?? null) === key);
    if (group) group.facilities.push(node);
    else industries.push({ industry: f.industry, facilities: [node] });
  }
  return industries;
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 text-xs tabular-nums text-muted-foreground">({formatNum(n)})</span>;
}

export function CatalogHierarchy({
  tree,
  unassigned,
  open,
}: {
  tree: readonly HierarchyIndustryNode[];
  /** Сколько продуктов не привязано ни к одному типу объекта (в дерево не попадают). */
  unassigned: number;
  open: boolean;
}) {
  if (tree.length === 0) return null;
  return (
    <details open={open} className="group/tree rounded-lg border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        Иерархия каталога: отрасль → тип объекта → процесс → тип решения
        <span className="ml-2 text-xs font-normal text-muted-foreground">в скобках — число продуктов</span>
      </summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {tree.flatMap((g) =>
          g.facilities.map((f) => (
            <div key={f.slug} className="flex flex-col gap-2">
              <div>
                <div className="text-xs text-muted-foreground">{g.industry?.name ?? "Отрасль не указана"}</div>
                <Link
                  href={catalogHref({ facility: f.slug })}
                  prefetch={false}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {f.name}
                </Link>
                <Count n={f.count} />
              </div>
              <ul className="grid gap-1.5 border-l pl-3">
                {f.processes.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={catalogHref({ facility: f.slug, process: p.slug })}
                      prefetch={false}
                      className="underline-offset-2 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <Count n={p.count} />
                    {p.solutionTypes.length > 0 && (
                      <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-3 text-xs">
                        {p.solutionTypes.map((s) => (
                          <li key={s.slug}>
                            <Link
                              href={catalogHref({ facility: f.slug, process: p.slug, solutionType: s.slug })}
                              prefetch={false}
                              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            >
                              {s.name}
                            </Link>
                            <Count n={s.count} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )),
        )}
      </div>
      {unassigned > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Не привязаны к типу объекта: {formatNum(unassigned)} {pluralRu(unassigned, ["продукт", "продукта", "продуктов"])} — они есть в
          списке, если не выбирать «Тип объекта».
        </p>
      )}
    </details>
  );
}
