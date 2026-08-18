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
});
