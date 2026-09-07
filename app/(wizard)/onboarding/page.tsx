import { getIndustries } from "@/lib/db/queries";
import { IndustryStep } from "@/components/wizard/industry-step";
import { parseWizardParams } from "@/lib/wizard/steps";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [industries, sp] = await Promise.all([getIndustries(), searchParams]);
  const state = parseWizardParams(sp);
  return (
    <IndustryStep
      industries={industries.map((i) => ({
        slug: i.slug,
        name: i.name,
        count: i.facilityTypes.length,
      }))}
      initial={state.industry}
    />
  );
}
