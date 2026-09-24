import { describe, it, expect } from "vitest";
import { normThroughput, throughputFor } from "../econ/fleet";
import { resolveNorms } from "../norms";
import { processDef, type ProcessDef } from "../processes";
import type { ParamValues, ProductForCalc, SelectionResult } from "../types";
import { SELECTION_FIXTURES as F, SELECTION_FIXTURE_LIST, WAREHOUSE_BASE_PARAMS } from "./fixtures";
import {
  SELECTION_RULES,
  compareResults,
  relevantProducts,
  selectProducts,
  summarizeSolutionTypes,
  type SelectionEcon,
} from "./index";

function proc(slug: string): ProcessDef {
  const p = processDef(slug);
  if (!p) throw new Error(`нет процесса ${slug}`);
  return p;
}

const PALLET = proc("pallet-transport");
const NORMS = resolveNorms();

/** NPV покупки по демо-набору: у H1500 лучший (числа условные — нужен только порядок). */
const ECON: SelectionEcon = {
  [F.h1500.slug]: { npvPurchaseRub: 640_375 },
  [F.carrierP.slug]: { npvPurchaseRub: -6_000_000 },
  [F.moros1500.slug]: { npvPurchaseRub: -1_500_000 },
  [F.moros800.slug]: { npvPurchaseRub: 200_000 },
  [F.palletShuttle.slug]: { npvPurchaseRub: -20_000_000 },
  // Исключённым NPV передан намеренно: в нормировку он не должен попасть.
  [F.dmr600.slug]: { npvPurchaseRub: 50_000_000 },
};

function run(opts: {
  params?: ParamValues;
  products?: readonly ProductForCalc[];
  econ?: SelectionEcon;
  process?: ProcessDef;
  facility?: string;
} = {}): SelectionResult[] {
  return selectProducts({
    facility: opts.facility ?? "warehouse",
    params: opts.params ?? WAREHOUSE_BASE_PARAMS,
    process: opts.process ?? PALLET,
    products: opts.products ?? SELECTION_FIXTURE_LIST,
    norms: NORMS,
    econ: "econ" in opts ? opts.econ : ECON,
  });
}

function bySlug(results: SelectionResult[], slug: string): SelectionResult {
  const r = results.find((x) => x.productSlug === slug);
  if (!r) throw new Error(`нет результата для ${slug}`);
  return r;
}

/** Строки с обычными пробелами: ICU ставит неразрывный пробел между разрядами. */
function plain(lines: readonly string[]): string {
  return lines.join("\n").replace(/[  ]/g, " ");
}

