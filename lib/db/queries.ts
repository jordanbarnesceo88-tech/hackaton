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

export type SavedAnalysisInput = {
  name: string;
  facilityTypeSlug: string;
  solutionId: string;
  params: unknown;
  assumptions: unknown;
  results: unknown;
};

export async function createSavedAnalysis(userId: string, input: SavedAnalysisInput) {
  return prisma.savedAnalysis.create({
    data: {
      userId,
      name: input.name,
      facilityTypeSlug: input.facilityTypeSlug,
      solutionId: input.solutionId,
      params: input.params as object,
      assumptions: input.assumptions as object,
      results: input.results as object,
    },
  });
}

export async function getSavedAnalyses(userId: string) {
  return prisma.savedAnalysis.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSavedAnalysis(id: string, userId: string) {
  return prisma.savedAnalysis.findFirst({ where: { id, userId } });
}
