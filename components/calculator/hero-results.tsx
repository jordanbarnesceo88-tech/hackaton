import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { isCalculable } from "@/lib/economics/types";
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
      <div className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-6 py-5 text-center">
        <div className="text-lg font-semibold text-red-700">
          Не окупается при текущих параметрах
        </div>
        <div className="mt-1 text-sm text-red-600/80">
          Годовая экономия не покрывает затраты — измените параметры или решение.
        </div>
      </div>
    );
  }

  return (
    <div className="md:col-span-2 rounded-lg border border-sky-200 bg-sky-50 px-6 py-5 text-center">
      <div className="text-xs font-medium uppercase tracking-wide text-sky-700">
        Окупается за
      </div>
      <div className="mt-1 text-4xl font-bold text-sky-900">
        {formatYearsRu(result.simplePaybackYears)}
      </div>
      {/* Label the headline as the simple (undiscounted) payback, consistent with the A3 honesty
          discipline used everywhere else — the number is real but must not imply a discounted claim. */}
      <div className="text-xs text-sky-700/80">простой срок окупаемости</div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm text-sky-800">
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