describe("selectProducts — жёсткие правила", () => {
  const results = run();

  it("DMR 600 исключён: грузоподъёмность меньше массы паллеты, с числами", () => {
    const r = bySlug(results, F.dmr600.slug);
    expect(r.status).toBe("excluded");
    expect(plain(r.reasons)).toContain("600 кг < масса груза 800 кг");
    expect(r.reasons[0]).toBe("DMR 600: грузоподъёмность 600 кг < масса груза 800 кг");
  });

  it("RoboCV исключён: ширина разворота больше прохода, десятичная запятая", () => {
    const r = bySlug(results, F.robocv.slug);
    expect(r.status).toBe("excluded");
    expect(plain(r.reasons)).toContain("2,9 м > ширина проходов объекта 2,8 м");
  });

  it("Ronavi RCM исключён: НИОКР и модель не найдена у производителя", () => {
    const r = bySlug(results, F.rcm.slug);
    expect(r.status).toBe("excluded");
    expect(r.reasons).toContain("Статус НИОКР — в расчёт не включается");
    expect(r.reasons).toContain("Модель не найдена у производителя");
    // Причина из каталога совпадает с текстом правила R2 и не дублируется.
    expect(r.reasons.filter((x) => x === "Модель не найдена у производителя")).toHaveLength(1);
    expect(plain(r.reasons)).toContain("350 кг < масса груза 800 кг");
  });

  it("исключённые продукты не получают балла", () => {
    for (const r of results.filter((x) => x.status === "excluded")) {
      expect(r.score.total).toBeNull();
      expect(r.score.contributions).toEqual([]);
    }
  });

  it("пометки variant-unpublished и rnd-exclude исключают с понятной причиной", () => {
    const [a, b] = run({
      products: [
        { ...F.h1500, slug: "v", flags: ["variant-unpublished"] },
        { ...F.h1500, slug: "r", flags: ["rnd-exclude"] },
      ],
    }).sort((x, y) => x.productSlug.localeCompare(y.productSlug));
    expect(a!.status).toBe("excluded");
    expect(a!.reasons).toContain("Опытный образец");
    expect(b!.status).toBe("excluded");
    expect(b!.reasons).toContain("Вариант не опубликован");
  });

  it("минимальная ширина прохода больше главных проездов — исключение", () => {
    const [r] = run({ products: [{ ...F.moros800, minAisleM: 1.9 }], params: { ...WAREHOUSE_BASE_PARAMS, mainAisleWidthM: 1.8, rackAisleWidthM: 4 } });
    expect(r!.status).toBe("excluded");
    expect(plain(r!.reasons)).toContain("минимальная ширина прохода 1,9 м > ширина главных проездов 1,8 м");
  });

  it("R6: продукт не для процесса и не для типа объекта", () => {
    const [r] = run({ products: [F.h1500], process: proc("storage") });
    expect(r!.status).toBe("excluded");
    expect(r!.reasons.join(" ")).toContain("не предназначен для процесса «Автоматизированное хранение»");

    const [m] = run({ products: [F.h1500], facility: "medical" });
    expect(m!.status).toBe("excluded");
    expect(m!.reasons.join(" ")).toContain("не применяется на объектах типа «Медучреждение»");
  });

  it("R6: продукт, исключённый в каталоге, показывает причину каталога", () => {
    const [r] = run({ products: [{ ...F.h1500, excluded: true, excludedReason: "Дубль карточки" }] });
    expect(r!.status).toBe("excluded");
    expect(r!.reasons).toContain("Дубль карточки");
  });
});

describe("selectProducts — температурный режим (R5)", () => {
  it("охлаждаемый склад исключает H1500 (+5…+25 °C), шаттл до −35 °C проходит", () => {
    const params = { ...WAREHOUSE_BASE_PARAMS, storageTempRegime: "Охлаждаемый (0…+5 °C)" };
    const results = run({ params });
    const h = bySlug(results, F.h1500.slug);
    expect(h.status).toBe("excluded");
    expect(h.reasons.join(" ")).toContain("Ronavi H1500: рабочая температура +5…+25 °C — не подходит для режима «Охлаждаемый (0…+5 °C)»");
    expect(bySlug(results, F.palletShuttle.slug).status).not.toBe("excluded");
  });

  it("морозильный режим: без опубликованной температуры — требует проверки", () => {
    const params = { ...WAREHOUSE_BASE_PARAMS, storageTempRegime: "Морозильный (ниже −18 °C)" };
    const results = run({ params });
    expect(bySlug(results, F.palletShuttle.slug).status).not.toBe("excluded");
    const carrier = bySlug(results, F.carrierP.slug);
    expect(carrier.status).not.toBe("excluded");
    expect(carrier.needsVerification).toBe(true);
    expect(carrier.missing.map((m) => m.key)).toContain("temperature");
  });

  it("одна опубликованная граница — «не противоречит», а не «подходит»", () => {
    const shuttle = bySlug(run(), F.palletShuttle.slug);
    expect(shuttle.reasons).toContain(
      "Рабочая температура от −35 °C не противоречит режиму «Нормальный (+5…+25 °C)» (верхняя граница не опубликована)",
    );
    const frozen = { ...WAREHOUSE_BASE_PARAMS, storageTempRegime: "Морозильный (ниже −18 °C)" };
    expect(bySlug(run({ params: frozen }), F.palletShuttle.slug).reasons).toContain(
      "Рабочая температура от −35 °C подходит для режима «Морозильный (ниже −18 °C)»",
    );
  });

  it("нормальный режим: продукт до +20 °C не покрывает +25 °C", () => {
    const [r] = run({ products: [{ ...F.moros800, tempMaxC: 20 }] });
    expect(r!.status).toBe("excluded");
    expect(r!.reasons.join(" ")).toContain("рабочая температура +5…+20 °C");
  });

  it("аэропорт: минимальная температура продукта выше зимнего минимума перрона", () => {
    const apron = proc("apron-towing");
    const tug: ProductForCalc = {
      ...F.h1500,
      slug: "tug",
      name: "Тягач",
      solutionType: "tug",
      handlingClass: "tug",
      processes: ["apron-towing"],
      facilityTypes: ["airport"],
      tempMinC: -20,
    };
    const [r] = run({ products: [tug], process: apron, facility: "airport", params: { apronWinterMinTempC: -25 } });
    expect(r!.status).toBe("excluded");
    expect(r!.reasons.join(" ")).toContain("минимальная температура эксплуатации −20 °C выше зимнего минимума объекта −25 °C");

    const [ok] = run({ products: [{ ...tug, tempMinC: -30 }], process: apron, facility: "airport", params: { apronWinterMinTempC: -25 } });
    expect(ok!.status).not.toBe("excluded");
  });
});

