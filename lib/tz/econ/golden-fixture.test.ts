import { describe, expect, it } from "vitest";
import { DEFAULT_NORMS } from "../norms";
import type { ScenarioOk, ScenarioResult } from "../types";
import { fixtureContext, fixtureSpecs } from "./fixtures";
import { computeScenarios } from "./scenario";

/**
 * Эталон T1.2: склад организатора (базовые значения датасета), продукт Ronavi H1500, цикл
 * подставлен как 20,0 пал./ч, нормативы по умолчанию. Числа проверены отдельным пробным
 * расчётом (plan_summary §3 «Контрольный пример»). Любое изменение здесь — «МЕНЯЕТ ЧИСЛА».
 */

const ctx = fixtureContext(20.0, { norms: { ...DEFAULT_NORMS } });
const results = computeScenarios(ctx, fixtureSpecs());

function ok(key: string): ScenarioOk {
  const r: ScenarioResult | undefined = results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан: ${JSON.stringify(r && "refusal" in r ? r.refusal : r)}`);
  return r;
}

function line(r: ScenarioOk, group: "capex" | "opex", key: string): number {
  const l = (group === "capex" ? r.capexLines : r.opexLines).find((x) => x.key === key);
  if (!l) throw new Error(`нет строки ${group}:${key}`);
  return l.valueRub;
}

describe("эталон T1.2: склад организатора × Ronavi H1500, цикл 20 пал./ч", () => {
  const asis = ok("asis");
  const p = ok("p1");
  const r = ok("r1");
  const item = p.items[0];

  it("спрос, парк и зарядки", () => {
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.demandPerDay).toBeCloseTo(1900, 6);
    expect(item.peakPerHour).toBeCloseTo(129.5455, 4);
    expect(item.thrNorm).toBe(90);
    expect(item.thrCycle).toBe(20);
    expect(item.thrEff).toBe(20);
    expect(item.thrSource).toBe("цикл");
    expect(item.nExact).toBeCloseTo(9.8204, 4);
    expect(item.n).toBe(10);
    expect(item.nAuto).toBe(10);
    expect(item.coverage).toBe(1);
    expect(item.chargers).toBe(1);
  });

  it("труд", () => {
    if (!item) return;
    expect(item.roleCostRubYear).toBeCloseTo(1_874_880, 6);
    expect(item.baselineLabourRub).toBeCloseTo(46_872_000, 4);
    expect(item.releasedFte).toBeCloseTo(11.875, 9);
    expect(item.remainingLabourRub).toBeCloseTo(24_607_800, 4);
    expect(item.operatorPosts).toBe(1);
    expect(item.operatingStaffRub).toBeCloseTo(7_630_657.07, 1);
  });

  it("покупка: CAPEX по статьям", () => {
    expect(line(p, "capex", "equipment")).toBe(27_000_000);
    expect(line(p, "capex", "chargers")).toBe(300_000);
    expect(line(p, "capex", "infrastructure")).toBe(1_500_000);
    expect(line(p, "capex", "software")).toBe(1_000_000);
    expect(line(p, "capex", "integration")).toBe(1_250_000);
    expect(line(p, "capex", "commissioning")).toBe(1_000_000);
    expect(line(p, "capex", "training")).toBe(150_000);
    const subtotal = p.capexLines.filter((l) => l.key !== "reserve").reduce((a, l) => a + l.valueRub, 0);
    expect(subtotal).toBeCloseTo(32_200_000, 4);
    expect(line(p, "capex", "reserve")).toBeCloseTo(3_220_000, 4);
    expect(p.capexRub).toBeCloseTo(35_420_000, 4);
  });

  it("покупка: OPEX, эффект, окупаемость, ROI, NPV, TCO", () => {
    expect(line(p, "opex", "service")).toBe(3_000_000);
    expect(line(p, "opex", "licences")).toBe(0);
    expect(line(p, "opex", "electricity")).toBeCloseTo(224_037, 4);
    expect(line(p, "opex", "connectivity")).toBe(120_000);
    expect(line(p, "opex", "consumables")).toBeCloseTo(270_000, 4);
    expect(line(p, "opex", "repair")).toBeCloseTo(540_000, 4);
    expect(line(p, "opex", "battery")).toBeCloseTo(675_000, 4);
    expect(p.opexYearRub).toBeCloseTo(37_067_494.07, 1);
    expect(p.effectYearRub).toBeCloseTo(9_804_505.93, 1);
    expect(p.paybackYears).toBeCloseTo(3.6126, 4);
    expect(p.band).toBe("moderate");
    expect(p.roiTzPct).toBeCloseTo(140.31, 2);
    expect(p.roiNetPct).toBeCloseTo(40.31, 2);
    expect(Math.abs((p.npvRub ?? NaN) - 640_375)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.tcoRub - 220_082_470)).toBeLessThanOrEqual(1);
    expect(p.tcoYears).toBe(5);
    // Замена АКБ в год 4 (4 < T = 5), докупки нет (срок службы 7 > T).
    expect(p.cashflows.map((c) => c.batteryRub)).toEqual([0, 0, 0, 0, 2_700_000, 0]);
    expect(p.cashflows.every((c) => c.reinvestRub === 0)).toBe(true);
  });

  it("«Как есть»: OPEX = ФОТ процесса, TCO за 5 лет", () => {
    expect(asis.capexRub).toBe(0);
    expect(asis.opexYearRub).toBeCloseTo(46_872_000, 4);
    expect(asis.effectYearRub).toBe(0);
    expect(asis.paybackYears).toBeNull();
    expect(asis.band).toBe("none");
    expect(asis.roiTzPct).toBeNull();
    expect(asis.npvRub).toBeNull();
    expect(asis.tcoRub).toBeCloseTo(234_360_000, 4);
  });

  it("услуга (RaaS): CAPEX, эффект, NPV, TCO", () => {
    expect(r.capexRub).toBeCloseTo(1_540_000, 4);
    expect(line(r, "capex", "equipment")).toBe(0);
    expect(r.capexLines.find((l) => l.key === "equipment")?.includedInSubscription).toBe(true);
    expect(line(r, "opex", "subscription")).toBe(12_000_000);
    expect(r.effectYearRub).toBeCloseTo(2_289_505.93, 1);
    expect(Math.abs((r.npvRub ?? NaN) - 6_713_156)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.tcoRub - 224_452_470)).toBeLessThanOrEqual(1);
    expect(r.band).toBe("fast");
  });

  it("TCO относительно «Как есть»", () => {
    expect(p.tcoDeltaVsAsIsRub).toBeCloseTo(220_082_470.35 - 234_360_000, 0);
    expect(r.tcoDeltaVsAsIsRub).toBeCloseTo(224_452_470.35 - 234_360_000, 0);
  });
});
