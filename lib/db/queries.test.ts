import { describe, it, expect } from "vitest";
import { getIndustries, getCatalogForFacilityType } from "./queries";

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
