import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import type { RankedSolution } from "@/lib/economics/recommend";

export function RecommendationPanel({
  ranked,
  selectedId,
  usdToRub,
  onSelect,
}: {
  ranked: RankedSolution[];
  selectedId: string;
  usdToRub: number;
  onSelect: (id: string) => void;
}) {
  if (ranked.length < 2) return null;
  const bestId = ranked[0].result.economical ? ranked[0].id : null;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Рекомендация для вашего объекта</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Решения этой категории, отсортированные по NPV при ваших параметрах.
        </p>
        {ranked.map((r) => {
          const isSelected = r.id === selectedId;
          const isBest = r.id === bestId;
          return (
            <div
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                isSelected ? "border-sky-500 bg-sky-50/50" : ""
              }`}
            >
              <div className="min-w-40">
                <div className="font-medium">
                  {isBest ? "★ " : ""}
                  {r.name}
                  {isSelected ? (
                    <span className="ml-2 text-xs text-sky-700">вы смотрите</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{r.vendor}</div>
              </div>
              <div className="flex items-center gap-4">
                {r.result.economical ? (
                  <span className="tabular-nums text-muted-foreground">
                    {formatYearsRu(r.result.simplePaybackYears)} · NPV{" "}
                    {formatCost(r.result.npvUsd, usdToRub)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {r.result.economical === false && r.result.reason === "no_savings"
                      ? "не окупается"
                      : "проверьте параметры"}
                  </span>
                )}
                {!isSelected && (
                  <button
                    onClick={() => onSelect(r.id)}
                    className="rounded-md border px-2 py-1 text-xs font-medium"
                  >
                    Сделать основным
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
