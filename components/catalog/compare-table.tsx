import Link from "next/link";
import type { ReactNode } from "react";
import { SourceBadge } from "@/components/project/source-badge";
import { compareCharKeys, isCharPresent } from "@/lib/catalog/product-for-calc";
import type { CatalogCharacteristic, CatalogProductDetail } from "@/lib/catalog/queries";
import { CHAR_GROUP_LABELS, CHARACTERISTIC_KEYS } from "@/lib/tz/characteristics";
import type { CharGroup } from "@/lib/tz/characteristics";
import { formatPct, formatRub } from "@/lib/format/rub";
import { cn } from "@/lib/utils";
import { priceText, throughputText } from "./catalog-table";
import { ConfirmedMark } from "./characteristic-row";
import { ArchivedChip, CompletenessBar, LevelChip, StatusChip } from "./chips";
import { CHAR_GROUP_ORDER, groupStats, groupStatsText, requiredKeysOf } from "./group-section";
import { NO_DATA } from "./labels";
import { selectionParticipation } from "./product-card";
import { compareHref, productHref } from "./search-params";

/**
 * Сравнение до четырёх продуктов каталога бок о бок (ТЗ §3.3.7): продукты — столбцы, строки —
 * характеристики по шести группам ТЗ §3.3.4. В каждой ячейке — значение, бейдж источника,
 * признак подтверждения и ⚠ при расхождении источников. Строки группы — все обязательные
 * характеристики и все, что заполнены хотя бы у одного продукта; пропуск — «нет данных».
 *
 * «Лучшее» значение не выделяется намеренно: значения в строке взяты из разных источников с
 * разной степенью подтверждения, и подсветка выдала бы оценку за факт. Выбор с учётом объекта
 * делает подбор в проекте.
 */

type Product = CatalogProductDetail;

/** Ключи строк группы: обязательные и заполненные хотя бы у одного продукта, в порядке словаря. */
export function compareRowKeys(group: CharGroup, products: readonly Pick<Product, "characteristics">[]): string[] {
  const keys = new Set<string>(requiredKeysOf(group));
  for (const p of products) for (const c of p.characteristics[group]) if (isCharPresent(c)) keys.add(c.key);
  return [...keys].sort(compareCharKeys);
}

/** Подпись строки: из словаря характеристик или из самой характеристики. */
function rowLabel(key: string, products: readonly Product[], group: CharGroup): string {
  if (Object.prototype.hasOwnProperty.call(CHARACTERISTIC_KEYS, key)) {
    return CHARACTERISTIC_KEYS[key as keyof typeof CHARACTERISTIC_KEYS].label;
  }
  for (const p of products) {
    const c = p.characteristics[group].find((x) => x.key === key);
    if (c) return c.label;
  }
  return key;
}

