import { formatNum } from "@/lib/format/rub";
import type { ScoreContribution, SelectionResult } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Балл подбора с разложением по факторам (ТЗ §3.4.5: «пользователь должен видеть критерии и
 * вклад ключевых факторов в итоговую оценку»). Полоса из пяти отрезков — экономика, данные,
 * зрелость, запас, кейсы — длиной в очки фактора из 100, под ней подписи с числами, а в
 * раскрытии — объяснение каждого вклада словами из модуля подбора.
 *
 * Балл и вклады считает `lib/tz/selection` — здесь только показ: ничего не пересчитывается и
 * не нормируется повторно. У исключённого продукта балла нет — «не оценивается».
 */

/** Балл в форме `SelectionResult.score`; null — балла нет вовсе. */
export type ScoreLike = SelectionResult["score"];

/** Подпись для продукта без балла (исключён подбором). */
export const SCORE_NOT_RATED = "не оценивается";

/** Цвет отрезка по фактору — палитра графиков из globals.css, одинаковая в светлой и тёмной теме. */
const FACTOR_COLOR: Readonly<Record<ScoreContribution["factor"], string>> = {
  econ: "bg-chart-1",
  data: "bg-chart-2",
  maturity: "bg-chart-3",
  margin: "bg-chart-4",
  cases: "bg-chart-5",
};

/** Очки с одним знаком после запятой без лишнего нуля: 32 → «32», 12.44 → «12,4». */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) return "—";
  const r = Math.round(points * 10) / 10;
  return formatNum(r, Number.isInteger(r) ? 0 : 1);
}

/** Наибольшие очки фактора — его вес в баллах: вес 0,40 → 40. */
export function contributionMax(c: Pick<ScoreContribution, "weight">): number {
  return Math.round(c.weight * 1000) / 10;
}

/**
 * Очки фактора для подписи — целые, как в объяснении модуля подбора («Данные: 12 из 20»):
 * round(вес × значение × 100). Иначе подпись «11,6» спорила бы с объяснением «12» рядом.
 * Ширина отрезка при этом берётся из точных `points`.
 */
export function contributionPoints(c: Pick<ScoreContribution, "weight" | "value01">): number {
  const v = c.weight * c.value01 * 100;
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/** Вклад фактора коротко: «Экономика: 32 из 40». */
export function contributionSummary(c: Pick<ScoreContribution, "label" | "weight" | "value01">): string {
  return `${c.label}: ${formatNum(contributionPoints(c))} из ${formatPoints(contributionMax(c))}`;
}

/** Отрезок полосы: фактор, подпись и ширина в процентах шкалы 0–100. */
export type ScoreSegment = {
  factor: ScoreContribution["factor"];
  label: string;
  points: number;
  /** Целые очки для подписи (см. `contributionPoints`). */
  displayPoints: number;
  widthPct: number;
  summary: string;
  colorClass: string;
};

/**
 * Отрезки полосы по вкладам. Ширина — очки фактора (шкала балла 0–100), обрезанные так, чтобы
 * сумма ширин не превышала 100 %: повреждённый снимок не должен вылезать за рамку.
 */
export function scoreSegments(contributions: readonly ScoreContribution[]): ScoreSegment[] {
  let used = 0;
  return contributions.map((c) => {
    const raw = Number.isFinite(c.points) ? Math.max(0, c.points) : 0;
    const widthPct = Math.min(raw, Math.max(0, 100 - used));
    used += widthPct;
    return {
      factor: c.factor,
      label: c.label,
      points: c.points,
      displayPoints: contributionPoints(c),
      widthPct,
      summary: contributionSummary(c),
      colorClass: FACTOR_COLOR[c.factor] ?? "bg-muted-foreground",
    };
  });
}

/** Итог словами: «68 из 100» или «не оценивается». */
export function scoreTotalText(score: ScoreLike | null | undefined): string {
  if (!score || score.total === null || !Number.isFinite(score.total)) return SCORE_NOT_RATED;
  return `${formatNum(score.total)} из 100`;
}

/** Описание полосы для скринридера: «Балл 68 из 100: Экономика: 32 из 40, …». */
export function scoreAriaLabel(score: ScoreLike | null | undefined): string {
  if (!score || score.total === null || !Number.isFinite(score.total)) return `Балл: ${SCORE_NOT_RATED}`;
  const parts = score.contributions.map(contributionSummary).join(", ");
  return parts ? `Балл ${scoreTotalText(score)}: ${parts}` : `Балл ${scoreTotalText(score)}`;
}

export function ScoreBar({ score, className }: { score: ScoreLike | null | undefined; className?: string }) {
  if (!score || score.total === null || !Number.isFinite(score.total)) {
    return <span className={cn("text-xs text-muted-foreground", className)}>{SCORE_NOT_RATED}</span>;
  }
  const segments = scoreSegments(score.contributions);
  return (
    <div className={cn("flex min-w-40 flex-col gap-1", className)}>
      <div className="flex items-baseline gap-1">
        <span className="text-base font-semibold tabular-nums">{formatNum(score.total)}</span>
        <span className="text-xs text-muted-foreground">из 100</span>
      </div>
      <div
        role="img"
        aria-label={scoreAriaLabel(score)}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted [print-color-adjust:exact]"
      >
        {segments.map((s) =>
          s.widthPct > 0 ? (
            <div key={s.factor} className={cn("h-full", s.colorClass)} style={{ width: `${s.widthPct}%` }} title={s.summary} />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-tight text-muted-foreground" aria-hidden="true">
        {segments.map((s) => (
          <li key={s.factor} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className={cn("inline-block size-2 rounded-full [print-color-adjust:exact]", s.colorClass)} />
            {s.label} {formatNum(s.displayPoints)}
          </li>
        ))}
      </ul>
      {score.contributions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">
            Как сложился балл
          </summary>
          <ul className="mt-1 grid gap-1 pl-3">
            {score.contributions.map((c) => (
              <li key={c.factor} className="list-disc">
                {c.explanation}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
