import { describe, it, expect } from "vitest";
import { isViable } from "./types";
import type { EconomicsResult } from "./types";

const common = {
  quantity: 1, displacedFte: 8, capexUsd: 57500, opexAnnualUsd: 9000,
  baselineAnnualUsd: 240000, annualSavingsUsd: 99000,
};
const econ = (over: Partial<Extract<EconomicsResult, { economical: true }>>): EconomicsResult => ({
  economical: true, ...common,
  simplePaybackYears: 0.58, simpleRoiPct: 761, npvUsd: 299373, discountedPaybackYears: 0.65,
  ...over,
});

describe("isViable", () => {
  it("is true for a healthy economical result", () => {
    expect(isViable(econ({}))).toBe(true);
  });

  it("is FALSE when savings are positive but NPV is negative (the MediCarry M1 case)", () => {
    // economical:true, yet the hero used to celebrate this while the panel said it never pays back
    expect(isViable(econ({ npvUsd: -87878, discountedPaybackYears: null }))).toBe(false);
  });

  it("is false when the discounted payback never lands inside the horizon", () => {
    expect(isViable(econ({ discountedPaybackYears: null }))).toBe(false);
  });

  it("is false for a negative NPV even if a discounted payback exists", () => {
    expect(isViable(econ({ npvUsd: -1 }))).toBe(false);
  });

  it("treats exactly break-even NPV as viable", () => {
    expect(isViable(econ({ npvUsd: 0 }))).toBe(true);
  });

  it("is false for no_savings and for invalid_inputs", () => {
    expect(isViable({ economical: false, reason: "no_savings", ...common })).toBe(false);
    expect(isViable({ economical: false, reason: "invalid_inputs" })).toBe(false);
  });
});
