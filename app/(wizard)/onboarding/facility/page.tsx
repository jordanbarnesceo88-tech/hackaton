import { redirectLegacyWorkflow, type LegacyQuery } from "@/lib/wizard/current-route";

/** New v1 calculations are retired; keep old links usable through the current workflow. */
export default function LegacyWorkflowPage({ searchParams }: { searchParams: Promise<LegacyQuery> }) {
  return redirectLegacyWorkflow(searchParams);
}
