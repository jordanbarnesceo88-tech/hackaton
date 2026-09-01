import { describe, it, expect } from "vitest";
import { assumptionsToValues, withAssumptionDefaults, DEFAULT_ASSUMPTIONS } from "./assumptions";

describe("assumptionsToValues", () => {
  it("maps rows by key into a complete AssumptionValues object", () => {
    const rows = [
      { key: "laborCostPerHourUsd", value: 20 },
      { key: "roiHorizonYears", value: 3 },
    ];
    const v = assumptionsToValues(rows);
    expect(v.laborCostPerHourUsd).toBe(20);
    expect(v.roiHorizonYears).toBe(3);
    // missing keys fall back to documented defaults
    expect(v.workingDaysPerYear).toBe(DEFAULT_ASSUMPTIONS.workingDaysPerYear);
  });

  it("ships the conservative post-audit defaults (A2)", () => {
    expect(DEFAULT_ASSUMPTIONS.laborReplacementPct).toBe(0.5); // was 0.7
    expect(DEFAULT_ASSUMPTIONS.residualSupervisionPct).toBe(0.1);
  });
});

describe("withAssumptionDefaults", () => {
  it("backfills a key missing from an old saved blob (e.g. energyCostFactor)", () => {
    const { energyCostFactor, ...oldBlob } = DEFAULT_ASSUMPTIONS;
    void energyCostFactor;
    const v = withAssumptionDefaults(oldBlob);
    expect(v.energyCostFactor).toBe(1.0); // default, not undefined → no NaN downstream
  });
  it("keeps a provided finite value", () => {
    const v = withAssumptionDefaults({ ...DEFAULT_ASSUMPTIONS, energyCostFactor: 0.8 });
    expect(v.energyCostFactor).toBe(0.8);
  });
  it("falls back for a non-finite or non-number value", () => {
    expect(withAssumptionDefaults({ laborCostPerHourUsd: NaN }).laborCostPerHourUsd).toBe(15);
    expect(withAssumptionDefaults({ discountRate: "x" }).discountRate).toBe(0.12);
  });
  it("returns all defaults for a null / non-object input", () => {
    expect(withAssumptionDefaults(null)).toEqual(DEFAULT_ASSUMPTIONS);
  });
});
