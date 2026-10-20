import Link from "next/link";
import { fmtValue } from "@/components/project/comparison-table";
import type { CatalogListItem } from "@/lib/catalog/queries";
import { formatRub } from "@/lib/format/rub";
import { displayDataText } from "@/lib/tz/characteristics";
import { CompletenessBar, QualityChips, StatusChip } from "./chips";
import { NO_DATA } from "./labels";
import { productHref } from "./search-params";

/**
 * Таблица списка каталога (ТЗ §3.3.7): решение и производитель, тип, статус, цена,
 * производительность с единицей, полнота данных и пометки качества. Первая колонка — флажки
 * «сравнить» (`name="ids"`), их собирает окружающая форма сравнения (compare-form.tsx).
 *
 * Отсутствующее значение — «нет данных», а не ноль: цена и производительность публикуются не
 * у всех продуктов, и пустая ячейка не должна читаться как «бесплатно» или «0 паллет/ч».
 * Производительность сохраняет диапазон, оговорки и область действия первичной характеристики.
 * Её справочное отображение не меняет допустимое числовое значение для расчёта.
 */

/** Сколько процессов показывать под типом решения; остальные — «и ещё N». */
const MAX_PROCESSES_SHOWN = 2;

/** Цена за единицу или «нет данных». */
export function priceText(priceRub: number | null): string {
  return priceRub === null ? NO_DATA : formatRub(priceRub);
}

/** Полная справочная характеристика; числовой fallback для прежних строк и фикстур. */
export function throughputText(value: number | null, unit: string | null, display?: string | null): string {
  if (display !== undefined && display !== null) return display.trim() === "" || display.trim() === "—" ? NO_DATA : displayDataText(display);
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  const u = (unit ?? "").trim();
  return u === "" ? fmtValue(value) : `${fmtValue(value)} ${u}`;
}

/** Процессы строки коротко: «Перемещение паллет…, Сортировка и ещё 1». */
export function processesText(processes: readonly { name: string }[]): string | null {
  if (processes.length === 0) return null;
  const shown = processes.slice(0, MAX_PROCESSES_SHOWN).map((p) => p.name).join("; ");
  const rest = processes.length - MAX_PROCESSES_SHOWN;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/**
 * Сноска под таблицей: какие именно числа стоят в колонках цены и производительности.
 * Справочный показ не превращает предел или значение на парк в расчётную норму одного робота.
 */
export const TABLE_FOOTNOTE =
  "Цена и ставка RaaS — типичное значение диапазона из источника. Производительность приведена " +
  "как в карточке: с единицей, диапазоном и оговорками источника. Применимость к расчёту, " +
  "источник и дата проверки — в карточке продукта.";

export function CatalogTable({ items, caption }: { items: readonly CatalogListItem[]; caption: string }) {
  return (
    <div className="min-w-0 max-w-full">
      <p className="mb-2 text-xs text-muted-foreground">Все колонки доступны при горизонтальной прокрутке таблицы. С клавиатуры — стрелками.</p>
    <div className="data-table-wrap relative min-w-0 max-w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" role="region" aria-label={caption} tabIndex={0}>
      <table className="data-table min-w-[82rem] table-fixed [overflow-wrap:anywhere]">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-10" />
          <col className="w-56" />
          <col className="w-44" />
          <col className="w-36" />
          <col className="w-40" />
          <col className="w-60" />
          <col className="w-32" />
          <col className="w-[12.5rem]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="w-10">
              <span className="sr-only">Сравнить</span>
              <span aria-hidden="true">⇄</span>
            </th>
            <th scope="col">Решение и производитель</th>
            <th scope="col">Тип решения</th>
            <th scope="col">Статус</th>
            <th scope="col" className="text-right">Цена за единицу</th>
            <th scope="col" className="text-right">Производительность</th>
            <th scope="col">Полнота данных</th>
            <th scope="col">Пометки</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const checkboxId = `cmp-${item.slug}`;
            const processes = processesText(item.processes);
            const throughput = throughputText(item.throughputPerH, item.throughputUnit, item.throughputDisplay);
            return (
              <tr key={item.slug} className="align-top">
                <td>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    name="ids"
                    value={item.slug}
                    className="mt-1 size-4"
                    aria-label={`Сравнить: ${item.name}`}
                  />
                </td>
                <th scope="row" className="min-w-56 text-left font-normal">
                  <Link
                    href={productHref(item.slug)}
                    prefetch={false}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {item.name}
                  </Link>
                  {(item.manufacturer || item.country) && (
                    <div className="text-xs text-muted-foreground">
                      {[item.manufacturer, item.country].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </th>
                <td className="min-w-44">
                  {item.solutionType ? item.solutionType.name : <span className="text-muted-foreground">{NO_DATA}</span>}
                  {processes && <div className="mt-0.5 text-xs text-muted-foreground">{processes}</div>}
                </td>
                <td>
                  <StatusChip status={item.status} />
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">
                  <span className={item.priceRub === null ? "text-muted-foreground" : undefined}>{priceText(item.priceRub)}</span>
                  {item.raasRubMonth !== null && (
                    <div className="text-xs text-muted-foreground">RaaS: {formatRub(item.raasRubMonth)}/мес</div>
                  )}
                </td>
                <td className="whitespace-normal text-right tabular-nums">
                  <span className={throughput === NO_DATA ? "text-muted-foreground" : "font-medium"}>
                    {throughput}
                  </span>
                </td>
                <td>
                  <CompletenessBar pct={item.completenessPct} />
                </td>
                <td>
                  <QualityChips needsVerification={item.needsVerification} level={item.level} excluded={item.excluded} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}
