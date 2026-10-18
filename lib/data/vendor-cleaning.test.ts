import { describe, expect, it } from "vitest";
import { validateProductSeeds } from "../api/import";
import { productForCalcFromSeed as fromSeed } from "../catalog/product-for-calc";
import { CLEANING_SOURCE_DATE, VENDOR_CLEANING_PRODUCTS } from "./vendor-cleaning";

describe("official cleaning products", () => {
  it("imports three distinct real models, without invented commercials, measurements or local service", () => {
    const checked = validateProductSeeds(VENDOR_CLEANING_PRODUCTS);
    expect(checked.ok ? [] : checked.issues).toEqual([]);
    expect(VENDOR_CLEANING_PRODUCTS.map(p => p.slug)).toEqual(["pudu-cc1", "agibot-c5", "viggo-sc80"]);
    for (const seed of VENDOR_CLEANING_PRODUCTS) {
      const product = fromSeed(seed);
      expect(product.priceRub).toBeNull();
      expect(product.raasRubMonth).toBeNull();
      expect(product.serviceRubYear).toBeNull();
      expect(product.serviceLifeYears).toBeNull();
      expect(product.status).toBe("unknown");
      expect(seed.characteristics.manufacturerCountry?.value).toContain("Китай");
      expect(seed.characteristics.operatingEvidence).toBeUndefined();
      for (const s of Object.values(seed.characteristics)) {
        expect(s.date).toBe(CLEANING_SOURCE_DATE);
        if (s.origin === "research") expect(s.sourceUrl).toMatch(/^https:\/\/((www|store)\.)?(pudurobotics|agibot|viggorobot)\.com\//);
        if (s.origin === "estimate") expect(s.confirmed).toBe(false);
      }
    }
  });

  it("preserves maxima, model identity and explicit source discrepancies", () => {
    expect(VENDOR_CLEANING_PRODUCTS[0]!.characteristics.chargeMin?.value).toMatchObject({ max: 180, qualifier: "до" });
    expect(fromSeed(VENDOR_CLEANING_PRODUCTS[0]!).throughputPerH).toBe(700);
    expect(fromSeed(VENDOR_CLEANING_PRODUCTS[1]!).throughputPerH).toBeNull();
    expect(fromSeed(VENDOR_CLEANING_PRODUCTS[2]!).throughputPerH).toBeNull();
    expect(VENDOR_CLEANING_PRODUCTS[2]!.characteristics.limitations?.value).toContain("210");
    expect(VENDOR_CLEANING_PRODUCTS[1]!.characteristics.limitations?.value).toContain("вентилятора");
  });
});
