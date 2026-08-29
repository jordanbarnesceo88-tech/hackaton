import { describe, it, expect } from "vitest";
import { npvForScenario, sensitivity } from "./sensitivity";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.5,
  residualSupervisionPct: 0.1, opsPerWorkerPerYear: 12500, turnoverPerDay: 8,
  roiHorizonYears: 5, discountRate: 0.12, assetLifeYears: 7, usdToRub: 90,
};
const cap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW", priceUsd: 50000,
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };

describe("npvForScenario", () => {
  it("returns a finite NPV for an economical scenario", () => {
    const v = npvForScenario(cap, params, a);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!)).toBe(true);
    expect(v!).toBeGreaterThan(0);
  });
  it("returns a real NEGATIVE NPV when savings go negative (not truncated to 0)", () => {
    // Tiny displaceable workload -> savings < 0, but capex still incurred -> NPV < 0.
    const v = npvForScenario(cap, { ...params, opsPerDay: 20, staffCount: 1 }, a);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(0);
  });
  it("returns null for invalid inputs", () => {
    expect(npvForScenario(cap, params, { ...a, opsPerWorkerPerYear: 0 })).toBeNull();
  });
});

describe("sensitivity", () => {
  it("returns bars sorted by swing descending, all with positive swing", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1].swing).toBeGreaterThanOrEqual(bars[i].swing);
    }
    expect(bars.every((b) => b.swing >= 0)).toBe(true);
  });
  it("does not perturb display-only usdToRub", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.some((b) => b.key === "usdToRub")).toBe(false);
  });
  it("labor cost is among the strongest levers", () => {
    const bars = sensitivity(cap, params, a);
    const top3 = bars.slice(0, 3).map((b) => b.key);
    expect(top3).toContain("laborCostPerHourUsd");
  });
  it("returns [] when the base case is invalid", () => {
    expect(sensitivity(cap, params, { ...a, assetLifeYears: 0 })).toEqual([]);
  });
});
