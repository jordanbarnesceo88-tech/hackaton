import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SORT_OPTIONS, STATUS_LABELS } from "./labels";
import type { CatalogOptions } from "./options";
import { hasActiveFilters, type CatalogQuery } from "./search-params";

/**
 * Фильтры публичного каталога (ТЗ §3.3.7: фильтрация, поиск, сортировка). Обычная GET-форма
 * на /catalog: работает без JavaScript, а выборка остаётся в адресе — ссылку можно отправить.
 * Номер страницы в форму не входит, поэтому новая выборка всегда начинается с первой страницы.
 *
 * Процессы сгруппированы по типам объектов (<optgroup>): одинаковые по смыслу процессы разных
 * объектов («Уборка склада», «Уборка терминала») различаются группой.
 */

const FIELD_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none transition-colors " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";

const LABEL_CLASS = "text-xs font-medium text-muted-foreground";

const STATUS_ORDER = ["operation", "piloting", "rnd"] as const;

const LEVEL_FILTER: readonly { value: CatalogQuery["level"]; label: string }[] = [
  { value: "", label: "любая" },
  { value: "enriched", label: "с характеристиками и источниками" },
  { value: "examples", label: "из «Примеров решений» организатора" },
  { value: "identification", label: "только идентификация" },
];

export function CatalogFiltersForm({ query, options }: { query: CatalogQuery; options: CatalogOptions }) {
  const active = hasActiveFilters(query);
  // Сортировка по производительности сравнивает числа в разных единицах (паллет/ч, м²/ч,
  // строк/ч) — осмысленна только внутри одного процесса.
  const throughputHint = query.sort === "throughput" && query.process === "";
  return (
    <form
      method="get"
      action="/catalog"
      role="search"
      aria-label="Фильтры каталога"
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="catalog-q" className={LABEL_CLASS}>
            Поиск
          </label>
          <input
            id="catalog-q"
            name="q"
            type="search"
            defaultValue={query.q}
            maxLength={100}
            autoComplete="off"
            placeholder="Например: Ronavi, тягач, уборка"
            aria-describedby="catalog-q-hint"
            className={FIELD_CLASS}
          />
          <span id="catalog-q-hint" className="text-[11px] text-muted-foreground">
            Ищет все слова в названии, производителе и описании, без учёта регистра и «ё».
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="catalog-facility" className={LABEL_CLASS}>
            Тип объекта
          </label>
          <select id="catalog-facility" name="facility" defaultValue={query.facility} className={FIELD_CLASS}>
            <option value="">все</option>
            {options.facilities.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="catalog-process" className={LABEL_CLASS}>
            Процесс
          </label>
          <select id="catalog-process" name="process" defaultValue={query.process} className={FIELD_CLASS}>
            <option value="">все</option>
            {options.facilities.map((f) => (
              <optgroup key={f.slug} label={f.name}>
                {f.processes.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="catalog-solution-type" className={LABEL_CLASS}>
            Тип решения
          </label>
          <select id="catalog-solution-type" name="solutionType" defaultValue={query.solutionType} className={FIELD_CLASS}>
            <option value="">все</option>
            {options.solutionTypes.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="catalog-status" className={LABEL_CLASS}>
            Статус
          </label>
          <select id="catalog-status" name="status" defaultValue={query.status} className={FIELD_CLASS}>
            <option value="">любой</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="catalog-level" className={LABEL_CLASS}>
            Глубина описания
          </label>
          <select id="catalog-level" name="level" defaultValue={query.level} className={FIELD_CLASS}>
            {LEVEL_FILTER.map((l) => (
              <option key={l.value || "any"} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="catalog-sort" className={LABEL_CLASS}>
            Сортировка
          </label>
          <select
            id="catalog-sort"
            name="sort"
            defaultValue={query.sort}
            aria-describedby={throughputHint ? "catalog-sort-hint" : undefined}
            className={FIELD_CLASS}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {throughputHint && (
            <span id="catalog-sort-hint" className="text-[11px] text-caution">
              Производительность разных процессов измеряется в разных единицах — выберите процесс,
              чтобы сравнивать одинаковые величины.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <label className="flex max-w-md items-start gap-2 text-sm">
          <input type="checkbox" name="confirmed" value="1" defaultChecked={query.confirmed} className="mt-1" />
          <span>
            Только с подтверждёнными данными
            <span className="block text-[11px] text-muted-foreground">
              хотя бы одна характеристика подтверждена первоисточником (производителем)
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="raas" value="1" defaultChecked={query.raas} className="mt-1" />
          <span>
            Есть модель RaaS
            <span className="block text-[11px] text-muted-foreground">опубликована ставка аренды робота-как-услуги</span>
          </span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          {active && (
            <Link href="/catalog" prefetch={false} className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}>
              Сбросить
            </Link>
          )}
          <button type="submit" className={cn(buttonVariants({ size: "lg" }), "px-4")}>
            Показать
          </button>
        </div>
      </div>
    </form>
  );
}
