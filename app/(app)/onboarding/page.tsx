import { getIndustries } from "@/lib/db/queries";
import { OnboardingForm } from "@/components/onboarding-form";

export default async function OnboardingPage() {
  const industries = await getIndustries();
  return <OnboardingForm industries={industries} />;
}
