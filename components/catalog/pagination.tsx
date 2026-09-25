import Link from "next/link";
import { cn } from "@/lib/utils";
import { catalogHref, type CatalogQuery } from "./search-params";

/**
 * Постраничная навигация списка каталога (по 50 строк, ТЗ §3.3.7). Ссылки сохраняют фильтры и
 * сортировку; текущая страница отмечена `aria-current="page"`. Одна страница — ничего не рисуется.
 */

/**
 * Номера страниц для показа: первая, последняя и соседи текущей, пропуски — null («…»).
 * Каталог организатора — четыре страницы, но при росте каталога ряд не разрастается.
 */
export function pageNumbers(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && n - prev > 1) out.push(null);
    out.push(n);
  }
  return out;
}

const ITEM_CLASS = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm tabular-nums";

export function Pagination({ query, pageCount }: { query: CatalogQuery; pageCount: number }) {
  if (pageCount <= 1) return null;
  const page = Math.min(query.page, pageCount);
  return (
    <nav aria-label="Страницы каталога" className="flex flex-wrap items-center gap-1">
      {page > 1 ? (
        <Link href={catalogHref({ page: page - 1 }, query)} prefetch={false} className={cn(ITEM_CLASS, "hover:bg-muted")}>
          ← Предыдущая
        </Link>
      ) : (
        <span className={cn(ITEM_CLASS, "text-muted-foreground opacity-60")} aria-hidden="true">
          ← Предыдущая
        </span>
      )}
      {pageNumbers(page, pageCount).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} className="px-1 text-muted-foreground" aria-hidden="true">
            …
          </span>
        ) : n === page ? (
          <span key={n} aria-current="page" className={cn(ITEM_CLASS, "border-primary bg-primary text-primary-foreground")}>
            <span className="sr-only">Страница </span>
            {n}
          </span>
        ) : (
          <Link key={n} href={catalogHref({ page: n }, query)} prefetch={false} className={cn(ITEM_CLASS, "hover:bg-muted")}>
            <span className="sr-only">Страница </span>
            {n}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={catalogHref({ page: page + 1 }, query)} prefetch={false} className={cn(ITEM_CLASS, "hover:bg-muted")}>
          Следующая →
        </Link>
      ) : (
        <span className={cn(ITEM_CLASS, "text-muted-foreground opacity-60")} aria-hidden="true">
          Следующая →
        </span>
      )}
    </nav>
  );
}
