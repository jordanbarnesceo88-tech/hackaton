import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { isFacilitySlug } from "@/lib/tz/processes";

export type LegacyQuery = Record<string, string | string[] | undefined>;

/** Only identical facility slugs are compatible; v1 workload units are not converted. */
export function currentWorkflowHref(facility: unknown, authenticated: boolean): string {
  const query = new URLSearchParams({ legacy: "1" });
  if (typeof facility === "string" && isFacilitySlug(facility)) query.set("facility", facility);
  return `${authenticated ? "/projects/new" : "/demo"}?${query}`;
}

export async function redirectLegacyWorkflow(searchParams: Promise<LegacyQuery>, facilityOverride?: string): Promise<never> {
  const [query, user] = await Promise.all([searchParams, getSessionUser()]);
  redirect(currentWorkflowHref(facilityOverride ?? query.facility, Boolean(user)));
}
