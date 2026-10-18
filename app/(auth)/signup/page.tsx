import { SignupForm } from "@/components/project/signup-form";
import { guestDraftNonce } from "@/lib/projects/guest-draft";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ guestDraft?: string }> }) {
  return <SignupForm nonce={guestDraftNonce((await searchParams).guestDraft)} />;
}