function Cell({ c }: { c: CatalogCharacteristic | undefined }) {
  if (!c || !isCharPresent(c)) return <span className="text-muted-foreground">{NO_DATA}</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="break-words font-medium">{c.display}</span>
      {c.hasConflict && (
        <span className="text-xs font-medium text-caution">
          <span aria-hidden="true">⚠ </span>есть расхождения — см. карточку
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge
          origin={c.origin}
          sourceUrl={c.sourceUrl}
          sourceRef={c.sourceRef}
          date={c.verifiedAt}
          confirmed={c.confirmed}
          note={c.basis}
        />
        <span className="text-xs">
          <ConfirmedMark confirmed={c.confirmed} />
        </span>
      </div>
    </div>
  );
}

/** Строка сводки: подпись и значение для каждого продукта. */
function SummaryRow({ label, products, render }: { label: string; products: readonly Product[]; render: (p: Product) => ReactNode }) {
  return (
    <tr className="border-t align-top">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        {label}
      </th>
      {products.map((p) => (
        <td key={p.slug} className="px-3 py-2">
          {render(p)}
        </td>
      ))}
    </tr>
  );
}

function GroupHeader({ group, products }: { group: CharGroup; products: readonly Product[] }) {
  return (
    <tr className="border-t bg-muted/40">
      <th scope="colgroup" className="px-3 py-2 text-left font-heading font-semibold">
        {CHAR_GROUP_LABELS[group]}
      </th>
      {products.map((p) => {
        const stats = groupStats(group, p.characteristics[group]);
        return (
          <td key={p.slug} className={cn("px-3 py-2 text-xs", stats.filled < stats.required ? "text-caution" : "text-muted-foreground")}>
            {groupStatsText(stats)}
          </td>
        );
      })}
    </tr>
  );
}

export function CompareTable({ products }: { products: readonly Product[] }) {
  const slugs = products.map((p) => p.slug);
  return (
    <div className="data-table-wrap relative">
      <table className="w-full min-w-[48rem] table-fixed border-collapse text-sm">
        <caption className="sr-only">Сравнение решений каталога по группам характеристик</caption>
        <colgroup>
          <col className="w-52" />
          {products.map((p) => (
            <col key={p.slug} />
          ))}
        </colgroup>
        <thead className="text-left align-top">
          <tr>
            <th scope="col" className="px-3 py-3 text-xs font-medium text-muted-foreground">
              Характеристика
            </th>
            {products.map((p) => (
              <th key={p.slug} scope="col" className="px-3 py-3 font-normal">
                <div className="flex flex-col items-start gap-1">
                  <Link href={productHref(p.slug)} prefetch={false} className="font-medium text-primary underline-offset-2 hover:underline">
                    {p.name}
                  </Link>
                  {p.manufacturer && <span className="text-xs text-muted-foreground">{p.manufacturer}</span>}
                  <div className="flex flex-wrap gap-1">
                    <StatusChip status={p.status} />
                    <LevelChip level={p.level} />
                    {p.archived && <ArchivedChip />}
                  </div>
                  <Link
                    href={compareHref(slugs.filter((s) => s !== p.slug))}
                    prefetch={false}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Убрать из сравнения<span className="sr-only">: {p.name}</span>
                  </Link>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t bg-muted/40">
            <th scope="colgroup" colSpan={products.length + 1} className="px-3 py-2 text-left font-heading font-semibold">
              Кратко
            </th>
          </tr>
          <SummaryRow label="Цена за единицу" products={products} render={(p) => <span className="tabular-nums">{priceText(p.priceRub)}</span>} />
          <SummaryRow
            label="Ставка RaaS"
            products={products}
            render={(p) => <span className="tabular-nums">{p.raasRubMonth === null ? NO_DATA : `${formatRub(p.raasRubMonth)}/мес`}</span>}
          />
          <SummaryRow
            label="Производительность"
            products={products}
            render={(p) => <span className="tabular-nums">{throughputText(p.throughputPerH, p.throughputUnit)}</span>}
          />
          <SummaryRow label="Полнота данных" products={products} render={(p) => <CompletenessBar pct={p.completenessPct} />} />
          <SummaryRow
            label="Подтверждено первоисточником"
            products={products}
            render={(p) => <span className="tabular-nums">{formatPct(p.confirmedSharePct)} значений</span>}
          />
          <SummaryRow
            label="Требует проверки"
            products={products}
            render={(p) => (p.needsVerification ? <span className="text-caution">да</span> : "нет")}
          />
          <SummaryRow
            label="Участвует в подборе"
            products={products}
            render={(p) => {
              const part = selectionParticipation(p);
              if (part.ok) return part.text;
              const tone = p.excluded && !p.archived && p.level !== "identification" ? "text-destructive" : "text-muted-foreground";
              return <span className={tone}>{part.text}</span>;
            }}
          />
        </tbody>
        {CHAR_GROUP_ORDER.map((g) => (
          <tbody key={g}>
            <GroupHeader group={g} products={products} />
            {compareRowKeys(g, products).map((key) => (
              <tr key={key} className="border-t align-top">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {rowLabel(key, products, g)}
                </th>
                {products.map((p) => (
                  <td key={p.slug} className="px-3 py-2">
                    <Cell c={p.characteristics[g].find((c) => c.key === key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
