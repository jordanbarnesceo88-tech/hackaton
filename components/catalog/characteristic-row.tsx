import { SourceBadge, formatSourceDate } from "@/components/project/source-badge";
import type { CatalogAlternative, CatalogCharacteristic } from "@/lib/catalog/queries";
import { cn } from "@/lib/utils";
import { confidenceLabel, NO_DATA } from "./labels";

/**
 * Строка характеристики в карточке продукта (ТЗ §3.3.4: «для каждой характеристики должны
 * храниться источник, дата актуализации и признак подтверждения»). Колонки: характеристика,
 * значение, как в источнике (дословная цитата — чтобы проверяющий нашёл число на странице),
 * источник (бейдж с ссылкой, местом в источнике, датой и основанием) и подтверждение ✓/—.
 *
 * Другие найденные значения («альтернативы», проигравшие по приоритету источника) раскрываются
 * под значением. Если источники расходятся сильнее допуска — сводка «⚠ есть расхождения»,
 * иначе нейтральная «другие источники (N)»: совпавшее значение — подтверждение, а не спор.
 */

/** Число колонок таблицы характеристик — для строк-заглушек на всю ширину. */
export const CHARACTERISTIC_COLUMNS = 5;

/** Заголовки колонок таблицы характеристик в порядке показа. */
export const CHARACTERISTIC_HEADERS = ["Характеристика", "Значение", "Как в источнике", "Источник", "Подтверждено"] as const;

/** Цитата из источника в кавычках-«ёлочках»; пустая — null. */
export function quoteText(asInSource: string | null | undefined): string | null {
  const t = (asInSource ?? "").trim();
  return t === "" ? null : `«${t}»`;
}

/** Строка «проверено 22.09.2026» под бейджем; даты нет — null. */
export function checkedOnText(date: string | null | undefined): string | null {
  const d = formatSourceDate(date);
  return d === null ? null : `проверено ${d}`;
}

/** Признак подтверждения: ✓ с пояснением для скринридера или прочерк. */
export function ConfirmedMark({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="font-medium text-positive">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">подтверждено первоисточником</span>
    </span>
  ) : (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">не подтверждено</span>
    </span>
  );
}

/** Одно альтернативное значение: значение, бейдж источника, цитата. */
function AlternativeItem({ alt }: { alt: CatalogAlternative }) {
  const quote = quoteText(alt.asInSource);
  const confidence = confidenceLabel(alt.confidence);
  return (
    <li className="flex flex-col gap-1 border-l-2 border-border pl-2">
      <span className="font-medium">{alt.value}</span>
      <SourceBadge
        origin={alt.origin}
        sourceUrl={alt.sourceUrl}
        sourceRef={alt.sourceRef}
        date={alt.date}
        confirmed={alt.confirmed}
      />
      {quote && <span className="text-muted-foreground italic">{quote}</span>}
      {confidence && <span className="text-muted-foreground">достоверность: {confidence}</span>}
    </li>
  );
}

/** Раскрытие альтернатив; без альтернатив — ничего. */
export function Alternatives({ c }: { c: Pick<CatalogCharacteristic, "alternatives" | "hasConflict"> }) {
  if (c.alternatives.length === 0) return null;
  return (
    <details className="mt-1 text-xs">
      <summary
        className={cn(
          "cursor-pointer select-none underline-offset-2 hover:underline",
          c.hasConflict ? "font-medium text-caution" : "text-muted-foreground",
        )}
      >
        {c.hasConflict ? (
          <>
            <span aria-hidden="true">⚠ </span>есть расхождения ({c.alternatives.length})
          </>
        ) : (
          `другие источники (${c.alternatives.length})`
        )}
      </summary>
      {c.hasConflict && (
        <p className="mt-1 text-muted-foreground">
          Источники расходятся больше допуска. Основное значение (выше) выбрано по приоритету источника:
          организатор, документация производителя, сайт производителя, дилер, агрегатор, пресса. Остальные
          найденные значения — ниже.
        </p>
      )}
      <ul className="mt-1 grid gap-2">
        {c.alternatives.map((alt, i) => (
          <AlternativeItem key={`${alt.sourceUrl ?? alt.sourceRef ?? "alt"}-${i}`} alt={alt} />
        ))}
      </ul>
    </details>
  );
}

export function CharacteristicRow({ c }: { c: CatalogCharacteristic }) {
  const quote = quoteText(c.asInSource);
  const checked = checkedOnText(c.verifiedAt);
  const confidence = confidenceLabel(c.confidence);
  const empty = c.display === "—";
  return (
    <tr className="border-t align-top">
      <th scope="row" className="w-56 px-3 py-2 text-left font-normal">
        {c.label}
      </th>
      <td className="min-w-48 px-3 py-2">
        <span className={cn("break-words", empty ? "text-muted-foreground" : "font-medium")}>{empty ? NO_DATA : c.display}</span>
        {c.formula && <div className="mt-0.5 text-xs text-muted-foreground">Формула: {c.formula}</div>}
        {c.note && <div className="mt-0.5 text-xs text-muted-foreground">Примечание: {c.note}</div>}
        {c.granularity === "row" && (
          <div className="mt-0.5 text-xs text-muted-foreground">источник указан для всей строки свода, а не для этого поля</div>
        )}
        <Alternatives c={c} />
      </td>
      <td className="min-w-44 max-w-80 px-3 py-2 text-xs">
        {quote ? <span className="break-words italic">{quote}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="min-w-40 px-3 py-2">
        <div className="flex flex-col items-start gap-1">
          <SourceBadge
            origin={c.origin}
            sourceUrl={c.sourceUrl}
            sourceRef={c.sourceRef}
            date={c.verifiedAt}
            confirmed={c.confirmed}
            note={c.basis}
          />
          {checked && <span className="text-[11px] tabular-nums text-muted-foreground">{checked}</span>}
          {confidence && <span className="text-[11px] text-muted-foreground">достоверность: {confidence}</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        <ConfirmedMark confirmed={c.confirmed} />
      </td>
    </tr>
  );
}

/** Строка обязательной характеристики, которой у продукта нет: видно, чего не хватает до полноты. */
export function MissingCharacteristicRow({ label }: { label: string }) {
  return (
    <tr className="border-t align-top text-muted-foreground">
      <th scope="row" className="w-56 px-3 py-2 text-left font-normal">
        {label}
      </th>
      <td className="px-3 py-2">{NO_DATA}</td>
      <td className="px-3 py-2 text-xs">—</td>
      <td className="px-3 py-2 text-xs">источник не найден</td>
      <td className="px-3 py-2 text-center">
        <ConfirmedMark confirmed={false} />
      </td>
    </tr>
  );
}
