import Link from "next/link";
import type { CatalogProductDetail } from "@/lib/catalog/queries";
import { catalogHref } from "./search-params";

/**
 * «Хлебные крошки» карточки продукта по иерархии ТЗ §3.3.1: отрасль → тип объекта → процесс →
 * тип решения → продукт. Каждое звено, кроме отрасли и самого продукта, — ссылка на список
 * каталога с соответствующими фильтрами (у отрасли своего фильтра нет).
 *
 * Продукт бывает в нескольких процессах и типах объектов (MULE, Carrier P, Pallet Shuttle),
 * поэтому путей может быть несколько — по одному на пару «тип объекта — процесс». Звено,
 * которого у продукта нет (продукт на уровне идентификации без привязки к процессу),
 * показывается как «не указан», а не пропускается: так видно, где карточка не дотягивает
 * до иерархии.
 */

/** Звено пути со ссылкой на отфильтрованный список. */
export type TrailLink = { slug: string; name: string; href: string };

/** Один путь по иерархии для продукта. */
export type HierarchyTrail = {
  industry: string | null;
  facility: TrailLink | null;
  process: TrailLink | null;
  solutionType: TrailLink | null;
  product: string;
};

/** Уровни иерархии в порядке ТЗ §3.3.1 — подпись над путями. */
export const HIERARCHY_LEVELS = ["Отрасль", "Тип объекта", "Процесс", "Тип решения", "Продукт"] as const;

type TrailProduct = Pick<CatalogProductDetail, "name" | "facilityTypes" | "processes" | "solutionType">;

/**
 * Пути по иерархии для продукта. `processFacilities` — к каким типам объектов относится
 * каждый процесс (связи FacilityTypeProcess из БД).
 * - Для каждого типа объекта продукта — по пути на каждый его процесс этого объекта; процессов
 *   этого объекта нет — один путь без процесса.
 * - Процесс, не попавший ни в один путь (его объекта нет в карточке), — отдельный путь без
 *   отрасли и объекта.
 * - Ни объектов, ни процессов — один путь с типом решения и продуктом.
 */
export function buildTrails(product: TrailProduct, processFacilities: ReadonlyMap<string, readonly string[]>): HierarchyTrail[] {
  const trails: HierarchyTrail[] = [];
  const used = new Set<string>();
  const st = product.solutionType;
  const stLink = (facility: string, process: string): TrailLink | null =>
    st ? { slug: st.slug, name: st.name, href: catalogHref({ facility, process, solutionType: st.slug }) } : null;

  for (const f of product.facilityTypes) {
    const facility: TrailLink = { slug: f.slug, name: f.name, href: catalogHref({ facility: f.slug }) };
    const procs = product.processes.filter((p) => (processFacilities.get(p.slug) ?? []).includes(f.slug));
    if (procs.length === 0) {
      trails.push({ industry: f.industry?.name ?? null, facility, process: null, solutionType: stLink(f.slug, ""), product: product.name });
      continue;
    }
    for (const p of procs) {
      used.add(p.slug);
      trails.push({
        industry: f.industry?.name ?? null,
        facility,
        process: { slug: p.slug, name: p.name, href: catalogHref({ facility: f.slug, process: p.slug }) },
        solutionType: stLink(f.slug, p.slug),
        product: product.name,
      });
    }
  }
  for (const p of product.processes) {
    if (used.has(p.slug)) continue;
    trails.push({
      industry: null,
      facility: null,
      process: { slug: p.slug, name: p.name, href: catalogHref({ process: p.slug }) },
      solutionType: stLink("", p.slug),
      product: product.name,
    });
  }
  if (trails.length === 0) {
    trails.push({ industry: null, facility: null, process: null, solutionType: stLink("", ""), product: product.name });
  }
  return trails;
}

function Missing() {
  return <span className="text-muted-foreground italic">не указан</span>;
}

function Crumb({ link }: { link: TrailLink | null }) {
  if (!link) return <Missing />;
  return (
    <Link href={link.href} prefetch={false} className="text-primary underline-offset-2 hover:underline">
      {link.name}
    </Link>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="px-1 text-muted-foreground">
      →
    </span>
  );
}

export function Breadcrumb({ trails }: { trails: readonly HierarchyTrail[] }) {
  return (
    <nav aria-label="Место в иерархии каталога" className="flex flex-col gap-1 text-sm">
      <p className="text-xs text-muted-foreground">{HIERARCHY_LEVELS.join(" → ")}</p>
      {trails.map((t, i) => (
        <ol
          key={`${t.facility?.slug ?? "-"}:${t.process?.slug ?? "-"}:${i}`}
          className="flex flex-wrap items-baseline gap-y-0.5"
        >
          {[
            <span key="industry">{t.industry ?? <Missing />}</span>,
            <Crumb key="facility" link={t.facility} />,
            <Crumb key="process" link={t.process} />,
            <Crumb key="solutionType" link={t.solutionType} />,
          ].map((node, j) => (
            <li key={HIERARCHY_LEVELS[j]} className="inline">
              <span className="sr-only">{HIERARCHY_LEVELS[j]}: </span>
              {node}
              <Arrow />
            </li>
          ))}
          <li className="inline font-medium" aria-current="page">
            <span className="sr-only">Продукт: </span>
            {t.product}
          </li>
        </ol>
      ))}
    </nav>
  );
}
