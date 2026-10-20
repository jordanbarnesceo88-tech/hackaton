import { describe, expect, it } from "vitest";
import { catalogVisibilityWhere } from "./assignment";
import { CATALOG, withApplicableScopes } from "../data/organizer/catalog";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";

describe("catalogue assignment independent of financial readiness", () => {
  it("requires one matching facility/process relationship by default and exposes an explicit all-card opt-in", () => {
    const normal = catalogVisibilityWhere();
    expect(normal.archived).toBe(false);
    expect(normal.OR).toHaveLength(3);
    expect(normal).toMatchObject({ OR: [{ facilityTypeSlugs: { has: "warehouse" }, processes: { some: { process: { facilityTypes: { some: { facilityType: { slug: "warehouse" } } } } } } }, {}, {}] });
    expect(catalogVisibilityWhere(true)).toEqual({ archived: false });
    const text = JSON.stringify(normal);
    for (const unrelated of ["priceRub", "status", "level", "throughputPerH", "confirmed"]) expect(text).not.toContain(unrelated);
  });
  it("assigns every identified cleaner to ordinary floor cleaning in three facilities without inventing a clinical workflow", () => {
    for (const product of [...CATALOG, ...VENDOR_CLEANING_PRODUCTS].filter(product => product.solutionType === "cleaner")) {
      expect(product.facilityTypes).toEqual(["warehouse", "airport", "medical"]);
      expect(product.processes).toEqual(["cleaning", "terminal-cleaning", "hospital-cleaning"]);
      expect(product.processes).not.toContain("disinfection");
    }
    const prototype = CATALOG.find(product => product.slug === "168robotics-bro-2-1")!;
    expect(withApplicableScopes({ ...prototype, level: "identification" }).level).toBe("identification");
    expect(withApplicableScopes(prototype).characteristics).toEqual(prototype.characteristics);
  });
  it("keeps warehouse carriers in the warehouse, retaining actual dedicated medical delivery entries", () => {
    for (const slug of ["dikom-dmr-300-carrier-b", "moros-amr-100", "ronavi-m", "ronavi-sd"]) {
      const product = CATALOG.find(product => product.slug === slug)!;
      expect(product.facilityTypes).toEqual(["warehouse"]); expect(product.processes).not.toContain("hospital-delivery");
    }
    expect(CATALOG.some(product => product.processes.includes("hospital-delivery"))).toBe(true);
  });
});
