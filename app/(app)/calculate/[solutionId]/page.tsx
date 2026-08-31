import { notFound } from "next/navigation";
import { auth } from "@/auth";
import {
  getSolutionForCalc,
  getAssumptions,
  getSavedAnalysis,
  getSiblingSolutions,
} from "@/lib/db/queries";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import { computeEconomics } from "@/lib/economics/calculate";
import { resultsDiverged } from "@/lib/analyses/diverged";
import { EconomicsCalculator } from "@/components/economics-calculator";
import type {
  FacilityParams,
  AssumptionValues,
  SolutionCapacity,
  EconomicsResult,
} from "@/lib/economics/types";

export default async function CalculatePage({
  params,
  searchParams,
}: {
  params: Promise<{ solutionId: string }>;
  searchParams: Promise<{ analysis?: string; obj?: string }>;
}) {
  const { solutionId } = await params;
  const { analysis: analysisId, obj } = await searchParams;
  const objectName = obj?.trim().slice(0, 80) || null; // M4: echo the "Other" object name
  const [solution, assumptionRows, categorySolutions] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
    getSiblingSolutions(solutionId),
  ]);
  if (!solution) notFound();

  const capacity: SolutionCapacity = {
    capacityPerUnit: solution.capacityPerUnit,
    capacityBasis: solution.capacityBasis,
    priceUsd: solution.priceUsd,
    maintenanceUsdYear: solution.maintenanceUsdYear,
    energyUsdYear: solution.energyUsdYear,
    licensingUsdYear: solution.licensingUsdYear,
  };

  let initialAssumptions = assumptionsToValues(assumptionRows);
  let initialParams: FacilityParams | undefined;
  let dataChanged = false;
  if (analysisId) {
    const session = await auth();
    if (session?.user?.id) {
      const saved = await getSavedAnalysis(analysisId, session.user.id);
      if (saved && saved.solutionId === solutionId) {
        initialParams = saved.params as FacilityParams;
        initialAssumptions = saved.assumptions as AssumptionValues;
        const recomputed = computeEconomics(capacity, initialParams, initialAssumptions);
        dataChanged = resultsDiverged(saved.results, recomputed);
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl py-12">
      <EconomicsCalculator
        categorySolutions={categorySolutions}
        initialSelectedId={solution.id}
        initialAssumptions={initialAssumptions}
        facilitySlug={solution.solutionCategory.facilityType.slug}
        facilityTypeName={solution.solutionCategory.facilityType.name}
        industryName={solution.solutionCategory.facilityType.industry.name}
        objectName={objectName}
        dataChanged={dataChanged}
        initialParams={initialParams}
      />
    </div>
  );
}
