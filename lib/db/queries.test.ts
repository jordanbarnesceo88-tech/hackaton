import { describe, it, expect } from "vitest";
import {
  getIndustries,
  getCatalogForFacilityType,
  getSolutionForCalc,
  getSolutionApplicability,
  getFacilityTypeBySlug,
  getAssumptions,
  getSiblingSolutions,
} from "./queries";
import { createSavedAnalysis, getSavedAnalyses, getSavedAnalysis } from "./queries";
import { prisma } from "./client";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";

describe("getIndustries", () => {
  it("returns the seeded industries with their facility types", async () => {
    // Было ровно 4. Расширение таксономии — намеренное изменение данных, а не поломка:
    // проверяем нижнюю границу и сохранность исходной ветки, а не точное число, чтобы
    // следующее пополнение справочника не красило тест без причины.
    const industries = await getIndustries();
    expect(industries.length).toBeGreaterThanOrEqual(12);
    const retail = industries.find((i) => i.slug === "retail");
    expect(retail).toBeDefined();
    expect(retail!.facilityTypes.map((f) => f.slug)).toContain("warehouse");
  });
});

describe("глобальные категории", () => {
  it("одна категория применима к нескольким типам объектов", async () => {
    const links = await prisma.facilityTypeCategory.findMany({
      where: { category: { slug: "amr" } },
      select: { facilityTypeId: true },
    });
    expect(links.length).toBeGreaterThan(0);
  });
});

describe("getCatalogForFacilityType", () => {
  it("returns categories with solutions for the warehouse facility type", async () => {
    const catalog = await getCatalogForFacilityType("warehouse");
    expect(catalog).not.toBeNull();
    expect(catalog!.solutionCategories.length).toBeGreaterThanOrEqual(2);
    for (const category of catalog!.solutionCategories) {
      expect(category.solutions.length).toBeGreaterThan(0);
    }
  });

  it("returns null for an unknown facility type slug", async () => {
    const catalog = await getCatalogForFacilityType("does-not-exist");
    expect(catalog).toBeNull();
  });
});

describe("getAssumptions", () => {
  it("seeds one row per model assumption, ordered by `order`", async () => {
    const rows = await getAssumptions();
    // Tie the count to the model definition, not a magic number, so a new assumption that is
    // added to the engine but not seeded (or vice versa) fails here.
    const expectedKeys = Object.keys(DEFAULT_ASSUMPTIONS).sort();
    expect(rows.map((r) => r.key).sort()).toEqual(expectedKeys);
    expect(rows[0]!.key).toBe("laborCostPerHourUsd"); // order 1
    expect(rows.map((r) => r.order)).toEqual([...rows.map((r) => r.order)].sort((x, y) => x - y));
  });
});

describe("getSolutionForCalc", () => {
  it("returns a solution with capacityBasis and its category, or null", async () => {
    const warehouse = await getCatalogForFacilityType("warehouse");
    const someId = warehouse!.solutionCategories[0]!.solutions[0]!.id;
    const sol = await getSolutionForCalc(someId);
    expect(sol).not.toBeNull();
    expect(sol!.capacityBasis).toBeDefined();
    expect(sol!.solutionCategory.slug).toBeTruthy();
    expect(await getSolutionForCalc("does-not-exist")).toBeNull();
  });
});

describe("классы решений", () => {
  // Проходит вхолостую, пока классов нет — наполнение отдельной задачей. Смысл теста в том,
  // чтобы форма была под тестом РАНЬШЕ данных: класс обязан нести диапазон и признавать себя
  // оценкой, иначе он выдаёт себя за конкретный продукт с точной ценой.
  it("класс помечен оценкой и несёт диапазон, накрывающий середину", async () => {
    const classes = await prisma.solution.findMany({ where: { isClass: true } });
    for (const c of classes) {
      expect(c.priceEstimated, `${c.name}: класс без пометки «оценка»`).toBe(true);
      expect(c.capacityLow, `${c.name}: нет нижней границы производительности`).not.toBeNull();
      expect(c.capacityHigh).not.toBeNull();
      expect(c.capacityPerUnit).toBeGreaterThanOrEqual(c.capacityLow!);
      expect(c.capacityPerUnit).toBeLessThanOrEqual(c.capacityHigh!);
      expect(c.priceLowUsd).not.toBeNull();
      expect(c.priceHighUsd).not.toBeNull();
      expect(c.sourceUrl, `${c.name}: класс без источника`).toBeTruthy();
    }
  });
});