describe("selectProducts — статусы и рекомендация", () => {
  const results = run();

  it("H1500 рекомендуется, если у него лучший NPV", () => {
    const r = bySlug(results, F.h1500.slug);
    expect(r.status).toBe("recommended");
    expect(r.reasons[0]).toMatch(/^Рекомендуется: лучший балл среди кандидатов с расчётом экономики — \d+ из 100$/);
    expect(results[0]!.productSlug).toBe(F.h1500.slug);
  });

  it("рекомендуемый не больше одного на процесс", () => {
    expect(results.filter((r) => r.status === "recommended")).toHaveLength(1);
  });

  it("ожидаемый итог демо-набора: 1 рекомендуемый, 3 кандидата, 1 без данных, 3 исключённых", () => {
    const status = Object.fromEntries(results.map((r) => [r.productSlug, r.status]));
    expect(status).toEqual({
      [F.h1500.slug]: "recommended",
      [F.carrierP.slug]: "candidate",
      [F.moros1500.slug]: "candidate",
      [F.moros800.slug]: "candidate",
      // Цифра «на канал» движком не принимается, цикла у стационарной системы нет.
      [F.palletShuttle.slug]: "insufficient-data",
      [F.dmr600.slug]: "excluded",
      [F.robocv.slug]: "excluded",
      [F.rcm.slug]: "excluded",
    });
  });

  it("Moros 1500 — кандидат: пилотная эксплуатация, требует проверки, цикл по скорости", () => {
    const r = bySlug(results, F.moros1500.slug);
    expect(r.status).toBe("candidate");
    expect(r.limitations).toContain("пилотная эксплуатация");
    expect(r.needsVerification).toBe(true);
    expect(plain(r.limitations)).toContain(
      "паспортная производительность не опубликована — в расчёт идёт цикл по скорости 1,5 м/с и планировке объекта",
    );
  });

  it("Pallet Shuttle — ограничение по перестройке фронтальных стеллажей", () => {
    const r = bySlug(results, F.palletShuttle.slug);
    expect(r.limitations).toContain("перестройка стеллажей под каналы шаттла в CAPEX не учтена");
    expect(r.limitations.join(" ")).toContain("требует проверки: производитель указан спорно; кейс внедрения не подтверждён");
  });

  it("Pallet Shuttle — «Недостаточно данных»: цифра «на канал» не проходит правило движка", () => {
    const r = bySlug(results, F.palletShuttle.slug);
    expect(r.status).toBe("insufficient-data");
    const skipped = normThroughput(F.palletShuttle, PALLET).skipped;
    expect(skipped).not.toBeNull();
    expect(r.reasons[0]).toBe(
      `Недостаточно данных для расчёта парка: паспортная производительность 100 паллет/ч в расчёт не идёт ` +
        `(${skipped}), цикл по скорости для стационарного решения не считается`,
    );
    expect(r.missing.map((m) => m.key)).toContain("throughput");
  });

  it("Moros 800 — малый запас грузоподъёмности и нулевой запас в балле", () => {
    const r = bySlug(results, F.moros800.slug);
    expect(r.status).toBe("candidate");
    expect(plain(r.limitations)).toContain("запас грузоподъёмности 0 % (800 кг при массе груза 800 кг)");
    const margin = r.score.contributions.find((c) => c.factor === "margin")!;
    expect(margin.value01).toBe(0);
  });

  it("подъёмный AMR: только горизонтальная транспортировка; FMR: высота вил ниже яруса", () => {
    expect(bySlug(results, F.h1500.slug).limitations).toContain(
      "подъём на ярусы не предусмотрен: только горизонтальная транспортировка; размещение на верхние ярусы остаётся за погрузчиками",
    );
    expect(plain(bySlug(results, F.carrierP.slug).limitations)).toContain(
      "высота подъёма 1,6 м < верхнего яруса 9 м: только горизонтальная транспортировка",
    );
  });

  it("продукт без производительности и скорости — «Недостаточно данных» с подсказкой", () => {
    const blank: ProductForCalc = { ...F.moros800, slug: "blank", name: "Без данных", speedMps: null, throughputPerH: null };
    const results2 = run({ products: [...SELECTION_FIXTURE_LIST, blank] });
    const r = bySlug(results2, "blank");
    expect(r.status).toBe("insufficient-data");
    expect(r.missing).toContainEqual({
      key: "throughput",
      label: "Производительность",
      howToFix: "Укажите производительность вручную или выберите продукт с данными",
    });
    expect(r.reasons[0]).toContain("Недостаточно данных для расчёта парка");
    expect(r.score.total).not.toBeNull();
    // NPV, переданный для такого продукта, не делает его рекомендуемым.
    const r3 = bySlug(run({ products: [blank], econ: { blank: { npvPurchaseRub: 9e9 } } }), "blank");
    expect(r3.status).toBe("insufficient-data");
  });

  it("стационарное решение без производительности — недостаточно данных, даже со скоростью", () => {
    const [r] = run({ products: [{ ...F.palletShuttle, throughputPerH: null, speedMps: 1 }] });
    expect(r!.status).toBe("insufficient-data");
    expect(r!.reasons[0]).toContain("цикл по скорости для стационарного решения не считается");
  });

  it("производительность «до X» без скорости — недостаточно данных для расчёта парка", () => {
    const p: ProductForCalc = { ...F.h1500, throughputQualifier: "до", speedMps: null };
    const [r] = run({ products: [p] });
    expect(r!.status).toBe("insufficient-data");
    // Причина отказа нормы — текст движка экономики, тот же, что в трассировке расчёта.
    expect(r!.reasons[0]).toBe(
      `Недостаточно данных для расчёта парка: паспортная производительность 90 паллет/ч в расчёт не идёт ` +
        `(${normThroughput(p, PALLET).skipped}), скорость для расчёта цикла не опубликована`,
    );
    expect(r!.reasons[0]).toContain("«до 90»");
  });

  it("процесс-прототип: «до X» — это данные, продукт остаётся кандидатом, но без рекомендации", () => {
    const cleaning = proc("cleaning");
    const cleaner: ProductForCalc = {
      ...F.h1500,
      slug: "cleaner",
      name: "Уборщик",
      solutionType: "cleaner",
      handlingClass: "cleaner",
      processes: ["cleaning"],
      throughputPerH: 1000,
      throughputUnit: "м²/ч",
      throughputQualifier: "до",
      speedMps: null,
    };
    const [r] = run({ products: [cleaner], process: cleaning, econ: {} });
    expect(r!.status).toBe("candidate");
    const econ = r!.score.contributions.find((c) => c.factor === "econ")!;
    expect(econ.explanation).toContain("нет данных для экономики");
  });

  it("без NPV никто не рекомендуется, фактор «Экономика» равен 0 с объяснением", () => {
    const res = run({ econ: undefined });
    expect(res.filter((r) => r.status === "recommended")).toHaveLength(0);
    for (const r of res.filter((x) => x.status !== "excluded")) {
      const econ = r.score.contributions.find((c) => c.factor === "econ")!;
      expect(econ.value01).toBe(0);
      expect(econ.points).toBe(0);
      expect(econ.explanation).toContain("нет данных для экономики");
    }
  });

  it("единственный кандидат с NPV получает полный балл экономики", () => {
    const res = run({ econ: { [F.moros800.slug]: { npvPurchaseRub: -3_000_000 } } });
    const r = bySlug(res, F.moros800.slug);
    const econ = r.score.contributions.find((c) => c.factor === "econ")!;
    expect(econ.value01).toBe(1);
    expect(econ.explanation).toContain("других кандидатов с расчётом NPV нет");
    expect(r.status).toBe("recommended");
  });

  it("без цены — недостающие данные «цена», покупка не рассчитывается", () => {
    const [r] = run({ products: [{ ...F.moros1500, priceRub: null }], econ: {} });
    expect(r!.missing.map((m) => m.key)).toContain("price");
    const econ = r!.score.contributions.find((c) => c.factor === "econ")!;
    expect(econ.explanation).toContain("нет цены — покупка не рассчитывается");
  });

  it("нет ставки RaaS — отмечена как недостающие данные", () => {
    expect(bySlug(results, F.moros800.slug).missing.map((m) => m.key)).toContain("raas");
    expect(bySlug(results, F.h1500.slug).missing.map((m) => m.key)).not.toContain("raas");
  });
});

