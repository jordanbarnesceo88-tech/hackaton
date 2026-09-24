import { describe, expect, it } from "vitest";
import { NORM_DEFS, resolveNorms, type NormKey } from "../norms";
import type { ParamValues, ProductForCalc, ScenarioItem, ScenarioSpec, Scope } from "../types";
import { buildConclusion } from "./conclusion";
import type { CycleInfo, ScenarioContext } from "./context";
import { FIXTURE_PRODUCTS, WAREHOUSE_BASE_PARAMS, fixtureProcesses } from "./fixtures";
import { computeScenarios } from "./scenario";

/**
 * Фаззинг тотальности: 500 случайных контекстов (в том числе вырожденных: нули, пропуски,
 * отрицательные значения, «до X», цифры на парк) — движок не бросает исключений, а каждое
 * число в результате конечно или null. NaN и ±∞ наружу не выходят ни при каком вводе.
 */

/** mulberry32 — детерминированный генератор, чтобы падение воспроизводилось по номеру прогона. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const between = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
const int = (rng: Rng, a: number, b: number) => Math.floor(between(rng, a, b + 1));
function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)] as T;
}
/** С вероятностью p — «плохое» значение (null, 0, отрицательное), иначе нормальное. */
function sometimes<T>(rng: Rng, p: number, bad: readonly T[], good: () => T): T {
  return rng() < p ? pick(rng, bad) : good();
}

function randomParams(rng: Rng): ParamValues {
  const p: ParamValues = { ...WAREHOUSE_BASE_PARAMS };
  p.shiftsPerDay = sometimes(rng, 0.05, [null, 0], () => int(rng, 1, 3));
  p.shiftDurationH = sometimes(rng, 0.05, [null, 0, -1], () => between(rng, 6, 12));
  p.workDaysPerYear = sometimes(rng, 0.05, [null, 0, 400], () => int(rng, 200, 365));
  p.peakFactor = sometimes(rng, 0.05, [null, 0, 0.5], () => between(rng, 1, 3));
  p.inboundPalletsPerDay = sometimes(rng, 0.1, [null, 0, -5], () => between(rng, 0, 6000));
  p.outboundPalletsPerDay = sometimes(rng, 0.1, [0, "1 000", "abc"], () => between(rng, 0, 6000));
  p.internalPalletMovesPerDay = sometimes(rng, 0.05, [null], () => between(rng, 0, 3000));
  p.nonStandardCargoPct = sometimes(rng, 0.05, [null, 100, 150], () => between(rng, 0, 40));
  p.forkliftOperatorsCount = sometimes(rng, 0.08, [null, 0, -3], () => int(rng, 1, 120));
  p.forkliftSalaryRubMonth = sometimes(rng, 0.08, [null, 0, "120 000"], () => between(rng, 20_000, 250_000));
  p.payrollTaxMultiplier = sometimes(rng, 0.1, [null, 0, "1,302"], () => 1.302);
  p.activeAreaM2 = sometimes(rng, 0.05, [null, 0], () => between(rng, 500, 60_000));
  p.horizonYears = sometimes(rng, 0.05, [null, 0, -2, 0.2, 60], () => between(rng, 1, 12));
  p.hasWms = pick(rng, ["Да", "Да ", "Нет", null, "", 1, 0]);
  p.floorsCount = sometimes(rng, 0.05, [null], () => int(rng, 1, 4));
  p.availablePowerKw = sometimes(rng, 0.1, [null, 0], () => between(rng, 1, 3000));
  p.capexBudgetMRub = sometimes(rng, 0.1, [null, 0], () => between(rng, 1, 500));
  return p;
}

