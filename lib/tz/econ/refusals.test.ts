import { describe, expect, it } from "vitest";
import type { ProductForCalc, ScenarioRefused, ScenarioResult, ScenarioSpec } from "../types";
import { computeScenarios } from "./scenario";
import { FIXTURE_CARRIER_P, FIXTURE_DMR600, FIXTURE_H1500, fixtureContext, fixtureSpecs } from "./fixtures";

/**
 * Отказы расчёта: типизированная причина, поля, которые нужно заполнить, и сообщение по-русски,
 * которое говорит, что сделать. Никаких нулей и NaN вместо отказа.
 */

function refused(results: ScenarioResult[], key: string): ScenarioRefused {
  const r = results.find((x) => x.key === key);
  if (!r || r.status !== "refused") throw new Error(`сценарий ${key} не отказан: ${JSON.stringify(r?.status)}`);
  return r;
}

const purchase = (slug: string, extra: Partial<ScenarioSpec["items"][number]> = {}, process = "pallet-transport"): ScenarioSpec => ({
  key: "p1",
  name: "Покупка",
  kind: "purchase",
  items: [{ process, productSlug: slug, ...extra }],
});
const raas = (slug: string, extra: Partial<ScenarioSpec["items"][number]> = {}): ScenarioSpec => ({
  key: "r1",
  name: "Услуга",
  kind: "raas",
  items: [{ process: "pallet-transport", productSlug: slug, ...extra }],
});
const asis: ScenarioSpec = { key: "asis", name: "Как есть", kind: "asis", items: [] };

function withProduct(p: ProductForCalc) {
  const ctx = fixtureContext(20);
  ctx.products = { ...ctx.products, [p.slug]: p };
  return ctx;
}

