import { describe, expect, it } from "vitest";
import type { ProductForCalc, ScenarioOk, ScenarioResult, ScenarioSpec } from "../types";
import { computeScenariosCore } from "./core";
import { FIXTURE_H1500, fixtureContext, fixtureSpecs } from "./fixtures";
import { interpretBand } from "./interpret";
import { computeScenarios } from "./scenario";

/**
 * Тождества модели: связи между показателями, которые обязаны выполняться при любых входах
 * (ТЗ §3.5.2: ROI, срок окупаемости и TCO считаются из одних и тех же потоков).
 */

function ok(results: ScenarioResult[], key: string): ScenarioOk {
  const r = results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан: ${JSON.stringify(r)}`);
  return r;
}

function withProduct(patch: Partial<ProductForCalc>) {
  const ctx = fixtureContext(20);
  ctx.products = { ...ctx.products, [FIXTURE_H1500.slug]: { ...FIXTURE_H1500, ...patch } };
  return ctx;
}

describe("тождества ROI, окупаемости и TCO", () => {
  it("без замены АКБ и докупки ROI по ТЗ = H / PB × 100 %", () => {
    // Комплект АКБ бесплатный (среднее и фактическая замена = 0), срок службы длиннее T.
    const ctx = withProduct({ batteryCostRub: 0, serviceLifeYears: 50 });
    for (const H of [3, 5, 8]) {
      ctx.params = { ...ctx.params, horizonYears: H };
      const p = ok(computeScenariosCore(ctx, fixtureSpecs()), "p1");
      expect(p.paybackYears).not.toBeNull();
      expect(p.roiTzPct).toBeCloseTo((H / (p.paybackYears ?? 1)) * 100, 9);
      expect(p.roiNetPct).toBeCloseTo((p.roiTzPct ?? 0) - 100, 9);
      expect(p.cashflows.every((c) => c.batteryRub === 0 && c.reinvestRub === 0)).toBe(true);
    }
  });

  it("CAPEX, OPEX — суммы статей; TCO — CAPEX плюс потоки за T лет", () => {
    const results = computeScenariosCore(fixtureContext(20), fixtureSpecs());
    for (const key of ["p1", "r1"]) {
      const r = ok(results, key);
      expect(r.capexRub).toBeCloseTo(r.capexLines.reduce((a, l) => a + l.valueRub, 0), 6);
      expect(r.opexYearRub).toBeCloseTo(r.opexLines.reduce((a, l) => a + l.valueRub, 0), 6);
      const tco = r.capexRub + r.cashflows.slice(1).reduce((a, c) => a + c.opexRub + c.reinvestRub, 0);
      expect(r.tcoRub).toBeCloseTo(tco, 6);
      expect(r.cashflows).toHaveLength(r.tcoYears + 1);
      expect(r.cashflows[0]?.cashflowRub).toBe(-r.capexRub);
    }
  });

  it("срок службы внутри горизонта TCO → докупка оборудования в год, кратный сроку", () => {
    const ctx = fixtureContext(20, { params: { horizonYears: 10 } });
    const p = ok(computeScenariosCore(ctx, fixtureSpecs()), "p1");
    // Срок службы по нормативу 7 лет < T = 10: докупка 10 × 2 700 000 в год 7.
    expect(p.tcoYears).toBe(10);
    expect(p.cashflows.map((c) => c.reinvestRub)).toEqual([0, 0, 0, 0, 0, 0, 0, 27_000_000, 0, 0, 0]);
    // АКБ раз в 4 года: годы 4 и 8 (12 > T).
    expect(p.cashflows.filter((c) => c.batteryRub > 0).map((c) => c.year)).toEqual([4, 8]);
  });

  it("срок замены АКБ и срок службы меньше года в карточке — берётся норматив, а не замена каждый год", () => {
    const H10 = { horizonYears: 10 };
    const ref = ok(computeScenariosCore(fixtureContext(20, { params: H10 }), fixtureSpecs()), "p1");
    for (const patch of [
      { batteryReplacementYears: 0 },
      { batteryReplacementYears: 0.3 },
      { batteryReplacementYears: -2 },
      { serviceLifeYears: 0 },
      { serviceLifeYears: 0.4 },
    ] satisfies Partial<ProductForCalc>[]) {
      const ctx = withProduct(patch);
      ctx.params = { ...ctx.params, ...H10 };
      const p = ok(computeScenariosCore(ctx, fixtureSpecs()), "p1");
      // Как у карточки без срока (null): АКБ в годы 4 и 8, докупка в год 7.
      expect(p.cashflows.filter((c) => c.batteryRub > 0).map((c) => c.year), JSON.stringify(patch)).toEqual([4, 8]);
      expect(p.cashflows.filter((c) => c.reinvestRub > 0).map((c) => c.year), JSON.stringify(patch)).toEqual([7]);
      expect(p.opexYearRub).toBeCloseTo(ref.opexYearRub, 6);
      expect(p.tcoRub).toBeCloseTo(ref.tcoRub, 6);
    }
    // Срок от года — из карточки: 0,6 года округляется до 1, АКБ меняется каждый год.
    const yearly = withProduct({ batteryReplacementYears: 0.6 });
    const y = ok(computeScenariosCore(yearly, fixtureSpecs()), "p1");
    expect(y.cashflows.filter((c) => c.batteryRub > 0).map((c) => c.year)).toEqual([1, 2, 3, 4]);
  });

  it("горизонт короче минимального TCO: NPV за H лет, TCO за 5 лет", () => {
    const ctx = fixtureContext(20, { params: { horizonYears: 3 } });
    const p = ok(computeScenariosCore(ctx, fixtureSpecs()), "p1");
    expect(p.tcoYears).toBe(5);
    const r = 0.12;
    const npv3 = p.cashflows.slice(0, 4).reduce((a, c) => a + c.cashflowRub / Math.pow(1 + r, c.year), 0);
    expect(p.npvRub).toBeCloseTo(npv3, 4);
  });

  it("половина расчётного парка вручную: κ < 1, эффект и CAPEX ниже", () => {
    const base = ok(computeScenariosCore(fixtureContext(20), fixtureSpecs()), "p1");
    const specs: ScenarioSpec[] = fixtureSpecs().map((s) =>
      s.key === "p1" ? { ...s, items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, quantityOverride: 5 }] } : s,
    );
    const half = ok(computeScenariosCore(fixtureContext(20), specs), "p1");
    const item = half.items[0];
    expect(item?.n).toBe(5);
    expect(item?.nAuto).toBe(10);
    expect(item?.nOverridden).toBe(true);
    expect(item?.coverage).toBeLessThan(1);
    expect(item?.coverage).toBeCloseTo((5 * 20 * 0.775) / (1900 / 22 * 1.5), 9);
    expect(item?.releasedFte).toBeLessThan(base.items[0]?.releasedFte ?? 0);
    expect(half.capexRub).toBeLessThan(base.capexRub);
    // Меньше роботов — меньше высвобождённого труда: эффект падает сильнее, чем экономия на OPEX роботов.
    expect(half.effectYearRub).toBeLessThan(base.effectYearRub);
  });

  it("CAPEX = 0 → ROI не определён (null), окупаемость 0", () => {
    // RaaS без интеграции и обучения: все статьи CAPEX нулевые.
    const ctx = withProduct({ implementationRub: 0, trainingRub: 0 });
    const r = ok(computeScenariosCore(ctx, fixtureSpecs()), "r1");
    expect(r.capexRub).toBe(0);
    expect(r.roiTzPct).toBeNull();
    expect(r.roiNetPct).toBeNull();
    expect(r.effectYearRub).toBeGreaterThan(0);
    expect(r.paybackYears).toBe(0);
    expect(r.band).toBe("fast");
  });

  it("E ≤ 0 → срок окупаемости null и интервал «не окупается»", () => {
    const ctx = fixtureContext(20, { params: { forkliftSalaryRubMonth: 20_000 } });
    const p = ok(computeScenariosCore(ctx, fixtureSpecs()), "p1");
    expect(p.effectYearRub).toBeLessThanOrEqual(0);
    expect(p.paybackYears).toBeNull();
    expect(p.band).toBe("none");
    expect(p.npvRub).toBeLessThan(0);
    expect(p.discountedPaybackYears).toBeNull();
  });

  it("интервалы окупаемости по нормативам 3 и 5 лет", () => {
    const n = { paybackBandFastYears: 3, paybackBandSlowYears: 5 };
    expect(interpretBand(2.99, n)).toEqual({ band: "fast", text: "быстрая окупаемость (менее 3 лет)" });
    expect(interpretBand(3, n)).toEqual({ band: "moderate", text: "средняя окупаемость (3–5 лет)" });
    expect(interpretBand(5, n)).toEqual({ band: "moderate", text: "средняя окупаемость (3–5 лет)" });
    expect(interpretBand(5.01, n)).toEqual({ band: "slow", text: "долгая окупаемость (более 5 лет)" });
    expect(interpretBand(null, n)).toEqual({ band: "none", text: "не окупается в пределах горизонта" });
  });

  it("охват сравнения: одинаковый OPEX «Как есть» у всех сценариев, «Как есть» без NPV", () => {
    const results = computeScenarios(fixtureContext(20), fixtureSpecs());
    const asis = ok(results, "asis");
    for (const key of ["p1", "r1"]) {
      const r = ok(results, key);
      expect(r.effectYearRub).toBeCloseTo(asis.opexYearRub - r.opexYearRub, 6);
      expect(r.tcoDeltaVsAsIsRub).toBeCloseTo(r.tcoRub - asis.tcoRub, 6);
    }
    expect(asis.npvRub).toBeNull();
    expect(asis.sensitivity.length).toBeGreaterThanOrEqual(3);
  });

  it("происхождение цены: из карточки, из записи источника, иначе оценка — не «организатор»", () => {
    const equipment = (patch: Partial<ProductForCalc>) =>
      ok(computeScenariosCore(withProduct(patch), fixtureSpecs()), "p1").capexLines.find((l) => l.key === "equipment");
    expect(equipment({})?.origin).toBe("organizer");
    // priceOrigin не задан, но есть запись источника priceRub — её происхождение.
    const researched = FIXTURE_H1500.sources.map((s) => (s.key === "priceRub" ? { ...s, origin: "research" as const } : s));
    expect(equipment({ priceOrigin: null, sources: researched })?.origin).toBe("research");
    // Нет ни priceOrigin, ни записи источника: происхождение неизвестно — оценка с пометкой.
    const unknown = equipment({ priceOrigin: null, sources: [] });
    expect(unknown?.origin).toBe("estimate");
    expect(unknown?.originNote).toBe("источник цены в карточке не указан");
    // Ручная цена — «задано вами».
    const user = computeScenariosCore(fixtureContext(20), [
      fixtureSpecs()[0]!,
      { key: "p1", name: "Покупка", kind: "purchase", items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, priceRubOverride: 2_500_000 }] },
    ]);
    expect(ok(user, "p1").capexLines.find((l) => l.key === "equipment")).toMatchObject({ origin: "user", overridden: true });
  });

  it("при полном охвате строки «ФОТ процессов без роботов» нет", () => {
    const results = computeScenariosCore(fixtureContext(20), fixtureSpecs());
    expect(ok(results, "p1").opexLines.some((l) => l.key === "uncoveredLabour")).toBe(false);
  });

  it("сценарий платит базовый ФОТ процессов охвата, которые он не роботизирует", () => {
    // Второй рассчитываемый процесс (в tz-1.0.0 такой один, поэтому он синтетический): уборка
    // с численностью и зарплатой уборщиков.
    const ctx = fixtureContext(20, {
      params: { cleaningAreaM2: 10_000, cleaningsPerDay: 2, cleanersCount: 10, cleanerSalaryRubMonth: 65_000 },
    });
    const cleaning = ctx.processes["cleaning"];
    if (!cleaning) throw new Error("нет процесса cleaning");
    ctx.processes = { ...ctx.processes, cleaning: { ...cleaning, calcSupported: true } };
    const specs: ScenarioSpec[] = [
      ...fixtureSpecs(),
      { key: "c1", name: "Уборка", kind: "purchase", items: [{ process: "cleaning", productSlug: FIXTURE_H1500.slug, throughputPerHOverride: 1000 }] },
    ];
    const results = computeScenariosCore(ctx, specs);
    const cleanersBaseline = 10 * 65_000 * 12 * 1.302;
    const asis = ok(results, "asis");
    expect(asis.opexYearRub).toBeCloseTo(46_872_000 + cleanersBaseline, 4);
    const p1 = ok(results, "p1");
    const uncovered = p1.opexLines.find((l) => l.key === "uncoveredLabour");
    expect(uncovered?.valueRub).toBeCloseTo(cleanersBaseline, 4);
    // Эффект покупки H1500 не меняется от расширения охвата: ФОТ уборщиков есть с обеих сторон.
    const base = ok(computeScenariosCore(fixtureContext(20), fixtureSpecs()), "p1");
    expect(p1.effectYearRub).toBeCloseTo(base.effectYearRub, 4);
  });
});
