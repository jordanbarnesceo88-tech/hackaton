import { describe, it, expect } from "vitest";
import { rankSolutions, type SiblingSolution } from "./recommend";
import type { FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.5,
  residualSupervisionPct: 0.1, opsPerWorkerPerYear: 12500, turnoverPerDay: 8,
  roiHorizonYears: 5, discountRate: 0.12, assetLifeYears: 7, usdToRub: 90,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };

const base = {
  capacityBasis: "PER_DAY_FLOW" as const, capacityPerUnit: 400, capacityUnit: "паллет/день",
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
  priceEstimated: false, priceLowUsd: null, priceHighUsd: null, priceBasis: null, sourceUrl: null,
};
// cheaper price -> higher NPV; expensive -> lower; broken -> no_savings
const cheap: SiblingSolution = { ...base, id: "cheap", name: "Cheap", vendor: "V", priceUsd: 40000 };
const pricey: SiblingSolution = { ...base, id: "pricey", name: "Pricey", vendor: "V", priceUsd: 90000 };
const unprofitable: SiblingSolution = {
  ...base, id: "bad", name: "Bad", vendor: "V", priceUsd: 40000,
  maintenanceUsdYear: 500000, energyUsdYear: 0, licensingUsdYear: 0, // OPEX >> savings
};

describe("rankSolutions", () => {
  it("orders economical solutions by NPV descending", () => {
    const ranked = rankSolutions([pricey, cheap], params, a);
    expect(ranked.map((r) => r.id)).toEqual(["cheap", "pricey"]);
    expect(ranked[0].result.economical).toBe(true);
  });
  it("places non-economical solutions after economical ones", () => {
    const ranked = rankSolutions([unprofitable, cheap], params, a);
    expect(ranked[0].id).toBe("cheap");
    expect(ranked[1].id).toBe("bad");
    expect(ranked[1].result.economical).toBe(false);
  });
  it("is a stable single-item list", () => {
    const ranked = rankSolutions([cheap], params, a);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("cheap");
  });
  it("breaks NPV ties deterministically by name", () => {
    const twinA: SiblingSolution = { ...cheap, id: "a", name: "Alpha" };
    const twinB: SiblingSolution = { ...cheap, id: "b", name: "Beta" };
    const ranked = rankSolutions([twinB, twinA], params, a);
    expect(ranked.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });
});