describe("отказы расчёта", () => {
  it("throughput_required: нет ни паспортной нормы, ни цикла", () => {
    const ctx = fixtureContext(20);
    ctx.cycle = {}; // цикл не посчитан, у DMR 600 паспортной нормы нет
    const r = refused(computeScenarios(ctx, [asis, purchase(FIXTURE_DMR600.slug)]), "p1");
    expect(r.refusal.reason).toBe("throughput_required");
    expect(r.refusal.message).toBe(
      "Нет производительности для «DMR 600»: укажите её вручную в поле «Производительность, паллет/ч» или выберите другой продукт",
    );
    expect(r.refusal.fields).toEqual(["item:pallet-transport:throughput"]);
  });

  it("норма «до X» не считается типичной производительностью", () => {
    const ctx = withProduct({ ...FIXTURE_DMR600, throughputPerH: 100, throughputUnit: "паллет/ч", throughputScope: "per-robot", throughputQualifier: "до" });
    ctx.cycle = {};
    const r = refused(computeScenarios(ctx, [asis, purchase(FIXTURE_DMR600.slug)]), "p1");
    expect(r.refusal.reason).toBe("throughput_required");
  });

  it("цифра на весь парк не задаёт производительность одного робота", () => {
    const ctx = withProduct({ ...FIXTURE_DMR600, throughputPerH: 350, throughputUnit: "паллет/ч", throughputScope: "per-fleet" });
    ctx.cycle = {};
    const r = refused(computeScenarios(ctx, [asis, purchase(FIXTURE_DMR600.slug)]), "p1");
    expect(r.refusal.reason).toBe("throughput_required");
  });

  it("ручная производительность снимает отказ", () => {
    const ctx = fixtureContext(20);
    ctx.cycle = {};
    const results = computeScenarios(ctx, [asis, purchase(FIXTURE_DMR600.slug, { throughputPerHOverride: 25 })]);
    const p = results.find((x) => x.key === "p1");
    expect(p?.status).toBe("ok");
    expect(p?.items[0]?.thrSource).toBe("задано вами");
  });

  it("price_required: у продукта нет цены", () => {
    const ctx = withProduct({ ...FIXTURE_H1500, priceRub: null });
    const r = refused(computeScenarios(ctx, fixtureSpecs()), "p1");
    expect(r.refusal.reason).toBe("price_required");
    expect(r.refusal.message).toBe("Нет цены «Ronavi H1500»: укажите цену за единицу, ₽");
    expect(r.refusal.fields).toEqual(["item:pallet-transport:price"]);
    // Посчитанный парк показывается и в отказе.
    expect(r.items[0]?.n).toBe(10);
  });

  it("raas_rate_required: нет ставки RaaS и нет ручной", () => {
    const r = refused(computeScenarios(fixtureContext(20), [asis, raas(FIXTURE_CARRIER_P.slug)]), "r1");
    expect(r.refusal.reason).toBe("raas_rate_required");
    expect(r.refusal.message).toBe(
      "Нет ставки RaaS для «DMR Carrier P»: укажите ставку, ₽/мес за робота, или нажмите «Подставить оценку (5,2 % цены в месяц)»",
    );
    expect(r.refusal.fields).toEqual(["item:pallet-transport:raasRate"]);
  });

  it("staffing_required: нет численности персонала процесса", () => {
    const ctx = fixtureContext(20, { params: { forkliftOperatorsCount: null } });
    const results = computeScenarios(ctx, fixtureSpecs());
    for (const key of ["asis", "p1", "r1"]) {
      const r = refused(results, key);
      expect(r.refusal.reason).toBe("staffing_required");
      expect(r.refusal.message).toBe(
        "Укажите численность и зарплату персонала процесса «Перемещение паллет: приёмка → хранение → отгрузка» в параметрах объекта",
      );
      expect(r.refusal.fields).toEqual(["param:forkliftOperatorsCount", "param:forkliftSalaryRubMonth"]);
    }
  });

  it("calc_not_supported: процесс без экономики в прототипе", () => {
    const results = computeScenarios(fixtureContext(20), [asis, purchase(FIXTURE_H1500.slug, {}, "cleaning")]);
    for (const key of ["asis", "p1"]) {
      const r = refused(results, key);
      expect(r.refusal.reason).toBe("calc_not_supported");
      expect(r.refusal.message).toBe("Экономика для процесса «Уборка склада» в прототипе не рассчитывается (§5.7)");
    }
  });

  it("invalid_inputs: два решения на один процесс", () => {
    const spec: ScenarioSpec = {
      key: "p1",
      name: "Покупка",
      kind: "purchase",
      items: [
        { process: "pallet-transport", productSlug: FIXTURE_H1500.slug },
        { process: "pallet-transport", productSlug: FIXTURE_CARRIER_P.slug },
      ],
    };
    const r = refused(computeScenarios(fixtureContext(20), [asis, spec]), "p1");
    expect(r.refusal.reason).toBe("invalid_inputs");
    expect(r.refusal.message).toContain("несколько решений для одного процесса");
  });

  it("invalid_inputs: неизвестный продукт, пустой сценарий, нет горизонта, отрицательная цена", () => {
    const results = computeScenarios(fixtureContext(20), [asis, purchase("no-such-product")]);
    expect(refused(results, "p1").refusal).toMatchObject({ reason: "invalid_inputs" });
    expect(refused(results, "p1").refusal.message).toBe("Продукт «no-such-product» не найден в каталоге — выберите другой");

    const empty = computeScenarios(fixtureContext(20), [asis, { key: "p1", name: "Пустой", kind: "purchase", items: [] }]);
    expect(refused(empty, "p1").refusal.message).toBe("В сценарии «Пустой» не выбрано ни одного решения: добавьте продукт");
    expect(refused(empty, "asis").refusal.reason).toBe("invalid_inputs");

    // Без ctx.paramLabels — встроенная русская подпись (DEFAULT_PARAM_LABELS), а не ключ.
    const noHorizon = computeScenarios(fixtureContext(20, { params: { horizonYears: null } }), fixtureSpecs());
    expect(refused(noHorizon, "p1").refusal).toEqual({
      reason: "invalid_inputs",
      fields: ["param:horizonYears"],
      message: "Не задан параметр «Горизонт расчёта окупаемости»: заполните его в параметрах объекта",
    });

    const negative = computeScenarios(fixtureContext(20), [asis, purchase(FIXTURE_H1500.slug, { priceRubOverride: -1 })]);
    expect(refused(negative, "p1").refusal.fields).toEqual(["item:pallet-transport:price"]);
  });

  it("подпись параметра из ctx.paramLabels важнее встроенной", () => {
    const ctx = fixtureContext(20, { params: { horizonYears: null } });
    ctx.paramLabels = { horizonYears: "Горизонт, лет (админ)" };
    const r = refused(computeScenarios(ctx, fixtureSpecs()), "p1");
    expect(r.refusal.message).toBe("Не задан параметр «Горизонт, лет (админ)»: заполните его в параметрах объекта");
  });

  it("горизонт меньше 1 года или больше 30 лет — отказ, а не молчаливая подстановка", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [0.2, "0,2"],
      [-2, "-2"],
      [40, "40"],
    ];
    for (const [h, shown] of cases) {
      const results = computeScenarios(fixtureContext(20, { params: { horizonYears: h } }), fixtureSpecs());
      for (const key of ["asis", "p1", "r1"]) {
        expect(refused(results, key).refusal, `горизонт ${h}, ${key}`).toEqual({
          reason: "invalid_inputs",
          fields: ["param:horizonYears"],
          message: `Горизонт расчёта должен быть от 1 до 30 лет (целое число лет), сейчас ${shown}: исправьте «Горизонт расчёта окупаемости» в параметрах объекта`,
        });
      }
    }
    // Границы допустимы: 0,5 года округляется до 1, 30 лет — наибольший горизонт.
    for (const h of [0.5, 30]) {
      const p = computeScenarios(fixtureContext(20, { params: { horizonYears: h } }), fixtureSpecs()).find((x) => x.key === "p1");
      expect(p?.status, `горизонт ${h}`).toBe("ok");
    }
  });

  it("нулевой спрос — отказ, а не деление на ноль", () => {
    const ctx = fixtureContext(20, { params: { inboundPalletsPerDay: 0, outboundPalletsPerDay: 0 } });
    const r = refused(computeScenarios(ctx, fixtureSpecs()), "p1");
    expect(r.refusal.reason).toBe("invalid_inputs");
    expect(r.refusal.message).toContain("равен нулю");
  });

  it("3 смены по 11 ч прижимаются к 24 ч в сутки, а не дают 33 ч", () => {
    const ctx = fixtureContext(20, { params: { shiftsPerDay: 3 } });
    const p = computeScenarios(ctx, fixtureSpecs()).find((x) => x.key === "p1");
    expect(p?.status).toBe("ok");
    expect(p?.items[0]?.avgPerHour).toBeCloseTo(1900 / 24, 9);
    expect(p?.trace.find((t) => t.key === "workHours")?.substituted).toContain("min(24; 3 × 11) = 24");
  });
});
