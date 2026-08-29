import { describe, it, expect } from "vitest";
import { formatCost, USD_TO_RUB } from "./currency";

describe("formatCost", () => {
  it("shows RUB primary with USD in parentheses, using a fixed ru-RU format", () => {
    // 45000 USD at the pinned rate. Assert on the computed RUB figure so the test
    // tracks the constant rather than hardcoding a rate.
    const rub = 45000 * USD_TO_RUB;
    const result = formatCost(45000);
    expect(result).toContain("₽");
    expect(result).toContain("US$");
    // ru-RU groups thousands with a non-breaking space ( ); no fractional part.
    expect(result).toContain(Math.round(rub).toLocaleString("ru-RU"));
  });

  it("rounds to whole currency units (no kopecks/cents)", () => {
    expect(formatCost(45000)).not.toMatch(/[.,]\d{2}\b/);
  });

  it("formats zero without throwing", () => {
    expect(formatCost(0)).toContain("0");
  });

  it("uses a caller-supplied rate (I6 editable usdToRub)", () => {
    expect(formatCost(100, 100)).toContain((100 * 100).toLocaleString("ru-RU"));
    expect(formatCost(100, 50)).toContain((100 * 50).toLocaleString("ru-RU"));
  });

  it("falls back to the default rate for a non-positive/non-finite rate", () => {
    const expected = formatCost(100); // default USD_TO_RUB
    expect(formatCost(100, 0)).toBe(expected);
    expect(formatCost(100, NaN)).toBe(expected);
  });
});