function randomProduct(rng: Rng, base: ProductForCalc): ProductForCalc {
  const num = (p: number, lo: number, hi: number) => sometimes<number | null>(rng, p, [null, 0, -1], () => between(rng, lo, hi));
  return {
    ...base,
    mobile: rng() < 0.85,
    handlingClass: pick(rng, ["jacking", "fork", "tug", "station", "cleaner", "other"] as const),
    status: pick(rng, ["operation", "piloting", "rnd"] as const),
    priceRub: num(0.15, 100_000, 12_000_000),
    priceConfirmed: rng() < 0.5,
    throughputPerH: num(0.25, 1, 200),
    throughputUnit: pick(rng, ["паллет/ч", "поддонов/час", "м²/ч", null]),
    throughputScope: pick<Scope | null>(rng, ["per-robot", "per-station", "per-channel", "per-fleet", null]),
    throughputQualifier: pick(rng, [null, "до", "от", "≈"] as const),
    throughputConfirmed: rng() < 0.5,
    speedMps: num(0.2, 0.3, 3),
    autonomyH: num(0.2, 0.5, 30),
    chargeMin: num(0.2, 5, 300),
    serviceRubYear: num(0.4, 0, 1_000_000),
    softwareRubOneTime: num(0.4, 0, 3_000_000),
    softwareRubYear: num(0.6, 0, 500_000),
    implementationRub: num(0.4, 0, 3_000_000),
    trainingRub: num(0.5, 0, 500_000),
    consumablesRubYear: num(0.6, 0, 200_000),
    batteryCostRub: num(0.5, 0, 1_000_000),
    batteryReplacementYears: num(0.4, 0.2, 12),
    serviceLifeYears: num(0.4, 0.2, 25),
    raasRubMonth: num(0.3, 10_000, 400_000),
    raasQualifier: pick(rng, [null, "до", "от", "≈"] as const),
    completenessPct: between(rng, 0, 100),
  };
}

function randomCycle(rng: Rng): CycleInfo | null {
  if (rng() < 0.25) return null;
  return {
    thrPerH: sometimes(rng, 0.1, [0, -1], () => between(rng, 1, 120)),
    loadedM: between(rng, 1, 300),
    emptyM: between(rng, 1, 300),
  };
}

const RANDOM_NORMS: NormKey[] = [
  "utilization",
  "availability",
  "reservePct",
  "servicePctOfPriceYear",
  "discountRate",
  "laborShareAutomatable",
  "batteryReplacementYears",
  "serviceLifeYearsDefault",
  "tcoMinYears",
  "robotsPerOperatorPost",
  "chargerSafetyFactor",
  "sensitivityDeltaPct",
];

function randomNormOverrides(rng: Rng): Partial<Record<NormKey, number>> {
  const out: Partial<Record<NormKey, number>> = {};
  for (const key of RANDOM_NORMS) {
    if (rng() < 0.3) {
      const d = NORM_DEFS.find((x) => x.key === key);
      const lo = d?.min ?? 0;
      const hi = d?.max ?? (d?.value ?? 1) * 3;
      // Иногда за пределами диапазона: resolveNorms обязан прижать.
      out[key] = between(rng, lo - (hi - lo), hi + (hi - lo));
    }
  }
  return out;
}

function randomItem(rng: Rng, slugs: string[]): ScenarioItem {
  const it: ScenarioItem = {
    process: rng() < 0.9 ? "pallet-transport" : pick(rng, ["cleaning", "storage", "no-such-process"]),
    productSlug: rng() < 0.95 ? pick(rng, slugs) : "no-such-product",
  };
  if (rng() < 0.2) it.quantityOverride = pick(rng, [0, -1, 0.4, 1, 3, 17, 250]);
  if (rng() < 0.2) it.priceRubOverride = pick(rng, [0, -5, 50_000, 2_000_000, 9e6]);
  if (rng() < 0.2) it.throughputPerHOverride = pick(rng, [0, -1, 0.5, 20, 150]);
  if (rng() < 0.2) it.serviceRubYearOverride = pick(rng, [-1, 0, 250_000]);
  if (rng() < 0.2) it.raasRubMonthOverride = pick(rng, [0, 80_000, 200_000]);
  if (rng() < 0.1) it.raasFromEstimate = true;
  if (rng() < 0.1) {
    it.manuallyAdded = true;
    it.manualReason = "проверка";
  }
  return it;
}

