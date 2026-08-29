"use client";

import { useState } from "react";
import { FacilityVisualization } from "@/components/facility-visualization";
import { ParamsForm } from "@/components/calculator/params-form";
import { ResultsPanel } from "@/components/calculator/results-panel";
import { AssumptionsPanel } from "@/components/calculator/assumptions-panel";
import { SaveControl } from "@/components/calculator/save-control";
import { RecommendationPanel } from "@/components/calculator/recommendation-panel";
import { SensitivityChart } from "@/components/calculator/sensitivity-chart";
import { mapKind } from "@/lib/scene/layout";
import { computeEconomics } from "@/lib/economics/calculate";
import { rankSolutions, type SiblingSolution } from "@/lib/economics/recommend";
import { sensitivity } from "@/lib/economics/sensitivity";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";

export function EconomicsCalculator({
  categorySolutions,
  initialSelectedId,
  initialAssumptions,
  facilitySlug,
  initialParams,
}: {
  categorySolutions: SiblingSolution[];
  initialSelectedId: string;
  initialAssumptions: AssumptionValues;
  facilitySlug: string;
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

  const capacity: SolutionCapacity = {
    capacityPerUnit: primary.capacityPerUnit,
    capacityBasis: primary.capacityBasis,
    priceUsd: primary.priceUsd,
    maintenanceUsdYear: primary.maintenanceUsdYear,
    energyUsdYear: primary.energyUsdYear,
    licensingUsdYear: primary.licensingUsdYear,
  };

  const result = computeEconomics(capacity, params, assumptions);
  const ranked = rankSolutions(categorySolutions, params, assumptions);
  const bars = sensitivity(capacity, params, assumptions);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ParamsForm
        params={params}
        setParams={setParams}
        capacity={capacity}
        capacityUnit={primary.capacityUnit}
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
  );
}
