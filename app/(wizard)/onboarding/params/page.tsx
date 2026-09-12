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
      // Уже введённое важнее типового: WizardChrome строит «Назад» с текущей query-строкой,
      // и без этого возврат со сравнения молча стирал набранные цифры, подставляя обратно
      // значения по умолчанию.
      //
      // Поле за полем, а не всё-или-ничего: `state.complete` здесь означал, что ОДНО негодное
      // число стирает и два годных — человек возвращался на шаг и видел вместо своих 8000
      // типовое значение. Принятое накладывается поверх типового, поэтому возвращается ровно
      // то, что он набрал, а незаполненное подсказано.
      typical={{ ...withParamDefaults(typical), ...state.provided }}
      rejected={state.rejected}
    />
  );
}
