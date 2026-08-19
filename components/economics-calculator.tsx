"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { computeEconomics } from "@/lib/economics/calculate";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";
import { formatCost } from "@/lib/format/currency";

const ASSUMPTION_LABELS: Record<keyof AssumptionValues, string> = {
  laborCostPerHourUsd: "Стоимость труда (USD/час)",
  hoursPerYear: "Рабочих часов в году",
  workingDaysPerYear: "Рабочих дней в году",
  operatingHoursPerDay: "Часов работы в сутки",
  installPctOfCapex: "Монтаж (доля от CAPEX)",
  laborReplacementPct: "Замещение труда (доля)",
  turnoverPerDay: "Оборотов в сутки",
  roiHorizonYears: "Горизонт ROI (лет)",
};

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <input
        type="number"
        className="rounded-md border px-3 py-2 text-sm"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function EconomicsCalculator({
  capacity,
  capacityUnit,
  initialAssumptions,
}: {
  capacity: SolutionCapacity;
  capacityUnit: string;
  initialAssumptions: AssumptionValues;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  const [params, setParams] = useState<FacilityParams>({
    areaM2: 1000,
    opsPerDay: 500,
    staffCount: 10,
    ...(isStock ? { peakConcurrent: 20 } : {}),
  });
  const [assumptions, setAssumptions] =
    useState<AssumptionValues>(initialAssumptions);

  const result = computeEconomics(capacity, params, assumptions);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Параметры объекта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <NumField label="Площадь (м²)" value={params.areaM2}
            onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
          <NumField label="Объём операций в сутки" value={params.opsPerDay}
            onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))} />
          <NumField label="Численность персонала" value={params.staffCount}
            onChange={(n) => setParams((p) => ({ ...p, staffCount: n }))} />
          {isStock && (
            <NumField
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

      <Card>
        <CardHeader>
          <CardTitle>Результаты</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>Требуется единиц: <b>{result.quantity}</b></div>
          <div>CAPEX: <b>{formatCost(result.capexUsd)}</b></div>
          <div>OPEX/год: <b>{formatCost(result.opexAnnualUsd)}</b></div>
          <div>Базовые затраты на труд/год: {formatCost(result.baselineAnnualUsd)}</div>
          {result.economical ? (
            <>
              <div>Годовая экономия: <b>{formatCost(result.annualSavingsUsd)}</b></div>
              <div>Срок окупаемости: <b>{result.paybackYears.toFixed(1)} лет</b></div>
              <div>ROI: <b>{result.roiPct.toFixed(0)}%</b></div>
            </>
          ) : (
            <div className="font-medium text-red-600">
              Решение не окупается при текущих параметрах
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Допущения (можно изменить)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {(Object.keys(ASSUMPTION_LABELS) as (keyof AssumptionValues)[]).map((k) => (
            <NumField
              key={k}
              label={ASSUMPTION_LABELS[k]}
              value={assumptions[k]}
              onChange={(n) => setAssumptions((a) => ({ ...a, [k]: n }))}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
