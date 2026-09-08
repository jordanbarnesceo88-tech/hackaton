import { redirect } from "next/navigation";
import { getIndustries } from "@/lib/db/queries";
import { FacilityStep } from "@/components/wizard/facility-step";
import { parseWizardParams } from "@/lib/wizard/steps";

export default async function FacilityStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const state = parseWizardParams(sp);
  const industries = await getIndustries();
  const industry = industries.find((i) => i.slug === state.industry);
  // Прыжок сюда по прямой ссылке без отрасли — не ошибка пользователя, а незаполненный шаг:
  // мягко возвращаем на первый недостающий, а не показываем пустой экран и не падаем.
  if (!industry) redirect("/onboarding");

  return (
    <FacilityStep
      industry={industry.slug}
      facilityTypes={industry.facilityTypes.map((f) => ({
        slug: f.slug,
        name: f.name,
        isGeneric: f.isGeneric,
      }))}
      initial={state.facility}
      initialObjectName={state.objectName}
    />
  );
}
