import { describe, it, expect } from "vitest";
import { assumptionsToValues, DEFAULT_ASSUMPTIONS } from "./assumptions";

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
