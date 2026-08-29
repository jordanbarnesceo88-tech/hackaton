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
import { EconomicsCalculator } from "@/components/economics-calculator";
import type {
  FacilityParams,
  AssumptionValues,
  SolutionCapacity,
  EconomicsResult,
} from "@/lib/economics/types";

// P2: a saved analysis restores its params/assumptions but the calculator recomputes live from
// the CURRENT solution row. If the solution's price/capacity/OPEX changed since the save (or the
// economics model itself changed), the displayed numbers differ from what was stored. Detect
// that by recomputing with the saved inputs against today's solution and comparing to the
// stored results, so we can tell the user honestly instead of silently showing different numbers.
function resultsDiverged(stored: unknown, recomputed: EconomicsResult): boolean {
  if (!stored || typeof stored !== "object") return true;
  const s = stored as Record<string, unknown>;
  const now = recomputed as Record<string, unknown>;
  // Discriminant change (economical ↔ not, or a different reason) is a divergence.
  if (s.economical !== now.economical) return true;
  if (now.reason !== undefined && s.reason !== now.reason) return true;
  // Compare every numeric output field the recompute produces — not just a few — so a model
  // change that only shifts derived figures (NPV, ROI, payback, OPEX, displaced FTE …) is caught.
  for (const [k, v] of Object.entries(now)) {
    if (typeof v !== "number") continue;
    const then = s[k];
    if (typeof then !== "number") return true;
    if (Math.abs(v - then) / Math.max(1, Math.abs(v)) > 1e-6) return true;
  }
  return false;
}

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
