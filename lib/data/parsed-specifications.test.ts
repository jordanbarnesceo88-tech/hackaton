import { describe, expect, it } from "vitest";
import base from "./organizer/catalog.generated.json";
import generated from "./parsed-specifications.generated.json";
import audit from "./parsed-specifications.audit.generated.json";
import { buildParsedSpecifications, withParsedSpecifications, type SpecificationDocument, type SpecificationRow } from "./parsed-specifications";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { sourcedToCharRow } from "../catalog/product-for-calc";
import { hasConflictingAlternatives } from "../catalog/promote";
import { validateProductSeeds } from "../api/import";
import type { CharValue, ProductSeed, Sourced } from "../tz/types";

const products = base as unknown as ProductSeed[];
const document: SpecificationDocument = { found: audit.decisions.map(item => item.raw) as SpecificationRow[], notConfirmed: [[], ...audit.excludedBySource], discrepancies: [[], ...audit.sourceDiscrepancies] };
const numeric = (value: CharValue) => typeof value === "number" || (typeof value === "object" && !Array.isArray(value));
function fixture(row: number, value: string, key = "payloadKg", unit = "кг"): SpecificationRow {
  return { row, slug: "fixture-model", "Ключ": key, "Значение": value, "Единица": unit, "Ссылка": "https://manufacturer.example/fixture-model", "Цитата из источника": `Specification: ${value} ${unit}`, "Тип источника": "Сайт производителя", "Уверенность": "высокая", "Проверка": "цитата найдена на странице", "Сверка числа": "число есть в цитате", "Проход": 1, "Примечание": "" };
}
const product = (): ProductSeed => ({ ...structuredClone(products[0]!), slug: "fixture-model", level: "identification", characteristics: {}, flags: [], organizerCatalogId: "identity-must-survive" });
const build = (rows: SpecificationRow[], source = product()) => buildParsedSpecifications([source], { found: rows, notConfirmed: [[]] }, "a".repeat(64));

