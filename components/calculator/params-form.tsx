import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumField } from "@/components/ui/num-field";
import type { FacilityParams, SolutionCapacity } from "@/lib/economics/types";

export function ParamsForm({
  params,
  setParams,
  capacity,
  capacityUnit,
}: {
  params: FacilityParams;
  setParams: Dispatch<SetStateAction<FacilityParams>>;
  capacity: SolutionCapacity;
  capacityUnit: string;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Параметры объекта</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <NumField id="areaM2" label="Площадь (м²)" value={params.areaM2}
          onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
        <NumField id="opsPerDay" label="Объём операций в сутки" value={params.opsPerDay}
          onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))} />
        <NumField id="staffCount" label="Персонал, замещаемый решением" value={params.staffCount}
          onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))} />
        {isStock && (
          <NumField
            id="peakConcurrent"
            label="Пиковая одновременная нагрузка"
            value={params.peakConcurrent ?? 0}
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
