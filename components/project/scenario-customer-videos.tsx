import { CustomerVideos } from "@/components/catalog/customer-videos";
import type { ProjectResults } from "@/lib/tz/types";

/** Match the calculated scenario, never substitute a generic or another model's review. */
export function ScenarioCustomerVideos({ model, scenarioKey, stale = false, id }: {
  model: Pick<ProjectResults, "results">; scenarioKey: string | null | undefined; stale?: boolean; id: string;
}) {
  const result = model.results.find(scenario => scenario.key === scenarioKey);
  if (stale || result?.status !== "ok" || result.kind === "asis") return null;
  return <CustomerVideos productSlugs={result.items.map(item => item.productSlug)} id={id} />;
}
