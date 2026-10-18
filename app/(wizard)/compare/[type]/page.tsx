import { redirectLegacyWorkflow, type LegacyQuery } from "@/lib/wizard/current-route";

export default async function LegacyComparePage({ params, searchParams }: {
  params: Promise<{ type: string }>; searchParams: Promise<LegacyQuery>;
}) {
  return redirectLegacyWorkflow(searchParams, (await params).type);
}
