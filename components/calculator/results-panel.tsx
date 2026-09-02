import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isCalculable } from "@/lib/economics/types";
import type { EconomicsResult } from "@/lib/economics/types";
import { economicsRows, PANEL_LABELS } from "./economics-rows";

export function ResultsPanel({
  result,
  usdToRub,
}: {
  result: EconomicsResult;
  usdToRub: number;
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
            {economicsRows(result, usdToRub, PANEL_LABELS).map((row) => (
              <div key={row.key}>
                {row.label}: <b>{row.value}</b>
              </div>
            ))}
            {!result.economical && (
              <div className="font-medium text-destructive">
                Решение не окупается при текущих параметрах
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
