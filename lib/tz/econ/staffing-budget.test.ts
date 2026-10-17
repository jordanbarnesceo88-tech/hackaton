import { describe, expect, it } from "vitest";
import { staffingBreakEvenBudget } from "./staffing-budget";

describe("constant staffing break-even", () => {
  it("returns the same ceiling before and after a constant annual fee changes", () => {
    const factor = [1, 2, 3, 4, 5].reduce((sum, year) => sum + 1 / 1.12 ** year, 0);
    const ceiling = staffingBreakEvenBudget(7_630_657.07045109, -18_355_734.237703256, 5, .12)!;
    expect(ceiling).toBeGreaterThan(2_500_000); expect(ceiling).toBeLessThan(2_600_000);
    expect(staffingBreakEvenBudget(900_000, -18_355_734.237703256 + (7_630_657.07045109 - 900_000) * factor, 5, .12)).toBeCloseTo(ceiling);
  });
  it("keeps a negative ceiling and rejects unknown inputs instead of turning either into free staff", () => {
    expect(staffingBreakEvenBudget(0, -1000, 5, 0)).toBe(-200);
    expect(staffingBreakEvenBudget(0, null, 5, .12)).toBeNull();
    expect(staffingBreakEvenBudget(0, 100, NaN, .12)).toBeNull();
  });
});
