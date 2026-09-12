import Link from "next/link";
import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { isViable, isCalculable, isStaffingRequired } from "@/lib/economics/types";
import type { EconomicsResult } from "@/lib/economics/types";

export type Candidate = {
  id: string;
  name: string;
  vendor: string;
  isClass: boolean;
  result: EconomicsResult;
};

/**
 * Ответ до таблицы.
 *
 * «Лучшее» — по NPV и ТОЛЬКО среди проходящих isViable. Предикат отделяет «экономично» от
 * «стоит рекомендовать»: `economical` выставляется по одному лишь положительному годовому
 * эффекту и остаётся true у решения, которое никогда не отбивает дисконтированный CAPEX. В
 * сиде такие есть, и интерфейс однажды уже их праздновал, пока панель ниже писала
 * «не окупается в пределах горизонта».
 *
 * Если не проходит ни одно — блок НЕ показывает лучшее из плохих. Ложный герой на этом экране
 * дороже отсутствующего: продукт продаёт защищаемость вывода, а не бодрость.
 */
export function BestSolution({
  candidates,
  usdToRub,
  calcHref,
  backHref,
  staffingHref,
}: {
  candidates: Candidate[];
  usdToRub: number;
  calcHref: (id: string) => string;
  backHref: string;
  /** Шаг «Кто чем занят» — единственное место, где снимается отказ по занятости. */
  staffingHref: string;
}) {
  const viable = candidates
    .filter((c) => isViable(c.result))
    .sort((a, b) => {
      const na = isCalculable(a.result) && a.result.economical ? a.result.npvUsd : -Infinity;
      const nb = isCalculable(b.result) && b.result.economical ? b.result.npvUsd : -Infinity;
      return nb - na;
    });

  const best = viable[0];

  // «Не окупается» — это вывод, и делать его можно только когда есть из чего. Пока хотя бы одно
  // решение отказывается считать без занятости, вывода нет: молчание движка объяснялось словами
  // «объём операций слишком мал для автоматизации такого класса» — уверенное неверное
  // объяснение там, где не хватало одного числа.
  const awaitingStaffing = candidates.filter((c) => isStaffingRequired(c.result));
  if (!best && awaitingStaffing.length > 0) {
    const all = awaitingStaffing.length === candidates.length;
    return (
      <div
        data-testid="best-solution"
        className="rounded-lg border-2 border-border bg-muted/30 p-6"
      >
        <div className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Пока нечем считать
        </div>
        <p className="mt-2 max-w-prose">
          {all
            ? "Ни по одной из этих работ не указано, сколько человек ею занято."
            : `По ${awaitingStaffing.length} из ${candidates.length} решений не указано, сколько человек занято их работой.`}{" "}
          Замещение считается от занятости, поэтому без неё ответа нет — а показать ноль значило
          бы утверждать, что работой никто не занят.
        </p>
        <Link
          href={staffingHref}
          className="mt-4 inline-block font-medium underline underline-offset-4"
        >
          Указать, кто чем занят
        </Link>
      </div>
    );
  }

  if (!best || !isCalculable(best.result) || !best.result.economical) {
    return (
      <div
        data-testid="best-solution"
        className="rounded-lg border-2 border-caution/40 bg-caution/5 p-6"
      >
        <div className="text-sm font-medium tracking-wide text-caution uppercase">
          Не окупается
        </div>
        <p className="mt-2 max-w-prose">
          При этих параметрах ни одно решение не возвращает вложения внутри горизонта расчёта.
          Это тоже ответ — и чаще всего он означает, что объём операций слишком мал для
          автоматизации такого класса.
        </p>
        <Link href={backHref} className="mt-4 inline-block font-medium underline underline-offset-4">
          Изменить параметры объекта
        </Link>
      </div>
    );
  }

  const r = best.result;
  return (
    <div
      data-testid="best-solution"
      className="rounded-lg border-2 border-primary bg-primary/5 p-6"
    >
      <div className="text-sm font-medium tracking-wide text-primary uppercase">
        Окупается за {formatYearsRu(r.discountedPaybackYears!)}
      </div>
      <h2 className="mt-1">
        {best.name}
        {best.isClass ? (
          <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
            класс решений
          </span>
        ) : (
          <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
            {best.vendor}
          </span>
        )}
      </h2>
      <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <dt className="text-sm text-muted-foreground">NPV за горизонт</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatCost(r.npvUsd, usdToRub)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Требуется единиц</dt>
          <dd className="text-lg font-semibold tabular-nums">{r.quantity}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Годовая экономия</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatCost(r.annualSavingsUsd, usdToRub)}
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Link
          href={calcHref(best.id)}
          className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground
            transition-opacity hover:opacity-90
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Разобрать расчёт
        </Link>
        {viable.length > 1 && (
          <span className="text-sm text-muted-foreground">
            ещё {viable.length - 1} окупающихся ниже
          </span>
        )}
      </div>
    </div>
  );
}
