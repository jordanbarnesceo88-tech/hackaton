import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CHARACTERISTIC_KEYS } from "../../tz/characteristics";
import { PROCESS_DEFS, SOLUTION_TYPE_DEFS, processDef } from "../../tz/processes";
import type { CharValue, ParamSpec, ProductSeed, Sourced } from "../../tz/types";
import { CATALOG, catalogProduct } from "./catalog";
import { DUPLICATE_ROW_MERGES, PARAM_EXTRAS } from "./decisions";
import { PARAM_SPECS, baseValuesFor, paramSpecsFor } from "./params";
import { CATALOG_COUNTS, ORGANIZER_DATA_VERSION } from "./version.generated";

/**
 * Проверки данных организатора (T1.1): правила провенанса (Sourced), состав и значения
 * параметров объектов, каталог (187 id организатора, обогащённые продукты, исключения) и
 * опорные значения, на которые опираются экономика, подбор и эталон расчёта.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FACILITIES = ["warehouse", "airport", "medical"] as const;

/** Типичное значение числа или диапазона; иначе ошибка теста. */
function num(v: CharValue | undefined): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && !Array.isArray(v)) return v.typical;
  throw new Error(`ожидалось число или диапазон, получено ${JSON.stringify(v)}`);
}

function product(slug: string): ProductSeed {
  const p = catalogProduct(slug);
  if (!p) throw new Error(`нет продукта ${slug}`);
  return p;
}

