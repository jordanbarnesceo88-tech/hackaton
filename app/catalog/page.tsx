import Link from "next/link";
import { connection } from "next/server";
import { CatalogTable, TABLE_FOOTNOTE } from "@/components/catalog/catalog-table";
import { CompareForm } from "@/components/catalog/compare-form";
import { CatalogFiltersForm } from "@/components/catalog/filters";
import { buildHierarchy, CatalogHierarchy } from "@/components/catalog/hierarchy";
import { LEVEL_LABELS, STATUS_LABELS, SORT_OPTIONS } from "@/components/catalog/labels";
import { facilityName, processName, solutionTypeName, type CatalogOptions } from "@/components/catalog/options";
import { Pagination } from "@/components/catalog/pagination";
import {
  catalogHref,
  hasActiveFilters,
  parseCatalogQuery,
  toCatalogFilters,
  type CatalogQuery,
  type RawSearchParams,
} from "@/components/catalog/search-params";
import { getCatalogList, latestDataRelease } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { pluralRu } from "@/lib/format/plural";
import { formatNum } from "@/lib/format/rub";
import { getCatalogOptions, getHierarchyProducts } from "./_lib/data";

export const metadata = { title: "Каталог роботизированных решений — Платформа оценки роботизации" };

/** Дата выпуска данных по-русски: «25 сентября 2026 г.» (время — московское, как у организатора). */
const RELEASE_DATE = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" });

/** Применённые фильтры словами — строка над таблицей: видно, почему список именно такой. */
function activeFilterLabels(query: CatalogQuery, options: CatalogOptions): string[] {
  const out: string[] = [];
  if (query.q) out.push(`поиск «${query.q}»`);
  if (query.facility) out.push(`тип объекта «${facilityName(options, query.facility)}»`);
  if (query.process) out.push(`процесс «${processName(options, query.process)}»`);
  if (query.solutionType) out.push(`тип решения «${solutionTypeName(options, query.solutionType)}»`);
  if (query.status) out.push(`статус «${STATUS_LABELS[query.status]}»`);
  if (query.level) out.push(`глубина описания «${LEVEL_LABELS[query.level]}»`);
  if (query.confirmed) out.push("только с подтверждёнными данными");
  if (query.raas) out.push("есть модель RaaS");
  return out;
}

/**
 * Публичный каталог роботизированных решений (ТЗ §3.3, §3.1.2 — доступен гостю без входа):
 * иерархия отрасль → тип объекта → процесс → тип решения → продукт, фильтры, поиск,
 * сортировка, страницы по 50 и выбор до четырёх решений для сравнения.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  // Каталог правит администратор и обновляет синхронизация: страница всегда читает БД на запросе.
  await connection();
  const sp = await searchParams;
  const query = parseCatalogQuery(sp);
  const [list, options, hierarchyProducts, release] = await Promise.all([
    getCatalogList(prisma, toCatalogFilters(query)),
    getCatalogOptions(prisma),
    getHierarchyProducts(prisma),
    latestDataRelease(prisma),
  ]);
  const active = hasActiveFilters(query);
  const tree = buildHierarchy(options.facilities, hierarchyProducts);
  const unassigned = hierarchyProducts.filter((p) => p.facilityTypeSlugs.length === 0).length;
  const filters = activeFilterLabels(query, options);
  const sortLabel = SORT_OPTIONS.find((s) => s.value === query.sort)?.label ?? "";
  const beyondLastPage = list.total > 0 && list.items.length === 0;
  const found = `${formatNum(list.total)} ${pluralRu(list.total, ["решение", "решения", "решений"])}`;

  return (
    <div className="surface-data flex flex-col gap-6 py-8">
      <header className="flex max-w-4xl flex-col gap-2">
        <h1>Каталог роботизированных решений</h1>
        <p className="text-muted-foreground">
          Решения из каталога организатора, дополненные характеристиками из открытых источников. В карточке у
          каждой характеристики указаны источник, дата проверки и признак подтверждения первоисточником; спорные
          значения показаны вместе с альтернативами.
        </p>
        <p className="text-xs text-muted-foreground">
          {release
            ? `Выпуск данных ${release.version} от ${RELEASE_DATE.format(release.seededAt)} · всего в каталоге ${formatNum(hierarchyProducts.length)} ${pluralRu(hierarchyProducts.length, ["продукт", "продукта", "продуктов"])}`
            : "Данные каталога ещё не загружены: выполните npm run db:seed."}
        </p>
      </header>

      {/* Дерево свёрнуто: на экране 1366×768 раскрытое (~480 px) уводит таблицу ниже первого экрана. */}
      <CatalogHierarchy tree={tree} unassigned={unassigned} open={false} />

      <CatalogFiltersForm query={query} options={options} />

      <section aria-labelledby="catalog-results" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="catalog-results">Найдено {found}</h2>
          <p className="text-sm text-muted-foreground">
            {sortLabel && `Сортировка ${sortLabel}`}
            {list.pageCount > 1 && ` · страница ${formatNum(Math.min(query.page, list.pageCount))} из ${formatNum(list.pageCount)}`}
          </p>
        </div>
        {filters.length > 0 && <p className="text-sm">Применены фильтры: {filters.join(", ")}.</p>}

        {list.total === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-6 text-sm">
            <p className="font-medium">По этим условиям решений нет.</p>
            <p className="mt-1 text-muted-foreground">
              Уберите часть фильтров или измените запрос. Продукты, описанные только на уровне идентификации,
              часто не привязаны к типу объекта и процессу — попробуйте искать без фильтра «Тип объекта».
            </p>
            {active && (
              <Link href="/catalog" prefetch={false} className="mt-2 inline-block text-primary underline underline-offset-2">
                Показать весь каталог
              </Link>
            )}
          </div>
        ) : beyondLastPage ? (
          <div className="rounded-lg border bg-card px-4 py-6 text-sm">
            <p>Такой страницы нет: в выборке {formatNum(list.pageCount)} {pluralRu(list.pageCount, ["страница", "страницы", "страниц"])}.</p>
            <Link href={catalogHref({ page: 1 }, query)} prefetch={false} className="mt-2 inline-block text-primary underline underline-offset-2">
              К первой странице
            </Link>
          </div>
        ) : (
          <CompareForm>
            <CatalogTable items={list.items} caption={`Каталог: найдено ${found}`} />
            <p className="text-xs text-muted-foreground">{TABLE_FOOTNOTE}</p>
          </CompareForm>
        )}

        <Pagination query={query} pageCount={list.pageCount} />
      </section>
    </div>
  );
}
