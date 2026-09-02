import { describe, it, expect } from "vitest";
import {
  assumptionsToValues,
  withAssumptionDefaults,
  DEFAULT_ASSUMPTIONS,
  ASSUMPTION_BOUNDS,
  clampAssumption,
  assumptionsInRange,
} from "./assumptions";
import type { AssumptionValues } from "./types";

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

describe("ASSUMPTION_BOUNDS", () => {
  it("covers every assumption and contains every shipped default", () => {
    const keys = Object.keys(DEFAULT_ASSUMPTIONS) as (keyof AssumptionValues)[];
    expect(Object.keys(ASSUMPTION_BOUNDS).sort()).toEqual([...keys].sort());
    expect(assumptionsInRange(DEFAULT_ASSUMPTIONS)).toBe(true);
  });

  it("keeps min < max for every key", () => {
    for (const [k, b] of Object.entries(ASSUMPTION_BOUNDS)) {
      expect(b.min, k).toBeLessThan(b.max);
    }
  });

  it("holds fractions to 0..1 and the discount rate to a real cost of capital", () => {
    expect(ASSUMPTION_BOUNDS.laborReplacementPct).toEqual({ min: 0, max: 1 });
    expect(ASSUMPTION_BOUNDS.residualSupervisionPct).toEqual({ min: 0, max: 1 });
    // the engine alone permits (-1, 0), where NPV explodes
    expect(ASSUMPTION_BOUNDS.discountRate).toEqual({ min: 0, max: 1 });
  });
});

describe("clampAssumption", () => {
  it("clamps the typo that produced a 12x NPV", () => {
    expect(clampAssumption("laborReplacementPct", 5)).toBe(1);
  });
  it("clamps a negative supervision share up to 0", () => {
    expect(clampAssumption("residualSupervisionPct", -3)).toBe(0);
  });
  it("clamps a discount rate below zero", () => {
    expect(clampAssumption("discountRate", -0.99)).toBe(0);
  });
  it("leaves an in-range value untouched", () => {
    expect(clampAssumption("laborCostPerHourUsd", 15)).toBe(15);
    expect(clampAssumption("discountRate", 0.12)).toBe(0.12);
  });
  it("falls back to the default for a non-finite value", () => {
    expect(clampAssumption("discountRate", NaN)).toBe(DEFAULT_ASSUMPTIONS.discountRate);
    expect(clampAssumption("hoursPerYear", Infinity)).toBe(DEFAULT_ASSUMPTIONS.hoursPerYear);
  });
  it("respects physical limits", () => {
    expect(clampAssumption("operatingHoursPerDay", 99)).toBe(24);
    expect(clampAssumption("workingDaysPerYear", 5000)).toBe(366);
  });
});
