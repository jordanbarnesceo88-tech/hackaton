import { describe, it, expect } from "vitest";
import { npv, discountedPaybackYears } from "./finance";

describe("npv", () => {
  it("sums undiscounted at rate 0", () => {
    expect(npv(0, [-100, 50, 50, 50])).toBeCloseTo(50, 6);
  });
  it("discounts future flows", () => {
    // -100 + 110/1.1 = 0
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 6);
  });
  it("handles a multi-year annuity", () => {
    // -100 + 60/1.1 + 60/1.21 = -100 + 54.5454 + 49.5868 = 4.1322
    expect(npv(0.1, [-100, 60, 60])).toBeCloseTo(4.1322, 3);
  });
});

describe("discountedPaybackYears", () => {
  it("interpolates the crossing year at rate 0", () => {
    // cum: y1 -40, y2 +20 -> 1 + 40/60
    expect(discountedPaybackYears(0, [-100, 60, 60])).toBeCloseTo(1 + 40 / 60, 6);
  });
  it("accounts for discounting (payback comes later)", () => {
    // y1 disc 54.5454 -> cum -45.4545; y2 disc 49.5868 -> cum 4.132; 1 + 45.4545/49.5868
    expect(discountedPaybackYears(0.1, [-100, 60, 60])).toBeCloseTo(1 + 45.4545 / 49.5868, 3);
  });
  it("returns null when the series never recovers within the horizon", () => {
    expect(discountedPaybackYears(0, [-100, 10, 10])).toBeNull();
  });
  it("returns 0 when there is no upfront cost", () => {
    expect(discountedPaybackYears(0.1, [0, 10])).toBe(0);
  });
});
