import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSolutionForCalc, getAssumptions, getSavedAnalysis } from "@/lib/db/queries";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import { EconomicsCalculator } from "@/components/economics-calculator";
import type { FacilityParams, AssumptionValues } from "@/lib/economics/types";

export default async function CalculatePage({
  params,
  searchParams,
}: {
  params: Promise<{ solutionId: string }>;
  searchParams: Promise<{ analysis?: string }>;
}) {
  const { solutionId } = await params;
  const { analysis: analysisId } = await searchParams;
  const [solution, assumptionRows] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
  ]);
  if (!solution) notFound();

  let initialAssumptions = assumptionsToValues(assumptionRows);
  let initialParams: FacilityParams | undefined;
  if (analysisId) {
    const session = await auth();
    if (session?.user?.id) {
      const saved = await getSavedAnalysis(analysisId, session.user.id);
      if (saved && saved.solutionId === solutionId) {
        initialParams = saved.params as FacilityParams;
        initialAssumptions = saved.assumptions as AssumptionValues;
      }
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Расчёт экономики: {solution.name}</h1>
        <p className="text-sm text-muted-foreground">
          {solution.vendor} · {solution.solutionCategory.facilityType.name} (
          {solution.solutionCategory.facilityType.industry.name})
        </p>
      </div>
      <EconomicsCalculator
        capacity={{
          capacityPerUnit: solution.capacityPerUnit,
          capacityBasis: solution.capacityBasis,
          priceUsd: solution.priceUsd,
          maintenanceUsdYear: solution.maintenanceUsdYear,
          energyUsdYear: solution.energyUsdYear,
          licensingUsdYear: solution.licensingUsdYear,
        }}
        capacityUnit={solution.capacityUnit}
        initialAssumptions={initialAssumptions}
        facilitySlug={solution.solutionCategory.facilityType.slug}
        solutionId={solution.id}
        initialParams={initialParams}
      />
    </div>
  );
}
