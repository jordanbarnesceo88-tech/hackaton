import Link from "next/link";
import { connection } from "next/server";
import { CreateProductForm } from "@/components/admin/create-product-form";
import { FACILITY_NAMES, LEVEL_LABELS, STATUS_LABELS } from "@/components/admin/format";
import {
  CHIP_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  LABEL_TEXT_CLASS,
  SELECT_CLASS,
  TABLE_WRAP_CLASS,
  TD_CLASS,
  TH_CLASS,
} from "@/components/admin/styles";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/guards";
import { compareProcessSlugs } from "@/lib/catalog/product-for-calc";
import { prisma } from "@/lib/db/client";
import { formatNum, formatRub } from "@/lib/format/rub";
import { cn } from "@/lib/utils";

export const metadata = { title: "Каталог — администрирование — Платформа оценки роботизации" };

/** Строк на странице списка. */
const PAGE_SIZE = 100;

/** Какие продукты показать. */
const SHOW_OPTIONS = {
  active: "Действующие (без архива)",
  verify: "Требуют проверки",
  edited: "С правками администратора",
  admin: "Заведены администратором",
  archived: "В архиве",
  all: "Все",
} as const;
type Show = keyof typeof SHOW_OPTIONS;

function isShow(v: unknown): v is Show {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SHOW_OPTIONS, v);
}

