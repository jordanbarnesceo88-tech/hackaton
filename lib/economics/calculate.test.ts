import { describe, it, expect } from "vitest";
import { computeEconomics } from "./calculate";
import { npv, discountedPaybackYears } from "./finance";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";
import type { SolutionCapacity, FacilityParams } from "./types";

// residualSupervisionPct stays 0 so the pinned pre-A2 numbers below remain stable.
const a = makeAssumptions({ laborReplacementPct: 0.7, residualSupervisionPct: 0 });

// PER_DAY_FLOW, cap 400/day. opsPerDay 400 -> qty = ceil((400*250)/(400*250)) = 1.
const cap = makeCapacity();

describe("computeEconomics", () => {
  it("computes an economical result with all fields", () => {
    // demand/yr = 400*250 = 100000; maxDisplaceable = 100000/12500 = 8; displacedFte = min(10,8)=8
    // baseline = 8*(15*2000) = 8*30000 = 240000
    // qty 1 -> capex = 1*50000*1.15 = 57500; opex = 1*(6000+1000+2000)=9000
    // savings = 240000*0.7 - 9000 = 168000 - 9000 = 159000
    // payback = 57500/159000 ≈ 0.362; roi = (159000*5 - 57500)/57500*100 ≈ 1282.6
    const params = makeParams();
    const r = computeEconomics(cap, params, a);
    expect(r.economical).toBe(true);
    if (!r.economical) return;
    expect(r.quantity).toBe(1);
    expect(r.displacedFte).toBeCloseTo(8, 6);
    expect(r.capexUsd).toBeCloseTo(57500, 2);
    expect(r.opexAnnualUsd).toBeCloseTo(9000, 2);
    expect(r.baselineAnnualUsd).toBeCloseTo(240000, 2);
    expect(r.annualSavingsUsd).toBeCloseTo(159000, 2);
    // A3: asset life 7 >= horizon 5 -> no re-CAPEX, so simple figures match the old formula.
    expect(r.simplePaybackYears).toBeCloseTo(57500 / 159000, 4);
    expect(r.simpleRoiPct).toBeCloseTo(((159000 * 5 - 57500) / 57500) * 100, 2);
    const cfs = [-57500, 159000, 159000, 159000, 159000, 159000];
    expect(r.npvUsd).toBeCloseTo(npv(a.discountRate, cfs), 2);
    expect(r.discountedPaybackYears).toBeCloseTo(
      discountedPaybackYears(a.discountRate, cfs)!,
      4
    );
  });

  it("caps displaced labor by workload, not raw headcount (A1)", () => {
    // opsPerDay 40 -> demand/yr 10000 -> maxDisplaceable 10000/12500 = 0.8; staffCount 100
    // displacedFte = min(100, 0.8) = 0.8 (a huge headcount can't inflate savings)
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 40, staffCount: 100 };
    const r = computeEconomics(cap, params, a);
    if (!r.economical && r.reason !== "no_savings") throw new Error(`unexpected ${r.reason}`);
    expect(r.displacedFte).toBeCloseTo(0.8, 6);
    if (r.economical) return; // tiny workload likely won't cover OPEX — either branch is fine
    expect(r.reason).toBe("no_savings");
  });

  it("scales OPEX by quantity (I1)", () => {
    // opsPerDay 1600 -> qty = ceil((1600*250)/(400*250)) = 4; opex = 4*9000 = 36000
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 1600, staffCount: 50 };
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    expect(r.quantity).toBe(4);
    expect(r.opexAnnualUsd).toBeCloseTo(36000, 2);
  });

  it("отказывается считать, когда занятость не заявлена и норматива у задачи нет", () => {
    // Заменил тест на opsPerWorkerPerYear <= 0. То допущение было делителем предела замещения,
    // и движок его больше не читает: замещение считается от занятости, названной человеком.
    // Предохранитель переехал на задачу, и проверять надо его, а не опустевшее допущение.
    const params = makeParams();
    expect(computeEconomics({ ...cap, workerOutputPerYear: null }, params, a)).toEqual({
      economical: false,
      reason: "staffing_required",
    });
  });

  it("заявленная занятость снимает отказ даже без норматива", () => {
    // staffing_required — единственный отказ, который человек может снять сам. Если ввод его
    // не снимает, сообщение врёт о том, что от человека требуется.
    const params = makeParams({ taskStaffing: { "test-task": 4 } });
    const r = computeEconomics({ ...cap, workerOutputPerYear: null }, params, a);
    expect(r.economical || r.reason).not.toBe("staffing_required");
  });

  it("returns not-economical when savings <= 0 (C2), no payback/roi", () => {
    // tiny staff (1) -> baseline 30000; savings = 30000*0.7 - 9000 = 21000-9000=12000 >0
    // push OPEX up via many robots: opsPerDay 4000 -> qty=10 -> opex=90000; savings=21000-90000<0
    const params: FacilityParams = { areaM2: 1000, opsPerDay: 4000, staffCount: 1 };
    const r = computeEconomics(cap, params, a);
    expect(r.economical).toBe(false);
    if (r.economical) return;
    if (r.reason !== "no_savings") throw new Error("expected no_savings");
    expect(r.annualSavingsUsd).toBeLessThanOrEqual(0);
    expect(r).not.toHaveProperty("paybackYears");
  });

  it("applies labor-replacement pct < 100 (I2)", () => {
    // displacedFte 8 -> baseline 240000; replacement 0.5 -> labor saved 120000; opex 9000
    const params = makeParams();
    const r = computeEconomics(cap, params, { ...a, laborReplacementPct: 0.5 });
    if (!r.economical) throw new Error("expected economical");
    expect(r.annualSavingsUsd).toBeCloseTo(120000 - 9000, 2);
  });

  it("retains residual supervision cost (A2)", () => {
    // baseline 240000 * replacement 0.7 * (1 - 0.1 residual) = 151200; opex 9000 -> 142200
    const params = makeParams();
    const r = computeEconomics(cap, params, { ...a, residualSupervisionPct: 0.1 });
    if (!r.economical) throw new Error("expected economical");
    expect(r.annualSavingsUsd).toBeCloseTo(240000 * 0.7 * 0.9 - 9000, 2);
  });

  it("finance figures stay consistent after the projectFinance extraction (parity)", () => {
    const params = makeParams();
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    // Values pinned pre-refactor (assetLife 7 >= horizon 5 -> no re-CAPEX).
    expect(r.simplePaybackYears).toBeCloseTo(57500 / 159000, 6);
    expect(r.simpleRoiPct).toBeCloseTo(((159000 * 5 - 57500) / 57500) * 100, 4);
    expect(r.npvUsd).toBeGreaterThan(0);
    expect(Number.isFinite(r.npvUsd)).toBe(true);
  });

  it("energyCostFactor 1.0 is a no-op (parity with the pre-#8a numbers)", () => {
    const params = makeParams();
    const r = computeEconomics(cap, params, a);
    if (!r.economical) throw new Error("expected economical");
    // opex = 1*(6000 + 1000 + 2000) = 9000, unchanged.
    expect(r.opexAnnualUsd).toBeCloseTo(9000, 6);
  });

  it("energyCostFactor scales ONLY the energy term of OPEX (#8a)", () => {
    const params = makeParams();
    const base = computeEconomics(cap, params, a);
    const scaled = computeEconomics(cap, params, { ...a, energyCostFactor: 0.5 });
    if (!base.economical || !scaled.economical) throw new Error("expected economical");
    // energy 1000 → 500; opex drops by quantity(1)*500 = 500; savings rise by 500.
    expect(base.opexAnnualUsd - scaled.opexAnnualUsd).toBeCloseTo(500, 6);
    expect(scaled.annualSavingsUsd - base.annualSavingsUsd).toBeCloseTo(500, 6);
  });

  describe("discounting & asset lifecycle (A3)", () => {
    const params = makeParams();

    it("re-buys CAPEX when asset life < horizon and reflects it in simple ROI", () => {
      // life 2, horizon 5 -> re-CAPEX at t=2,4 -> investment = capex*3 = 172500
      const r = computeEconomics(cap, params, { ...a, assetLifeYears: 2 });
      if (!r.economical) throw new Error("expected economical");
      const investment = 57500 * 3;
      expect(r.simpleRoiPct).toBeCloseTo(((159000 * 5 - investment) / investment) * 100, 2);
      const cfs = [-57500, 159000, 159000 - 57500, 159000, 159000 - 57500, 159000];
      expect(r.npvUsd).toBeCloseTo(npv(a.discountRate, cfs), 2);
    });

    it("does NOT re-buy when asset life equals the horizon (assets last the whole horizon)", () => {
      // life 5 == horizon 5 -> no re-CAPEX; simple ROI must match the no-re-buy formula and
      // the default (life 7) result — the terminal-year over-count bug would have halved it.
      const r5 = computeEconomics(cap, params, { ...a, assetLifeYears: 5 });
      const r7 = computeEconomics(cap, params, { ...a, assetLifeYears: 7 });
      if (!r5.economical || !r7.economical) throw new Error("expected economical");
      expect(r5.simpleRoiPct).toBeCloseTo(((159000 * 5 - 57500) / 57500) * 100, 2);
      expect(r5.simpleRoiPct).toBeCloseTo(r7.simpleRoiPct, 6);
      expect(r5.npvUsd).toBeCloseTo(r7.npvUsd, 6);
    });

    it("clamps displaced FTE to 0 for a negative param instead of showing negative labor", () => {
      const r = computeEconomics(cap, { ...params, opsPerDay: -400 }, a);
      if (r.economical) throw new Error("expected non-economical");
      if (r.reason !== "no_savings") throw new Error("expected no_savings, got " + r.reason);
      expect(r.displacedFte).toBe(0);
      expect(r.baselineAnnualUsd).toBe(0);
    });

    it("rejects a sub-year asset life as invalid_inputs", () => {
      expect(computeEconomics(cap, params, { ...a, assetLifeYears: 0.5 })).toEqual({
        economical: false,
        reason: "invalid_inputs",
      });
    });

    it("reports null discounted payback when it never recovers within the horizon", () => {
      // huge CAPEX, 1-year horizon -> positive annual savings but no discounted payback
      const pricey: SolutionCapacity = { ...cap, priceUsd: 5_000_000 };
      const r = computeEconomics(pricey, params, { ...a, roiHorizonYears: 1 });
      if (!r.economical) throw new Error("expected economical (savings still > 0)");
      expect(r.discountedPaybackYears).toBeNull();
      expect(r.npvUsd).toBeLessThan(0);
    });

    it("rejects a non-positive horizon / asset life / discount rate as invalid_inputs", () => {
      expect(computeEconomics(cap, params, { ...a, roiHorizonYears: 0 }).economical).toBe(false);
      expect(computeEconomics(cap, params, { ...a, assetLifeYears: 0 }).economical).toBe(false);
      expect(computeEconomics(cap, params, { ...a, discountRate: -1 }).economical).toBe(false);
      expect(computeEconomics(cap, params, { ...a, assetLifeYears: 0 })).toEqual({
        economical: false,
        reason: "invalid_inputs",
      });
    });
  });

  // E1: the engine must never leak Infinity/NaN for degenerate inputs — it returns a typed
  // { economical: false, reason: "invalid_inputs" } instead. (Previously these produced
  // Infinity/NaN masked only by ad-hoc UI finiteness checks.)
  describe("invalid_inputs guard (E1)", () => {
    const stock: SolutionCapacity = { ...cap, capacityBasis: "CONCURRENT_STOCK" };
    const params = makeParams();

    it("returns invalid_inputs when turnoverPerDay = 0 on a stock solution (no peak given)", () => {
      const r = computeEconomics(stock, params, { ...a, turnoverPerDay: 0 });
      expect(r).toEqual({ economical: false, reason: "invalid_inputs" });
    });

    it("returns invalid_inputs when priceUsd = 0 (capex not positive)", () => {
      const r = computeEconomics({ ...cap, priceUsd: 0 }, params, a);
      expect(r).toEqual({ economical: false, reason: "invalid_inputs" });
    });

    it("returns invalid_inputs when workingDaysPerYear = 0 (non-finite quantity)", () => {
      const r = computeEconomics(cap, params, { ...a, workingDaysPerYear: 0 });
      expect(r).toEqual({ economical: false, reason: "invalid_inputs" });
    });

    it("returns invalid_inputs when operatingHoursPerDay = 0 on a per-hour solution", () => {
      const perHour: SolutionCapacity = { ...cap, capacityBasis: "PER_HOUR_FLOW" };
      const r = computeEconomics(perHour, params, { ...a, operatingHoursPerDay: 0 });
      expect(r).toEqual({ economical: false, reason: "invalid_inputs" });
    });

    it("returns invalid_inputs when capacityPerUnit = 0 (was a thrown error)", () => {
      const r = computeEconomics({ ...cap, capacityPerUnit: 0 }, params, a);
      expect(r).toEqual({ economical: false, reason: "invalid_inputs" });
    });

    it("never exposes non-finite numbers on any returned field", () => {
      const r = computeEconomics(stock, params, { ...a, turnoverPerDay: 0 });
      for (const v of Object.values(r)) {
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      }
    });
  });
});
