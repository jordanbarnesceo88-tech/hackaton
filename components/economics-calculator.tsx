"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { FacilityVisualization } from "@/components/facility-visualization";
import { mapKind } from "@/lib/scene/layout";
import { computeEconomics } from "@/lib/economics/calculate";
import { saveAnalysisAction } from "@/lib/analyses/actions";
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

// Ratio (0..1 fraction) assumptions get a finer spinner step; everything else steps by 1.
const RATIO_KEYS = new Set<keyof AssumptionValues>([
  "installPctOfCapex",
  "laborReplacementPct",
]);

function NumField({
  id,
  label,
  value,
  step = 1,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        min={0}
        step={step}
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
  facilitySlug,
  solutionId,
}: {
  capacity: SolutionCapacity;
  capacityUnit: string;
  initialAssumptions: AssumptionValues;
  facilitySlug: string;
  solutionId: string;
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
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const result = computeEconomics(capacity, params, assumptions);

  async function handleSave() {
    setSaveMsg(null);
    const res = await saveAnalysisAction({
      name: `Расчёт — ${new Date().toLocaleDateString("ru-RU")}`,
      facilityTypeSlug: facilitySlug,
      solutionId,
      params,
      assumptions,
      results: result,
    });
    if (res.ok) setSaveMsg("Сохранено");
    else if (res.reason === "unauthenticated") setSaveMsg("unauth");
    else setSaveMsg("Ошибка сохранения");
  }

  // Zeroing a divisor assumption (e.g. workingDaysPerYear=0, or operatingHoursPerDay=0 on a
  // PER_HOUR_FLOW solution) makes the engine divide by zero, yielding NaN/Infinity that would
  // otherwise render as a bogus "economical" card (NaN <= 0 is false). Guard the shared outputs
  // and show a neutral notice instead of numbers when any of them isn't finite.
  const resultsFinite =
    Number.isFinite(result.quantity) &&
    Number.isFinite(result.capexUsd) &&
    result.capexUsd > 0 &&
    Number.isFinite(result.opexAnnualUsd) &&
    Number.isFinite(result.baselineAnnualUsd) &&
    Number.isFinite(result.annualSavingsUsd);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Параметры объекта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <NumField id="areaM2" label="Площадь (м²)" value={params.areaM2}
            onChange={(n) => setParams((p) => ({ ...p, areaM2: n }))} />
          <NumField id="opsPerDay" label="Объём операций в сутки" value={params.opsPerDay}
            onChange={(n) => setParams((p) => ({ ...p, opsPerDay: n }))} />
          <NumField id="staffCount" label="Численность персонала" value={params.staffCount}
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

      <Card>
        <CardHeader>
          <CardTitle>Результаты</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {!resultsFinite ? (
            <div className="font-medium text-muted-foreground">
              Проверьте параметры расчёта — некоторые значения некорректны
            </div>
          ) : (
            <>
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
            </>
          )}
        </CardContent>
      </Card>

      <div className="md:col-span-2 flex items-center gap-3">
        <button onClick={handleSave}
          className="rounded-md border px-3 py-2 text-sm font-medium">
          Сохранить расчёт
        </button>
        {saveMsg === "unauth" ? (
          <span className="text-sm">
            <Link href="/login" className="underline">Войдите</Link>, чтобы сохранить расчёт
          </span>
        ) : saveMsg ? (
          <span className="text-sm text-muted-foreground">{saveMsg}</span>
        ) : null}
      </div>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Допущения (можно изменить)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {(Object.keys(ASSUMPTION_LABELS) as (keyof AssumptionValues)[]).map((k) => (
            <NumField
              key={k}
              id={k}
              label={ASSUMPTION_LABELS[k]}
              value={assumptions[k]}
              step={RATIO_KEYS.has(k) ? 0.05 : 1}
              onChange={(n) => setAssumptions((a) => ({ ...a, [k]: n }))}
            />
          ))}
        </CardContent>
      </Card>

      <FacilityVisualization
        facilityKind={mapKind(facilitySlug)}
        params={params}
        assumptions={assumptions}
        capacity={capacity}
        capacityUnit={capacityUnit}
        result={result}
      />
    </div>
  );
}
