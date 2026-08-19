import { notFound } from "next/navigation";
import { getSolutionForCalc, getAssumptions } from "@/lib/db/queries";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import { EconomicsCalculator } from "@/components/economics-calculator";

export default async function CalculatePage({
  params,
}: {
  params: Promise<{ solutionId: string }>;
}) {
  const { solutionId } = await params;
  const [solution, assumptionRows] = await Promise.all([
    getSolutionForCalc(solutionId),
    getAssumptions(),
  ]);
  if (!solution) notFound();

  const initialAssumptions = assumptionsToValues(assumptionRows);

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
      />
    </div>
  );
}
