import { originLabel } from "@/lib/tz/characteristics";
import type { Origin } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Бейдж «откуда число» для модели tz-1.0.0 (ТЗ §3.2.5 — источник каждого норматива и значения
 * по умолчанию, §3.3.4 — источник, дата и признак подтверждения характеристики, §3.5.8 —
 * происхождение статей расчёта). Текст бейджа — происхождение («Организатор», «Оценка»,
 * «Задано вами»…), по нажатию раскрываются ссылка на источник, место в источнике, дата
 * проверки и признак подтверждения.
 *
 * Раскрытие — нативный <details>: работает с клавиатуры и без JavaScript, не требует
 * клиентского состояния (компонент годится и для серверных страниц каталога), а блок с
 * подробностями встаёт в поток под бейджем, поэтому не обрезается прокруткой таблицы.
 *
 * Вариант для статей расчёта (`LineItem.originNote`, например «аналог: Ronavi»): короткое
 * примечание печатается прямо в бейдже — «Оценка · аналог: Ronavi»; длинное (обоснование
 * оценки) уходит в раскрытие, чтобы бейдж оставался бейджем.
 */

/** Примечание не длиннее этого числа знаков печатается в самом бейдже, длиннее — в раскрытии. */
export const NOTE_INLINE_MAX = 40;

export type SourceBadgeProps = {
  origin: Origin;
  /** Ссылка на первоисточник; показывается только http(s). */
  sourceUrl?: string | null;
  /** Где именно в источнике: «Датасеты_хакатон.xlsx › Склад › стр. 4». */
  sourceRef?: string | null;
  /** Дата проверки значения, YYYY-MM-DD. */
  date?: string | null;
  /** Подтверждено первоисточником; не передано — строка о подтверждении не показывается. */
  confirmed?: boolean;
  /** Уточнение происхождения: «демо-значение организатора», «аналог: Ronavi», обоснование оценки. */
  note?: string | null;
  className?: string;
};

/** Примечание без крайних пробелов; пустое — null. */
function cleanNote(note: string | null | undefined): string | null {
  const n = (note ?? "").trim();
  return n === "" ? null : n;
}

/** Примечание достаточно короткое, чтобы стоять в самом бейдже. */
export function isInlineNote(note: string | null | undefined): boolean {
  const n = cleanNote(note);
  return n !== null && n.length <= NOTE_INLINE_MAX;
}

/** Текст бейджа: «Организатор», «Оценка · аналог: Ronavi». */
export function sourceBadgeText(origin: Origin, note?: string | null): string {
  const label = originLabel(origin);
  const n = cleanNote(note);
  return n !== null && n.length <= NOTE_INLINE_MAX ? `${label} · ${n}` : label;
}

/**
 * Ссылка, которую можно показать: только http и https. Источники правит администратор, поэтому
 * «javascript:» и прочие схемы в href не попадают никогда.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https?:\/\/\S+$/i.test(u) ? u : null;
}

/** Дата проверки по-русски: «2026-09-12» → «12.09.2026»; другой формат — как есть. */
export function formatSourceDate(date: string | null | undefined): string | null {
  const d = (date ?? "").trim();
  if (d === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

/** Цвет бейджа по происхождению: оценка — предупреждающий, значение пользователя — основной. */
const ORIGIN_TONE: Readonly<Record<Origin, string>> = {
  organizer: "border-primary/30 bg-primary/5 text-foreground",
  research: "border-positive/40 bg-positive/10 text-foreground",
  estimate: "border-caution/40 bg-caution/10 text-foreground",
  derived: "border-border bg-muted text-foreground",
  choice: "border-border bg-muted text-foreground",
  tz: "border-primary/30 bg-primary/5 text-foreground",
  admin: "border-border bg-secondary text-secondary-foreground",
  user: "border-primary/50 bg-primary/10 font-medium text-primary",
};

const CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-tight";

export function SourceBadge({ origin, sourceUrl, sourceRef, date, confirmed, note, className }: SourceBadgeProps) {
  const text = sourceBadgeText(origin, note);
  const url = safeHttpUrl(sourceUrl);
  const ref = cleanNote(sourceRef);
  const when = formatSourceDate(date);
  const n = cleanNote(note);
  const longNote = n !== null && !isInlineNote(n) ? n : null;
  const hasDetails = url !== null || ref !== null || when !== null || confirmed !== undefined || longNote !== null;

  if (!hasDetails) {
    return <span className={cn(CHIP_CLASS, "self-start", ORIGIN_TONE[origin], className)}>{text}</span>;
  }

  return (
    <details className={cn("group/source inline-block max-w-full self-start align-middle", className)}>
      <summary
        className={cn(
          CHIP_CLASS,
          ORIGIN_TONE[origin],
          "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <span className="min-w-0 truncate">{text}</span>
        <span aria-hidden="true" className="text-muted-foreground group-open/source:rotate-180">
          ▾
        </span>
        <span className="sr-only"> — источник</span>
      </summary>
      <div className="mt-1 max-w-xs rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
        <dl className="grid gap-1">
          {url !== null && (
            <div>
              <dt className="text-muted-foreground">Источник</dt>
              <dd>
                <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">
                  {url}
                </a>
              </dd>
            </div>
          )}
          {ref !== null && (
            <div>
              <dt className="text-muted-foreground">Где в источнике</dt>
              <dd className="break-words">{ref}</dd>
            </div>
          )}
          {when !== null && (
            <div>
              <dt className="text-muted-foreground">Дата проверки</dt>
              <dd className="tabular-nums">{when}</dd>
            </div>
          )}
          {confirmed !== undefined && (
            <div>
              <dt className="sr-only">Подтверждение</dt>
              <dd className={confirmed ? "text-positive" : "text-caution"}>
                {confirmed ? "✓ подтверждено" : "не подтверждено"}
              </dd>
            </div>
          )}
          {longNote !== null && (
            <div>
              <dt className="text-muted-foreground">Основание</dt>
              <dd className="break-words">{longNote}</dd>
            </div>
          )}
        </dl>
      </div>
    </details>
  );
}