/** Нормализация для поиска: регистр по правилам русской локали, «ё» = «е». */
function fold(s: string): string {
  return s.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

/**
 * Список каталога для администратора (ТЗ §3.3.5, §3.3.7): поиск по названию, производителю,
 * описанию и slug, отбор по архиву и правкам, переход в карточку; внизу — «Создать продукт».
 * В отличие от гостевого каталога здесь видны и архивные продукты. Каталог — пара сотен строк,
 * поэтому поиск идёт в памяти (как в lib/catalog/queries: ILIKE в базе с локалью C не
 * сворачивает регистр кириллицы).
 */
export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const show: Show = isShow(sp.show) ? sp.show : "active";
  const pageRaw = typeof sp.page === "string" ? Number.parseInt(sp.page, 10) : 1;

  const [rows, solutionTypes, processes] = await Promise.all([
    prisma.catalogProduct.findMany({
      select: {
        slug: true,
        name: true,
        manufacturer: true,
        description: true,
        level: true,
        status: true,
        origin: true,
        editedByAdmin: true,
        archived: true,
        excluded: true,
        needsVerification: true,
        completenessPct: true,
        priceRub: true,
        solutionType: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    }),
    prisma.solutionType.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }),
    prisma.process.findMany({
      select: {
        slug: true,
        name: true,
        facilityTypes: { select: { facilityType: { select: { slug: true } } } },
      },
    }),
  ]);

  const tokens = fold(q).split(/\s+/).filter((t) => t !== "");
  const filtered = rows.filter((r) => {
    switch (show) {
      case "active":
        if (r.archived) return false;
        break;
      case "verify":
        if (r.archived || !r.needsVerification) return false;
        break;
      case "edited":
        if (!r.editedByAdmin || r.origin !== "ORGANIZER") return false;
        break;
      case "admin":
        if (r.origin !== "ADMIN") return false;
        break;
      case "archived":
        if (!r.archived) return false;
        break;
      case "all":
        break;
    }
    if (tokens.length === 0) return true;
    const haystack = fold([r.name, r.manufacturer ?? "", r.description, r.slug].join("\n"));
    return tokens.every((t) => haystack.includes(t));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(1, pageRaw), pageCount) : 1;
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const processOptions = [...processes]
    .sort((a, b) => compareProcessSlugs(a.slug, b.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      facilities:
        p.facilityTypes.map((l) => FACILITY_NAMES[l.facilityType.slug] ?? l.facilityType.slug).join(", ") ||
        "без объекта",
    }));

  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (q !== "") params.set("q", q);
    if (show !== "active") params.set("show", show);
    if (n > 1) params.set("page", String(n));
    const s = params.toString();
    return s === "" ? "/admin/catalog" : `/admin/catalog?${s}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1>Каталог решений</h1>
        <p className="max-w-3xl text-muted-foreground">
          Продукты из данных организатора и заведённые администратором. В карточке продукта правятся идентификация и
          каждая характеристика с источником, датой проверки и признаком подтверждения.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search" aria-label="Поиск по каталогу">
        <label className={cn(LABEL_CLASS, "w-72 max-w-full")}>
          <span className={LABEL_TEXT_CLASS}>Поиск</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="например, Ronavi или тягач"
            className={INPUT_CLASS}
          />
        </label>
        <label className={cn(LABEL_CLASS, "w-64 max-w-full")}>
          <span className={LABEL_TEXT_CLASS}>Показать</span>
          <select name="show" defaultValue={show} className={SELECT_CLASS}>
            {Object.entries(SHOW_OPTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Найти
        </button>
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="adm-cat-list">
        <h2 id="adm-cat-list" className="text-lg">
          Найдено: {formatNum(filtered.length)}
          {pageCount > 1 ? ` · страница ${page} из ${pageCount}` : ""}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ничего не найдено — измените запрос или выберите «Все» в поле «Показать».
          </p>
        ) : (
          <div className={TABLE_WRAP_CLASS}>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Продукты каталога</caption>
              <thead className="bg-muted/40">
                <tr>
                  <th scope="col" className={TH_CLASS}>
                    Продукт
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Тип решения
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Описание и статус
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    Полнота
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    Цена
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Отметки
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.slug}>
                    <td className={TD_CLASS}>
                      <Link
                        href={`/admin/catalog/${encodeURIComponent(r.slug)}`}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        {r.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {r.manufacturer ?? "производитель не указан"} · <code>{r.slug}</code>
                      </span>
                    </td>
                    <td className={TD_CLASS}>{r.solutionType?.name ?? "—"}</td>
                    <td className={TD_CLASS}>
                      {LEVEL_LABELS[r.level] ?? r.level} · {STATUS_LABELS[r.status] ?? r.status}
                    </td>
                    <td className={`${TD_CLASS} text-right tabular-nums`}>{r.completenessPct} %</td>
                    <td className={`${TD_CLASS} text-right whitespace-nowrap tabular-nums`}>{formatRub(r.priceRub)}</td>
                    <td className={TD_CLASS}>
                      <span className="flex flex-wrap gap-1">
                        {r.origin === "ADMIN" && <span className={cn(CHIP_CLASS, "bg-secondary")}>администратор</span>}
                        {r.origin === "ORGANIZER" && r.editedByAdmin && (
                          <span className={cn(CHIP_CLASS, "border-caution/40 bg-caution/10")}>правка</span>
                        )}
                        {r.archived && <span className={cn(CHIP_CLASS, "bg-muted")}>архив</span>}
                        {r.excluded && <span className={cn(CHIP_CLASS, "bg-muted")}>исключён</span>}
                        {r.needsVerification && (
                          <span className={cn(CHIP_CLASS, "border-caution/40")}>требует проверки</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <nav aria-label="Страницы списка" className="flex flex-wrap gap-2 text-sm">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) =>
              n === page ? (
                <span key={n} aria-current="page" className="rounded-md bg-muted px-3 py-1 font-medium">
                  {n}
                </span>
              ) : (
                <Link key={n} href={pageHref(n)} className="tap-target rounded-md px-3 py-1 underline">
                  {n}
                </Link>
              ),
            )}
          </nav>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="adm-cat-create">
        <h2 id="adm-cat-create" className="text-lg">
          Создать продукт
        </h2>
        <p className="text-sm text-muted-foreground">
          Продукт получит отметку «заведён администратором». Характеристики с источниками заполняются в карточке, куда
          форма переведёт после создания; пока их нет, продукт в подборе помечен «требует проверки».
        </p>
        <CreateProductForm solutionTypes={solutionTypes} processes={processOptions} />
      </section>
    </div>
  );
}