describe("getSolutionApplicability", () => {
  // Replaces the old assertion that a solution reaches its ONE facility type. It reaches a
  // set now, and the set is what the save path validates a client's claim against.
  it("lists the facility types a solution applies to", async () => {
    const warehouse = await getCatalogForFacilityType("warehouse");
    const someId = warehouse!.solutionCategories[0]!.solutions[0]!.id;
    const slugs = await getSolutionApplicability(someId);
    expect(slugs).toContain("warehouse");
  });

  it("is empty for an unknown solution", async () => {
    expect(await getSolutionApplicability("does-not-exist")).toEqual([]);
  });
});

describe("getFacilityTypeBySlug", () => {
  it("returns the facility type and its industry name", async () => {
    const ft = await getFacilityTypeBySlug("warehouse");
    expect(ft).not.toBeNull();
    expect(ft!.name).toBeTruthy();
    expect(ft!.industry.name).toBeTruthy();
  });

  it("returns null for an unknown slug", async () => {
    expect(await getFacilityTypeBySlug("does-not-exist")).toBeNull();
  });
});

describe("saved analyses (user-scoped)", () => {
  it("creates and lists a user's analyses, and forbids cross-user reads", async () => {
    const a = await prisma.user.create({
      data: { email: `a-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const b = await prisma.user.create({
      data: { email: `b-${Date.now()}@test.local`, passwordHash: "x" },
    });
    // A real solution id: SavedAnalysis.solutionId is a foreign key, so the placeholder "sol1"
    // this used to pass is now rejected by the database — which is the point of the constraint.
    const solution = await prisma.solution.findFirstOrThrow({ select: { id: true } });
    const saved = await createSavedAnalysis(a.id, {
      name: "test", facilityTypeSlug: "warehouse", solutionId: solution.id,
      params: { opsPerDay: 100 }, assumptions: { laborCostPerHourUsd: 15 }, results: { quantity: 2 },
    });
    const listA = await getSavedAnalyses(a.id);
    expect(listA.some((s) => s.id === saved.id)).toBe(true);
    // owner can read
    expect(await getSavedAnalysis(saved.id, a.id)).not.toBeNull();
    // other user cannot
    expect(await getSavedAnalysis(saved.id, b.id)).toBeNull();
    expect(await getSavedAnalyses(b.id)).toHaveLength(0);

    await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } }); // cascade cleans analyses
  });
});

describe("getSiblingSolutions", () => {
  it("returns all solutions in a solution's category, ordered by name", async () => {
    const warehouse = await getCatalogForFacilityType("warehouse");
    const amr = warehouse!.solutionCategories.find((c) => c.slug === "amr")!;
    const one = amr.solutions[0]!.id;
    const siblings = await getSiblingSolutions(one);
    expect(siblings.length).toBe(amr.solutions.length);
    expect(siblings.map((s) => s.id)).toContain(one);
    const names = siblings.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("returns [] for an unknown solution id", async () => {
    expect(await getSiblingSolutions("does-not-exist")).toEqual([]);
  });
});

describe("SavedAnalysis -> Solution referential integrity", () => {
  it("refuses an analysis pointing at a solution that does not exist", async () => {
    const user = await prisma.user.create({
      data: { email: `fk-${Date.now()}@test.local`, passwordHash: "x" },
    });
    await expect(
      createSavedAnalysis(user.id, {
        name: "dangling", facilityTypeSlug: "warehouse", solutionId: "no-such-solution",
        params: {}, assumptions: {}, results: {},
      })
    ).rejects.toThrow();
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses to delete a solution a saved analysis still references", async () => {
    // The failure this prevents: seed.ts's prune removes a renamed product, the reference
    // dangles, and the user's report 404s with nothing explaining why.
    const user = await prisma.user.create({
      data: { email: `fk2-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const solution = await prisma.solution.findFirstOrThrow({ select: { id: true } });
    const saved = await createSavedAnalysis(user.id, {
      name: "keeps the solution alive", facilityTypeSlug: "warehouse", solutionId: solution.id,
      params: {}, assumptions: {}, results: {},
    });
    await expect(prisma.solution.delete({ where: { id: solution.id } })).rejects.toThrow();
    await prisma.savedAnalysis.delete({ where: { id: saved.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
