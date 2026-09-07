import { redirect } from "next/navigation";
import { getFacilityTypeBySlug, getTypicalParams } from "@/lib/db/queries";
import { ParamsStep } from "@/components/wizard/params-step";
import { parseWizardParams, buildWizardQuery } from "@/lib/wizard/steps";
import { withParamDefaults } from "@/lib/economics/assumptions";

export default async function ParamsStepPage({
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

  const [facilityType, typical] = await Promise.all([
    getFacilityTypeBySlug(state.facility),
    getTypicalParams(state.facility),
  ]);
  if (!facilityType) redirect("/onboarding");

  // Единицу измерения здесь НЕ показываем. Она принадлежит решению, а не объекту: у склада
  // AutoStore считает «презентации/час», AMR — «отборы/час», паллетайзер — «коробки/час».
  // Подставить единицу первого решения значит пообещать объекту одну шкалу там, где их
  // несколько, и число, введённое под эту подпись, окажется не тем, что имел в виду человек.

  return (
    <ParamsStep
      industry={state.industry}
      facility={state.facility}
      facilityName={facilityType.name}
      objectName={state.objectName}
      typical={withParamDefaults(typical)}
    />
  );
}
