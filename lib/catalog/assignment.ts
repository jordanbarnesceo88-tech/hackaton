import type { Prisma } from "@prisma/client";

/** Assignment is a real facility/process relationship, independent of financial readiness. */
export function catalogVisibilityWhere(includeUnassigned = false): Prisma.CatalogProductWhereInput {
  return { archived: false, ...(includeUnassigned ? {} : {
    OR: ["warehouse", "airport", "medical"].map(facility => ({
      facilityTypeSlugs: { has: facility },
      processes: { some: { process: { facilityTypes: { some: { facilityType: { slug: facility } } } } } },
    })),
  }) };
}
