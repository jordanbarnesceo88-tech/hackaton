import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { defaultScenarios, initialScenarios, shortProductName } from "../projects/defaults";
import { runProjectSims } from "../projects/recalc";
import { cycleThroughputPerH, expectedLegsM } from "../sim/analytic";
import { buildWarehouseLayout } from "../sim/layout";
import type { SimSummaryStored } from "../sim/types";
import { pickRecommended } from "./econ";
import { FIXTURE_CARRIER_P, FIXTURE_DMR600, FIXTURE_H1500, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import {
  AUTO_MANUAL_SUFFIX,
  buildProjectModel,
  projectDataVersion,
  storedPartOf,
  withSnapshotProducts,
  type BuildProjectModelInput,
} from "./model";
import { resolveNorms } from "./norms";
import { timed } from "./timing";
import type { ScenarioOk, ScenarioSpec } from "./types";
import { stableJson } from "./version";

/**
 * Сборка модели проекта на базовом складе организатора с фикстурными продуктами экономики
 * (H1500, Carrier P, DMR 600 — числа с источниками в lib/tz/econ/fixtures.ts) и настоящими
 * описаниями параметров склада из данных организатора. Производительность по циклу модель
 * считает сама по планировке lib/sim — здесь она пересчитывается независимо, той же формулой.
 */

const NORMS = resolveNorms();
const DEFS = paramSpecsFor("warehouse");
const PRODUCTS = [FIXTURE_H1500, FIXTURE_CARRIER_P, FIXTURE_DMR600];
const PT = "pallet-transport";

const SPECS: ScenarioSpec[] = [
  { key: "asis", name: "Как есть", kind: "asis", items: [] },
  { key: "p1", name: "Покупка — Ronavi H1500", kind: "purchase", items: [{ process: PT, productSlug: FIXTURE_H1500.slug }] },
  { key: "r1", name: "Услуга (RaaS) — Ronavi H1500", kind: "raas", items: [{ process: PT, productSlug: FIXTURE_H1500.slug }] },
  { key: "p2", name: "Покупка — DMR Carrier P", kind: "purchase", items: [{ process: PT, productSlug: FIXTURE_CARRIER_P.slug }] },
];

function input(patch: Partial<BuildProjectModelInput> = {}): BuildProjectModelInput {
  return {
    facility: "warehouse",
    params: { ...WAREHOUSE_BASE_PARAMS },
    paramDefs: DEFS,
    scenarios: SPECS,
    products: PRODUCTS,
    norms: NORMS,
    ...patch,
  };
}

function ok(model: ReturnType<typeof buildProjectModel>, key: string): ScenarioOk {
  const r = model.results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан: ${JSON.stringify(r)}`);
  return r;
}

const model = buildProjectModel(input());

describe("buildProjectModel — базовый склад организатора", () => {
  it("параметры датасета проходят проверку без ошибок", () => {
    expect(model.paramIssues.filter((i) => i.severity === "error")).toEqual([]);
    expect(model.paramsUsed.forkliftSalaryRubMonth).toBe(120_000);
  });

  it("все четыре сценария рассчитаны, версии модели и имитации проставлены", () => {
    expect(model.results.map((r) => [r.key, r.status])).toEqual([
      ["asis", "ok"],
      ["p1", "ok"],
      ["r1", "ok"],
      ["p2", "ok"],
    ]);
    expect(model.modelVersion).toBe("tz-1.0.0");
    expect(model.simModelVersion).toBe("sim-1.0.0");
  });

  it("парк H1500 по формуле ТЗ: ⌈λпик / (цикл × 0,775) × 1,175⌉ по циклу на той же планировке", () => {
    const layout = buildWarehouseLayout({
      activeAreaM2: 10_000,
      mainAisleWidthM: 3.5,
      rackAisleWidthM: 2.8,
      receivingDocksCount: 4,
      shippingDocksCount: 4,
      chargers: 1,
    });
    const legs = expectedLegsM(layout);
    const cycle = cycleThroughputPerH({ ...legs, speedMps: 1.5, loadedSpeedFactor: 0.8, handlingSec: 20 });
    expect(cycle).not.toBeNull();
    const peak = (((1000 + 1000 + 0) * (1 - 5 / 100)) / 22) * 1.5;
    const expected = Math.ceil((peak / ((cycle as number) * 0.775 * 1)) * 1.175 - 1e-9);

    const item = ok(model, "p1").items[0];
    expect(item?.thrCycle).toBe(cycle);
    expect(item?.thrNorm).toBe(90);
    expect(item?.thrEff).toBe(cycle);
    expect(item?.peakPerHour).toBeCloseTo(peak, 9);
    expect(item?.n).toBe(expected);
    expect(item?.n).toBe(11);
    expect(item?.routeLoadedM).toBe(legs.loadedM);
    expect(item?.routeEmptyM).toBe(legs.emptyM);
    expect(model.layout?.widthM).toBe(layout.widthM);
  });

  it("подбор: DMR 600 исключён по грузоподъёмности, H1500 рекомендуется", () => {
    const dmr = model.selection.find((s) => s.productSlug === FIXTURE_DMR600.slug && s.process === PT);
    expect(dmr?.status).toBe("excluded");
    expect(dmr?.reasons.join(" ")).toMatch(/600/);
    const h = model.selection.find((s) => s.productSlug === FIXTURE_H1500.slug && s.process === PT);
    expect(h?.status).toBe("recommended");
  });

  it("сравнение: строки кандидатов с парком, CAPEX и NPV временной покупки", () => {
    const rows = model.comparison.filter((r) => r.process === PT);
    expect(rows.map((r) => r.productSlug)).toEqual([FIXTURE_H1500.slug, FIXTURE_CARRIER_P.slug]);
    const h = rows[0];
    const p1 = ok(model, "p1");
    expect(h?.n).toBe(p1.items[0]?.n);
    expect(h?.capexPurchaseRub).toBe(p1.capexRub);
    expect(h?.npvPurchaseRub).toBe(p1.npvRub);
    expect(h?.thrNorm).toBe(90);
    expect(h?.raasRubMonth).toBe(100_000);
    expect(rows.every((r) => !r.manuallyAdded)).toBe(true);
  });

  it("входы имитации: парк по расчёту и по паспортной норме (90 пал./ч → 3 робота)", () => {
    const p1 = ok(model, "p1");
    const si = model.simInputs.p1;
    expect(si?.calculated?.robots.count).toBe(p1.items[0]?.n);
    expect(si?.calculated?.layout.chargers).toBe(p1.items[0]?.chargers);
    expect(si?.calculated?.demand.peakPerH).toBe(p1.items[0]?.peakPerHour);
    expect(si?.byNorm?.robots.count).toBe(3);
    expect(si?.assumedUtilPct).toBe(77.5);
    expect(model.simInputs.asis).toEqual({ calculated: null, byNorm: null, assumedUtilPct: null, provenance: null });
    expect(si?.provenance?.some((r) => r.field === "param:activeAreaM2")).toBe(true);
    // Carrier P — вилочный: цикл с временем захвата 45 с, норма 50 пал./ч.
    expect(model.simInputs.p2?.calculated?.robots.handlingSec).toBe(NORMS.handlingSecFork);
  });

  it("снимки — только продукты сценариев; версия данных стабильна и зависит от данных", () => {
    expect(Object.keys(model.productSnapshots)).toEqual([FIXTURE_CARRIER_P.slug, FIXTURE_H1500.slug]);
    const again = buildProjectModel(input({ products: [...PRODUCTS].reverse() }));
    expect(again.dataVersion).toBe(model.dataVersion);
    expect(again.results).toEqual(model.results);
    const cheaper = buildProjectModel(input({ products: [{ ...FIXTURE_H1500, priceRub: 2_600_000 }, FIXTURE_CARRIER_P, FIXTURE_DMR600] }));
    expect(cheaper.dataVersion).not.toBe(model.dataVersion);
    // Продукт вне сценариев на версию данных не влияет.
    const other = buildProjectModel(input({ products: [FIXTURE_H1500, FIXTURE_CARRIER_P, { ...FIXTURE_DMR600, priceRub: 1 }] }));
    expect(other.dataVersion).toBe(model.dataVersion);
  });

  it("вывод с оговоркой о предварительной оценке", () => {
    expect(model.conclusion.disclaimer).toMatch(/предварительной оценкой/);
    expect(model.conclusion.headline.length).toBeGreaterThan(0);
  });

  it("storedPartOf отбрасывает планировку и входы имитации", () => {
    const stored = storedPartOf(model);
    expect("layout" in stored).toBe(false);
    expect("simInputs" in stored).toBe(false);
    expect(stored.results).toBe(model.results);
  });
});

describe("buildProjectModel — ошибки и имитация", () => {
  it("ошибка в параметрах: все сценарии — отказ invalid_inputs с перечнем полей", () => {
    const m = buildProjectModel(input({ params: { ...WAREHOUSE_BASE_PARAMS, forkliftSalaryRubMonth: "сто тысяч" } }));
    expect(m.paramIssues.some((i) => i.key === "forkliftSalaryRubMonth" && i.severity === "error")).toBe(true);
    for (const r of m.results) {
      expect(r.status).toBe("refused");
      if (r.status === "refused") {
        expect(r.refusal.reason).toBe("invalid_inputs");
        expect(r.refusal.fields).toContain("param:forkliftSalaryRubMonth");
      }
    }
    // Подбор показывается и без экономики.
    expect(m.selection.some((s) => s.productSlug === FIXTURE_DMR600.slug && s.status === "excluded")).toBe(true);
  });

  const simOf = (patch: Partial<SimSummaryStored>): SimSummaryStored => {
    const item = ok(model, "p1").items[0];
    return {
      simModelVersion: "sim-1.0.0",
      seed: 1,
      scenarioKey: "p1",
      fleet: item?.n ?? 0,
      requiredPerH: item?.peakPerHour ?? 0,
      achievedPerH: 54,
      servedShare: 0.4,
      fleetUtilPct: 99,
      assumedUtilPct: 77.5,
      idlePct: 0,
      chargingPct: 5,
      waitAtPointsPct: 1,
      queueMax: 80,
      waitP95Min: 60,
      verdict: "NOT_CONFIRMED",
      bottleneck: "fleet",
      oversized: false,
      minStableFleet: 9,
      fleetByNorm: 3,
      verdictByNorm: "NOT_CONFIRMED",
      durationMs: 5,
      ...patch,
    };
  };

  it("имитация не подтвердила расчёт → риск SIM_NOT_CONFIRMED (высокий) с числами", () => {
    const m = buildProjectModel(input({ sims: { p1: simOf({}) } }));
    const risk = ok(m, "p1").risks.find((r) => r.code === "SIM_NOT_CONFIRMED");
    expect(risk?.severity).toBe("high");
    expect(risk?.text).toBe(
      "Имитация не подтвердила расчёт: достигнуто 54 из 129,5 пал./ч; узкое место — парк роботов; " +
        "минимальный устойчивый парк по имитации — 9 роботов",
    );
    expect(ok(m, "r1").risks.some((r) => r.code.startsWith("SIM_"))).toBe(false);
  });

  it("избыточный парк → SIM_OVERSIZED (низкий); устаревшая сводка рисков не даёт", () => {
    const m = buildProjectModel(
      input({ sims: { p1: simOf({ verdict: "CONFIRMED", bottleneck: "none", oversized: true, idlePct: 45 }) } }),
    );
    const risk = ok(m, "p1").risks.find((r) => r.code === "SIM_OVERSIZED");
    expect(risk?.severity).toBe("low");
    expect(risk?.text).toMatch(/простой 45 %/);
    const stale = buildProjectModel(input({ sims: { p1: simOf({ fleet: 7 }) } }));
    expect(ok(stale, "p1").risks.some((r) => r.code.startsWith("SIM_"))).toBe(false);
  });

  it("аэропорт: экономика процессов в прототипе не считается — отказ calc_not_supported", () => {
    const m = buildProjectModel({
      facility: "airport",
      params: {},
      paramDefs: paramSpecsFor("airport"),
      scenarios: [
        { key: "asis", name: "Как есть", kind: "asis", items: [] },
        { key: "p1", name: "Покупка", kind: "purchase", items: [{ process: "baggage-transport", productSlug: FIXTURE_H1500.slug }] },
        { key: "r1", name: "Услуга", kind: "raas", items: [{ process: "baggage-transport", productSlug: FIXTURE_H1500.slug }] },
      ],
      products: PRODUCTS,
      norms: NORMS,
    });
    expect(m.layout).toBeNull();
    for (const r of m.results) {
      expect(r.status).toBe("refused");
      if (r.status === "refused") expect(r.refusal.reason).toBe("calc_not_supported");
    }
  });
});

describe("buildProjectModel — решение, исключённое подбором, в сценарии", () => {
  // DMR 600 дешевле, чем в фикстуре: без защиты его покупка вышла бы в лидеры по NPV.
  const cheapDmr = { ...FIXTURE_DMR600, priceRub: 1_000_000 };
  const dmrSpec = (item: Partial<ScenarioSpec["items"][number]> = {}): ScenarioSpec => ({
    key: "p3",
    name: "Покупка — DMR 600",
    kind: "purchase",
    items: [{ process: PT, productSlug: FIXTURE_DMR600.slug, ...item }],
  });
  const withDmr = (spec: ScenarioSpec, patch: Partial<BuildProjectModelInput> = {}) =>
    buildProjectModel(input({ scenarios: [...SPECS, spec], products: [FIXTURE_H1500, FIXTURE_CARRIER_P, cheapDmr], ...patch }));

  it("без пометки клиента: отметка «добавлено вручную» с причиной подбора, риск MANUAL_ADD и ⚠ в сравнении", () => {
    const m = withDmr(dmrSpec());
    const spec = m.scenarios.find((s) => s.key === "p3");
    expect(spec?.items[0]?.manuallyAdded).toBe(true);
    expect(spec?.items[0]?.manualReason).toBe(`грузоподъёмность 600 кг < масса груза 800 кг${AUTO_MANUAL_SUFFIX}`);
    const p3 = ok(m, "p3");
    expect(p3.items[0]?.manuallyAdded).toBe(true);
    const manual = p3.risks.find((r) => r.code === "MANUAL_ADD");
    expect(manual?.severity).toBe("high");
    expect(manual?.text).toMatch(/«DMR 600» добавлен вручную, хотя подбор его исключил: грузоподъёмность 600 кг < масса груза 800 кг/);
    const row = m.comparison.find((r) => r.productSlug === FIXTURE_DMR600.slug);
    expect(row).toMatchObject({ status: "excluded", manuallyAdded: true });
    // Вход вызывающего кода не изменён.
    expect(dmrSpec().items[0]?.manuallyAdded).toBeUndefined();
  });

  it("сценарий с исключённым решением не рекомендуется, даже с наибольшим NPV", () => {
    const m = withDmr(dmrSpec());
    // Без защиты вывод выбрал бы именно его.
    expect(pickRecommended(m.results)?.key).toBe("p3");
    expect(m.conclusion.recommendedScenarioKey).not.toBe("p3");
    expect(m.conclusion.recommendedScenarioKey).toBe("r1");
    expect(m.conclusion.bullets[0]).toMatch(/^«Покупка — DMR 600» не рекомендуется: подбор исключил решение \(DMR 600 — грузоподъёмность 600 кг < масса груза 800 кг\)/);
  });

  it("пометка пользователя сохраняется, но рекомендацию тоже не даёт", () => {
    const m = withDmr(dmrSpec({ manuallyAdded: true, manualReason: "проверим на пилоте с лёгкими паллетами" }));
    expect(m.scenarios.find((s) => s.key === "p3")?.items[0]?.manualReason).toBe("проверим на пилоте с лёгкими паллетами");
    expect(ok(m, "p3").risks.find((r) => r.code === "MANUAL_ADD")?.text).toMatch(/проверим на пилоте/);
    expect(m.conclusion.recommendedScenarioKey).not.toBe("p3");
  });

  it("отметка идемпотентна и снимается, когда решение снова проходит подбор", () => {
    const m = withDmr(dmrSpec());
    const again = withDmr(m.scenarios.find((s) => s.key === "p3") as ScenarioSpec);
    expect(stableJson(again.scenarios)).toBe(stableJson(m.scenarios));
    expect(stableJson(again.results)).toBe(stableJson(m.results));
    expect(stableJson(again.conclusion)).toBe(stableJson(m.conclusion));

    // Паллета 500 кг — DMR 600 проходит по грузоподъёмности, автоматическая отметка снимается.
    const light = withDmr(m.scenarios.find((s) => s.key === "p3") as ScenarioSpec, {
      params: { ...WAREHOUSE_BASE_PARAMS, avgPalletMassKg: 500 },
    });
    const item = light.scenarios.find((s) => s.key === "p3")?.items[0];
    expect(item?.manuallyAdded).toBeUndefined();
    expect(item?.manualReason).toBeUndefined();
    expect(ok(light, "p3").risks.some((r) => r.code === "MANUAL_ADD")).toBe(false);
    expect(light.conclusion.bullets.some((b) => b.includes("не рекомендуется"))).toBe(false);
  });

  it("продукт не для этого процесса исключается правилом R6 и тоже отмечается", () => {
    const foreign = { ...FIXTURE_H1500, slug: "foreign-robot", name: "Чужой робот", processes: ["cleaning"], solutionType: "cleaner" };
    const m = buildProjectModel(
      input({
        products: [...PRODUCTS, foreign],
        scenarios: [...SPECS, { key: "p3", name: "Покупка — чужой", kind: "purchase", items: [{ process: PT, productSlug: foreign.slug }] }],
      }),
    );
    const it3 = m.scenarios.find((s) => s.key === "p3")?.items[0];
    expect(it3?.manuallyAdded).toBe(true);
    expect(it3?.manualReason).toMatch(/не предназначен для процесса/);
    expect(m.conclusion.recommendedScenarioKey).not.toBe("p3");
  });
});

describe("buildProjectModel — планировка склада не строится", () => {
  const cases: [string, number][] = [
    ["receivingDocksCount", 0],
    ["rackAisleWidthM", 0],
    ["activeAreaM2", 2_000_000],
  ];
  for (const [key, value] of cases) {
    it(`${key} = ${value}: сценарии с мобильными роботами — отказ с полем, «Как есть» считается`, () => {
      const m = buildProjectModel(input({ params: { ...WAREHOUSE_BASE_PARAMS, [key]: value } }));
      expect(m.paramIssues.filter((i) => i.severity === "error")).toEqual([]);
      expect(m.layout).toBeNull();
      expect(m.results.find((r) => r.key === "asis")?.status).toBe("ok");
      for (const k of ["p1", "r1", "p2"]) {
        const r = m.results.find((x) => x.key === k);
        expect(r?.status).toBe("refused");
        if (r?.status === "refused") {
          expect(r.refusal.reason).toBe("invalid_inputs");
          expect(r.refusal.fields).toEqual([`param:${key}`]);
          expect(r.refusal.message).toMatch(/^Планировка склада не строится: «/);
          expect(r.refusal.message).toMatch(/паспортной норме занизил бы парк/);
        }
        expect(m.simInputs[k]?.calculated).toBeNull();
      }
      // Сравнение не показывает парк по паспортной норме вместо цикла.
      expect(m.comparison.every((row) => row.n === null && row.npvPurchaseRub === null)).toBe(true);
      expect(m.conclusion.recommendedScenarioKey).toBeNull();
      expect(m.conclusion.headline).toMatch(/Планировка склада не строится/);
    });
  }
});

describe("версия данных", () => {
  it("зависит от описаний параметров, влияющих на расчёт, и не зависит от подсказок", () => {
    const tighter = DEFS.map((d) => (d.key === "forkliftSalaryRubMonth" ? { ...d, max: (d.max ?? 0) + 1 } : d));
    expect(buildProjectModel(input({ paramDefs: tighter })).dataVersion).not.toBe(model.dataVersion);
    const relabeled = DEFS.map((d) => (d.key === "forkliftSalaryRubMonth" ? { ...d, label: `${d.label} (ред.)` } : d));
    expect(buildProjectModel(input({ paramDefs: relabeled })).dataVersion).not.toBe(model.dataVersion);
    const hinted = DEFS.map((d) => (d.key === "forkliftSalaryRubMonth" ? { ...d, hint: "другая подсказка", example: "например, 1" } : d));
    expect(buildProjectModel(input({ paramDefs: hinted })).dataVersion).toBe(model.dataVersion);
    // Порядок описаний не важен; формула та же, что у проверки расхождения с живыми данными.
    expect(buildProjectModel(input({ paramDefs: [...DEFS].reverse() })).dataVersion).toBe(model.dataVersion);
    expect(projectDataVersion(model.productSnapshots, model.normsUsed, DEFS)).toBe(model.dataVersion);
  });
});

describe("прогоны имитации проекта", () => {
  it("общий бюджет подбора минимального парка исчерпан — подбор пропускается, вердикты есть", () => {
    let t = 0;
    const clock = () => {
      t += 30_000;
      return t;
    };
    const sims = runProjectSims(model, { now: clock, projectBudgetMs: 40_000 });
    expect(sims.asis).toBeNull();
    for (const k of ["p1", "r1", "p2"]) {
      expect(sims[k]?.verdict).toMatch(/CONFIRMED|NOT_CONFIRMED/);
      expect(sims[k]?.minStableFleet).toBeNull();
    }
  }, 60_000);
});

describe("сценарии по умолчанию", () => {
  it("склад: «Как есть», покупка и услуга рекомендуемого, покупка следующего кандидата", () => {
    const specs = defaultScenarios(model.selection, "warehouse", PRODUCTS);
    expect(specs.map((s) => [s.key, s.kind, s.name, s.items.map((i) => i.productSlug)])).toEqual([
      ["asis", "asis", "Как есть", []],
      ["p1", "purchase", "Покупка — Ronavi H1500", [FIXTURE_H1500.slug]],
      ["r1", "raas", "Услуга (RaaS) — Ronavi H1500", [FIXTURE_H1500.slug]],
      ["p2", "purchase", "Покупка — DMR Carrier P", [FIXTURE_CARRIER_P.slug]],
    ]);
  });

  it("initialScenarios даёт тот же набор из пробной сборки", () => {
    const specs = initialScenarios({
      facility: "warehouse",
      params: { ...WAREHOUSE_BASE_PARAMS },
      paramDefs: DEFS,
      products: PRODUCTS,
      norms: NORMS,
    });
    expect(specs).toEqual(defaultScenarios(model.selection, "warehouse", PRODUCTS));
  });

  it("у лучшего решения нет ставки RaaS — услуга берёт следующего кандидата со ставкой", () => {
    const noRate = { ...FIXTURE_H1500, raasRubMonth: null, raasQualifier: null, raasOrigin: null };
    const withRate = { ...FIXTURE_CARRIER_P, raasRubMonth: 150_000 };
    const m = buildProjectModel(input({ products: [noRate, withRate, FIXTURE_DMR600] }));
    const specs = defaultScenarios(m.selection, "warehouse", [noRate, withRate, FIXTURE_DMR600]);
    expect(specs.find((s) => s.key === "r1")?.items[0]?.productSlug).toBe(FIXTURE_CARRIER_P.slug);
  });

  it("без кандидатов — всё равно три сценария, без решений", () => {
    const specs = defaultScenarios([], "airport", []);
    expect(specs.map((s) => s.key)).toEqual(["asis", "p1", "r1"]);
    expect(specs.every((s) => s.items.length === 0)).toBe(true);
  });

  it("короткое название без хвоста в скобках", () => {
    expect(shortProductName("Ronavi H1500 (грузоподъемность до 1 500 кг)")).toBe("Ronavi H1500");
    expect(shortProductName("DMR Carrier P")).toBe("DMR Carrier P");
    expect(shortProductName("(только скобки)")).toBe("(только скобки)");
  });
});

describe("вспомогательное", () => {
  it("withSnapshotProducts: снимок заменяет живой продукт, пропавший из каталога — добавляется", () => {
    const snapH = { ...FIXTURE_H1500, priceRub: 1 };
    const gone = { ...FIXTURE_DMR600, slug: "gone-product" };
    const merged = withSnapshotProducts([FIXTURE_H1500, FIXTURE_CARRIER_P], { [snapH.slug]: snapH, [gone.slug]: gone });
    expect(merged.map((p) => [p.slug, p.priceRub])).toEqual([
      [FIXTURE_H1500.slug, 1],
      [FIXTURE_CARRIER_P.slug, FIXTURE_CARRIER_P.priceRub],
      ["gone-product", FIXTURE_DMR600.priceRub],
    ]);
  });

  it("timed измеряет время часами вызывающего кода", () => {
    const ticks = [100, 142.5];
    const r = timed(() => "готово", () => ticks.shift() ?? 0);
    expect(r).toEqual({ value: "готово", ms: 42.5 });
    const back = [10, 5];
    expect(timed(() => 1, () => back.shift() ?? 0).ms).toBe(0);
  });
});
