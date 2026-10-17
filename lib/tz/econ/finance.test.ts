import { describe, expect, it } from "vitest";
import { cashflows, npvOf, tcoOf } from "./finance";

describe("замена АКБ после обновления оборудования", () => {
  it.each([
    { life: 7, battery: 4, horizon: 10, years: [4] },
    { life: 7, battery: 4, horizon: 12, years: [4, 11] },
    { life: 4, battery: 4, horizon: 10, years: [] },
    { life: 4, battery: 2, horizon: 10, years: [2, 6] },
    { life: 3, battery: 5, horizon: 10, years: [] },
    { life: 7, battery: 4, horizon: 11, years: [4] },
  ])("ресурс $life, АКБ $battery, горизонт $horizon: годы $years", ({ life, battery, horizon, years }) => {
    const rows = cashflows({
      capexRub: 1_000,
      opexYearRub: 100 / battery,
      opexAsisRub: 0,
      batteryAvgRub: 100 / battery,
      batteryEvents: [{ everyYears: battery, costRub: 100, resetEveryYears: life }],
      reinvestEvents: [{ everyYears: life, costRub: 1_000 }],
      tcoYears: horizon,
      discountRate: 0,
    });
    expect(rows.filter((r) => r.batteryRub > 0).map((r) => r.year)).toEqual(years);
    expect(rows.find((r) => r.year === life)?.batteryRub).toBe(0);
    expect(rows[horizon]?.reinvestRub).toBe(0);
    expect(rows[horizon]?.batteryRub).toBe(0);
  });

  it("возраст АКБ разных позиций сбрасывается только заменой своей техники", () => {
    const rows = cashflows({
      capexRub: 3_000,
      opexYearRub: 0,
      opexAsisRub: 0,
      batteryAvgRub: 0,
      batteryEvents: [
        { everyYears: 4, costRub: 100, resetEveryYears: 7 },
        { everyYears: 3, costRub: 200, resetEveryYears: 5 },
      ],
      reinvestEvents: [
        { everyYears: 7, costRub: 1_000 },
        { everyYears: 5, costRub: 2_000 },
      ],
      tcoYears: 12,
      discountRate: 0,
    });
    expect(rows.filter((r) => r.batteryRub > 0).map((r) => [r.year, r.batteryRub]))
      .toEqual([[3, 200], [4, 100], [8, 200], [11, 100]]);
    expect(rows.filter((r) => r.reinvestRub > 0).map((r) => [r.year, r.reinvestRub]))
      .toEqual([[5, 2_000], [7, 1_000], [10, 2_000]]);
  });
});

describe("explicit net residual at the end of TCO", () => {
  const input = { capexRub: 1000, opexYearRub: 100, opexAsisRub: 400, batteryAvgRub: 0, batteryEvents: [], reinvestEvents: [], tcoYears: 5, discountRate: 0.1 };
  it("preserves old rows exactly when excluded or explicitly zero", () => {
    expect(cashflows({ ...input, terminalResidualRub: 0 })).toEqual(cashflows(input));
    expect(cashflows(input).every(row => !("residualRub" in row))).toBe(true);
  });
  it("adds net proceeds once in year T, reduces TCO once and discounts them only inside H", () => {
    const base = cashflows(input), residual = cashflows({ ...input, terminalResidualRub: 200 });
    expect(residual.filter(row => row.residualRub)).toHaveLength(1);
    expect(residual[5]).toMatchObject({ residualRub: 200, effectRub: 300, cashflowRub: 500 });
    expect(tcoOf(residual)).toBe(tcoOf(base) - 200);
    expect(npvOf(residual, 3, 0.1)).toBe(npvOf(base, 3, 0.1));
    expect(npvOf(residual, 5, 0.1) - npvOf(base, 5, 0.1)).toBeCloseTo(200 / 1.1 ** 5);
  });
  it("rejects negative or nonfinite sale assumptions", () => {
    for (const value of [-1, NaN, Infinity]) expect(() => cashflows({ ...input, terminalResidualRub: value })).toThrow();
  });
});
