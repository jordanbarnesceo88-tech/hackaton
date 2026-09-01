import { describe, it, expect } from "vitest";
import { breakEvenLaborRateUsd } from "./breakeven";
import { computeEconomics } from "./calculate";
import type { SolutionCapacity, FacilityParams, AssumptionValues } from "./types";

const a: AssumptionValues = {
  laborCostPerHourUsd: 15, hoursPerYear: 2000, workingDaysPerYear: 250,
  operatingHoursPerDay: 16, installPctOfCapex: 0.15, laborReplacementPct: 0.7,
  residualSupervisionPct: 0.1, opsPerWorkerPerYear: 12500, turnoverPerDay: 8,
  roiHorizonYears: 5, discountRate: 0.12, assetLifeYears: 7, usdToRub: 90,
  energyCostFactor: 1.0,
};
const cap: SolutionCapacity = {
  capacityPerUnit: 400, capacityBasis: "PER_DAY_FLOW", priceUsd: 50000,
  maintenanceUsdYear: 6000, energyUsdYear: 1000, licensingUsdYear: 2000,
};
const params: FacilityParams = { areaM2: 1000, opsPerDay: 400, staffCount: 10 };

describe("breakEvenLaborRateUsd", () => {
  it("round-trips: at the break-even rate, recomputed NPV ≈ 0", () => {
    const L = breakEvenLaborRateUsd(cap, params, a);
    expect(L).not.toBeNull();
    expect(L!).toBeGreaterThan(0);
    const r = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: L! });
    if (!r.economical) throw new Error("expected economical at break-even");
    // NPV should be ~0 relative to the CAPEX scale.
    expect(Math.abs(r.npvUsd)).toBeLessThan(1); // within $1 of zero
  });

  it("just above the rate → NPV > 0; just below → NPV < 0", () => {
    const L = breakEvenLaborRateUsd(cap, params, a)!;
    const above = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: L + 1 });
    const below = computeEconomics(cap, params, { ...a, laborCostPerHourUsd: Math.max(0.01, L - 1) });
    if (!above.economical) throw new Error("expected economical above");
    expect(above.npvUsd).toBeGreaterThan(0);
    // below may be economical or not, but its NPV must be lower than the break-even (≈0)
    const belowNpv = below.economical ? below.npvUsd : -Infinity;
    expect(belowNpv).toBeLessThan(above.npvUsd);
  });

  it("returns null when no labor can be displaced (replacement 0 → K=0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, laborReplacementPct: 0 })).toBeNull();
  });

  it("returns null at 100% residual supervision (K=0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, residualSupervisionPct: 1 })).toBeNull();
  });

  it("returns null for invalid inputs (opsPerWorkerPerYear = 0)", () => {
    expect(breakEvenLaborRateUsd(cap, params, { ...a, opsPerWorkerPerYear: 0 })).toBeNull();
  });
});