function randomSpecs(rng: Rng, slugs: string[]): ScenarioSpec[] {
  const specs: ScenarioSpec[] = [{ key: "asis", name: "Как есть", kind: "asis", items: [] }];
  const n = int(rng, 1, 3);
  for (let i = 0; i < n; i++) {
    const kind = pick(rng, ["purchase", "raas"] as const);
    const items = rng() < 0.08 ? [] : rng() < 0.08 ? [randomItem(rng, slugs), randomItem(rng, slugs)] : [randomItem(rng, slugs)];
    const spec: ScenarioSpec = { key: `s${i}`, name: `Сценарий ${i}`, kind, items };
    if (rng() < 0.3) spec.normOverrides = randomNormOverrides(rng);
    specs.push(spec);
  }
  return specs;
}

function randomContext(rng: Rng): ScenarioContext {
  const products = FIXTURE_PRODUCTS.map((p) => randomProduct(rng, p));
  const ctx: ScenarioContext = {
    facility: "warehouse",
    params: randomParams(rng),
    norms: resolveNorms(undefined, randomNormOverrides(rng)),
    products: Object.fromEntries(products.map((p) => [p.slug, p])),
    processes: fixtureProcesses(),
    cycle: Object.fromEntries(products.map((p) => [p.slug, randomCycle(rng)])),
  };
  if (rng() < 0.5) {
    ctx.paramBounds = {
      forkliftSalaryRubMonth: { min: 80_000, max: 170_000 },
      peakFactor: pick(rng, [
        { min: 1.2, max: 2.5 },
        { min: null, max: null },
        { min: 3, max: 1 },
      ]),
      horizonYears: { min: 3, max: 10 },
    };
  }
  return ctx;
}

/** Путь к первому нечисловому числу в значении; null — все числа конечны. */
function firstNonFinite(value: unknown, path = "$"): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path} = ${value}`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = firstNonFinite(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = firstNonFinite(v, `${path}.${k}`);
      if (p) return p;
    }
  }
  return null;
}

describe("фаззинг: 500 случайных контекстов", () => {
  // Обычно ~2 с; запас по времени — на случай, когда машина загружена параллельными прогонами.
  it("каждое число конечно или null, исключений нет, отказ всегда с сообщением", { timeout: 60_000 }, () => {
    const slugs = FIXTURE_PRODUCTS.map((p) => p.slug);
    let ok = 0;
    let refused = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const rng = mulberry32(seed);
      const ctx = randomContext(rng);
      const specs = randomSpecs(rng, slugs);
      const results = computeScenarios(ctx, specs);
      const conclusion = buildConclusion(results, ctx, rng() < 0.5 ? specs : undefined);
      const bad = firstNonFinite({ results, conclusion });
      expect(bad, `seed ${seed}: ${bad}`).toBeNull();
      expect(results).toHaveLength(specs.length);
      for (const r of results) {
        if (r.status === "refused") {
          refused++;
          expect(r.refusal.message.length, `seed ${seed}`).toBeGreaterThan(10);
          expect(r.refusal.message).not.toMatch(/NaN|Infinity|undefined/);
          // Страховка allFinite не должна срабатывать: вырожденный ввод ловят проверки с понятным сообщением.
          expect(r.refusal.message, `seed ${seed} ${r.key}`).not.toContain("нечисловой результат");
        } else {
          ok++;
          for (const l of [...r.capexLines, ...r.opexLines]) expect(l.substituted).not.toMatch(/NaN|Infinity|undefined/);
          for (const t of r.trace) expect(t.substituted, `seed ${seed} ${t.key}`).not.toMatch(/NaN|Infinity|undefined/);
          for (const k of r.risks) expect(k.text).not.toMatch(/NaN|Infinity|undefined/);
          if (r.paybackYears !== null) expect(r.paybackYears).toBeGreaterThanOrEqual(0);
          for (const it of r.items) {
            expect(it.n).toBeGreaterThanOrEqual(1);
            expect(it.coverage).toBeGreaterThanOrEqual(0);
            expect(it.coverage).toBeLessThanOrEqual(1);
            expect(it.releasedFte).toBeLessThanOrEqual(it.headcount + 1e-9);
          }
        }
      }
      expect(conclusion.headline).not.toMatch(/NaN|Infinity|undefined/);
      expect(conclusion.disclaimer).toBe("Результат является предварительной оценкой и требует верификации при обследовании объекта.");
    }
    // Фаззинг должен проверять и расчёты, и отказы, а не только одно из двух.
    expect(ok).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(50);
  });
});
