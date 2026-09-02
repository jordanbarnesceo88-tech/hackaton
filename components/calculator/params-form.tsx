import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumField } from "@/components/ui/num-field";
import { RegionSelect } from "@/components/calculator/region-select";
import type {
  FacilityParams,
  SolutionCapacity,
  AssumptionValues,
} from "@/lib/economics/types";
import { resolvePeakConcurrent } from "@/lib/economics/normalize";

export function ParamsForm({
  params,
  setParams,
  capacity,
  capacityUnit,
  assumptions,
  onPickRegion,
  usdToRub,
}: {
  params: FacilityParams;
  setParams: Dispatch<SetStateAction<FacilityParams>>;
  capacity: SolutionCapacity;
  capacityUnit: string;
  assumptions: AssumptionValues;
  onPickRegion: (labor: number, energyFactor: number) => void;
  usdToRub: number;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Параметры объекта</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RegionSelect usdToRub={usdToRub} onPick={onPickRegion} />
        {/* U1: area does not enter the economics — it only sizes the Step-4 scene. Labelled so
            no field silently fails to move the result. */}
        <NumField id="areaM2" label="Площадь, м² (только визуализация)" value={params.areaM2}
          onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
        <NumField id="opsPerDay" label="Объём операций в сутки" value={params.opsPerDay}
          onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))} />
        <NumField id="staffCount" label="Персонал, замещаемый решением" value={params.staffCount}
          onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))} />
        {isStock && (
          <NumField
            id="peakConcurrent"
            label="Пиковая одновременная нагрузка"
            // Show what the engine is actually sizing against. When the field has never been
            // set — which happens if the user switches in-place into a stock solution — the
            // engine derives the peak from throughput and turnover, and rendering `?? 0` here
            // put a 0 on screen while the fleet was sized from something else entirely.
            value={resolvePeakConcurrent(params, assumptions) ?? 0}
            onChange={(n) => setParams((p) => ({ ...p, peakConcurrent: n }))}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Производительность решения: {capacity.capacityPerUnit} {capacityUnit}
        </p>
      </CardContent>
    </Card>
  );
}
