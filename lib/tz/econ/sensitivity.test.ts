import { describe, expect, it } from "vitest";
import type { ScenarioOk, ScenarioResult, ScenarioSpec, SensitivityRow } from "../types";
import { computeScenarios } from "./scenario";
import { FIXTURE_H1500, fixtureContext, fixtureSpecs } from "./fixtures";
import { leverBounds, scenarioSensitivity } from "./sensitivity";

/** Анализ чувствительности (ТЗ §3.5.6): не меньше трёх рычагов на каждый сценарий. */

function ok(results: ScenarioResult[], key: string): ScenarioOk {
  const r = results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан`);
  return r;
}

function lever(rows: SensitivityRow[], key: string): SensitivityRow {
  const r = rows.find((x) => x.lever === key);
  if (!r) throw new Error(`нет рычага ${key}: ${rows.map((x) => x.lever).join(", ")}`);
  return r;
}

describe("чувствительность", () => {
  const results = computeScenarios(fixtureContext(20), fixtureSpecs());

  it("не меньше трёх рычагов у каждого сценария, включая «Как есть»", () => {
    for (const key of ["asis", "p1", "r1"]) {
      expect(ok(results, key).sensitivity.length).toBeGreaterThanOrEqual(3);
    }
    expect(ok(results, "asis").sensitivity.map((r) => r.lever).sort()).toEqual(["headcount", "horizon", "salary"]);
  });

  it("набор рычагов покупки и услуги", () => {
    expect(ok(results, "p1").sensitivity.map((r) => r.lever).sort()).toEqual(
      ["discountRate", "equipmentPrice", "horizon", "laborShare", "peakFactor", "salary", "service", "throughput", "utilization", "volume"].sort(),
    );
    expect(ok(results, "r1").sensitivity.map((r) => r.lever).sort()).toEqual(
      ["discountRate", "horizon", "laborShare", "peakFactor", "raasRate", "salary", "throughput", "utilization", "volume"].sort(),
    );
  });

  it("плечо загрузки — границы норматива 0,70 и 0,85", () => {
    const u = lever(ok(results, "p1").sensitivity, "utilization");
    expect(u.low).toBe(0.7);
    expect(u.high).toBe(0.85);
    expect(u.base).toBe(0.775);
    expect(u.boundsSource).toBe("норматив");
    expect(u.label).toBe("Коэффициент загрузки");
  });

  it("границы организатора для зарплаты, пика и горизонта; ±20 % для цены и объёма", () => {
    const rows = ok(results, "p1").sensitivity;
    expect(lever(rows, "salary")).toMatchObject({ low: 80_000, high: 170_000, boundsSource: "организатор", label: "Зарплата оператора погрузчика" });
    expect(lever(rows, "peakFactor")).toMatchObject({ low: 1.2, high: 2.5, boundsSource: "организатор", label: "Пиковый коэффициент" });
    expect(lever(rows, "horizon")).toMatchObject({ low: 3, high: 10, boundsSource: "организатор", label: "Горизонт расчёта" });
    const price = lever(rows, "equipmentPrice");
    expect(price.boundsSource).toBe("±20 %");
    expect(price.low).toBeCloseTo(2_160_000, 6);
    expect(price.high).toBeCloseTo(3_240_000, 6);
    expect(price.label).toBe("Цена робота");
    expect(lever(rows, "volume").label).toBe("Объём паллет");
    expect(lever(rows, "throughput").label).toBe("Производительность робота");
    expect(lever(ok(results, "r1").sensitivity, "raasRate").label).toBe("Ставка RaaS");
  });

  it("сервис из карточки — плечо ±20 % от сервиса; из норматива — доля цены 0,10–0,24", () => {
    expect(lever(ok(results, "p1").sensitivity, "service")).toMatchObject({ base: 300_000, boundsSource: "±20 %" });
    const carrier = computeScenarios(fixtureContext(20), fixtureSpecs({ ...fixtureContext(20).products["dikom-dmr-carrier-p"]! }));
    const sp = lever(ok(carrier, "p1").sensitivity, "servicePct");
    expect(sp).toMatchObject({ low: 0.1, high: 0.24, boundsSource: "норматив", label: "Сервис, % цены" });
  });

  it("без диапазонов организатора — ±20 %, с прижатием к физическим пределам", () => {
    const ctx = fixtureContext(20, { paramBounds: false, params: { peakFactor: 1.1 } });
    const res = computeScenarios(ctx, fixtureSpecs());
    const pf = lever(ok(res, "p1").sensitivity, "peakFactor");
    // 1,1 × 0,8 = 0,88 < 1: пик не бывает ниже среднего потока.
    expect(pf.low).toBe(1);
    expect(pf.clampedLow).toBe(true);
    expect(pf.high).toBeCloseTo(1.32, 9);
    expect(pf.clampedHigh).toBe(false);
    expect(pf.boundsSource).toBe("±20 %");
    // Горизонт склада без ctx.paramBounds — встроенный диапазон организатора 3–10 лет.
    const h = lever(ok(res, "p1").sensitivity, "horizon");
    expect(h).toMatchObject({ low: 3, high: 10, boundsSource: "организатор", clampedLow: false, clampedHigh: false });
    expect(lever(ok(res, "asis").sensitivity, "horizon")).toMatchObject({ low: 3, high: 10, boundsSource: "организатор" });
    expect(lever(ok(res, "p1").sensitivity, "salary")).toMatchObject({ low: 96_000, high: 144_000, boundsSource: "±20 %" });
  });

  it("горизонт: ctx.paramBounds важнее встроенного диапазона; вне склада без границ — ±20 %", () => {
    // ctx.paramBounds есть, но без горизонта — для склада тот же встроенный диапазон 3–10.
    const noHorizonBounds = fixtureContext(20);
    noHorizonBounds.paramBounds = { forkliftSalaryRubMonth: { min: 80_000, max: 170_000 } };
    expect(lever(ok(computeScenarios(noHorizonBounds, fixtureSpecs()), "p1").sensitivity, "horizon")).toMatchObject({
      low: 3,
      high: 10,
      boundsSource: "организатор",
    });
    // Границы горизонта из ctx.paramBounds (аэропорт и медучреждение у организатора: 5–15 лет).
    const own = fixtureContext(20, { params: { horizonYears: 7 } });
    own.paramBounds = { ...own.paramBounds, horizonYears: { min: 5, max: 15 } };
    expect(lever(ok(computeScenarios(own, fixtureSpecs()), "p1").sensitivity, "horizon")).toMatchObject({
      low: 5,
      high: 15,
      boundsSource: "организатор",
    });
    // Не склад и без границ: подпись «организатор» для 3–10 лет была бы неверной — ±20 %.
    const other = { ...fixtureContext(20, { paramBounds: false }), facility: "airport" };
    expect(lever(ok(computeScenarios(other, fixtureSpecs()), "p1").sensitivity, "horizon")).toMatchObject({
      low: 4,
      high: 6,
      boundsSource: "±20 %",
    });
  });

  it("leverBounds: прижатие сверху и целые годы", () => {
    const ctx = fixtureContext(20, { paramBounds: false });
    expect(leverBounds(ctx, 29, { hard: [1, 30], integer: true })).toMatchObject({ low: 23, high: 30, clampedHigh: true });
    const b = leverBounds(ctx, 0.9, { hard: [0, 1] });
    expect(b.low).toBeCloseTo(0.72, 12);
    expect(b).toMatchObject({ high: 1, clampedHigh: true, clampedLow: false });
  });

  it("строки отсортированы по размаху; размах — по NPV, у «Как есть» — по TCO", () => {
    for (const key of ["asis", "p1", "r1"]) {
      const rows = ok(results, key).sensitivity;
      for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.swing).toBeGreaterThanOrEqual(rows[i]!.swing);
    }
    const p = ok(results, "p1").sensitivity;
    for (const r of p) {
      expect(r.swing).toBeCloseTo(Math.abs((r.npvHigh ?? 0) - (r.npvLow ?? 0)), 6);
      expect(r.signFlip).toBe((r.npvLow ?? 0) >= 0 !== (r.npvHigh ?? 0) >= 0);
    }
    const a = ok(results, "asis").sensitivity;
    for (const r of a) {
      expect(r.npvLow).toBeNull();
      expect(r.swing).toBeCloseTo(Math.abs(r.tcoHigh - r.tcoLow), 6);
    }
  });

  it("каждое плечо — полный пересчёт: при −20 % производительности парк растёт", () => {
    const t = lever(ok(results, "p1").sensitivity, "throughput");
    expect(t.low).toBeCloseTo(16, 9);
    // Больше роботов — дороже CAPEX и OPEX: NPV на нижней границе ниже базового.
    expect(t.npvLow ?? 0).toBeLessThan(t.npvBase ?? 0);
    // Ставка выше — NPV ниже; зарплата выше — NPV выше.
    const dr = lever(ok(results, "p1").sensitivity, "discountRate");
    expect(dr.npvHigh ?? 0).toBeLessThan(dr.npvLow ?? 0);
    const s = lever(ok(results, "p1").sensitivity, "salary");
    expect(s.npvHigh ?? 0).toBeGreaterThan(s.npvLow ?? 0);
  });

  it("отказанный сценарий — пустой список, в результате отказа строк чувствительности нет", () => {
    // Покупка продукта без цены — настоящий отказ price_required в общем списке сценариев.
    const ctx = fixtureContext(20);
    ctx.products = { ...ctx.products, "h1500-no-price": { ...FIXTURE_H1500, slug: "h1500-no-price", priceRub: null } };
    const noPrice: ScenarioSpec = {
      key: "p2",
      name: "Покупка — без цены",
      kind: "purchase",
      items: [{ process: "pallet-transport", productSlug: "h1500-no-price" }],
    };
    const specs = [...fixtureSpecs(), noPrice];
    expect(scenarioSensitivity(ctx, noPrice, specs)).toEqual([]);
    const all = computeScenarios(ctx, specs);
    const p2 = all.find((x) => x.key === "p2");
    expect(p2?.status).toBe("refused");
    expect(p2 && p2.status === "refused" ? p2.refusal.reason : null).toBe("price_required");
    expect(p2 && "sensitivity" in p2).toBe(false);
    // Остальные сценарии того же списка считаются с чувствительностью.
    expect(ok(all, "p1").sensitivity.length).toBeGreaterThanOrEqual(3);
  });
});
