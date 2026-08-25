import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import { isCalculable } from "@/lib/economics/types";
import type { EconomicsResult } from "@/lib/economics/types";

export function ResultsPanel({
  result,
  horizonYears,
}: {
  result: EconomicsResult;
  horizonYears: number;
}) {
  // `isCalculable` is false only for the engine's `invalid_inputs` variant (degenerate inputs);
  // it also narrows the union so the numeric fields below are type-safe.
  const hasNumbers = isCalculable(result);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Результаты</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {!hasNumbers ? (
          <div className="font-medium text-muted-foreground">
            Проверьте параметры расчёта — некоторые значения некорректны
          </div>
        ) : (
          <>
            <div>Требуется единиц: <b>{result.quantity}</b></div>
            <div>Замещается персонала (ЭПЗ): <b>{result.displacedFte.toFixed(1)}</b></div>
            <div>CAPEX: <b>{formatCost(result.capexUsd)}</b></div>
            <div>OPEX/год: <b>{formatCost(result.opexAnnualUsd)}</b></div>
            <div>Базовые затраты на труд/год: {formatCost(result.baselineAnnualUsd)}</div>
            {result.economical ? (
              <>
                <div>Годовая экономия: <b>{formatCost(result.annualSavingsUsd)}</b></div>
                <div>Срок окупаемости (простой): <b>{formatYearsRu(result.simplePaybackYears)}</b></div>
                <div>
                  Срок окупаемости (дисконт.):{" "}
                  <b>
                    {result.discountedPaybackYears === null
                      ? `более ${horizonYears} лет`
                      : formatYearsRu(result.discountedPaybackYears)}
                  </b>
                </div>
                <div>ROI (простой, без дисконтирования): <b>{result.simpleRoiPct.toFixed(0)}%</b></div>
                <div>NPV (чистая приведённая стоимость): <b>{formatCost(result.npvUsd)}</b></div>
              </>
            ) : (
              <div className="font-medium text-red-600">
                Решение не окупается при текущих параметрах
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
