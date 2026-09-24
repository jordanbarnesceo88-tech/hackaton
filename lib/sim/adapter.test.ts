import { describe, expect, it } from "vitest";
import { DEFAULT_NORMS, resolveNorms } from "../tz/norms";
import type { Origin, ParamSpec, ParamValues, ProductForCalc } from "../tz/types";
import { handlingSecFor, toSimInput } from "./adapter";
import { WAREHOUSE_BASE_AVG_PER_H, WAREHOUSE_BASE_PEAK_PER_H } from "./fixtures";

/** Снимок продукта для тестов адаптера: H1500 по «Примерам решений» организатора. */
function product(patch: Partial<ProductForCalc> = {}): ProductForCalc {
  return {
    slug: "ronavi-h1500",
    name: "Ronavi H1500",
    manufacturer: "Ronavi Robotics",
    solutionType: "pallet-amr",
    handlingClass: "jacking",
    mobile: true,
    status: "operation",
    level: "examples",
    flags: [],
    excluded: false,
    excludedReason: null,
    processes: ["pallet-transport"],
    facilityTypes: ["warehouse"],
    priceRub: 3_000_000,
    priceConfirmed: false,
    priceOrigin: "research",
    throughputPerH: 90,
    throughputUnit: "паллет/ч",
    throughputScope: "per-robot",
    throughputQualifier: null,
    throughputConfirmed: true,
    payloadKg: 1500,
    speedMps: 1.5,
    autonomyH: 6,
    chargeMin: 18,
    minAisleM: null,
    turnAisleM: null,
    liftHeightMm: null,
    tempMinC: null,
    tempMaxC: null,
    serviceRubYear: null,
    softwareRubOneTime: null,
    softwareRubYear: null,
    implementationRub: null,
    trainingRub: null,
    consumablesRubYear: null,
    batteryCostRub: null,
    batteryReplacementYears: null,
    serviceLifeYears: null,
    raasRubMonth: null,
    raasQualifier: null,
    raasOrigin: null,
    hasCases: true,
    completenessPct: 60,
    confirmedSharePct: 50,
    sources: [
      {
        key: "speedMps",
        label: "Скорость",
        value: "1,5 м/с",
        origin: "organizer",
        sourceUrl: null,
        sourceRef: "Примеры решений › Ronavi H1500",
        date: "2026-09-01",
        confirmed: true,
      },
    ],
    ...patch,
  };
}

const PARAMS: ParamValues = {
  activeAreaM2: 10000,
  mainAisleWidthM: 3.5,
  rackAisleWidthM: 2.8,
  receivingDocksCount: 4,
  shippingDocksCount: 4,
  avgPalletMassKg: 800,
};

function spec(key: string, base: number, origin: ParamSpec["origin"]): ParamSpec {
  return {
    key,
    facility: "warehouse",
    section: "Планировка",
    label: `Подпись ${key}`,
    unit: "м",
    kind: "number",
    options: [],
    base,
    min: null,
    max: null,
    locked: false,
    required: true,
    tzMinimum: null,
    usedBy: [],
    hint: "",
    example: "",
    organizerNote: null,
    origin,
    sourceRef: origin === "organizer" ? "Датасеты › Склад" : null,
    sourceUrl: null,
    basis: origin === "estimate" ? "оценка" : null,
    formula: null,
    order: 1,
  };
}

const BASE_ARGS = {
  params: PARAMS,
  product: product(),
  fleet: 11,
  chargers: 1,
  peakPerH: WAREHOUSE_BASE_PEAK_PER_H,
  avgPerH: WAREHOUSE_BASE_AVG_PER_H,
  norms: resolveNorms(),
};

