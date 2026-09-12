import { prisma } from "./client";
import type { SiblingSolution } from "@/lib/economics/recommend";

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
  const facilityType = await prisma.facilityType.findUnique({
    where: { slug: facilityTypeSlug },
    include: {
      industry: true,
      categories: {
        // `order` alone is not an order: it defaults to 0 for every row, so ties fell back to
        // whatever the database returned and the catalogue reshuffled between deploys. Name is
        // the tiebreaker, which is also the ordering this page had before the inversion.
        orderBy: [{ order: "asc" }, { category: { name: "asc" } }],
        include: { category: { include: { solutions: { orderBy: { name: "asc" } } } } },
      },
    },
  });
  if (!facilityType) return null;

  // The response shape deliberately matches the pre-inversion one — `solutionCategories` with
  // their solutions — so the comparison page doesn't move in the same change that moves the
  // schema. It is rewritten by the wizard plan, not this one.
  const { categories, ...rest } = facilityType;
  return {
    ...rest,
    solutionCategories: categories.map((link) => ({
      ...link.category,
      // Поток и контекст задачи спускаются с категории на каждое её решение: движок принимает
      // их на решении, а хранить на категории правильно — все паллетайзеры считаются
      // одинаково. categorySlug — ключ к заявленной занятости, workerOutputPerYear — норматив
      // для отката, когда занятость не заявлена.
      solutions: link.category.solutions.map((s) => ({
        ...s,
        workloadStream: link.category.workloadStream,
        categorySlug: link.category.slug,
        workerOutputPerYear: link.category.workerOutputPerYear,
      })),
    })),
  };
}

/**
 * Facility types a solution applies to, via its category and the applicability join.
 *
 * Replaces deriving a single facility type from the solution. After the inversion a solution
 * has no one facility type — but a client-supplied one still must not be taken on trust, so
 * the set it has to belong to stays checkable.
 */
/**
 * Задачи, применимые к типу объекта, — вход экрана «кто чем занят» (A-9).
 *
 * Отдельно от `getCatalogForFacilityType`, который тянет ещё и все решения каждой категории:
 * экрану занятости они не нужны, а порядок обязан совпадать с тем, что человек увидит на
 * сравнении, — поэтому сортировка здесь та же.
 */
export async function getTaskCategories(facilityTypeSlug: string) {
  const links = await prisma.facilityTypeCategory.findMany({
    where: { facilityType: { slug: facilityTypeSlug } },
    orderBy: [{ order: "asc" }, { category: { name: "asc" } }],
    select: {
      category: {
        select: {
          slug: true,
          taskLabel: true,
          workloadStream: true,
          workerOutputPerYear: true,
          workerOutputSourceUrl: true,
        },
      },
    },
  });
  return links.map((l) => l.category);
}

export async function getSolutionApplicability(solutionId: string): Promise<string[]> {
  const rows = await prisma.facilityTypeCategory.findMany({
    where: { category: { solutions: { some: { id: solutionId } } } },
    select: { facilityType: { select: { slug: true } } },
  });
  return rows.map((r) => r.facilityType.slug);
}

/**
 * Типовые параметры объекта — то, с чего стартует шаг ввода.
 *
 * Пустые поля здесь хуже приблизительных: человек, впервые открывший расчёт, не знает, сколько
 * операций в сутки у «типового» распределительного центра, и уходит вместо того, чтобы
 * поправить цифру под себя.
 */
export async function getTypicalParams(
  facilityTypeSlug: string
): Promise<{ areaM2: number; opsPerDay: number; staffCount: number } | null> {
  const ft = await prisma.facilityType.findUnique({
    where: { slug: facilityTypeSlug },
    select: { facilityExamples: { where: { name: "Типовой объект" }, select: { params: true }, take: 1 } },
  });
  const raw = ft?.facilityExamples[0]?.params;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const areaM2 = num(p.areaM2), opsPerDay = num(p.opsPerDay), staffCount = num(p.staffCount);
  if (areaM2 === null || opsPerDay === null || staffCount === null) return null;
  return { areaM2, opsPerDay, staffCount };
}

export async function getFacilityTypeBySlug(slug: string) {
  return prisma.facilityType.findUnique({
    where: { slug },
    select: { slug: true, name: true, industry: { select: { name: true } } },
  });
}

export async function getAssumptions() {
  return prisma.assumption.findMany({ orderBy: { order: "asc" } });
}

export async function getSolutionForCalc(id: string) {
  // No longer reaches through to a facility type: a category serves many of them now. Callers
  // take the facility type from where it actually belongs — the saved analysis for a report,
  // the URL for a live calculation — and validate it against getSolutionApplicability().
  return prisma.solution.findUnique({
    where: { id },
    include: {
      solutionCategory: {
        select: {
          id: true, slug: true, name: true, workloadStream: true,
          taskLabel: true, workerOutputPerYear: true,
        },
      },
    },
  });
}

export async function getSiblingSolutions(solutionId: string): Promise<SiblingSolution[]> {
  const solution = await prisma.solution.findUnique({
    where: { id: solutionId },
    select: { solutionCategoryId: true },
  });
  if (!solution) return [];
  const rows = await prisma.solution.findMany({
    where: { solutionCategoryId: solution.solutionCategoryId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, vendor: true, priceUsd: true, capacityPerUnit: true,
      capacityUnit: true, capacityBasis: true, maintenanceUsdYear: true,
      energyUsdYear: true, licensingUsdYear: true,
      priceEstimated: true, priceLowUsd: true, priceHighUsd: true,
      priceBasis: true, sourceUrl: true, isClass: true,
      // Поток живёт у категории, а движку он нужен на каждом решении: без него расчёт
      // сравнивает несравнимое, и это не ошибка отображения, а неверное число.
      solutionCategory: {
        select: { workloadStream: true, slug: true, workerOutputPerYear: true },
      },
    },
  });
  return rows.map(({ solutionCategory, ...s }) => ({
    ...s,
    workloadStream: solutionCategory.workloadStream,
    categorySlug: solutionCategory.slug,
    workerOutputPerYear: solutionCategory.workerOutputPerYear,
  }));
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
