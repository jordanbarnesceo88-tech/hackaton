import { describe, it, expect } from "vitest";
import { computeEconomics } from "./calculate";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15,
  hoursPerYear: 2000,
  workingDaysPerYear: 250,
  operatingHoursPerDay: 16,
  installPctOfCapex: 0.15,
  laborReplacementPct: 0.7,
  turnoverPerDay: 8,
  roiHorizonYears: 5,
};

// PER_DAY_FLOW, cap 400/day. opsPerDay 400 -> qty = ceil((400*250)/(400*250)) = 1.
const cap: SolutionCapacity = {
  capacityPerUnit: 400,
  capacityBasis: "PER_DAY_FLOW",
  priceUsd: 50000,
  maintenanceUsdYear: 6000,
  energyUsdYear: 1000,
  licensingUsdYear: 2000,
};

describe("computeEconomics", () => {
  it("computes an economical result with all fields", () => {
    // staff 10 -> baseline = 10*15*2000 = 300000
    // qty 1 -> capex = 1*50000*1.15 = 57500; opex = 1*(6000+1000+2000)=9000
    // savings = 300000*0.7 - 9000 = 210000 - 9000 = 201000
    // payback = 57500/201000 ≈ 0.286; roi = (201000*5 - 57500)/57500*100 ≈ 1647.8
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const r = computeEconomics(cap, params, a);
    expect(r.economical).toBe(true);
    if (!r.economical) return;
    expect(r.quantity).toBe(1);
    expect(r.capexUsd).toBeCloseTo(57500, 2);
    expect(r.opexAnnualUsd).toBeCloseTo(9000, 2);
    expect(r.baselineAnnualUsd).toBeCloseTo(300000, 2);
    expect(r.annualSavingsUsd).toBeCloseTo(201000, 2);
    expect(r.paybackYears).toBeCloseTo(57500 / 201000, 4);
    expect(r.roiPct).toBeCloseTo(((201000 * 5 - 57500) / 57500) * 100, 2);
  });

  it("scales OPEX by quantity (I1)", () => {
    // opsPerDay 1600 -> qty = ceil((1600*250)/(400*250)) = 4; opex = 4*9000 = 36000
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 1600, staffCount: 50 };
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    expect(r.quantity).toBe(4);
    expect(r.opexAnnualUsd).toBeCloseTo(36000, 2);
  });

  it("returns not-economical when savings <= 0 (C2), no payback/roi", () => {
    // tiny staff (1) -> baseline 30000; savings = 30000*0.7 - 9000 = 21000-9000=12000 >0
    // push OPEX up via many robots: opsPerDay 4000 -> qty=10 -> opex=90000; savings=21000-90000<0
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 4000, staffCount: 1 };
    const r = computeEconomics(cap, params, a);
    expect(r.economical).toBe(false);
    if (r.economical) return;
    expect(r.reason).toBe("no_savings");
    expect(r.annualSavingsUsd).toBeLessThanOrEqual(0);
    expect(r).not.toHaveProperty("paybackYears");
  });

  it("applies labor-replacement pct < 100 (I2)", () => {
    // baseline 300000, replacement 0.5 -> labor saved 150000; opex 9000; savings 141000
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };
    const r = computeEconomics(cap, params, { ...a, laborReplacementPct: 0.5 });
    if (!r.economical) throw new Error("expected economical");
    expect(r.annualSavingsUsd).toBeCloseTo(150000 - 9000, 2);
  });
});
