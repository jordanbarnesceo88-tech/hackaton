import { describe, it, expect } from "vitest";
import { deployedCapacity, utilizationPct, roiAccrued } from "./kpi";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "@/lib/economics/types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.7,
  opsPerWorkerPerYear: 12500, turnoverPerDay: 8, roiHorizonYears: 5,
};
const flowCap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW",
  priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
};
const stockCap: SolutionCapacity = {
  capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK",
  priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
};

describe("deployedCapacity", () => {
  it("is quantity × capacityPerUnit", () => {
    expect(deployedCapacity(4, 400)).toBe(1600);
  });
});

describe("utilizationPct", () => {
  it("flow: demand/deployed, clamped to [0,100]", () => {
    // opsPerDay 400 -> demand/yr 100000; qty 1 -> deployed/yr 100000 -> 100%
    const p: FacilityParams = { areaM2: 0, opsPerDay: 400, staffCount: 0 };
    expect(utilizationPct(flowCap, p, a, 1)).toBeCloseTo(100, 3);
    // qty 4 -> deployed/yr 400000 -> 25%
    expect(utilizationPct(flowCap, p, a, 4)).toBeCloseTo(25, 3);
  });
  it("stock: peak/deployed-concurrency, clamped", () => {
    // peakConcurrent 30, qty 3 -> deployed 36 -> 83.33%
    const p: FacilityParams = { areaM2: 0, opsPerDay: 100, staffCount: 0, peakConcurrent: 30 };
    expect(utilizationPct(stockCap, p, a, 3)).toBeCloseTo((30 / 36) * 100, 2);
  });
  it("never exceeds 100 or drops below 0", () => {
    const p: FacilityParams = { areaM2: 0, opsPerDay: 999999, staffCount: 0 };
    expect(utilizationPct(flowCap, p, a, 1)).toBe(100);
  });
});

describe("roiAccrued", () => {
  it("fills linearly to annualSavings across the loop, then wraps", () => {
    expect(roiAccrued(0, 20000, 200000)).toBeCloseTo(0, 3);
    expect(roiAccrued(10000, 20000, 200000)).toBeCloseTo(100000, 3);
    expect(roiAccrued(20000, 20000, 200000)).toBeCloseTo(0, 3); // wraps
    expect(roiAccrued(25000, 20000, 200000)).toBeCloseTo(50000, 3);
  });
});
