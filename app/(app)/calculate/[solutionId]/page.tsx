import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSolutionForCalc, getAssumptions, getSavedAnalysis } from "@/lib/db/queries";
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
  const keys = ["quantity", "capexUsd", "annualSavingsUsd"] as const;
  for (const k of keys) {
    const now = (recomputed as Record<string, unknown>)[k];
    const then = s[k];
    if (typeof now !== "number") {
      if (typeof then === "number") return true; // was calculable, now invalid (or vice versa)
      continue;
    }
    if (typeof then !== "number") return true;
    if (Math.abs(now - then) / Math.max(1, Math.abs(now)) > 1e-6) return true;
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
  const [solution, assumptionRows] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">
          Расчёт экономики: {solution.name}
          {objectName ? ` — объект «${objectName}»` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {solution.vendor} · {solution.solutionCategory.facilityType.name} (
          {solution.solutionCategory.facilityType.industry.name})
        </p>
      </div>
      {dataChanged && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Данные решения или модель расчёта изменились с момента сохранения — показан пересчёт по
          актуальным данным, он может отличаться от сохранённого.
        </div>
      )}
      <EconomicsCalculator
        capacity={capacity}
        capacityUnit={solution.capacityUnit}
        initialAssumptions={initialAssumptions}
        facilitySlug={solution.solutionCategory.facilityType.slug}
        solutionId={solution.id}
        initialParams={initialParams}
      />
    </div>
  );
}
