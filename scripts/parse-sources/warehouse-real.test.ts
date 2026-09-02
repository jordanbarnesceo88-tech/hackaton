import { describe, it, expect } from "vitest";
import { WAREHOUSE_REAL } from "./warehouse-real";

const BASES = ["PER_HOUR_FLOW", "PER_DAY_FLOW", "CONCURRENT_STOCK"];

describe("WAREHOUSE_REAL curated data", () => {
  it("has at least 3 products spanning both categories", () => {
    expect(WAREHOUSE_REAL.length).toBeGreaterThanOrEqual(3);
    const slugs = new Set(WAREHOUSE_REAL.map((s) => s.categorySlug));
    expect(slugs.has("amr")).toBe(true);
    expect(slugs.has("asrs")).toBe(true);
  });

  it.each(WAREHOUSE_REAL.map((s) => [s.name, s] as const))(
    "%s is well-formed, cited, and price-estimated",
    (_name, s) => {
      expect(["amr", "asrs"]).toContain(s.categorySlug);
      expect(BASES).toContain(s.capacityBasis);
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.vendor.trim().length).toBeGreaterThan(0);
      expect(s.capacityPerUnit).toBeGreaterThan(0);
      expect(s.priceEstimated).toBe(true);
      expect(s.priceLowUsd).toBeGreaterThan(0);
      expect(s.priceHighUsd).toBeGreaterThanOrEqual(s.priceLowUsd);
      expect(s.priceUsd).toBeGreaterThanOrEqual(s.priceLowUsd);
      expect(s.priceUsd).toBeLessThanOrEqual(s.priceHighUsd);
      // priceUsd is the rounded midpoint
      expect(s.priceUsd).toBe(Math.round((s.priceLowUsd + s.priceHighUsd) / 2));
      expect(s.priceBasis.trim().length).toBeGreaterThan(0);
      expect(s.maintenanceUsdYear).toBeGreaterThanOrEqual(0);
      expect(s.energyUsdYear).toBeGreaterThanOrEqual(0);
      expect(s.licensingUsdYear).toBeGreaterThanOrEqual(0);
      expect(/^https?:\/\//.test(s.sourceUrl)).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(s.lastVerified)).toBe(true);
    }
  );
});

describe("lastVerified integrity", () => {
  // Staleness itself is checked by `npm run check:sources`, not here: a test that fails once a
  // date passes would turn CI red for something no commit caused. What is safe to assert in CI
  // is that the dates are real and not claims about the future.
  it.each(WAREHOUSE_REAL.map((s) => [s.name, s] as const))("%s has a real, past verification date", (_n, s) => {
    const t = new Date(s.lastVerified).getTime();
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});