describe("selectProducts — балл и вклады", () => {
  const results = run();

  it("сумма вкладов равна итогу (±1) у каждого продукта с баллом", () => {
    for (const r of results.filter((x) => x.score.total !== null)) {
      const sum = r.score.contributions.reduce((acc, c) => acc + c.points, 0);
      expect(Math.abs(sum - r.score.total!)).toBeLessThanOrEqual(1);
      expect(r.score.total!).toBeGreaterThanOrEqual(0);
      expect(r.score.total!).toBeLessThanOrEqual(100);
      expect(r.score.contributions.map((c) => c.factor)).toEqual(["econ", "data", "maturity", "margin", "cases"]);
    }
  });

  it("веса вкладов — нормативы scoreWeight*, объяснение начинается с «Фактор: X из Y»", () => {
    const h = bySlug(results, F.h1500.slug);
    const w = h.score.contributions.map((c) => c.weight);
    expect(w).toEqual([
      NORMS.scoreWeightEcon,
      NORMS.scoreWeightData,
      NORMS.scoreWeightMaturity,
      NORMS.scoreWeightMargin,
      NORMS.scoreWeightCases,
    ]);
    const econ = h.score.contributions[0]!;
    expect(econ.value01).toBe(1);
    expect(plain([econ.explanation])).toBe("Экономика: 40 из 40 — NPV покупки 640 375 ₽, лучший среди 4 кандидатов");
  });

  it("экономика нормируется min-max только среди кандидатов (NPV исключённых и без данных не участвует)", () => {
    const m800 = bySlug(results, F.moros800.slug).score.contributions[0]!;
    // Минимум — Carrier P: (200 000 − (−6 000 000)) / (640 375 − (−6 000 000)) = 0,9336…
    // NPV шаттла (−20 млн, «Недостаточно данных») и DMR 600 (+50 млн, исключён) в нормировку не входят.
    expect(m800.value01).toBeCloseTo(6_200_000 / 6_640_375, 4);
    expect(m800.explanation).toContain("второй среди 4 кандидатов");
    expect(bySlug(results, F.carrierP.slug).score.contributions[0]!.value01).toBe(0);
    const shuttle = bySlug(results, F.palletShuttle.slug).score.contributions[0]!;
    expect(shuttle.value01).toBe(0);
    expect(shuttle.explanation).toContain("нет данных для экономики: без производительности парк не посчитать");
  });

  it("зрелость: пилот засчитывается 0,6", () => {
    const m = bySlug(results, F.moros1500.slug).score.contributions.find((c) => c.factor === "maturity")!;
    expect(m.value01).toBe(0.6);
    expect(m.explanation).toContain("пилотная эксплуатация — засчитывается 0,6 от серийной");
  });

  it("запас: неизвестная ширина прохода засчитывается 0,5 с объяснением", () => {
    const m = bySlug(results, F.carrierP.slug).score.contributions.find((c) => c.factor === "margin")!;
    // Грузоподъёмность 1500 при 800 кг — полный запас; проход не опубликован — 0,5.
    expect(m.value01).toBe(0.5);
    expect(m.explanation).toContain("ширина прохода не опубликована — засчитано 0,5");
    expect(bySlug(results, F.carrierP.slug).missing.map((x) => x.key)).toContain("aisle");
  });

  it("правка весов администратором (через resolveNorms) сохраняет балл в 0–100 и сумму вкладов", () => {
    const norms = resolveNorms([{ key: "scoreWeightEcon", value: 1 }]);
    const res = selectProducts({
      facility: "warehouse",
      params: WAREHOUSE_BASE_PARAMS,
      process: PALLET,
      products: SELECTION_FIXTURE_LIST,
      norms,
      econ: ECON,
    });
    for (const r of res.filter((x) => x.score.total !== null)) {
      const sum = r.score.contributions.reduce((acc, c) => acc + c.points, 0);
      expect(Math.abs(sum - r.score.total!)).toBeLessThanOrEqual(1);
      expect(r.score.total!).toBeLessThanOrEqual(100);
    }
  });
});