describe("toSimInput", () => {
  it("базовые значения склада и H1500 дают полный вход имитации с нормативами", () => {
    const r = toSimInput(BASE_ARGS);
    if (!r.ok) throw new Error(r.message);
    expect(r.input).toEqual({
      seed: 1,
      layout: {
        activeAreaM2: 10000,
        mainAisleWidthM: 3.5,
        rackAisleWidthM: 2.8,
        receivingDocksCount: 4,
        shippingDocksCount: 4,
        chargers: 1,
      },
      robots: {
        count: 11,
        speedMps: 1.5,
        loadedSpeedFactor: DEFAULT_NORMS.loadedSpeedFactor,
        handlingSec: DEFAULT_NORMS.handlingSecJacking,
        autonomyH: 6,
        chargeMin: 18,
        payloadKg: 1500,
      },
      demand: {
        avgPerH: WAREHOUSE_BASE_AVG_PER_H,
        peakPerH: WAREHOUSE_BASE_PEAK_PER_H,
        warmupMin: 15,
        peakMin: 120,
      },
      loadMassKg: 800,
      thresholds: { servedShareMin: 0.97, p95WaitMaxMin: 10, oversizedIdleShare: 0.4 },
      charge: { startSoc: 0.2, stopSoc: 0.9 },
    });
    expect(r.input.demand.peakPerH).toBeCloseTo(129.55, 2);
    expect(r.assumedUtilPct).toBeCloseTo(77.5, 10);
  });

  it("время погрузки берётся по классу погрузки", () => {
    const fork = toSimInput({ ...BASE_ARGS, product: product({ handlingClass: "fork" }) });
    const tug = toSimInput({ ...BASE_ARGS, product: product({ handlingClass: "tug" }) });
    expect(fork.ok && fork.input.robots.handlingSec).toBe(DEFAULT_NORMS.handlingSecFork);
    expect(tug.ok && tug.input.robots.handlingSec).toBe(DEFAULT_NORMS.handlingSecTug);
  });

  it("стационарные и немобильные решения — отказ not_supported", () => {
    for (const p of [product({ handlingClass: "station" }), product({ handlingClass: "cleaner" }), product({ mobile: false })]) {
      const r = toSimInput({ ...BASE_ARGS, product: p });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("not_supported");
        expect(r.message).toContain("не поддерживается");
      }
    }
  });

  it("недостающие данные перечисляются, ноль не подставляется", () => {
    const r = toSimInput({
      ...BASE_ARGS,
      params: { ...PARAMS, activeAreaM2: null, rackAisleWidthM: "abc", receivingDocksCount: 0 },
      product: product({ speedMps: null }),
      fleet: 0,
      peakPerH: Number.NaN,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing_inputs");
      expect(r.missing).toEqual(["activeAreaM2", "rackAisleWidthM", "receivingDocksCount", "product.speedMps", "fleet", "peakPerH"]);
      expect(r.message).toContain("Для имитации не хватает данных");
      expect(r.message).toContain("Скорость робота");
    }
  });

  it("зарядка моделируется — нужна хотя бы одна станция; без автономности станции не нужны", () => {
    const noCharger = toSimInput({ ...BASE_ARGS, chargers: 0 });
    expect(noCharger.ok).toBe(false);
    if (!noCharger.ok) expect(noCharger.missing).toEqual(["chargers"]);

    const noAutonomy = toSimInput({ ...BASE_ARGS, chargers: 0, product: product({ autonomyH: null }) });
    expect(noAutonomy.ok).toBe(true);
    if (noAutonomy.ok) {
      expect(noAutonomy.input.robots.autonomyH).toBeNull();
      expect(noAutonomy.input.robots.chargeMin).toBeNull();
    }
  });

  it("числа строкой с десятичной запятой принимаются; масса не задана — проверка массы не выполняется", () => {
    const r = toSimInput({ ...BASE_ARGS, params: { ...PARAMS, mainAisleWidthM: "3,5", avgPalletMassKg: null } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.layout.mainAisleWidthM).toBe(3.5);
      expect(r.input.loadMassKg).toBeNull();
      const massRow = r.provenance.find((p) => p.field === "param:avgPalletMassKg")!;
      expect(massRow.note).toContain("не выполняется");
    }
  });

  it("происхождение: базовое значение наследует описание параметра, изменённое — «задано вами»", () => {
    const r = toSimInput({
      ...BASE_ARGS,
      params: { ...PARAMS, rackAisleWidthM: 3.0 },
      paramSpecs: [
        spec("activeAreaM2", 10000, "organizer"),
        spec("rackAisleWidthM", 2.8, "organizer"),
        spec("receivingDocksCount", 4, "estimate"),
      ],
    });
    if (!r.ok) throw new Error(r.message);
    const byField = new Map(r.provenance.map((p) => [p.field, p]));
    expect(byField.get("param:activeAreaM2")).toMatchObject({ origin: "organizer", label: "Подпись activeAreaM2" });
    expect(byField.get("param:rackAisleWidthM")!.origin).toBe("user");
    expect(byField.get("param:receivingDocksCount")!.origin).toBe("estimate");
    expect(byField.get("param:mainAisleWidthM")!.origin).toBe("user");
    expect(byField.get("product:speedMps")).toMatchObject({ origin: "organizer", value: 1.5 });
    expect(byField.get("norm:handlingSecJacking")).toMatchObject({ origin: "estimate", value: 20 });
    expect(byField.get("calc:fleet")).toMatchObject({ origin: "derived", value: 11 });
    expect(byField.get("layout:rackRowDepthM")).toMatchObject({ origin: "estimate", value: 2.4 });
    for (const p of r.provenance) expect(p.label.length).toBeGreaterThan(0);
  });

  it("заведомо ошибочные величины — отказ out_of_range с подсказкой про единицы", () => {
    const r = toSimInput({ ...BASE_ARGS, params: { ...PARAMS, activeAreaM2: 5e8 }, fleet: 5000, peakPerH: 1e7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("out_of_range");
      expect(r.missing).toEqual(["activeAreaM2", "fleet", "peakPerH"]);
      expect(r.message).toContain("Проверьте единицы измерения");
    }
  });

  it("handlingSecFor — то же время погрузки, что в адаптере; стационарные классы — null", () => {
    const norms = resolveNorms();
    expect(handlingSecFor("jacking", norms)).toBe(norms.handlingSecJacking);
    expect(handlingSecFor("fork", norms)).toBe(norms.handlingSecFork);
    expect(handlingSecFor("tug", norms)).toBe(norms.handlingSecTug);
    for (const c of ["station", "cleaner", "other"] as const) expect(handlingSecFor(c, norms)).toBeNull();
  });

  it("ручной парк помечается как заданный пользователем; зерно передаётся", () => {
    const r = toSimInput({ ...BASE_ARGS, fleet: 9, fleetOrigin: "user", seed: 7 });
    if (!r.ok) throw new Error(r.message);
    expect(r.input.seed).toBe(7);
    expect(r.provenance.find((p) => p.field === "calc:fleet")!.origin).toBe("user");
  });

  it("пояснение к числу роботов соответствует происхождению: формула — только для парка из расчёта", () => {
    const noteFor = (fleetOrigin?: Origin) => {
      const r = toSimInput({ ...BASE_ARGS, fleetOrigin });
      if (!r.ok) throw new Error(r.message);
      return r.provenance.find((p) => p.field === "calc:fleet")!.note;
    };
    expect(noteFor()).toContain("Парк из расчёта");
    expect(noteFor("derived")).toContain("Парк из расчёта");
    expect(noteFor("user")).toBe("Число роботов задано вручную (журнал изменений)");
    expect(noteFor("organizer")).toBeUndefined();
  });

  it("пороги зарядки вне 0 ≤ ухода < возврата ≤ 1 (например, в процентах) — отказ out_of_range", () => {
    const pct = { ...resolveNorms(), chargeStartSoc: 20, chargeStopSoc: 90 };
    const r = toSimInput({ ...BASE_ARGS, norms: pct });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("out_of_range");
      expect(r.missing).toEqual(["norm.chargeStartSoc", "norm.chargeStopSoc"]);
      expect(r.message).toContain("Пороги ухода на зарядку");
    }
    // Без моделирования зарядки пороги не используются — отказа нет.
    expect(toSimInput({ ...BASE_ARGS, norms: pct, product: product({ autonomyH: null }) }).ok).toBe(true);
  });
});
