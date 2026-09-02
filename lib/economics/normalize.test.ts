import { describe, it, expect } from "vitest";
import { computeQuantity, capacityPerYear, demandPerYear } from "./normalize";
import { makeAssumptions, makeParams } from "./fixtures";
import type { SolutionCapacity } from "./types";

const a = makeAssumptions({ laborReplacementPct: 0.7, residualSupervisionPct: 0 });
const params = makeParams({ opsPerDay: 1600 });
const base = { priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0 };

describe("computeQuantity", () => {
  it("sizes a PER_HOUR_FLOW solution by annualized throughput", () => {
    // cap/yr = 50 * 16 * 250 = 200000; demand/yr = 1600 * 250 = 400000; ceil(2) = 2
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 50, capacityBasis: "PER_HOUR_FLOW" };
    expect(computeQuantity(cap, params, a)).toBe(2);
  });

  it("sizes a PER_DAY_FLOW solution by annualized throughput", () => {
    // cap/yr = 400 * 250 = 100000; demand/yr = 400000; ceil(4) = 4
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW" };
    expect(computeQuantity(cap, params, a)).toBe(4);
  });

  it("sizes a CONCURRENT_STOCK solution from an explicit peak", () => {
    // peak 30 / capacityPerUnit 12 = ceil(2.5) = 3
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK" };
    expect(computeQuantity(cap, { ...params, peakConcurrent: 30 }, a)).toBe(3);
  });

  it("derives stock peak from opsPerDay/turnoverPerDay when peakConcurrent is absent", () => {
    // peak = ceil(1600/8)=200; 200/12 = ceil(16.67) = 17
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK" };
    expect(computeQuantity(cap, params, a)).toBe(17);
  });

  it("never returns less than 1", () => {
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 999999, capacityBasis: "PER_DAY_FLOW" };
    expect(computeQuantity(cap, { ...params, opsPerDay: 1 }, a)).toBe(1);
  });

  it("returns null on non-positive capacity (no divide-by-zero, no throw)", () => {
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 0, capacityBasis: "PER_DAY_FLOW" };
    expect(computeQuantity(cap, params, a)).toBeNull();
  });

  it("returns null when a zero turnover rate makes the stock peak non-finite", () => {
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 12, capacityBasis: "CONCURRENT_STOCK" };
    expect(computeQuantity(cap, params, { ...a, turnoverPerDay: 0 })).toBeNull();
  });

  it("returns null when annualized capacity collapses to zero (workingDaysPerYear = 0)", () => {
    const cap: SolutionCapacity = { ...base, capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW" };
    expect(computeQuantity(cap, params, { ...a, workingDaysPerYear: 0 })).toBeNull();
  });
});

describe("capacityPerYear / demandPerYear helpers", () => {
  it("annualizes a PER_HOUR_FLOW capacity using operating hours", () => {
    // 50/hr * 16 hrs/day * 250 days = 200000
    const cap = { priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
      capacityPerUnit: 50, capacityBasis: "PER_HOUR_FLOW" as const };
    expect(capacityPerYear(cap, a)).toBe(200000);
  });
  it("annualizes a PER_DAY_FLOW capacity without the hours factor", () => {
    const cap = { priceUsd: 1, maintenanceUsdYear: 0, energyUsdYear: 0, licensingUsdYear: 0,
      capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW" as const };
    expect(capacityPerYear(cap, a)).toBe(100000); // 400 * 1 * 250
  });
  it("annualizes demand from opsPerDay", () => {
    expect(demandPerYear({ areaM2: 0, opsPerDay: 1600, staffCount: 0 }, a)).toBe(400000);
  });
});
