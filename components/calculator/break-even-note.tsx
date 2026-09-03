import { breakEvenLaborRateUsd } from "@/lib/economics/breakeven";
import { formatCost } from "@/lib/format/currency";
import { isCalculable } from "@/lib/economics/types";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "@/lib/economics/types";

export function BreakEvenNote({
  capacity,
  params,
  assumptions,
  result,
}: {
  capacity: SolutionCapacity;
  params: FacilityParams;
  assumptions: AssumptionValues;
  result: EconomicsResult;
}) {
  // Hide on invalid_inputs, same convention as HeroResults — otherwise a degenerate input (which
  // also makes the solver return null) would render a misleading "never pays back" message.
  if (!isCalculable(result)) return null;

  const rate = breakEvenLaborRateUsd(capacity, params, assumptions);
  const usdToRub = assumptions.usdToRub;
  const current = assumptions.laborCostPerHourUsd;

  return (
    <div className="md:col-span-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <span className="font-medium">Точка безубыточности (по ставке труда): </span>
      {rate === null ? (
        <span className="text-muted-foreground">
          не окупается ни при какой ставке труда при текущих параметрах
        </span>
      ) : (
        <>
          окупается при ставке труда ≥ <b>{formatCost(rate, usdToRub)}/час</b> (сейчас{" "}
          {formatCost(current, usdToRub)})
          {current >= rate ? (
            <span className="text-positive"> · запас прочности ×{(current / rate).toFixed(1)}</span>
          ) : (
            <span className="text-caution"> · текущая ставка ниже точки безубыточности</span>
          )}
        </>
      )}
    </div>
  );
}
