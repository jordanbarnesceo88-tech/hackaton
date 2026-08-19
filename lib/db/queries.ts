import { prisma } from "./client";

export async function getIndustries() {
  return prisma.industry.findMany({
    orderBy: { name: "asc" },
    include: {
      facilityTypes: {
        orderBy: { name: "asc" },
      },
    },
  });
}

export async function getCatalogForFacilityType(facilityTypeSlug: string) {
  return prisma.facilityType.findUnique({
    where: { slug: facilityTypeSlug },
    include: {
      industry: true,
      solutionCategories: {
        orderBy: { name: "asc" },
        include: {
          solutions: {
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });
}

export async function getAssumptions() {
  return prisma.assumption.findMany({ orderBy: { order: "asc" } });
}

export async function getSolutionForCalc(id: string) {
  return prisma.solution.findUnique({
    where: { id },
    include: {
      solutionCategory: { include: { facilityType: { include: { industry: true } } } },
    },
  });
}