describe("selectProducts — мягкие правила объекта", () => {
  it("нет WMS и несколько этажей — ограничения для мобильных роботов", () => {
    const params = { ...WAREHOUSE_BASE_PARAMS, hasWms: "Нет", floorsCount: 2 };
    const h = bySlug(run({ params }), F.h1500.slug);
    expect(h.limitations).toContain("нет WMS — интеграция парка потребует доработки");
    expect(h.limitations).toContain("несколько этажей (2) — межэтажный транспорт не учтён");
    const s = bySlug(run({ params }), F.palletShuttle.slug);
    expect(s.limitations.join(" ")).not.toContain("несколько этажей");
  });

  it("правило WMS не применяется к объекту без такого параметра", () => {
    const { hasWms: _drop, ...noWms } = WAREHOUSE_BASE_PARAMS;
    void _drop;
    const h = bySlug(run({ params: noWms }), F.h1500.slug);
    expect(h.limitations.join(" ")).not.toContain("WMS");
  });

  it("неизвестная грузоподъёмность — недостающие данные и «требует проверки»", () => {
    const [r] = run({ products: [{ ...F.h1500, payloadKg: null }] });
    expect(r!.status).not.toBe("excluded");
    expect(r!.missing.map((m) => m.key)).toContain("payload");
    expect(r!.needsVerification).toBe(true);
  });

  it("полностью подтверждённый продукт без пометок не требует проверки", () => {
    const [r] = run({
      products: [{ ...F.h1500, flags: [], throughputConfirmed: true, priceConfirmed: true }],
    });
    expect(r!.needsVerification).toBe(false);
    expect(r!.limitations.join(" ")).not.toContain("требует проверки");
  });
});

