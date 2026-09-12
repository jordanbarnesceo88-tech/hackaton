import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TornadoChart } from "./tornado-chart";
import type { SensitivityBar } from "@/lib/economics/sensitivity";

export function SensitivityChart({
  bars,
  usdToRub,
}: {
  bars: SensitivityBar[];
  usdToRub: number;
}) {
  if (bars.length === 0) return null;
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
    ". Чем длиннее полоса, тем сильнее допущение влияет на результат." +
    (bars.some((b) => b.clampedLow || b.clampedHigh)
      ? " Звёздочкой помечены допущения, у которых плечо упёрлось в границу диапазона: их" +
        " размах меньше запрошенного, потому что дальше значение было бы недостижимо в" +
        " интерфейсе."
      : "") +
    (bars.some((b) => b.swing === 0)
      ? " Погашенные полосы при этих параметрах результат не двигают вовсе — например, срок" +
        " службы техники, когда он длиннее горизонта расчёта и замена в него не попадает."
      : "");

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle as="h2">Чувствительность NPV к допущениям</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">{caption}</p>
        <TornadoChart bars={bars} usdToRub={usdToRub} />
      </CardContent>
    </Card>
  );
}