describe("saved v2 specification import", () => {
  it("recomputes derived confirmation and date from the overlaid fields, without rewriting source facts", () => {
    for (const product of products) {
      const overlaid = withParsedSpecifications(product);
      const baseRows = Object.entries(overlaid.characteristics).filter(([key]) => !["primarySourceUrl", "verifiedAt", "confirmation"].includes(key)).map(([key, source]) => sourcedToCharRow(key, source));
      const present = baseRows.filter(row => row.valueNum !== null || row.valueMin !== null || row.valueMax !== null || Boolean(row.valueText?.trim()) || row.valueList.some(item => item.trim()));
      const confirmation = overlaid.characteristics.confirmation;
      if (confirmation?.origin === "derived") {
        expect(String(confirmation.value), product.slug).toMatch(new RegExp(`^${present.filter(row => row.confirmed).length} из ${present.length} подтверждены(?:;|$)`));
      }
      const latest = Object.entries(overlaid.characteristics).filter(([key]) => !["primarySourceUrl", "verifiedAt", "confirmation"].includes(key)).map(([, source]) => source.date).sort().at(-1);
      if (overlaid.characteristics.verifiedAt?.origin === "derived") expect(overlaid.characteristics.verifiedAt.value, product.slug).toBe(latest);
      const patch = (generated.patches as Record<string, { characteristics: Record<string, unknown> }>)[product.slug];
      for (const [key, source] of Object.entries(product.characteristics)) {
        if (!["confirmation", "verifiedAt"].includes(key) && !patch?.characteristics[key]) expect(overlaid.characteristics[key]).toEqual(source);
      }
    }
  });
  it("accounts for all 2860 findings, 31 source exclusions and original product identities without truncating evidence", () => {
    expect(audit.decisions).toHaveLength(2860);
    expect(new Set(audit.decisions.map(item => item.row)).size).toBe(2860);
    expect(audit.excludedBySource).toHaveLength(31);
    expect(new Set(audit.decisions.map(item => item.slug)).size).toBe(185);
    expect(generated.summary.primary + generated.summary.alternative + generated.summary.reference + generated.summary.rejected).toBe(2860);
    for (const p of products) {
      const overlaid = withParsedSpecifications(p);
      expect(overlaid.slug).toBe(p.slug); expect(overlaid.organizerCatalogId).toBe(p.organizerCatalogId);
      expect(overlaid.organizerRows).toEqual(p.organizerRows); expect(overlaid.flags).toEqual(p.flags);
      expect(overlaid.processes).toEqual(p.processes); expect(overlaid.facilityTypes).toEqual(p.facilityTypes);
    }
    expect(audit.decisions.every(item => item.raw["Цитата из источника"] && item.raw["Проверка"] && item.raw["Проход"])).toBe(true);
  });

  it("reproduces every generated patch, disposition and financial delta from the retained saved rows", () => {
    const rebuilt = buildParsedSpecifications(products, document, audit.sourceSha256);
    expect(rebuilt.runtime).toEqual(generated);
    expect(rebuilt.audit.decisions).toEqual(audit.decisions);
    expect(rebuilt.audit.deltas).toEqual(audit.deltas);
  });

  it("never changes an established organizer scalar merely because the new source disagrees", () => {
    const original = product();
    original.characteristics.payloadKg = { value: 10, origin: "organizer", sourceType: "organizer:catalog", sourceRef: "organizer row", sourceUrl: null, date: "2026-09-22", confirmed: false };
    const result = build([fixture(4000, "20")], original), item = result.runtime.patches[original.slug]!.characteristics.payloadKg!;
    expect(item.value).toBe(10); expect(item.alternatives?.[0]?.value).toBe(20);
    expect(result.audit.deltas).toEqual([]); expect(result.audit.decisions[0]?.disposition).toBe("alternative");
    expect(original.characteristics.payloadKg.alternatives).toBeUndefined();
  });

  it("does not choose a winner for a previously absent scalar when source values disagree", () => {
    const result = build([fixture(4000, "10"), fixture(4001, "20")]);
    const item = result.runtime.patches["fixture-model"]!.characteristics.payloadKg!;
    expect(numeric(item.value)).toBe(false); expect(item.confirmed).toBe(false);
    expect(item.alternatives?.map(alt => alt.value)).toEqual([10, 20]);
    expect(result.audit.decisions.every(row => row.disposition === "alternative")).toBe(true);
    expect(result.audit.deltas).toEqual([]);
  });

  it("keeps the author's eligible primary-source verification without claiming a fresh importer live check", () => {
    const checked = build([fixture(4000, "123")]).runtime.patches["fixture-model"]!.characteristics.payloadKg!;
    expect(checked.value).toBe(123); expect(checked.confirmed).toBe(true);
    expect(checked.sourceRef).toContain("проверка автора таблицы"); expect(checked.sourceRef).toContain("4000"); expect(checked.sourceRef).toContain("сбор 17–20");
    const dealer = fixture(4001, "123"); dealer["Тип источника"] = "Дилер, интегратор";
    expect(build([dealer]).runtime.patches["fixture-model"]!.characteristics.payloadKg!.confirmed).toBe(false);
    const unavailable = fixture(4002, "123"); unavailable["Проверка"] = "проверено вручную: страница недоступна; фраза на другом сайте";
    expect(build([unavailable]).runtime.patches["fixture-model"]!.characteristics.payloadKg!.confirmed).toBe(false);
  });

  it("does not mistake cycle resource, mains duty, other models or component life for a financial scalar", () => {
    const guarded = [99,130,156,460,1878,1904,1929,2462,182,201,1994,1560,2229,922,923,924,1911,500,505,511,521,901,902,956,1309,2713,2793,2794,454,1160,1162,2816,2826,2818,2828,1460,2688,1876,1902,2594,456,490,516,525,543,564,2723,2726,464,1930,1996,1968,2149,2430,2834,1580,1940,2823];
    for (const row of guarded) {
      const decision = audit.decisions.find(item => item.row === row)!;
      expect(decision, `row ${row} must be retained`).toBeDefined();
      expect(decision.numeric, `row ${row}: ${decision.reason}`).toBe(false);
      expect(decision.disposition, `row ${row}`).not.toBe("primary");
    }
    const h = withParsedSpecifications(products.find(p => p.slug === "ronavi-h1500")!);
    expect(h.characteristics.batteryReplacementYears?.value).not.toBe(2000);
  });

  it("keeps foreign currency, unasserted range midpoint and case throughput as visible references, never zero or converted money", () => {
    const rows = [fixture(4000, "10000", "priceOther", "USD"), fixture(4001, "10–20", "autonomyH", "ч"), fixture(4002, "3000", "throughput", "м²/сутки")];
    const result = build(rows), chars = result.runtime.patches["fixture-model"]!.characteristics;
    for (const item of Object.values(chars)) expect(numeric(item.value)).toBe(false);
    expect(result.audit.decisions.map(item => item.reason)).toEqual(["foreign-currency-not-converted", "range-has-no-asserted-typical-value", "throughput-basis-not-comparable-per-hour"]);
    expect(result.audit.deltas).toEqual([]);
  });

  it("quarantines the complete reviewed quantity and variant groups without losing source rows", () => {
    const reasons = new Set(["scaled-speed-not-travel-speed", "training-already-in-hardware-package", "whole-complex-mass-not-robot-mass",
      "shaft-height-not-robot-load-lift", "maximum-takeoff-mass-not-own-mass", "repeatability-not-absolute-positioning",
      "optional-ranging-depth-error-not-planar-positioning", "base-chassis-climate-not-autonomous-system", "family-platform-not-explicit-mark-a",
      "rozum-cafe-not-confirmed-r-cafe-1-3", "kingpro-archived-platform-not-facade-configuration", "gorodovoy-chassis-not-established",
      "aidol-walking-desktop-unspecified-variant", "ronavi-family-offer-model-rcm-not-identified", "mass-basis-not-stated",
      "legat-vs-legat-patrol-equivalence-not-established", "robocv-x-motion-ng-not-confirmed-stacker"]);
    const reviewed = audit.decisions.filter(decision => reasons.has(decision.reason));
    expect(reviewed).toHaveLength(131);
    expect(new Set(reviewed.map(decision => decision.reason)).size).toBe(17);
    for (const decision of reviewed) {
      expect(decision.numeric, `source row ${decision.row}`).toBe(false);
      expect(decision.disposition, `source row ${decision.row}`).toBe("reference");
      const value = generated.patches[decision.slug as keyof typeof generated.patches].characteristics[decision.targetKey as never] as Sourced<CharValue> | undefined;
      const evidence = [value, ...(value?.alternatives ?? [])].filter(item => item?.sourceRef?.includes(`Найдено!${decision.row};`));
      expect(evidence.length, `retained source row ${decision.row}`).toBeGreaterThan(0);
      for (const item of evidence) expect(item?.confirmed).toBe(false);
    }
    for (const row of [219, 1124, 2254]) expect(audit.decisions.find(decision => decision.row === row)?.reason).not.toBe("maximum-takeoff-mass-not-own-mass");
  });

  it("promotes enriched from actual substantive field-level sourcing, without pretending financial readiness", () => {
    const rows = [fixture(4000,"100"),fixture(4001,"1.5","speedMps","м/с"),fixture(4002,"SLAM","navigation",""),fixture(4003,"Wi-Fi","connectivity",""),fixture(4004,"API","integration","")];
    const result = build(rows), patch = result.runtime.patches["fixture-model"]!;
    expect(patch.level).toBe("enriched");
    const enriched = { ...product(), ...patch };
    const calc = productForCalcFromSeed(enriched);
    expect(calc.priceRub).toBeNull(); expect(calc.throughputPerH).toBeNull();
    expect(build([fixture(4000,"Россия","countryOfOrigin","")]).runtime.patches["fixture-model"]?.level).toBeUndefined();
    expect(build([fixture(4000,"100")]).runtime.patches["fixture-model"]?.level).toBe("enriched");
  });

  it("selects the strongest source only within the same fact, independently of saved row order", () => {
    const dealer = fixture(4000,"Россия","countryOfOrigin",""); dealer["Тип источника"] = "Дилер, интегратор";
    const manufacturer = fixture(4001,"Россия","countryOfOrigin","");
    const before = build([dealer,manufacturer]), reversed = build([manufacturer,dealer]);
    expect(before.runtime.patches["fixture-model"]!.characteristics.countryOfOrigin!.sourceRef).toContain("4001");
    expect(reversed.runtime.patches["fixture-model"]!.characteristics.countryOfOrigin!.sourceRef).toContain("4001");
    expect(before.runtime.patches["fixture-model"]!.characteristics.countryOfOrigin!.confirmed).toBe(true);
    expect(before.runtime.patches["fixture-model"]!.characteristics.countryOfOrigin!.alternatives).toHaveLength(1);
  });

  it("makes all 122 exact source discrepancy records visible even when the alternative is a non-numeric reference", () => {
    expect(audit.sourceDiscrepancies).toHaveLength(122);
    for (const discrepancy of audit.sourceDiscrepancies) {
      const decision = audit.decisions.find(item => item.raw["Продукт"] === discrepancy[0] && item.raw["Характеристика"] === discrepancy[1] && item.raw["Значение"] === discrepancy[4] && item.raw["Ссылка"] === discrepancy[8])!;
      const chars = withParsedSpecifications(products.find(p => p.slug === decision.slug)!).characteristics;
      expect(hasConflictingAlternatives(sourcedToCharRow(decision.targetKey, chars[decision.targetKey]!)), `source row ${decision.row}`).toBe(true);
    }
  });

  it("rejects duplicate row identity and reports unmatched slug instead of inventing another product", () => {
    expect(() => build([fixture(4000,"1"),fixture(4000,"2")])).toThrow("duplicate");
    const row = fixture(4000,"1"); row.slug = "unknown-model";
    const result = build([row]);
    expect(result.runtime.patches).toEqual({}); expect(result.audit.decisions[0]?.reason).toBe("unknown-product-slug");
  });

  it("writes no unknown Sourced properties and provides the full provenance for every imported primary and alternative", () => {
    const allowed = new Set(["value","unit","origin","sourceType","sourceUrl","sourceRef","date","confirmed","confidence","asInSource","basis","scope","granularity","alternatives","formula","conflict"]);
    const values: Sourced<CharValue>[] = Object.values(generated.patches).flatMap(p => Object.values(p.characteristics) as Sourced<CharValue>[]);
    for (const item of values.flatMap(item => [item, ...(item.alternatives ?? [])])) {
      expect(Object.keys(item).filter(key => !allowed.has(key))).toEqual([]);
      if (item.sourceRef?.startsWith("Импорт исследования 20.10.2026")) {
        expect(item.sourceUrl).toMatch(/^https?:\/\//); expect(item.asInSource).toBeTruthy(); expect(item.basis).toBeTruthy();
        if (item.confirmed) expect(["manufacturer","manufacturer-doc"]).toContain(item.sourceType);
      }
    }
  });

  it("keeps all overlaid seeds compatible with the real import boundary without truncating long source cells", () => {
    // The API reserves organizer identities for sync; use throwaway identities to test the same characteristic contract.
    const checked = validateProductSeeds(products.map(p => ({ ...withParsedSpecifications(p), slug: `import-check-${p.slug}`, organizerCatalogId: null, organizerRows: [] })));
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    expect(checked.seeds).toHaveLength(products.length);
    const long = document.found.find(row => row["Ключ"] === "applicability" && String(row["Значение"]).length > 300)!;
    const item = withParsedSpecifications(products.find(p => p.slug === long.slug)!).characteristics.applicability!;
    expect(JSON.stringify([item.value, ...(item.alternatives ?? []).map(alt => alt.value)])).toContain(String(long["Значение"]));
  });
});