/** Нарушения правил провенанса одного значения (пустой список — значение в порядке). */
function sourcedProblems(s: Omit<Sourced<CharValue>, "alternatives">): string[] {
  const out: string[] = [];
  if (!ISO_DATE.test(s.date)) out.push(`дата «${s.date}» не YYYY-MM-DD`);
  switch (s.origin) {
    case "organizer":
      if (!s.sourceRef?.trim()) out.push("organizer без sourceRef");
      break;
    case "research":
      if (!s.sourceUrl || !/^https?:\/\//.test(s.sourceUrl)) out.push("research без http(s)-ссылки");
      if (!s.asInSource?.trim()) out.push("research без цитаты asInSource");
      break;
    case "estimate":
      if (!s.basis?.trim()) out.push("estimate без basis");
      if (s.confirmed) out.push("estimate помечена подтверждённой");
      break;
    case "derived":
      if (!s.formula?.trim()) out.push("derived без formula");
      if (!s.basis?.trim()) out.push("derived без basis");
      break;
    case "choice":
      if (!s.basis?.trim()) out.push("choice без basis");
      break;
    default:
      out.push(`недопустимое происхождение ${s.origin} в данных организатора`);
  }
  return out;
}

describe("Каталог: правила провенанса (Sourced)", () => {
  it("каждая характеристика и каждая альтернатива соблюдают правила по origin", () => {
    const problems: string[] = [];
    for (const p of CATALOG) {
      for (const [key, s] of Object.entries(p.characteristics)) {
        for (const msg of sourcedProblems(s)) problems.push(`${p.slug}.${key}: ${msg}`);
        for (const [i, alt] of (s.alternatives ?? []).entries()) {
          for (const msg of sourcedProblems(alt)) problems.push(`${p.slug}.${key}.alternatives[${i}]: ${msg}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("подтверждённым считается только значение первоисточника или организатора, совпавшее с ним", () => {
    for (const p of CATALOG) {
      for (const [key, s] of Object.entries(p.characteristics)) {
        if (!s.confirmed) continue;
        if (s.origin === "research") {
          expect(["manufacturer", "manufacturer-doc"], `${p.slug}.${key}`).toContain(s.sourceType);
          expect(s.confidence, `${p.slug}.${key}`).not.toBe("low");
        } else {
          // Значение организатора подтверждено, только если в альтернативах есть первоисточник.
          expect(s.origin, `${p.slug}.${key}`).toBe("organizer");
          const primary = (s.alternatives ?? []).some(
            (a) => a.origin === "research" && ["manufacturer", "manufacturer-doc"].includes(a.sourceType),
          );
          expect(primary, `${p.slug}.${key}`).toBe(true);
        }
      }
    }
  });

  it("ключи характеристик — из словаря ТЗ §3.3.4", () => {
    const known = new Set(Object.keys(CHARACTERISTIC_KEYS));
    for (const p of CATALOG) {
      for (const key of Object.keys(p.characteristics)) expect(known.has(key), `${p.slug}.${key}`).toBe(true);
    }
  });

  it("производительность в расчёт — только на робот, станцию или канал, с единицей", () => {
    for (const p of CATALOG) {
      const t = p.characteristics.throughput;
      if (!t || typeof t.value === "string" || Array.isArray(t.value)) continue;
      expect(["per-robot", "per-station", "per-channel"], p.slug).toContain(t.scope);
      expect(t.unit, p.slug).toBeTruthy();
    }
  });
});

describe("Каталог: состав", () => {
  it("все 187 уникальных id каталога организатора импортированы, каждый один раз", () => {
    const ids = CATALOG.map((p) => p.organizerCatalogId).filter((id): id is string => id !== null);
    expect(ids).toHaveLength(187);
    expect(new Set(ids).size).toBe(187);
  });

  it("счётчики уровней совпадают с данными: 57 обогащённых, продукты «Примеров решений»", () => {
    const count = (level: string) => CATALOG.filter((p) => p.level === level).length;
    expect(CATALOG_COUNTS).toEqual({
      identification: count("identification"),
      enriched: count("enriched"),
      examples: count("examples"),
    });
    expect(CATALOG_COUNTS.enriched).toBe(57);
    expect(CATALOG_COUNTS.identification + CATALOG_COUNTS.enriched).toBe(187);
    expect(CATALOG_COUNTS.examples).toBeGreaterThanOrEqual(1);
  });

  it("slug'и уникальны и в kebab-case, описания не длиннее 200 символов, порядок по slug", () => {
    const slugs = CATALOG.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(KEBAB);
    expect([...slugs].sort()).toEqual(slugs);
    for (const p of CATALOG) expect(p.description.length, p.slug).toBeLessThanOrEqual(200);
  });

  it("типы решений и процессы существуют, типы объектов выведены из процессов", () => {
    const types = new Set(SOLUTION_TYPE_DEFS.map((s) => s.slug));
    for (const p of CATALOG) {
      expect(types.has(p.solutionType), `${p.slug}: ${p.solutionType}`).toBe(true);
      const facilities = new Set<string>();
      for (const proc of p.processes) {
        const def = processDef(proc);
        expect(def, `${p.slug}: ${proc}`).toBeDefined();
        for (const f of def?.facilityTypes ?? []) facilities.add(f);
      }
      expect(new Set(p.facilityTypes), p.slug).toEqual(facilities);
    }
  });

  it("слитые дубли свода — один продукт с номерами обеих строк и флагом duplicate-merged", () => {
    for (const [a, b] of DUPLICATE_ROW_MERGES) {
      const merged = CATALOG.filter((p) => p.organizerRows.includes(a));
      expect(merged, `${a}/${b}`).toHaveLength(1);
      expect(merged[0]?.organizerRows).toEqual([a, b]);
      expect(merged[0]?.flags).toContain("duplicate-merged");
    }
  });

  it("исключённые продукты несут причину исключения", () => {
    const excluding = ["model-not-found", "variant-unpublished", "rnd-exclude"];
    const excluded = CATALOG.filter((p) => p.flags.some((f) => excluding.includes(f)));
    expect(excluded.length).toBeGreaterThan(0);
    for (const p of excluded) expect(p.excludedReason?.trim(), p.slug).toBeTruthy();
    expect(product("ronavi-rcm").flags).toContain("model-not-found");
    expect(product("semargl-tagarka-35t").flags).toContain("variant-unpublished");
    expect(product("yandex-robot-komplektovshchik").flags).toContain("rnd-exclude");
    expect(product("robocv-tyagach").flags).toContain("values-from-other-product");
  });

  it("в процессе «перемещение паллет» не меньше пяти продуктов, пригодных для расчёта", () => {
    const calc = CATALOG.filter((p) => p.level !== "identification" && p.processes.includes("pallet-transport"));
    expect(calc.length).toBeGreaterThanOrEqual(5);
  });

  it("PuduBot 2 — продукт «Примеров решений» без цены", () => {
    const pudu = product("pudubot-2");
    expect(pudu.level).toBe("examples");
    expect(pudu.organizerCatalogId).toBeNull();
    expect(pudu.flags).toContain("no-price");
    expect(pudu.characteristics.priceRub).toBeUndefined();
    expect(num(pudu.characteristics.payloadKg?.value)).toBe(10);
    expect(pudu.processes).toEqual(["hospital-delivery"]);
  });

  it("catalog.generated.json меньше 1 МБ", () => {
    const size = statSync(fileURLToPath(new URL("./catalog.generated.json", import.meta.url))).size;
    expect(size).toBeLessThan(1_000_000);
  });
});

describe("Каталог: опорные значения для расчёта и подбора", () => {
  it("Ronavi H1500 — цена, производительность, RaaS и ТТХ из «Примеров решений»", () => {
    const h = product("ronavi-h1500");
    const c = h.characteristics;
    expect(h.level).toBe("enriched");
    expect(h.organizerRows).toEqual([21, 22]);
    expect(h.processes).toContain("pallet-transport");
    expect(c.priceRub?.value).toBe(2700000);
    expect(c.priceRub?.origin).toBe("organizer");
    // Цена организатора в диапазоне сайта производителя (2,16–2,7 млн ₽) — подтверждена.
    expect(c.priceRub?.confirmed).toBe(true);
    expect(num(c.throughput?.value)).toBe(90);
    expect(c.throughput).toMatchObject({ scope: "per-robot", origin: "organizer", unit: "паллет/ч" });
    expect(c.raasRubMonth?.value).toMatchObject({ typical: 100000, qualifier: "от" });
    expect(num(c.speedMps?.value)).toBe(1.5);
    expect(num(c.autonomyH?.value)).toBe(6);
    expect(num(c.chargeMin?.value)).toBe(18);
    expect(num(c.payloadKg?.value)).toBe(1500);
    expect(c.tempMinC?.value).toBe(5);
    expect(c.tempMaxC?.value).toBe(25);
  });

  it("Ronavi H1500 — экономика из статьи производителя, на которой держится эталон T1.2", () => {
    const c = product("ronavi-h1500").characteristics;
    expect(num(c.serviceRubYear?.value)).toBe(300000);
    expect(c.serviceRubYear).toMatchObject({ origin: "research", sourceType: "manufacturer" });
    expect(c.softwareRubOneTime?.value).toBe(1000000);
    expect(c.implementationRub?.value).toMatchObject({ min: 500000, max: 2000000, typical: 1250000 });
  });

  it("ограничения подбора: DMR 600 везёт 600 кг, RoboCV разворачивается в 2,9 м", () => {
    expect(num(product("dikom-dmr-600").characteristics.payloadKg?.value)).toBe(600);
    const robocv = product("robocv-shtabeler").characteristics;
    expect(robocv.turnAisleM?.value).toBe(2.9);
    expect(robocv.turnAisleM?.origin).toBe("research");
    expect(num(robocv.minAisleM?.value)).toBe(1.9);
  });

  it("DMR Carrier P — норма организатора 40–60 паллет/ч на робота", () => {
    const t = product("dikom-dmr-carrier-p").characteristics.throughput;
    expect(t?.value).toEqual({ min: 40, max: 60, typical: 50 });
    expect(t?.scope).toBe("per-robot");
  });

  it("«до X» сохраняет оговорку: MARK 2 SE до 1000 м²/ч", () => {
    const t = product("r2b-mark-2-se").characteristics.throughput;
    expect(t?.value).toEqual({ max: 1000, typical: 1000, qualifier: "до" });
  });

  it("цифры парка и кейсов не попадают в производительность", () => {
    // AK-2000-2: 350 паллет/ч — на парк из 67 роботов (кейс X5).
    const ak = product("avtomakon-ak-2000-2").characteristics;
    expect(ak.throughput).toBeUndefined();
    expect(JSON.stringify(ak.cases)).toContain("67");
  });
});

describe("Параметры объектов", () => {
  it("склад — 42 строки датасета, аэропорт — 39, медучреждение — 57, плюс дополнения", () => {
    const expected = { warehouse: 42, airport: 39, medical: 57 };
    for (const f of FACILITIES) {
      const specs = paramSpecsFor(f);
      expect(specs.filter((s) => s.origin === "organizer"), f).toHaveLength(expected[f]);
      expect(specs.filter((s) => s.origin !== "organizer"), f).toHaveLength(PARAM_EXTRAS[f].length);
    }
    expect(PARAM_SPECS).toHaveLength(42 + 39 + 57 + FACILITIES.reduce((n, f) => n + PARAM_EXTRAS[f].length, 0));
  });

  it("ключи уникальны в пределах типа объекта, порядок показа — 1…N", () => {
    for (const f of FACILITIES) {
      const specs = paramSpecsFor(f);
      expect(new Set(specs.map((s) => s.key)).size, f).toBe(specs.length);
      expect(specs.map((s) => s.order)).toEqual(specs.map((_, i) => i + 1));
    }
    expect(paramSpecsFor("hospitality")).toEqual([]);
  });

  it("правила провенанса: organizer → строка датасета, оценка и вывод → обоснование ≥ 40 символов", () => {
    for (const s of PARAM_SPECS) {
      const where = `${s.facility}.${s.key}`;
      if (s.origin === "organizer") {
        expect(s.sourceRef, where).toMatch(/^Датасеты_хакатон\.xlsx › (Склад|Аэропорт|Медучреждение) › стр\. \d+$/);
        if (s.formula) expect(s.basis?.trim(), where).toBeTruthy();
      } else {
        expect(["estimate", "derived"], where).toContain(s.origin);
        expect((s.basis ?? "").length, where).toBeGreaterThanOrEqual(40);
        if (s.origin === "derived") expect(s.formula?.trim(), where).toBeTruthy();
      }
      expect(s.hint.trim(), where).toBeTruthy();
      expect(s.example, where).toMatch(/^например, /);
    }
  });

  it("базовые значения лежат в диапазоне организатора, у перечислений — среди вариантов", () => {
    for (const s of PARAM_SPECS) {
      const where = `${s.facility}.${s.key}`;
      if (typeof s.base === "number") {
        if (s.min !== null) expect(s.base, where).toBeGreaterThanOrEqual(s.min);
        if (s.max !== null) expect(s.base, where).toBeLessThanOrEqual(s.max);
        if (s.kind === "integer") expect(Number.isInteger(s.base), where).toBe(true);
      }
      if (s.kind === "enum") expect(s.options, where).toContain(s.base);
      if (s.min !== null && s.max !== null) expect(s.min, where).toBeLessThanOrEqual(s.max);
    }
  });

  it("базовые значения склада совпадают с датасетом организатора", () => {
    const w = baseValuesFor("warehouse");
    expect(w).toMatchObject({
      totalAreaM2: 20000,
      activeAreaM2: 10000,
      inboundPalletsPerDay: 1000,
      outboundPalletsPerDay: 1000,
      pickLinesPerDay: 100000,
      totalStaff: 180,
      pickersCount: 100,
      forkliftOperatorsCount: 25,
      pickerSalaryRubMonth: 100000,
      forkliftSalaryRubMonth: 120000,
      payrollTaxMultiplier: 1.302,
      shiftsPerDay: 2,
      shiftDurationH: 11,
      workDaysPerYear: 365,
      peakFactor: 1.5,
      horizonYears: 5,
      capexBudgetMRub: 80,
      avgPalletMassKg: 800,
      nonStandardCargoPct: 5,
      rackAisleWidthM: 2.8,
      hasWms: "Да",
      internalPalletMovesPerDay: 0,
      storageTempRegime: "Нормальный (+5…+25 °C)",
      maxStorageLevelM: 9,
    });
  });

  it("значения, зафиксированные организатором (min = max), заблокированы", () => {
    const locked = PARAM_SPECS.filter((s) => s.locked).map((s) => `${s.facility}.${s.key}`);
    expect(locked).toEqual(
      expect.arrayContaining([
        "warehouse.workDaysPerYear",
        "warehouse.payrollTaxMultiplier",
        "warehouse.hasWms",
        "airport.payrollTaxMultiplier",
        "airport.hasFidsAodb",
        "medical.payrollTaxMultiplier",
      ]),
    );
    expect(paramSpecsFor("warehouse").find((s) => s.key === "peakFactor")?.locked).toBe(false);
  });

  it("каждый параметр, на который ссылаются процессы (PROCESS_DEFS), есть у своего типа объекта", () => {
    const missing: string[] = [];
    for (const p of PROCESS_DEFS) {
      const refs = [
        ...(p.demand?.sumParams ?? []),
        p.demand?.shareParam,
        p.demand?.excludeShareParam,
        ...(p.demand?.multiplierParams ?? []),
        p.peakFactorParam,
        p.headcountParam,
        p.salaryParam,
        ...Object.values(p.constraints),
      ].filter((k): k is string => typeof k === "string");
      for (const f of p.facilityTypes) {
        const keys = new Set(paramSpecsFor(f).map((s) => s.key));
        for (const k of refs) if (!keys.has(k)) missing.push(`${p.slug} → ${f}.${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("параметр в процессе расчёта используется: у ключей процессов заполнен usedBy", () => {
    const pallet = paramSpecsFor("warehouse");
    const byKey = (k: string): ParamSpec | undefined => pallet.find((s) => s.key === k);
    expect(byKey("inboundPalletsPerDay")?.usedBy).toContain("fleet");
    expect(byKey("forkliftSalaryRubMonth")?.usedBy).toContain("labour");
    expect(byKey("avgPalletMassKg")?.usedBy).toContain("constraints");
  });
});

describe("Версия данных организатора", () => {
  it("дата выгрузки и хэш оригиналов, момент заморозки исследования в ISO", () => {
    expect(ORGANIZER_DATA_VERSION.datasets).toBe("2026-09-22#4be0fac8");
    expect(ORGANIZER_DATA_VERSION.catalog).toBe("2026-09-22#da43c64c");
    expect(ORGANIZER_DATA_VERSION.examples).toBe("2026-09-22#6e738822");
    expect(ORGANIZER_DATA_VERSION.research).toMatch(
      /^svod 2026-09-23 \+ found_batch1-6@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  });
});
