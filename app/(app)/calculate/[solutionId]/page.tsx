import { notFound } from "next/navigation";
import { auth } from "@/auth";
import {
  getSolutionForCalc,
  getSolutionApplicability,
  getFacilityTypeBySlug,
  getAssumptions,
  getSavedAnalysis,
  getSiblingSolutions,
} from "@/lib/db/queries";
import { assumptionsToValues, withAssumptionDefaults, withParamDefaults } from "@/lib/economics/assumptions";
import { computeEconomics } from "@/lib/economics/calculate";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { resultsDiverged } from "@/lib/analyses/diverged";
import { EconomicsCalculator } from "@/components/economics-calculator";
import type { FacilityParams } from "@/lib/economics/types";

export default async function CalculatePage({
  params,
  searchParams,
}: {
  params: Promise<{ solutionId: string }>;
  searchParams: Promise<{ analysis?: string; obj?: string; facility?: string }>;
}) {
  const { solutionId } = await params;
  const { analysis: analysisId, obj, facility } = await searchParams;
  const objectName = obj?.trim().slice(0, 80) || null; // M4: echo the "Other" object name
  const [solution, assumptionRows, categorySolutions, applicable] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
    getSiblingSolutions(solutionId),
    getSolutionApplicability(solutionId),
  ]);
  if (!solution) notFound();

  // The facility type is no longer reachable through the solution — a category serves many.
  // Take it from the URL when it is one the solution actually applies to, and otherwise fall
  // back to the first applicable one rather than showing a facility the numbers aren't for.
  const facilitySlug = facility && applicable.includes(facility) ? facility : applicable[0];
  const facilityType = facilitySlug ? await getFacilityTypeBySlug(facilitySlug) : null;
  if (!facilityType) notFound();

  const capacity = toSolutionCapacity(solution);

  let initialAssumptions = assumptionsToValues(assumptionRows);
  let initialParams: FacilityParams | undefined;
  let dataChanged = false;
  if (analysisId) {
    const session = await auth();
    if (session?.user?.id) {
      const saved = await getSavedAnalysis(analysisId, session.user.id);
      if (saved && saved.solutionId === solutionId) {
        initialParams = withParamDefaults(saved.params);
        // Backfill defaults so an analysis saved before a newer assumption (e.g. energyCostFactor)
        // doesn't recompute to NaN/invalid.
        initialAssumptions = withAssumptionDefaults(saved.assumptions);
        const recomputed = computeEconomics(capacity, initialParams, initialAssumptions);
        dataChanged = resultsDiverged(saved.results, recomputed);
      }
    }
  }

  return (
    <div className="surface-data py-12">
      <EconomicsCalculator
        categorySolutions={categorySolutions}
        initialSelectedId={solution.id}
        initialAssumptions={initialAssumptions}
        facilitySlug={facilityType.slug}
        facilityTypeName={facilityType.name}
        industryName={facilityType.industry.name}
        objectName={objectName}
        dataChanged={dataChanged}
        initialParams={initialParams}
      />
    </div>
  );
}
