import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumField } from "@/components/ui/num-field";
import type { AssumptionValues, CapacityBasis } from "@/lib/economics/types";

const ASSUMPTION_LABELS: Record<keyof AssumptionValues, string> = {
  laborCostPerHourUsd: "Стоимость труда (USD/час)",
  hoursPerYear: "Рабочих часов в году",
  workingDaysPerYear: "Рабочих дней в году",
  operatingHoursPerDay: "Часов работы в сутки",
  installPctOfCapex: "Монтаж (доля от CAPEX)",
  laborReplacementPct: "Замещение труда (доля)",
  residualSupervisionPct: "Остаточный надзор (доля)",
  opsPerWorkerPerYear: "Операций на сотрудника в год",
  turnoverPerDay: "Оборотов в сутки",
  roiHorizonYears: "Горизонт ROI (лет)",
  discountRate: "Ставка дисконтирования (доля)",
  assetLifeYears: "Срок службы техники (лет)",
  usdToRub: "Курс USD→RUB",
};

// Ratio (0..1 fraction) assumptions get a finer spinner step; everything else steps by 1.
const RATIO_KEYS = new Set<keyof AssumptionValues>([
  "installPctOfCapex",
  "laborReplacementPct",
  "residualSupervisionPct",
  "discountRate",
]);

// U1: assumptions the engine only consumes for a specific capacity basis. Hidden for other
// bases so every visible field actually affects the result (operatingHoursPerDay only
// annualizes PER_HOUR_FLOW capacity; turnoverPerDay only derives the CONCURRENT_STOCK peak).
const BASIS_ONLY: Partial<Record<keyof AssumptionValues, CapacityBasis>> = {
  operatingHoursPerDay: "PER_HOUR_FLOW",
  turnoverPerDay: "CONCURRENT_STOCK",
};

export function AssumptionsPanel({
  assumptions,
  setAssumptions,
  capacityBasis,
}: {
  assumptions: AssumptionValues;
  setAssumptions: Dispatch<SetStateAction<AssumptionValues>>;
  capacityBasis: CapacityBasis;
}) {
  const visibleKeys = (Object.keys(ASSUMPTION_LABELS) as (keyof AssumptionValues)[]).filter(
    (k) => !BASIS_ONLY[k] || BASIS_ONLY[k] === capacityBasis
  );
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Допущения (можно изменить)</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {visibleKeys.map((k) => (
          <NumField
            key={k}
            id={k}
            label={ASSUMPTION_LABELS[k]}
            value={assumptions[k]}
            step={RATIO_KEYS.has(k) ? 0.05 : 1}
            onChange={(n) => setAssumptions((a) => ({ ...a, [k]: n }))}
          />
        ))}
      </CardContent>
    </Card>
  );
}
