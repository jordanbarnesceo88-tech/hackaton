import { redirect } from "next/navigation";
import { getFacilityTypeBySlug, getTaskCategories, getAssumptions } from "@/lib/db/queries";
import { StaffingStep } from "@/components/wizard/staffing-step";
import { parseWizardParams, buildWizardQuery } from "@/lib/wizard/steps";
import { assumptionsToValues } from "@/lib/economics/assumptions";
import { taskStaffingRows } from "@/lib/wizard/task-staffing";

export default async function StaffingStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const state = parseWizardParams(sp);
  if (!state.industry) redirect("/onboarding");
  if (!state.facility) {
    redirect(`/onboarding/facility?${buildWizardQuery({ industry: state.industry })}`);
  }
  // Занятость считается ОТ параметров объекта: норматив превращается в людей через годовой
  // объём работы. Без полного набора предзаполнять нечем, и человека возвращает на шаг назад,
  // а не встречает экран с пустыми подсказками.
  if (!state.complete) {
    redirect(
      `/onboarding/params?${buildWizardQuery({
        industry: state.industry,
        facility: state.facility,
        objectName: state.objectName,
        params: state.provided,
      })}`
    );
  }

  const [facilityType, categories, assumptionRows] = await Promise.all([
    getFacilityTypeBySlug(state.facility),
    getTaskCategories(state.facility),
    getAssumptions(),
  ]);
  if (!facilityType) redirect("/onboarding");

  // Р-4: ключи занятости из ссылки проверяются на применимость к ЭТОМУ типу объекта. Посторонний
  // ключ — это данные, которые кто-то потом прочитает как истину, и в сохранённый отчёт им
  // попадать нечего. Прецедент тот же, что у facilityTypeSlug против getSolutionApplicability().
  const applicable = new Set(categories.map((c) => c.slug));
  const declared = state.params.taskStaffing ?? {};
  const cleaned: Record<string, number> = {};
  for (const [slug, n] of Object.entries(declared)) {
    if (applicable.has(slug)) cleaned[slug] = n;
  }
  const params = {
    ...state.params,
    ...(Object.keys(cleaned).length > 0 ? { taskStaffing: cleaned } : { taskStaffing: undefined }),
  };

  const rows = taskStaffingRows(categories, params, assumptionsToValues(assumptionRows));

  return (
    <StaffingStep
      industry={state.industry}
      facility={state.facility}
      facilityName={facilityType.name}
      objectName={state.objectName}
      params={params}
      rows={rows}
    />
  );
}
