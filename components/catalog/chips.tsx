import { formatPct } from "@/lib/format/rub";
import { SELECTION_CONSTANTS } from "@/lib/tz/selection";
import type { ProductLevel, ProductStatus } from "@/lib/tz/types";
import { cn } from "@/lib/utils";
import {
  ARCHIVED_CHIP,
  BADGE_CLASS,
  CHIP_CLASS,
  EXCLUDED_CHIP,
  IDENTIFICATION_ONLY_CHIP,
  LEVEL_LABELS,
  NEEDS_VERIFICATION_CHIP,
  STATUS_LABELS,
  STATUS_TONE,
} from "./labels";

/**
 * Чипы и полоса полноты публичного каталога. Серверные компоненты без состояния: их рисуют
 * список, карточка и сравнение, одинаково и без JavaScript.
 */

/** Статус продукта: «в эксплуатации», «пилот», «НИОКР». */
export function StatusChip({ status, className }: { status: ProductStatus; className?: string }) {
  return (
    <span data-tone={STATUS_TONE[status]} className={cn(BADGE_CLASS, className)}>
      <span className="sr-only">Статус: </span>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Глубина описания карточки. */
export function LevelChip({ level, className }: { level: ProductLevel; className?: string }) {
  return <span className={cn(CHIP_CLASS, className)}>{LEVEL_LABELS[level]}</span>;
}

/** Архивный продукт: карточка и сравнение открываются по старой ссылке, в списке и подборе его нет. */
export function ArchivedChip({ className }: { className?: string }) {
  return <span className={cn(CHIP_CLASS, "text-muted-foreground", className)}>{ARCHIVED_CHIP}</span>;
}

/**
 * Пометки качества строки каталога: «требует проверки», «только идентификация», «не участвует
 * в подборе». Ничего не отмечено — ничего не рисуется.
 */
export function QualityChips({
  needsVerification,
  level,
  excluded,
  className,
}: {
  needsVerification: boolean;
  level: ProductLevel;
  excluded: boolean;
  className?: string;
}) {
  if (!needsVerification && level !== "identification" && !excluded) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {needsVerification && (
        <span data-tone="warn" className={BADGE_CLASS}>{NEEDS_VERIFICATION_CHIP}</span>
      )}
      {level === "identification" && (
        <span className={cn(CHIP_CLASS, "text-muted-foreground")}>{IDENTIFICATION_ONLY_CHIP}</span>
      )}
      {excluded && (
        // Статичный факт каталога, не тревога в реальном времени — data-live не ставится,
        // поэтому точка не пульсирует (см. app/globals.css, .badge[data-tone="crit"]).
        <span data-tone="crit" className={BADGE_CLASS}>{EXCLUDED_CHIP}</span>
      )}
    </div>
  );
}

/** Порог полноты, ниже которого подбор помечает продукт «требует проверки» (lib/tz/selection). */
export const COMPLETENESS_VERIFY_PCT = SELECTION_CONSTANTS.completenessVerifyPct.value;

/** Полнота в пределах 0–100; нечисловая — 0 (полосе не из чего расти). */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Полоса полноты карточки: доля заполненных обязательных характеристик ТЗ §3.3.4 (из 31).
 * Ниже порога проверки полоса предупреждающего цвета — так же, как подбор снижает балл данных.
 */
export function CompletenessBar({ pct, className }: { pct: number; className?: string }) {
  const value = clampPct(pct);
  const low = value < COMPLETENESS_VERIFY_PCT;
  return (
    <div className={cn("flex min-w-24 items-center gap-2", className)}>
      <div
        role="img"
        aria-label={`Полнота данных ${formatPct(value)}`}
        className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-muted [print-color-adjust:exact]"
      >
        <div className={cn("h-full", low ? "bg-caution" : "bg-primary")} style={{ width: `${value}%` }} />
      </div>
      <span className={cn("whitespace-nowrap text-xs tabular-nums", low && "text-caution")} aria-hidden="true">
        {formatPct(value)}
      </span>
    </div>
  );
}
