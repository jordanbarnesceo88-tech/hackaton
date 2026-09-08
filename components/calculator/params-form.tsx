import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumField } from "@/components/ui/num-field";
import { RegionSelect } from "@/components/calculator/region-select";
import type {
  FacilityParams,
  SolutionCapacity,
  AssumptionValues,
} from "@/lib/economics/types";
import { resolvePeakConcurrent, computeQuantity } from "@/lib/economics/normalize";
import { OverrideField } from "@/components/calculator/override-field";

export function ParamsForm({
  params,
  setParams,
  capacity,
  capacityUnit,
  assumptions,
  selectedRegionId,
  onPickRegion,
  onClearRegion,
  usdToRub,
}: {
  params: FacilityParams;
  setParams: Dispatch<SetStateAction<FacilityParams>>;
  capacity: SolutionCapacity;
  capacityUnit: string;
  assumptions: AssumptionValues;
  selectedRegionId: string | null;
  onPickRegion: (id: string, labor: number, energyFactor: number) => void;
  onClearRegion: () => void;
  usdToRub: number;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  // Считается БЕЗ переопределения: иначе «расчёт даёт» показывало бы то же число, которое
  // человек только что ввёл, и пометка потеряла бы смысл.
  const computedQuantity = computeQuantity(
    capacity,
    { ...params, quantityOverride: undefined },
    assumptions
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Параметры объекта</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RegionSelect
          usdToRub={usdToRub}
          selectedRegionId={selectedRegionId}
          onPick={onPickRegion}
          onClear={onClearRegion}
        />
        {/* U1: area does not enter the economics — it only sizes the Step-4 scene. Labelled so
            no field silently fails to move the result. */}
        <NumField id="areaM2" label="Площадь, м² (только визуализация)" value={params.areaM2}
          onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
        <NumField id="opsPerDay" label="Объём операций в сутки" value={params.opsPerDay}
          onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))} />
        {/* Ключевое поле для защищаемости числа, и единственное, где модель верит на слово.
            Подпись раньше называлась «Персонал, замещаемый решением», но мастер спрашивает
            его до того, как решение выбрано, поэтому человек поневоле вводил весь штат — и
            один паллетайзер «замещал» сорок кладовщиков. Здесь решение уже известно. */}
        <NumField id="staffCount" label="Сколько человек делает работу этого решения" value={params.staffCount}
          onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))} />
        <p className="-mt-4 text-xs text-muted-foreground">
          Не весь штат объекта, а те, чью работу забирает именно это решение. Пока здесь весь
          персонал, показатели ниже — верхняя граница, а не оценка.
        </p>
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

        {/* Переопределения. Отделены линией и подписью намеренно: выше — то, что человек
            знает про свой объект, ниже — то, чем он спорит с расчётом. Смешивать их в один
            список значило бы стереть разницу между «мои данные» и «моя правка модели». */}
        <div className="mt-2 flex flex-col gap-4 border-t pt-4">
          <p className="text-sm font-medium">
            Свои значения
            <span className="ml-2 font-normal text-muted-foreground">
              — если вы не согласны с расчётом
            </span>
          </p>
          <OverrideField
            id="quantityOverride"
            integer
            label="Количество единиц"
            computed={computedQuantity ?? 1}
            value={params.quantityOverride}
            onChange={(n) => setParams((p) => ({ ...p, quantityOverride: n }))}
          />
          <OverrideField
            id="capexPerUnitUsdOverride"
            label="Цена за единицу, USD"
            computed={capacity.priceUsd}
            step={1000}
            format={(n) => `US$${Math.round(n).toLocaleString("en-US")}`}
            value={params.capexPerUnitUsdOverride}
            onChange={(n) => setParams((p) => ({ ...p, capexPerUnitUsdOverride: n }))}
          />
          {params.quantityOverride !== undefined &&
            computedQuantity !== null &&
            params.quantityOverride < computedQuantity && (
              <p className="rounded-md border-l-2 border-caution bg-caution/5 px-3 py-2 text-xs">
                Парк меньше расчётного закрывает не всю работу объекта, поэтому и экономия ниже
                — модель уменьшает её пропорционально покрытию, а не оставляет прежней.
              </p>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
