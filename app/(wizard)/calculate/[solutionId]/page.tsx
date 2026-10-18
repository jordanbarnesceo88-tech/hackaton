import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { getSavedAnalysis } from "@/lib/db/queries";
import { redirectLegacyWorkflow, type LegacyQuery } from "@/lib/wizard/current-route";

/** Preserve private historical links as read-only reports, with the same ownership boundary. */
export default async function LegacyCalculatePage({ params, searchParams }: {
  params: Promise<{ solutionId: string }>; searchParams: Promise<LegacyQuery>;
}) {
  const query = await searchParams;
  if (typeof query.analysis !== "string" || !query.analysis) return redirectLegacyWorkflow(Promise.resolve(query));
  const user = await requireUser();
  const saved = await getSavedAnalysis(query.analysis, user.userId);
  if (!saved || saved.solutionId !== (await params).solutionId) notFound();
  redirect(`/report/${encodeURIComponent(saved.id)}`);
}
