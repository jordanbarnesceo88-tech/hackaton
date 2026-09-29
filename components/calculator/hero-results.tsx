import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { isCalculable, isViable } from "@/lib/economics/types";
import type { EconomicsResult } from "@/lib/economics/types";
import { cn } from "@/lib/utils";

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

  // D4 (docs/design/PROTOTYPE-DESIGN-SYSTEM.md §6.4): a borderless ledger strip with a single
  // bleeding hairline, not a bordered/rounded/centered summary card — the asymmetry (one
  // number underlined, everything else in a plain left-to-right row) is meant as a content
  // signal ("this is the number that matters") rather than decoration. Replaces the earlier
  // bordered/tinted/centered treatment, which gave every figure equal visual weight.
  if (!result.economical) {
    return (
      <div className="md:col-span-2 border-b border-destructive/30 px-1 py-4">
        <div className="text-lg font-semibold text-destructive">
          Не окупается при текущих параметрах
        </div>
        <div className="mt-1 text-sm text-destructive">
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
      className={cn(
        "md:col-span-2 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b px-1 py-4",
        viable ? "border-primary/30" : "border-border",
      )}
    >
      <div>
        <div
          className={cn(
            "text-xs font-medium uppercase tracking-wide",
            viable ? "text-primary" : "text-muted-foreground",
          )}
        >
          {viable ? "Окупается за" : "Простой срок окупаемости"}
        </div>
        {/* Подчёркивание — единственный акцент этого блока, а не заливка/рамка: цифра, ради
            которой всё это существует, выделена линией под ней, остальное — обычный текст. */}
        <div
          className={cn(
            "text-4xl font-bold underline decoration-2 underline-offset-4",
            viable ? "text-primary decoration-primary" : "decoration-muted-foreground",
          )}
        >
          {formatYearsRu(result.simplePaybackYears)}
        </div>
        {/* Label the headline as the simple (undiscounted) payback, consistent with the A3 honesty
            discipline used everywhere else — the number is real but must not imply a discounted claim. */}
        {viable ? (
          <div className="text-xs text-muted-foreground">простой срок окупаемости</div>
        ) : (
          <div className="mt-1 text-sm font-medium text-caution">
            {/* Формулировка была ветвистой, потому что «NPV отрицателен» и «срока нет» могли
                разойтись: дисконтированная окупаемость возвращала ПЕРВОЕ пересечение нуля и не
                замечала, что докупка загнала поток обратно в минус (срок службы 4 при горизонте
                5 → NPV −19 296 и срок 2,9 года одновременно). Тогда герой обязан был говорить
                то, что правда в каждом из двух случаев по отдельности.

                Ч-2 убрал само расхождение: срок отдаётся по ПОСЛЕДНЕМУ пересечению, а если
                накопленный приведённый поток кончает ниже нуля — срока нет. Знак NPV и наличие
                срока стали одним утверждением, и вторая ветка стала недостижимой — проверено
                перебором 12 544 сценариев, ни одного случая. Инвариант закреплён с обеих сторон
                в finance.test.ts, поэтому если его когда-нибудь сломают, упадёт тест, а не
                подпись на экране. */}
            С учётом дисконтирования не окупается в пределах горизонта — NPV отрицательный
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-foreground">
        <span>
          NPV <b>{formatCost(result.npvUsd, usdToRub)}</b>
        </span>
        <span>
          ROI <b>{result.simpleRoiPct.toFixed(0)}%</b>
        </span>
        {priceEstimated && (
          <span className="text-xs text-caution">
            Цена решения оценочная — показатели по середине диапазона.
          </span>
        )}
      </div>
    </div>
  );
}
