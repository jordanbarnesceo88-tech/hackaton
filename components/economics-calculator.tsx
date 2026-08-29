"use client";

import { useState } from "react";
import { FacilityVisualization } from "@/components/facility-visualization";
import { ParamsForm } from "@/components/calculator/params-form";
import { ResultsPanel } from "@/components/calculator/results-panel";
import { AssumptionsPanel } from "@/components/calculator/assumptions-panel";
import { SaveControl } from "@/components/calculator/save-control";
import { mapKind } from "@/lib/scene/layout";
import { computeEconomics } from "@/lib/economics/calculate";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
} from "@/lib/economics/types";

export function EconomicsCalculator({
  capacity,
  capacityUnit,
  initialAssumptions,
  facilitySlug,
  solutionId,
  initialParams,
}: {
  capacity: SolutionCapacity;
  capacityUnit: string;
  initialAssumptions: AssumptionValues;
  facilitySlug: string;
  solutionId: string;
  initialParams?: FacilityParams;
}) {
  const isStock = capacity.capacityBasis === "CONCURRENT_STOCK";
  const [params, setParams] = useState<FacilityParams>(
    initialParams ?? {
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
      ...(isStock ? { peakConcurrent: 20 } : {}),
    }
  );
  const [assumptions, setAssumptions] =
    useState<AssumptionValues>(initialAssumptions);

  const result = computeEconomics(capacity, params, assumptions);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ParamsForm
        params={params}
        setParams={setParams}
        capacity={capacity}
        capacityUnit={capacityUnit}
      />
      <ResultsPanel result={result} usdToRub={assumptions.usdToRub} />
      <SaveControl
        facilitySlug={facilitySlug}
        solutionId={solutionId}
        params={params}
        assumptions={assumptions}
        result={result}
      />
      <AssumptionsPanel
        assumptions={assumptions}
        setAssumptions={setAssumptions}
        capacityBasis={capacity.capacityBasis}
      />
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
