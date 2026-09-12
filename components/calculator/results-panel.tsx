import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isCalculable, isStaffingRequired } from "@/lib/economics/types";
import type { EconomicsResult } from "@/lib/economics/types";
import { economicsRows, PANEL_LABELS } from "./economics-rows";
import { EXPLANATIONS } from "@/lib/economics/explanations";
import { Disclosure } from "@/components/ui/disclosure";

export function ResultsPanel({
  result,
  usdToRub,
}: {
  result: EconomicsResult;
  usdToRub: number;
}) {
  // `isCalculable` ложен для обоих отказов сразу, поэтому одного его мало: он говорит «чисел
  // нет», но не говорит, чья это забота. Занятость человек может назвать, вырожденный ввод —
  // нет, и одинаковая формулировка на оба случая оставляла его без единственной подсказки,
  // которая была ему нужна.
  const hasNumbers = isCalculable(result);
  const needsStaffing = isStaffingRequired(result);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Результаты</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {needsStaffing ? (
          <div className="flex flex-col gap-1">
            <div className="font-medium text-foreground">
              Не хватает одного числа: сколько человек занято этой работой
            </div>
            <div className="text-muted-foreground">
              Замещение считается от занятости, а норматива по этой работе у нас нет — открытого
              источника найти не удалось. Укажите число на шаге «Кто чем занят», и расчёт
              появится. Показать ноль вместо него значило бы утверждать, что работой никто не
              занят.
            </div>
          </div>
        ) : !hasNumbers ? (
          <div className="font-medium text-muted-foreground">
            Проверьте параметры расчёта — некоторые значения некорректны
          </div>
        ) : (
          <>
            {economicsRows(result, usdToRub, PANEL_LABELS).map((row) => (
              <div key={row.key}>
                {row.label}: <b>{row.value}</b>
                <Disclosure
                  title={EXPLANATIONS[row.key].title}
                  body={EXPLANATIONS[row.key].body}
                />
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
