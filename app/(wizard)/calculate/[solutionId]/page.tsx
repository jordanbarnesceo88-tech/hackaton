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
import { assumptionsToValues, withAssumptionDefaults } from "@/lib/economics/assumptions";
import { validateParams } from "@/lib/analyses/validate";
import { computeEconomics } from "@/lib/economics/calculate";
import { parseWizardParams } from "@/lib/wizard/steps";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { resultsDiverged } from "@/lib/analyses/diverged";
import { EconomicsCalculator } from "@/components/economics-calculator";
import type { FacilityParams } from "@/lib/economics/types";

export default async function CalculatePage({
  params,
  searchParams,
}: {
  params: Promise<{ solutionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { solutionId } = await params;
  const sp = await searchParams;
  const wizard = parseWizardParams(sp);
  const analysisId = typeof sp.analysis === "string" ? sp.analysis : undefined;
  const obj = wizard.objectName ?? undefined;
  const facility = wizard.facility ?? undefined;
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

  const capacity = toSolutionCapacity({
    ...solution,
    // Поток хранится у категории; движку он нужен на решении.
    workloadStream: solution.solutionCategory.workloadStream,
  });

  let initialAssumptions = assumptionsToValues(assumptionRows);
  // Параметры, собранные подбором, — стартовые для расчёта. Это и есть условие паритета:
  // шаг 4 считает на них же, поэтому первое показанное здесь число совпадает с тем, что
  // человек видел в списке решений. Сохранённый анализ (ниже) их перекрывает — там свои.
  let initialParams: FacilityParams | undefined = wizard.complete ? wizard.params : undefined;
  let dataChanged = false;
  let savedParamsBroken = false;
  if (analysisId) {
    const session = await auth();
    if (session?.user?.id) {
      const saved = await getSavedAnalysis(analysisId, session.user.id);
      if (saved && saved.solutionId === solutionId) {
        // Не withParamDefaults: он подставляет 1000 м² / 500 операций / 10 человек за любое
        // отсутствующее или испорченное поле, и человек правил бы чужие числа, считая их
        // своими. Отчёт это уже отказывается делать; калькулятор — интерактивный инструмент,
        // поэтому он не отказывает, а честно говорит, что сохранённые параметры восстановить
        // не удалось, и начинает с обычных значений по умолчанию.
        const restored = validateParams(saved.params);
        if (restored) {
          initialParams = restored;
        } else {
          savedParamsBroken = true;
        }
        // Допущения — другой случай: их backfill добавляет НЕДОСТАЮЩИЕ ключи (анализ, сохранённый
        // до появления нового допущения), а не выдумывает значения вместо присланных.
        initialAssumptions = withAssumptionDefaults(saved.assumptions);
        if (initialParams) {
          const recomputed = computeEconomics(capacity, initialParams, initialAssumptions);
          dataChanged = resultsDiverged(saved.results, recomputed);
        }
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
        savedParamsBroken={savedParamsBroken}
        initialParams={initialParams}
      />
    </div>
  );
}
