import { describe, expect, it } from "vitest";
import type { ScenarioOk, ScenarioResult, ScenarioSpec } from "../types";
import { DISCLAIMER, breakEvenSalary, buildConclusion, horizonFlip, pickRecommended } from "./conclusion";
import { computeScenariosCore } from "./core";
import { FIXTURE_CARRIER_P, FIXTURE_H1500, fixtureContext, fixtureSpecs } from "./fixtures";
import { MODEL_LIMITATIONS } from "./limitations";
import { scenarioRisks } from "./risks";
import { computeScenarios } from "./scenario";

/** Вывод и риски (ТЗ §3.5.7): число, риски и интерпретация, а не жёсткий порог. */

function ok(results: ScenarioResult[], key: string): ScenarioOk {
  const r = results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан`);
  return r;
}

const codes = (r: ScenarioResult) => r.risks.map((x) => x.code);

describe("вывод по эталону", () => {
  const ctx = fixtureContext(20);
  const specs = fixtureSpecs();
  const results = computeScenarios(ctx, specs);
  const c = buildConclusion(results, ctx, specs);

  it("рекомендуется услуга: наибольший NPV среди жизнеспособных", () => {
    expect(c.recommendedScenarioKey).toBe("r1");
    // Разряды ICU разделяет неразрывным пробелом — сравниваем после замены на обычный.
    expect(c.headline.replace(/\s/g, " ")).toBe(
      "Рекомендуемый сценарий: Услуга (RaaS) — Ronavi H1500. NPV 6 713 156 ₽ за 5 лет, окупаемость 0,7 года — быстрая окупаемость (менее 3 лет).",
    );
    expect(c.disclaimer).toBe("Результат является предварительной оценкой и требует верификации при обследовании объекта.");
    expect(c.disclaimer).toBe(DISCLAIMER);
  });

  it("пункты: лидер TCO, риски, рычаг, смена вывода по горизонту, пороговая зарплата", () => {
    const text = c.bullets.join("\n").replace(/\s/g, " ");
    expect(text).toContain("По TCO за 5 лет выгоднее «Покупка — Ronavi H1500»: 220,1 млн ₽ против 224,5 млн ₽");
    expect(c.bullets.filter((b) => b.startsWith("Риск (")).length).toBe(3);
    expect(text).toContain("Сильнейший рычаг — «Доля автоматизируемого труда»: при 30–70 %");
    // Вывод по горизонту не монотонный: покупка выигрывает только при 7 годах, с 8 лет в её
    // поток входит докупка парка в год 7 без остаточной стоимости.
    expect(text).toContain(
      "При горизонте 7 лет выгоднее «Покупка — Ronavi H1500»; при горизонте 8–10 лет — снова «Услуга (RaaS) — Ronavi H1500» " +
        "(с горизонта 8 лет в расчёт «Покупка — Ronavi H1500» входит докупка оборудования на 27,0 млн ₽ в год 7 без учёта остаточной стоимости)",
    );
    expect(text).not.toContain("≥ 7 лет");
    expect(text).toMatch(/Покупка окупается \(NPV ≥ 0\) при зарплате от 118 543 ₽\/мес/);
  });

  it("смена вывода по горизонту: покупка выгоднее только при 7 годах", () => {
    const flip = horizonFlip(ctx, specs);
    expect(flip).toMatchObject({
      years: 7,
      fromYears: 7,
      toYears: 7,
      openEnded: false,
      direction: "up",
      scenarioKey: "p1",
      reinvest: { horizonYears: 8, year: 7, rub: 27_000_000, scenarioKey: "p1" },
    });
    const at = (h: number) => pickRecommended(computeScenariosCore(fixtureContext(20, { params: { horizonYears: h } }), specs))?.key;
    expect(at(6)).toBe("r1");
    expect(at(7)).toBe("p1");
    expect(at(8)).toBe("r1");
    expect(at(10)).toBe("r1");
  });

  it("смена вывода от горизонта 7 лет: услуга с 8 лет, причина — докупка парка", () => {
    const c7 = fixtureContext(20, { params: { horizonYears: 7 } });
    const flip = horizonFlip(c7, specs);
    expect(flip).toMatchObject({ years: 8, fromYears: 8, toYears: 10, openEnded: true, direction: "up", scenarioKey: "r1" });
    expect(flip?.reinvest).toMatchObject({ horizonYears: 8, year: 7, scenarioKey: "p1" });
    expect(flip?.text.replace(/\s/g, " ")).toBe(
      "При горизонте ≥ 8 лет выгоднее «Услуга (RaaS) — Ronavi H1500» " +
        "(с горизонта 8 лет в расчёт «Покупка — Ronavi H1500» входит докупка оборудования на 27,0 млн ₽ в год 7 без учёта остаточной стоимости)",
    );
  });

  it("диапазон смены вывода: ctx.paramBounds важнее встроенного; вне склада без границ — ±20 %", () => {
    // Границы горизонта 3–7 лет: покупка выигрывает у края диапазона — «≥ 7 лет», без докупки.
    const narrow = fixtureContext(20);
    narrow.paramBounds = { ...narrow.paramBounds, horizonYears: { min: 3, max: 7 } };
    const flip = horizonFlip(narrow, specs);
    expect(flip).toMatchObject({ years: 7, openEnded: true, scenarioKey: "p1", reinvest: null });
    expect(flip?.text).toBe("При горизонте ≥ 7 лет выгоднее «Покупка — Ronavi H1500»");
    // Не склад, границ нет: 4–6 лет вокруг 5, на них вывод тот же.
    expect(horizonFlip({ ...fixtureContext(20, { paramBounds: false }), facility: "airport" }, specs)).toBeNull();
  });

  it("пороговая зарплата: при ней NPV покупки равен нулю", () => {
    const x = breakEvenSalary(ctx, specs[1]!, specs);
    expect(x).not.toBeNull();
    expect(ok(results, "p1").breakEvenSalaryRubMonth).toBeCloseTo(x ?? 0, 6);
    const at = computeScenariosCore(fixtureContext(20, { params: { forkliftSalaryRubMonth: x } }), specs);
    expect(Math.abs(ok(at, "p1").npvRub ?? Infinity)).toBeLessThan(1);
    expect(breakEvenSalary(ctx, specs[2]!, specs)).toBeNull();
  });

  it("ни один сценарий не окупается — заголовок называет сильнейший рычаг", () => {
    const low = fixtureContext(20, { params: { forkliftSalaryRubMonth: 60_000 } });
    const res = computeScenarios(low, specs);
    const cc = buildConclusion(res, low, specs);
    expect(cc.recommendedScenarioKey).toBeNull();
    expect(cc.headline).toMatch(/^При текущих параметрах ни один вариант роботизации не окупается за 5 лет; сильнейший рычаг — «.+»$/);
  });

  it("все сценарии роботизации отказаны — заголовок с причиной", () => {
    const res = computeScenarios(fixtureContext(20), [
      { key: "asis", name: "Как есть", kind: "asis", items: [] },
      { key: "r1", name: "Услуга", kind: "raas", items: [{ process: "pallet-transport", productSlug: FIXTURE_CARRIER_P.slug }] },
    ]);
    const cc = buildConclusion(res, fixtureContext(20));
    expect(cc.headline).toMatch(/^Сценарии роботизации не рассчитаны: Нет ставки RaaS для «DMR Carrier P»/);
  });

  it("при равном NPV рекомендуется меньший CAPEX", () => {
    const base = ok(results, "p1");
    const twin: ScenarioOk = { ...base, key: "p9", capexRub: base.capexRub - 1 };
    expect(pickRecommended([base, twin])?.key).toBe("p9");
  });

  it("ограничения модели перечислены", () => {
    expect(MODEL_LIMITATIONS.length).toBeGreaterThanOrEqual(5);
    expect(MODEL_LIMITATIONS.join(" ")).toContain("погрузчиков");
  });
});

describe("риски", () => {
  const ctx = fixtureContext(20);
  const specs = fixtureSpecs();
  const results = computeScenarios(ctx, specs);

  it("норма против цикла — с числами и плечом", () => {
    const r = ok(results, "p1").risks.find((x) => x.code === "NORM_VS_CYCLE");
    expect(r?.severity).toBe("high");
    expect(r?.text).toBe(
      "Паспортная норма 90 пал./ч в 4,5 раза выше расчётной по циклу на вашем объекте (20 пал./ч при плече ≈93 м, оценка по планировке); принято меньшее значение",
    );
  });

  it("у услуги всегда RAAS_ROI_UNINFORMATIVE и нижняя граница ставки «от»", () => {
    expect(codes(ok(results, "r1"))).toEqual(expect.arrayContaining(["RAAS_ROI_UNINFORMATIVE", "RAAS_LOWER_BOUND"]));
    expect(ok(results, "r1").risks.find((x) => x.code === "RAAS_ROI_UNINFORMATIVE")?.text).toBe(
      "ROI неинформативен при малом CAPEX — сравнивайте NPV и TCO",
    );
    expect(codes(ok(results, "p1"))).not.toContain("RAAS_ROI_UNINFORMATIVE");
  });

  it("низкие риски допущений и высвобождения персонала", () => {
    const p = ok(results, "p1");
    expect(codes(p)).toEqual(expect.arrayContaining(["LABOR_SHARE_ESTIMATE", "ROUTE_ESTIMATE", "FLEET_COST_MISSING", "STAFF_REDUCTION"]));
    expect(p.risks.find((x) => x.code === "FLEET_COST_MISSING")?.text).toBe(
      "Стоимость существующего парка погрузчиков в датасете не задана — эффект занижен, оценка консервативна",
    );
    expect(p.risks.find((x) => x.code === "STAFF_REDUCTION")?.text).toBe(
      "Высвобождение 11,9 FTE — учесть трудовые и социальные обязательства",
    );
    expect(codes(ok(results, "asis"))).toEqual([]);
  });

  it("риски отсортированы по важности", () => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    for (const r of results) {
      const s = r.risks.map((x) => order[x.severity]);
      expect([...s].sort((a, b) => a - b)).toEqual(s);
    }
  });

  it("объект: нет WMS, несколько этажей, мощность, бюджет", () => {
    const c2 = fixtureContext(20, { params: { hasWms: "Нет", floorsCount: 2, availablePowerKw: 1, capexBudgetMRub: 10 } });
    const p = ok(computeScenarios(c2, specs), "p1");
    expect(codes(p)).toEqual(expect.arrayContaining(["NO_WMS", "MULTI_FLOOR", "POWER", "CAPEX_OVER_BUDGET"]));
    expect(p.risks.find((x) => x.code === "MULTI_FLOOR")?.text).toBe(
      "Объект в 2 этажа — лифты и межэтажный транспорт в CAPEX не включены",
    );
    expect(p.risks.find((x) => x.code === "CAPEX_OVER_BUDGET")?.text.replace(/\s/g, " ")).toBe(
      "CAPEX 35,4 млн ₽ превышает планируемый бюджет 10 млн ₽",
    );
    // «Да » с пробелом у организатора — это «да».
    const c3 = fixtureContext(20, { params: { hasWms: "Да " } });
    expect(codes(ok(computeScenarios(c3, specs), "p1"))).not.toContain("NO_WMS");
  });

  it("продукт: пилот, цена не подтверждена, неполная карточка, ручное добавление", () => {
    const s: ScenarioSpec[] = [
      specs[0]!,
      {
        key: "p2",
        name: "Покупка — DMR 600",
        kind: "purchase",
        items: [{ process: "pallet-transport", productSlug: "dikom-dmr-600", manuallyAdded: true, manualReason: "грузоподъёмность 600 кг < масса груза 800 кг" }],
      },
    ];
    const p = ok(computeScenarios(ctx, s), "p2");
    expect(codes(p)).toEqual(expect.arrayContaining(["MANUAL_ADD", "PILOTING", "PRICE_UNCONFIRMED", "LOW_COMPLETENESS"]));
    expect(p.risks[0]?.code).toBe("MANUAL_ADD");
    expect(p.risks[0]?.text).toBe("«DMR 600» добавлен вручную, хотя подбор его исключил: грузоподъёмность 600 кг < масса груза 800 кг");
  });

  it("оценка ставки RaaS и паспортная производительность без подтверждения", () => {
    const s: ScenarioSpec[] = [
      specs[0]!,
      {
        key: "r2",
        name: "Услуга — Carrier P",
        kind: "raas",
        items: [{ process: "pallet-transport", productSlug: FIXTURE_CARRIER_P.slug, raasRubMonthOverride: 223_600, raasFromEstimate: true, throughputPerHOverride: undefined }],
      },
    ];
    const c4 = fixtureContext(20);
    c4.cycle = {}; // без цикла принимается паспортная норма 50 пал./ч
    const r = ok(computeScenarios(c4, s), "r2");
    expect(codes(r)).toEqual(expect.arrayContaining(["RAAS_ESTIMATE", "THROUGHPUT_UNCONFIRMED"]));
    expect(r.risks.find((x) => x.code === "RAAS_ESTIMATE")?.severity).toBe("high");
    expect(r.opexLines.find((l) => l.key === "subscription")?.origin).toBe("estimate");
  });

  it("большая доля CAPEX из оценок", () => {
    // Площадь 50 000 м² → инфраструктура 7,5 млн ₽ (оценка) при дешёвом роботе.
    const c5 = fixtureContext(20, { params: { activeAreaM2: 50_000 } });
    const s: ScenarioSpec[] = [
      specs[0]!,
      { key: "p1", name: "Покупка", kind: "purchase", items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, priceRubOverride: 100_000 }] },
    ];
    const p = ok(computeScenarios(c5, s), "p1");
    expect(codes(p)).toContain("ESTIMATE_SHARE");
    expect(codes(p)).not.toContain("PRICE_UNCONFIRMED");
  });

  it("смена знака NPV в диапазоне рычага — риск SIGN_FLIP с подписью рычага", () => {
    const p = ok(results, "p1");
    const flips = p.sensitivity.filter((r) => r.signFlip);
    expect(flips.length).toBeGreaterThan(0);
    const texts = p.risks.filter((r) => r.code === "SIGN_FLIP").map((r) => r.text);
    expect(texts).toHaveLength(flips.length);
    expect(texts.join("\n")).toContain("«Коэффициент загрузки» 70–85 %");
  });

  it("риски отказанного сценария — по продукту", () => {
    const c6 = fixtureContext(20);
    c6.products = { ...c6.products, [FIXTURE_H1500.slug]: { ...FIXTURE_H1500, priceRub: null, status: "piloting" } };
    const r = computeScenarios(c6, specs).find((x) => x.key === "p1");
    expect(r?.status).toBe("refused");
    expect(r?.risks.map((x) => x.code)).toContain("PILOTING");
    expect(scenarioRisks(c6, ok(results, "asis"), [])).toEqual([]);
  });
});
