"use client";

import { useState } from "react";
import { FacilityVisualization } from "@/components/facility-visualization";
import { ParamsForm } from "@/components/calculator/params-form";
import { ResultsPanel } from "@/components/calculator/results-panel";
import { AssumptionsPanel } from "@/components/calculator/assumptions-panel";
import { SaveControl } from "@/components/calculator/save-control";
import { RecommendationPanel } from "@/components/calculator/recommendation-panel";
import { SensitivityChart } from "@/components/calculator/sensitivity-chart";
import { HeroResults } from "@/components/calculator/hero-results";
import { BreakEvenNote } from "@/components/calculator/break-even-note";
import { mapKind } from "@/lib/scene/layout";
import { computeEconomics } from "@/lib/economics/calculate";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { rankSolutions, type SiblingSolution } from "@/lib/economics/recommend";
import { sensitivity } from "@/lib/economics/sensitivity";
import { formatCost } from "@/lib/format/currency";
import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";

export function EconomicsCalculator({
  categorySolutions,
  initialSelectedId,
  initialAssumptions,
  facilitySlug,
  facilityTypeName,
  industryName,
  objectName,
  dataChanged,
  initialParams,
}: {
  categorySolutions: SiblingSolution[];
  initialSelectedId: string;
  initialAssumptions: AssumptionValues;
  facilitySlug: string;
  facilityTypeName: string;
  industryName: string;
  objectName: string | null;
  dataChanged: boolean;
  initialParams?: FacilityParams;
}) {
  const [selectedSolutionId, setSelectedSolutionId] = useState(initialSelectedId);
  const primary =
    categorySolutions.find((s) => s.id === selectedSolutionId) ?? categorySolutions[0];

  const isStock = primary.capacityBasis === "CONCURRENT_STOCK";
  const [params, setParams] = useState<FacilityParams>(
    initialParams ?? {
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
      ...(isStock ? { peakConcurrent: 20 } : {}),
    }
  );
  const [assumptions, setAssumptions] = useState<AssumptionValues>(initialAssumptions);

  const capacity = toSolutionCapacity(primary);

  const result = computeEconomics(capacity, params, assumptions);
  const ranked = rankSolutions(categorySolutions, params, assumptions);
  const bars = sensitivity(capacity, params, assumptions);

  return (
    <div className="flex flex-col gap-6">
      {/* Header lives here (not the server page) so the title/vendor follow an in-place switch. */}
      <div>
        <h1 className="text-2xl font-semibold">
          Расчёт экономики: {primary.name}
          {objectName ? ` — объект «${objectName}»` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {primary.vendor} · {facilityTypeName} ({industryName})
        </p>
        {primary.priceEstimated && primary.priceLowUsd != null && primary.priceHighUsd != null && (
          <p className="text-xs text-amber-700">
            оценка цены: {formatCost(primary.priceLowUsd, assumptions.usdToRub)}–
            {formatCost(primary.priceHighUsd, assumptions.usdToRub)} · CAPEX по середине диапазона
            {primary.sourceUrl ? (
              <>
                {" "}
                <a href={primary.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  источник ↗
                </a>
              </>
            ) : null}
          </p>
        )}
      </div>
      {dataChanged && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Данные решения или модель расчёта изменились с момента сохранения — показан пересчёт по
          актуальным данным, он может отличаться от сохранённого.
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
      <HeroResults
        result={result}
        usdToRub={assumptions.usdToRub}
        priceEstimated={primary.priceEstimated}
      />
      <BreakEvenNote capacity={capacity} params={params} assumptions={assumptions} result={result} />
      <ParamsForm
        params={params}
        setParams={setParams}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
        assumptions={assumptions}
        usdToRub={assumptions.usdToRub}
        onPickRegion={(labor, energyFactor) =>
          setAssumptions((prev) => ({
            ...prev,
            laborCostPerHourUsd: labor,
            energyCostFactor: energyFactor,
          }))
        }
      />
      <ResultsPanel result={result} usdToRub={assumptions.usdToRub} />
      <RecommendationPanel
        ranked={ranked}
        selectedId={selectedSolutionId}
        usdToRub={assumptions.usdToRub}
        onSelect={setSelectedSolutionId}
      />
      <SensitivityChart bars={bars} usdToRub={assumptions.usdToRub} />
      <SaveControl
        facilitySlug={facilitySlug}
        solutionId={selectedSolutionId}
        params={params}
        assumptions={assumptions}
        result={result}
      />
      <AssumptionsPanel
        assumptions={assumptions}
        setAssumptions={setAssumptions}
        capacityBasis={primary.capacityBasis}
      />
      <FacilityVisualization
        facilityKind={mapKind(facilitySlug)}
        params={params}
        assumptions={assumptions}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
        result={result}
      />
      </div>
    </div>
  );
}
