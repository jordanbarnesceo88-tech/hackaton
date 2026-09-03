import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { isCalculable, isViable } from "@/lib/economics/types";
import type { EconomicsResult } from "@/lib/economics/types";

/**
 * One-glance headline of the calculation — the number a client remembers. Presentational:
 * reads the already-computed result. Hidden for invalid_inputs (the results panel shows its own
 * "проверьте параметры" notice); shows a plain "не окупается" for a non-economical result.
 */
export function HeroResults({
  result,
  usdToRub,
  priceEstimated,
}: {
  result: EconomicsResult;
  usdToRub: number;
  priceEstimated: boolean;
}) {
  if (!isCalculable(result)) return null;

  if (!result.economical) {
    return (
      <div className="md:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-5 text-center">
        <div className="text-lg font-semibold text-destructive">
          Не окупается при текущих параметрах
        </div>
        <div className="mt-1 text-sm text-destructive/80">
          Годовая экономия не покрывает затраты — измените параметры или решение.
        </div>
      </div>
    );
  }

  // Positive savings are not the same as a sound investment: `economical` is set by
  // annualSavingsUsd > 0 alone, so it stays true when the discounted cash flows never recover
  // the CAPEX. Celebrating that case put the hero in direct contradiction with the results
  // panel below it, which was already saying «не окупается в пределах горизонта».
  const viable = isViable(result);

  return (
    <div
      className={
        viable
          ? "md:col-span-2 rounded-lg border border-primary/20 bg-primary/5 px-6 py-5 text-center"
          : "md:col-span-2 rounded-lg border bg-muted/40 px-6 py-5 text-center"
      }
    >
      <div
        className={
          viable
            ? "text-xs font-medium uppercase tracking-wide text-primary"
            : "text-xs font-medium uppercase tracking-wide text-muted-foreground"
        }
      >
        {viable ? "Окупается за" : "Простой срок окупаемости"}
      </div>
      <div className={viable ? "mt-1 text-4xl font-bold text-primary" : "mt-1 text-4xl font-bold"}>
        {formatYearsRu(result.simplePaybackYears)}
      </div>
      {/* Label the headline as the simple (undiscounted) payback, consistent with the A3 honesty
          discipline used everywhere else — the number is real but must not imply a discounted claim. */}
      {viable ? (
        <div className="text-xs text-muted-foreground">простой срок окупаемости</div>
      ) : (
        <div className="mt-1 text-sm font-medium text-amber-700">
          {/* Word this off the condition that is actually true. `isViable` is false as soon as
              NPV is negative, and a negative NPV with a real discounted payback is reachable
              whenever assetLifeYears < roiHorizonYears: re-CAPEX pushes the cumulative back
              below zero after an early crossing (e.g. life 4 / horizon 5 -> NPV −19 296 with a
              2.9-year discounted payback). Claiming "не окупается в пределах горизонта" there
              contradicted the panel directly below, which printed «2.9 года». */}
          {result.discountedPaybackYears === null
            ? "С учётом дисконтирования не окупается в пределах горизонта — NPV отрицательный"
            : "С учётом дисконтирования решение не окупается — NPV отрицательный"}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm text-foreground">
        <span>
          NPV <b>{formatCost(result.npvUsd, usdToRub)}</b>
        </span>
        <span>
          ROI <b>{result.simpleRoiPct.toFixed(0)}%</b>
        </span>
      </div>
      {priceEstimated && (
        <div className="mt-1 text-xs text-amber-700">
          Цена решения оценочная — показатели по середине диапазона.
        </div>
      )}
    </div>
  );
}
