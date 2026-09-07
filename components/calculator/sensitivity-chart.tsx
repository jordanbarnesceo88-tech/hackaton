import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSUMPTION_LABELS } from "./assumption-labels";
import { formatCost } from "@/lib/format/currency";
import type { SensitivityBar } from "@/lib/economics/sensitivity";

export function SensitivityChart({
  bars,
  usdToRub,
}: {
  bars: SensitivityBar[];
  usdToRub: number;
}) {
  if (bars.length === 0) return null;
  const maxSwing = Math.max(...bars.map((b) => b.swing), 1);
  // Read the perturbation off the bars instead of restating it. «±25%» was typed into both the
  // caption and every tooltip while `sensitivity()` takes `deltaPct` as a parameter — a caller
  // passing anything else would have produced bars measured at one figure and labelled another.
  const pctBar = bars.find((b) => b.deltaPct !== null);
  const pctLabel =
    pctBar?.deltaPct == null
      ? null
      : `±${(pctBar.deltaPct * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
  const hasWholeYear = bars.some((b) => b.kind === "whole-year");
  // Assembled as one string: adjacent JSX expressions and text are joined with a space, which
  // would have put one in front of the full stop.
  const caption =
    "Размах NPV при изменении каждого допущения" +
    (pctLabel ? `: ${pctLabel}` : "") +
    (hasWholeYear
      ? `${pctLabel ? ", а" : ":"} для сроков в годах — ±1 год (модель округляет их до целых лет)`
      : "") +
    ". Чем длиннее полоса, тем сильнее допущение влияет на результат.";

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle as="h2">Чувствительность NPV к допущениям</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">{caption}</p>
        {bars.map((b) => (
          <div key={b.key} className="grid grid-cols-[minmax(9rem,14rem)_1fr_auto] items-center gap-3">
            <span
              className="truncate"
              title={`${ASSUMPTION_LABELS[b.key]} — ${
                b.deltaPct === null
                  ? "±1 год"
                  : `±${(b.deltaPct * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`
              }`}
            >
              {ASSUMPTION_LABELS[b.key]}
              {b.kind === "whole-year" && (
                <span className="ml-1 text-xs text-muted-foreground">±1 год</span>
              )}
            </span>
            <div className="h-3 w-full rounded bg-muted">
              <div
                className="h-full rounded bg-primary"
                style={{ width: `${Math.round((b.swing / maxSwing) * 100)}%` }}
              />
            </div>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {formatCost(b.swing, usdToRub)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