describe("selectProducts — порядок и детерминизм", () => {
  it("сортировка: рекомендуемый, кандидаты по баллу, недостаточно данных, исключённые по названию", () => {
    const blank: ProductForCalc = { ...F.moros800, slug: "blank", name: "Без данных", speedMps: null };
    const res = run({ products: [...SELECTION_FIXTURE_LIST, blank] });
    const tiers = res.map((r) => r.status);
    expect(tiers).toEqual([
      "recommended",
      "candidate",
      "candidate",
      "candidate",
      "insufficient-data",
      "insufficient-data",
      "excluded",
      "excluded",
      "excluded",
    ]);
    const cand = res.filter((r) => r.status === "candidate").map((r) => r.score.total!);
    expect([...cand].sort((a, b) => b - a)).toEqual(cand);
    const excluded = res.filter((r) => r.status === "excluded").map((r) => r.productName);
    expect(excluded).toEqual([...excluded].sort((a, b) => a.localeCompare(b, "ru")));
    expect([...res].sort(compareResults)).toEqual(res);
  });

  it("одинаковый вход — одинаковый результат; вход не меняется", () => {
    const before = JSON.stringify(SELECTION_FIXTURE_LIST);
    const a = run();
    const b = run({ products: [...SELECTION_FIXTURE_LIST].reverse() });
    expect(b).toEqual(a);
    expect(JSON.stringify(SELECTION_FIXTURE_LIST)).toBe(before);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe("relevantProducts и summarizeSolutionTypes", () => {
  it("в выдачу процесса попадают заявленные продукты и продукты его типов решений", () => {
    const cleaner: ProductForCalc = { ...F.h1500, slug: "cl", solutionType: "cleaner", processes: ["cleaning"] };
    const list = relevantProducts(PALLET, "warehouse", [...SELECTION_FIXTURE_LIST, cleaner]);
    expect(list.map((p) => p.slug)).not.toContain("cl");
    expect(list).toHaveLength(SELECTION_FIXTURE_LIST.length);
  });

  it("сводка по типам решений процесса перемещения паллет", () => {
    const res = run();
    const summary = summarizeSolutionTypes(PALLET, SELECTION_FIXTURE_LIST, res);
    expect(summary.map((s) => s.slug)).toEqual(PALLET.solutionTypes);
    const amr = summary.find((s) => s.slug === "pallet-amr")!;
    expect(amr).toMatchObject({ total: 5, recommended: 1, candidates: 2, excluded: 2, applicable: true });
    const fmr = summary.find((s) => s.slug === "fmr")!;
    expect(fmr).toMatchObject({ total: 2, candidates: 1, excluded: 1 });
    const shuttle = summary.find((s) => s.slug === "pallet-shuttle")!;
    expect(shuttle).toMatchObject({ total: 1, candidates: 0, insufficient: 1, excluded: 0, applicable: false });
    expect(summary.find((s) => s.slug === "pallet-asrs")!.applicable).toBe(false);
  });

  it("правила подбора описаны для методики: коды уникальны", () => {
    const codes = SELECTION_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.filter((c) => c.startsWith("R"))).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });
});

describe("selectProducts — одно правило производительности с движком экономики", () => {
  /**
   * Цикл по планировке считает сборка модели (T2.2) для мобильных роботов со скоростью; здесь
   * он условный (20 паллет/ч, плечи по 60 м) — важно только, есть он или нет.
   */
  function engineThr(p: ProductForCalc): number | null {
    const withCycle = p.mobile && p.speedMps !== null && Number.isFinite(p.speedMps) && p.speedMps > 0;
    return throughputFor(
      {
        products: { [p.slug]: p },
        processes: { [PALLET.slug]: PALLET },
        cycle: { [p.slug]: withCycle ? { thrPerH: 20, loadedM: 60, emptyM: 60 } : null },
      },
      { process: PALLET.slug, productSlug: p.slug },
    ).thrEff;
  }

  const variants: ProductForCalc[] = [
    ...SELECTION_FIXTURE_LIST.filter((p) => p.slug !== F.rcm.slug),
    { ...F.h1500, slug: "unit-null", throughputUnit: null, speedMps: null },
    { ...F.h1500, slug: "unit-boxes", throughputUnit: "коробок/ч", speedMps: null },
    { ...F.h1500, slug: "unit-boxes-speed", throughputUnit: "коробок/ч" },
    { ...F.h1500, slug: "unit-synonym", throughputUnit: "поддонов/час", speedMps: null },
    { ...F.h1500, slug: "fleet", throughputScope: "per-fleet", speedMps: null },
    { ...F.h1500, slug: "scope-null", throughputScope: null, speedMps: null },
    { ...F.h1500, slug: "upto", throughputQualifier: "до", speedMps: null },
    { ...F.palletShuttle, slug: "station", throughputScope: "per-station" },
    { ...F.palletShuttle, slug: "no-thr", throughputPerH: null, speedMps: 1 },
  ];

  it("«Кандидат» ⇔ движок получает производительность (нет отказа throughput_required)", () => {
    const res = run({ products: variants, econ: {} });
    for (const p of variants) {
      const r = bySlug(res, p.slug);
      if (r.status === "excluded") continue;
      const selectable = r.status === "candidate" || r.status === "recommended";
      expect({ slug: p.slug, selectable }).toEqual({ slug: p.slug, selectable: engineThr(p) !== null });
    }
  });

  it("H1500 без единицы или в «коробок/ч» и без скорости — «Недостаточно данных»", () => {
    const res = run({ products: variants, econ: {} });
    expect(bySlug(res, "unit-null").status).toBe("insufficient-data");
    expect(bySlug(res, "unit-boxes").status).toBe("insufficient-data");
    expect(bySlug(res, "unit-boxes").reasons[0]).toContain(
      "единица паспортной цифры (коробок/ч) не совпадает с единицей процесса (паллет/ч)",
    );
    // Со скоростью — кандидат по циклу, причина отказа нормы видна в ограничениях.
    const withSpeed = bySlug(res, "unit-boxes-speed");
    expect(withSpeed.status).toBe("candidate");
    expect(withSpeed.limitations.join(" ")).toContain("в расчёт идёт цикл по скорости 1,5 м/с");
    // Синоним единицы движок принимает — и подбор тоже.
    expect(bySlug(res, "unit-synonym").status).toBe("candidate");
    expect(bySlug(res, "station").status).toBe("candidate");
  });
});

describe("selectProducts — нечисловые и нулевые значения", () => {
  it("NaN и ±∞ в карточке не дают NaN в балле и текстах", () => {
    const products: ProductForCalc[] = [
      { ...F.h1500, slug: "nan-compl", completenessPct: Number.NaN, flags: [], throughputConfirmed: true, priceConfirmed: true },
      { ...F.h1500, slug: "inf-conf", confirmedSharePct: Number.POSITIVE_INFINITY },
      { ...F.h1500, slug: "nan-payload", payloadKg: Number.NaN, minAisleM: Number.NaN, tempMaxC: Number.NaN },
    ];
    const res = run({ products, econ: {} });
    for (const r of res) {
      expect(Number.isFinite(r.score.total)).toBe(true);
      for (const c of r.score.contributions) {
        expect(Number.isFinite(c.points)).toBe(true);
        expect(Number.isFinite(c.value01)).toBe(true);
      }
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
    }

    const compl = bySlug(res, "nan-compl");
    // Нечисловая полнота — «низкая»: пометка «требует проверки» не снимается.
    expect(compl.needsVerification).toBe(true);
    expect(compl.limitations).toContain("требует проверки: полнота карточки не рассчитана");
    const data = compl.score.contributions.find((c) => c.factor === "data")!;
    expect(data.value01).toBe(0);
    expect(data.explanation).toContain("полнота карточки не рассчитана");

    expect(bySlug(res, "inf-conf").score.contributions.find((c) => c.factor === "data")!.value01).toBe(0);

    const payload = bySlug(res, "nan-payload");
    expect(payload.status).not.toBe("excluded");
    expect(payload.missing.map((m) => m.key)).toEqual(expect.arrayContaining(["payload", "aisle"]));
  });

  it("ширина проходов объекта 0 — «не задана», а не повод исключить", () => {
    const params = { ...WAREHOUSE_BASE_PARAMS, rackAisleWidthM: 0, mainAisleWidthM: 0 };
    const res = run({ params, products: [F.robocv, { ...F.moros800, minAisleM: 1.9 }] });
    for (const r of res) {
      expect(r.status).not.toBe("excluded");
      expect(plain(r.reasons)).not.toContain("0 м");
      const margin = r.score.contributions.find((c) => c.factor === "margin")!;
      expect(margin.explanation).toContain("ширина проходов объекта не задана — засчитано 0,5");
    }
    // Отрицательная масса груза тоже «не задана»: R3 не срабатывает, грузоподъёмность не проверить.
    const [neg] = run({ params: { ...WAREHOUSE_BASE_PARAMS, avgPalletMassKg: -5 }, products: [F.dmr600] });
    expect(neg!.status).not.toBe("excluded");
  });
});

describe("selectProducts — высота подъёма (S2) по классу робота", () => {
  const inventory = proc("inventory");
  const scanner: ProductForCalc = {
    ...F.moros800,
    slug: "scanner",
    name: "Сканер",
    solutionType: "inventory",
    handlingClass: "other",
    processes: ["inventory"],
    liftHeightMm: 3000,
  };

  it("робот инвентаризации: не «горизонтальная транспортировка», а охват ярусов при сканировании", () => {
    const [r] = run({ products: [scanner], process: inventory, econ: {} });
    expect(r!.limitations).toContain(
      "высота подъёма 3 м < верхнего яруса 9 м — охват верхних ярусов при сканировании требует проверки",
    );
    expect(r!.limitations.join(" ")).not.toContain("горизонтальная транспортировка");

    const [tall] = run({ products: [{ ...scanner, liftHeightMm: 10_000 }], process: inventory, econ: {} });
    expect(tall!.reasons).toContain("Высота подъёма 10 м ≥ верхнего яруса 9 м");
  });

  it("стационарная система с высотой подъёма — правило не применяется", () => {
    const [r] = run({ products: [{ ...F.palletShuttle, liftHeightMm: 1000 }] });
    expect(r!.limitations.join(" ")).not.toContain("высота подъёма");
    expect(r!.reasons.join(" ")).not.toContain("Высота подъёма");
  });
});
