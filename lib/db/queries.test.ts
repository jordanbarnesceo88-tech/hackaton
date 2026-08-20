import { describe, it, expect } from "vitest";
import { getIndustries, getCatalogForFacilityType, getSolutionForCalc, getAssumptions } from "./queries";
import { createSavedAnalysis, getSavedAnalyses, getSavedAnalysis } from "./queries";
import { prisma } from "./client";

describe("getIndustries", () => {
  it("returns all 4 seeded industries with their facility types", async () => {
    const industries = await getIndustries();
    expect(industries).toHaveLength(4);
    const retail = industries.find((i) => i.slug === "retail");
    expect(retail).toBeDefined();
    expect(retail!.facilityTypes.map((f) => f.slug)).toContain("warehouse");
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
  it("returns the 8 seeded assumptions ordered by `order`", async () => {
    const rows = await getAssumptions();
    expect(rows).toHaveLength(8);
    expect(rows[0].key).toBe("laborCostPerHourUsd");
    expect(rows.map((r) => r.order)).toEqual([...rows.map((r) => r.order)].sort((x, y) => x - y));
  });
});

describe("getSolutionForCalc", () => {
  it("returns a solution with capacityBasis and its facility type, or null", async () => {
    const warehouse = await getCatalogForFacilityType("warehouse");
    const someId = warehouse!.solutionCategories[0].solutions[0].id;
    const sol = await getSolutionForCalc(someId);
    expect(sol).not.toBeNull();
    expect(sol!.capacityBasis).toBeDefined();
    expect(sol!.solutionCategory.facilityType.slug).toBe("warehouse");
    expect(await getSolutionForCalc("does-not-exist")).toBeNull();
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
    const saved = await createSavedAnalysis(a.id, {
      name: "test", facilityTypeSlug: "warehouse", solutionId: "sol1",
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
