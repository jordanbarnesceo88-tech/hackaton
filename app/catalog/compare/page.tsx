import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CompareTable } from "@/components/catalog/compare-table";
import {
  compareHref,
  MAX_COMPARE,
  parseCompareIds,
  stringParam,
  type RawSearchParams,
} from "@/components/catalog/search-params";
import { buttonVariants } from "@/components/ui/button";
import { getCatalogProducts } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { cn } from "@/lib/utils";
import { getCompareCandidates } from "../_lib/data";

export const metadata = { title: "Сравнение решений каталога — Платформа оценки роботизации" };

/** Параметр ids как список строк (одна строка, несколько или ни одной). */
function idsList(raw: string | string[] | undefined): string[] {
  return Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
}

/**
 * Сравнение до четырёх продуктов каталога (ТЗ §3.3.7): /catalog/compare?ids=a,b. Доступно гостю.
 * Форма «Добавить к сравнению» отправляет выбранный продукт параметром add — страница
 * перенаправляет на канонический адрес «ids=a,b,c», чтобы ссылку на сравнение можно было
 * отправить.
 */
export default async function CatalogComparePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await connection();
  const sp = await searchParams;
  const add = stringParam(sp, "add");
  if (add !== "") {
    // redirect() бросает исключение — вызывается вне try, до чтения БД.
    redirect(compareHref(parseCompareIds([...idsList(sp.ids), add]).slugs));
  }

  const selection = parseCompareIds(sp.ids);
  const products = await getCatalogProducts(prisma, selection.slugs);
  const missing = selection.slugs.filter((s) => !products.some((p) => p.slug === s));
  const processSlugs = [...new Set(products.flatMap((p) => p.processes.map((x) => x.slug)))];
  const candidates =
    products.length > 0 && products.length < MAX_COMPARE
      ? await getCompareCandidates(
          prisma,
          products.map((p) => p.slug),
          processSlugs,
        )
      : [];

  return (
    <div className="surface-data flex flex-col gap-6 py-8">
      <Link href="/catalog" prefetch={false} className="text-sm text-primary underline-offset-2 hover:underline">
        ← Весь каталог
      </Link>
      <header className="flex max-w-4xl flex-col gap-2">
        <h1>Сравнение решений</h1>
        <p className="text-muted-foreground">
          До {MAX_COMPARE} решений бок о бок по шести группам характеристик. У каждого значения — источник, дата
          проверки и признак подтверждения; ⚠ — источники расходятся, подробности в карточке продукта.
        </p>
      </header>

      {selection.overflow > 0 && (
        <p className="rounded-lg border border-caution/40 bg-caution/10 px-4 py-2 text-sm">
          Сравнить можно не больше {MAX_COMPARE} решений — показаны первые {MAX_COMPARE}; не вошло в сравнение:{" "}
          {selection.overflow}.
        </p>
      )}
      {missing.length > 0 && (
        <p className="rounded-lg border border-caution/40 bg-caution/10 px-4 py-2 text-sm">
          Не найдены в каталоге: {missing.join(", ")}. Возможно, ссылка устарела.
        </p>
      )}

      {products.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-6 text-sm">
          <p className="font-medium">Решения для сравнения не выбраны.</p>
          <p className="mt-1 text-muted-foreground">
            Отметьте от 2 до {MAX_COMPARE} решений в первой колонке таблицы каталога и нажмите «Сравнить выбранные».
          </p>
          <Link href="/catalog" prefetch={false} className={cn(buttonVariants({ size: "lg" }), "mt-3 px-4")}>
            Перейти в каталог
          </Link>
        </div>
      ) : (
        <>
          {products.length === 1 && (
            <p className="text-sm text-muted-foreground">
              Выбрано одно решение — добавьте ещё хотя бы одно, чтобы сравнить.
            </p>
          )}
          {candidates.length > 0 && (
            <form method="get" action="/catalog/compare" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="ids" value={products.map((p) => p.slug).join(",")} />
              <div className="flex min-w-72 flex-col gap-1">
                <label htmlFor="compare-add" className="text-xs font-medium text-muted-foreground">
                  {processSlugs.length > 0 ? "Добавить решение для тех же процессов" : "Добавить решение"}
                </label>
                <select
                  id="compare-add"
                  name="add"
                  required
                  defaultValue=""
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <option value="" disabled>
                    выберите решение
                  </option>
                  {candidates.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.manufacturer ? `${c.name} — ${c.manufacturer}` : c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-4")}>
                Добавить к сравнению
              </button>
            </form>
          )}
          <CompareTable products={products} />
          <p className="text-xs text-muted-foreground">
            Лучшее значение в строке не выделяется: значения взяты из разных источников с разной степенью
            подтверждения. Подбор с учётом параметров объекта — в демо-расчёте и в проекте.
          </p>
        </>
      )}
    </div>
  );
}
