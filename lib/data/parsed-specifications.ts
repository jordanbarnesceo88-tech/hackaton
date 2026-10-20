import generated from "./parsed-specifications.generated.json";
import { CHARACTERISTIC_KEYS } from "../tz/characteristics";
import { parseNumericText } from "./organizer/parse";
import { stableJson } from "../tz/version";
import type { CharValue, ProductSeed, Range, SourceType, Sourced } from "../tz/types";

export const PARSED_SPECIFICATIONS_POLICY = "parsed-specifications-2";
export const PARSED_SPECIFICATIONS_VERSION = generated.version;
export const PARSED_SPECIFICATIONS_SUMMARY = generated.summary;
const SOURCE_REF = "Импорт исследования 20.10.2026, v2; сбор 17–20.10.2026; проверка автора таблицы";
const DATE = "2026-10-20";
export type SpecificationRow = Record<string, unknown> & { row: number; slug: string; "Ключ": string };
export type SpecificationDocument = { found: SpecificationRow[]; notConfirmed: unknown[][]; discrepancies?: unknown[][] };
type Evidence = Omit<Sourced<CharValue>, "alternatives">;
type Disposition = "primary" | "alternative" | "reference" | "rejected";
export type SpecificationDecision = { row: number; slug: string; key: string; targetKey: string; disposition: Disposition; reason: string; numeric: boolean };
type Patch = { characteristics: Record<string, Sourced<CharValue>>; level?: "enriched" };

const SOURCE_TYPES: Record<string, SourceType> = {
  "Сайт производителя": "manufacturer", "Документ производителя (PDF)": "manufacturer-doc",
  "Дилер, интегратор": "dealer", "Пресса, новости": "press", "Каталог, маркетплейс": "aggregator",
  "Госреестр (ГИСП и др.)": "aggregator", "Госзакупка": "aggregator",
};
// These rows explicitly describe another model, component, tariff basis or physical quantity.
// Keep the original finding in the audit, never turn its digits into a canonical model input.
const REVIEWED_SCOPE_REFERENCES: Record<number, string> = {
  2787: "scaled-speed-not-travel-speed",
  1164: "training-already-in-hardware-package",
  2341: "whole-complex-mass-not-robot-mass",
  1990: "shaft-height-not-robot-load-lift",
  5: "maximum-takeoff-mass-not-own-mass",
  38: "maximum-takeoff-mass-not-own-mass",
  39: "maximum-takeoff-mass-not-own-mass",
  62: "maximum-takeoff-mass-not-own-mass",
  81: "maximum-takeoff-mass-not-own-mass",
  112: "maximum-takeoff-mass-not-own-mass",
  151: "maximum-takeoff-mass-not-own-mass",
  165: "maximum-takeoff-mass-not-own-mass",
  166: "maximum-takeoff-mass-not-own-mass",
  189: "maximum-takeoff-mass-not-own-mass",
  973: "maximum-takeoff-mass-not-own-mass",
  993: "maximum-takeoff-mass-not-own-mass",
  1104: "maximum-takeoff-mass-not-own-mass",
  1142: "maximum-takeoff-mass-not-own-mass",
  1178: "maximum-takeoff-mass-not-own-mass",
  1179: "maximum-takeoff-mass-not-own-mass",
  1180: "maximum-takeoff-mass-not-own-mass",
  1205: "maximum-takeoff-mass-not-own-mass",
  1229: "maximum-takeoff-mass-not-own-mass",
  1230: "maximum-takeoff-mass-not-own-mass",
  1361: "maximum-takeoff-mass-not-own-mass",
  1377: "maximum-takeoff-mass-not-own-mass",
  1388: "maximum-takeoff-mass-not-own-mass",
  1533: "maximum-takeoff-mass-not-own-mass",
  1653: "maximum-takeoff-mass-not-own-mass",
  1669: "maximum-takeoff-mass-not-own-mass",
  1832: "maximum-takeoff-mass-not-own-mass",
  1851: "maximum-takeoff-mass-not-own-mass",
  1852: "maximum-takeoff-mass-not-own-mass",
  1926: "maximum-takeoff-mass-not-own-mass",
  2288: "maximum-takeoff-mass-not-own-mass",
  2300: "maximum-takeoff-mass-not-own-mass",
  2301: "maximum-takeoff-mass-not-own-mass",
  2608: "maximum-takeoff-mass-not-own-mass",
  2609: "maximum-takeoff-mass-not-own-mass",
  2704: "maximum-takeoff-mass-not-own-mass",
  247: "repeatability-not-absolute-positioning",
  789: "repeatability-not-absolute-positioning",
  790: "repeatability-not-absolute-positioning",
  799: "repeatability-not-absolute-positioning",
  808: "repeatability-not-absolute-positioning",
  817: "repeatability-not-absolute-positioning",
  825: "repeatability-not-absolute-positioning",
  842: "repeatability-not-absolute-positioning",
  843: "repeatability-not-absolute-positioning",
  851: "repeatability-not-absolute-positioning",
  864: "repeatability-not-absolute-positioning",
  865: "repeatability-not-absolute-positioning",
  905: "repeatability-not-absolute-positioning",
  1781: "repeatability-not-absolute-positioning",
  2436: "repeatability-not-absolute-positioning",
  640: "optional-ranging-depth-error-not-planar-positioning",
  675: "optional-ranging-depth-error-not-planar-positioning",
  697: "optional-ranging-depth-error-not-planar-positioning",
  1932: "base-chassis-climate-not-autonomous-system",
  2353: "family-platform-not-explicit-mark-a",
  2354: "family-platform-not-explicit-mark-a",
  2355: "family-platform-not-explicit-mark-a",
  2356: "family-platform-not-explicit-mark-a",
  2357: "family-platform-not-explicit-mark-a",
  2358: "family-platform-not-explicit-mark-a",
  2359: "family-platform-not-explicit-mark-a",
  2360: "family-platform-not-explicit-mark-a",
  2361: "family-platform-not-explicit-mark-a",
  2362: "family-platform-not-explicit-mark-a",
  2363: "family-platform-not-explicit-mark-a",
  2364: "family-platform-not-explicit-mark-a",
  1767: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1768: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1769: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1770: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1771: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1772: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1773: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1774: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1775: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1776: "rozum-cafe-not-confirmed-r-cafe-1-3",
  1604: "kingpro-archived-platform-not-facade-configuration",
  1605: "kingpro-archived-platform-not-facade-configuration",
  1606: "kingpro-archived-platform-not-facade-configuration",
  1607: "kingpro-archived-platform-not-facade-configuration",
  1608: "kingpro-archived-platform-not-facade-configuration",
  1609: "kingpro-archived-platform-not-facade-configuration",
  1610: "kingpro-archived-platform-not-facade-configuration",
  1611: "kingpro-archived-platform-not-facade-configuration",
  1612: "kingpro-archived-platform-not-facade-configuration",
  1687: "gorodovoy-chassis-not-established",
  1688: "gorodovoy-chassis-not-established",
  1689: "gorodovoy-chassis-not-established",
  1690: "gorodovoy-chassis-not-established",
  1691: "gorodovoy-chassis-not-established",
  1692: "gorodovoy-chassis-not-established",
  1693: "gorodovoy-chassis-not-established",
  1694: "gorodovoy-chassis-not-established",
  1695: "gorodovoy-chassis-not-established",
  1696: "gorodovoy-chassis-not-established",
  1698: "gorodovoy-chassis-not-established",
  1699: "gorodovoy-chassis-not-established",
  1700: "gorodovoy-chassis-not-established",
  1702: "gorodovoy-chassis-not-established",
  2039: "aidol-walking-desktop-unspecified-variant",
  2040: "aidol-walking-desktop-unspecified-variant",
  2041: "aidol-walking-desktop-unspecified-variant",
  2042: "aidol-walking-desktop-unspecified-variant",
  2043: "aidol-walking-desktop-unspecified-variant",
  2044: "aidol-walking-desktop-unspecified-variant",
  2045: "aidol-walking-desktop-unspecified-variant",
  2047: "aidol-walking-desktop-unspecified-variant",
  2048: "aidol-walking-desktop-unspecified-variant",
  2049: "aidol-walking-desktop-unspecified-variant",
  524: "ronavi-family-offer-model-rcm-not-identified",
  525: "ronavi-family-offer-model-rcm-not-identified",
  526: "ronavi-family-offer-model-rcm-not-identified",
  527: "ronavi-family-offer-model-rcm-not-identified",
  528: "ronavi-family-offer-model-rcm-not-identified",
  1204: "mass-basis-not-stated",
  776: "legat-vs-legat-patrol-equivalence-not-established",
  777: "legat-vs-legat-patrol-equivalence-not-established",
  778: "legat-vs-legat-patrol-equivalence-not-established",
  779: "legat-vs-legat-patrol-equivalence-not-established",
  780: "legat-vs-legat-patrol-equivalence-not-established",
  781: "legat-vs-legat-patrol-equivalence-not-established",
  782: "legat-vs-legat-patrol-equivalence-not-established",
  783: "legat-vs-legat-patrol-equivalence-not-established",
  1792: "robocv-x-motion-ng-not-confirmed-stacker",
  1793: "robocv-x-motion-ng-not-confirmed-stacker",
  1794: "robocv-x-motion-ng-not-confirmed-stacker",
};
const SEMANTIC_REFERENCES: Record<number, string> = {
  ...REVIEWED_SCOPE_REFERENCES,
  182: "battery-life-calendar-or-hours", 201: "battery-life-calendar-or-hours",
  464: "historical-press-life-claim", 521: "battery-life-estimate-not-specification",
  956: "model-not-identified",
  1160: "incomplete-hardware-package", 1309: "other-model-payload",
  1460: "service-includes-operator-payroll", 1911: "hitch-lift-not-transport-payload",
  1930: "component-life-not-robot-life", 1968: "overhaul-not-service-life",
  1994: "working-station-not-charger", 1996: "structure-life-not-robot-life",
  2018: "advertising-battery-life-exceeds-device-life", 2149: "service-contract-not-service-life",
  2229: "site-supply-not-charger-output", 2430: "financial-horizon-not-service-life",
  2593: "expired-conditional-software-offer", 2818: "additional-person-not-base-training",
  2828: "additional-person-not-base-training", 2834: "mains-duty-not-battery-autonomy",
  922: "mast-height-not-load-lift", 923: "mast-height-not-load-lift",
  924: "mast-height-not-load-lift", 1580: "flight-altitude-not-load-lift",
  1940: "printing-height-not-load-lift", 1560: "charging-space-not-charger-sharing",
  500: "other-model-or-variant", 901: "other-model-or-variant", 902: "other-model-or-variant",
  2713: "other-model-or-variant", 1162: "hardware-configuration-requires-matched-quote",
  2816: "hardware-configuration-requires-matched-quote", 2826: "hardware-configuration-requires-matched-quote",
  2688: "service-materials-not-complete-maintenance", 1876: "raas-first-month-needs-explicit-package",
  1902: "raas-first-month-needs-explicit-package", 2594: "conditional-multi-robot-rental-offer",
  2823: "maintenance-first-year-already-included",
};
const WRONG_MODEL_ROWS = new Set([2793, 2794]);
const FINANCIAL_KEYS = new Set(["priceRub", "serviceRubYear", "softwareRubOneTime", "softwareRubYear", "implementationRub", "trainingRub", "batteryCostRub", "batteryReplacementYears", "serviceLifeYears", "raasRubMonth", "consumablesRubYear", "speedMps", "autonomyH", "chargeMin", "throughput", "payloadKg", "minAisleM", "turnAisleM", "liftHeightMm", "robotsPerStation", "chargerPowerKw"]);
const LIST_KEYS = new Set(["navigation", "connectivity", "integration", "acquisitionModels", "applicability"]);
const text = (row: SpecificationRow, key: string) => String(row[key] ?? "").trim();
const numeric = (value: CharValue): value is number | Range => typeof value === "number" || (typeof value === "object" && !Array.isArray(value));
function withoutAlternatives(value: Sourced<CharValue>): Evidence {
  const copy = { ...value }; delete copy.alternatives; return copy;
}

function numericValue(row: SpecificationRow, key: string): { value: CharValue; unit?: string; reason?: string } {
  const raw = text(row, "Значение"), notes = text(row, "Примечание"), unit = text(row, "Единица");
  const reference = (reason: string) => ({ value: raw, reason, ...(unit ? { unit } : {}) });
  if (SEMANTIC_REFERENCES[row.row]) return reference(SEMANTIC_REFERENCES[row.row]!);
  if (key === "priceRub" && text(row, "Ключ") === "priceOther") return reference("foreign-currency-not-converted");
  const def = CHARACTERISTIC_KEYS[key as keyof typeof CHARACTERISTIC_KEYS];
  if (!def || (def.kind !== "num" && def.kind !== "range")) {
    if (LIST_KEYS.has(key)) return { value: raw.length <= 300 ? [raw] : raw };
    if (key === "countryOfOrigin" && /^Россия(?:\s|$|[,(])/i.test(raw)) return { value: "Россия" };
    return { value: raw };
  }
  if (text(row, "Уверенность") === "низкая") return reference("low-confidence-numeric-reference");
  if (key === "batteryReplacementYears" && /срок.*год.*не указан|ресурс.*цикл|циклов.*(?:до|заряд)/i.test(`${raw} ${notes}`)) return reference("battery-cycles-are-not-years");
  if (key === "autonomyH" && /от сети|без АКБ|не от АКБ|по кабель|не.*аккумулятор/i.test(`${raw} ${notes}`)) return reference("mains-duty-not-battery-autonomy");
  if (/модель.*не (?:найден|указан|идентифиц)|не привязан.*модел|без указания модели|не для одной модели/i.test(notes)) return reference("model-scope-not-established");
  if (key === "throughput") {
    if (!/^(?:м²|паллет|палет|коробов|шт\.?|циклов|ячеек|палето-мест)\/ч$/.test(unit)) return reference("throughput-basis-not-comparable-per-hour");
    if (/кейс|внедрен|парк|двух|комплектац|станци|систем[аые]|не строго|не уточнен|не уточнён/i.test(`${raw} ${notes}`)) return reference("throughput-system-or-case-not-per-robot");
  } else if (unit !== def.unit) return reference("unit-not-canonical");
  if (key === "priceRub" && /от 100|при покупке|инвестици.*проект|без аккумулятор|без батаре|не включает|не входят/i.test(`${raw} ${notes}`)) return reference("conditional-or-project-price");
  if (/^(?:service|software|implementation|training|batteryCost|raas)/.test(key) && /%|для линейки аренды|за установку|на 5 робот|на группу|за проект|на объекте|дополнительн|не (?:назван|указан)|сумма не|входит в базовый/i.test(`${raw} ${notes}`)) return reference("cost-basis-requires-explicit-package");
  const value = parseNumericText(raw);
  if (value === null) return reference("not-an-unambiguous-numeric-value");
  if (typeof value !== "number" && value.min !== undefined && value.max !== undefined && value.min !== value.max) return reference("range-has-no-asserted-typical-value");
  if (typeof value === "number" && value < 0 && key !== "tempMinC" && key !== "tempMaxC") return reference("negative-non-temperature-value");
  // A hidden "price from" qualifier must survive parenthetical notes removed by the shared parser.
  if (typeof value === "number" && key === "priceRub" && /цена.*«от»|цена.*"от"/i.test(`${raw} ${notes}`)) return { value: { min: value, typical: value, qualifier: "от" }, unit };
  return { value, ...(unit ? { unit } : {}) };
}

function evidenceFor(row: SpecificationRow, key: string): { evidence: Evidence; reason?: string } {
  const parsed = numericValue(row, key), check = text(row, "Проверка"), sourceType = SOURCE_TYPES[text(row, "Тип источника")]!;
  const normalized = { value: parsed.value, ...(parsed.unit ? { unit: parsed.unit } : {}) };
  const confidence = ({ высокая: "high", средняя: "medium", низкая: "low" } as const)[text(row, "Уверенность") as "высокая" | "средняя" | "низкая"] ?? "low";
  const verified = /^(?:цитата найдена|числа найдены|проверено вручную)/i.test(check) && !/недоступна|закрыта|другого адреса|других источниках|та же фраза/i.test(check);
  const confirmed = !parsed.reason && confidence !== "low" && ["manufacturer", "manufacturer-doc"].includes(sourceType) && verified;
  return { reason: parsed.reason, evidence: {
    ...normalized, origin: "research", sourceType, sourceUrl: text(row, "Ссылка"),
    sourceRef: `${SOURCE_REF}; Найдено!${row.row}; проход ${String(row["Проход"] ?? "?")}`,
    date: DATE, confirmed, confidence, asInSource: text(row, "Цитата из источника"), granularity: "field",
    basis: `Классификация автора: ${text(row, "Тип источника")}; ${check}; ${text(row, "Сверка числа")}; ${text(row, "Примечание")}${parsed.reason ? `; Только справочно: ${parsed.reason}` : ""}`.replace(/; ;/g, ";").trim(),
    ...(key === "throughput" && numeric(parsed.value) ? { scope: "per-robot" as const } : {}),
  } };
}

function equivalent(a: Evidence, b: Evidence) { return stableJson([a.value, a.unit ?? null, a.scope ?? null]) === stableJson([b.value, b.unit ?? null, b.scope ?? null]); }
const SOURCE_PRIORITY: Partial<Record<SourceType, number>> = { "manufacturer-doc": 0, manufacturer: 1, "contract-reference": 2, dealer: 3, aggregator: 4, press: 5 };
function sourcePriority(a: Evidence, b: Evidence) {
  return Number(b.confirmed) - Number(a.confirmed) || (SOURCE_PRIORITY[a.sourceType] ?? 9) - (SOURCE_PRIORITY[b.sourceType] ?? 9)
    || a.sourceRef!.localeCompare(b.sourceRef!);
}
function conflicting(a: Evidence, b: Evidence) {
  if (!numeric(a.value) || !numeric(b.value)) return false;
  const av = typeof a.value === "number" ? a.value : a.value.typical;
  const bv = typeof b.value === "number" ? b.value : b.value.typical;
  return (a.unit && b.unit && a.unit !== b.unit) || Math.abs(av - bv) > Math.abs(av) * .1 + 1e-9;
}
function missing(value: Sourced<CharValue> | undefined) {
  return !value || ["estimate", "choice", "derived"].includes(value.origin) || (typeof value.value === "string" && /^(?:не (?:указ|публик)|нет данных|по запросу|—|n\/a)/i.test(value.value));
}

/** Rebuilds the complete overlay and per-row audit without network access or database writes. */
export function buildParsedSpecifications(catalog: readonly ProductSeed[], document: SpecificationDocument, sourceSha256: string) {
  if (!Array.isArray(document.found) || !Array.isArray(document.notConfirmed) || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("Invalid saved specification document/hash");
  const products = new Map(catalog.map(product => [product.slug, product]));
  const sourceDiscrepancies = document.discrepancies?.slice(1) ?? [];
  const discrepancyRows = new Set<number>();
  for (const discrepancy of sourceDiscrepancies) {
    const matches = document.found.filter(row => text(row, "Продукт") === String(discrepancy[0]) && text(row, "Характеристика") === String(discrepancy[1]) && text(row, "Значение") === String(discrepancy[4]) && text(row, "Ссылка") === String(discrepancy[8]));
    if (!matches.length) throw new Error("Source discrepancy cannot be matched to its exact finding");
    for (const row of matches) discrepancyRows.add(row.row);
  }
  const decisions: SpecificationDecision[] = [], grouped = new Map<string, { row: SpecificationRow; evidence: Evidence; decision: SpecificationDecision }[]>();
  const ids = new Set<number>();
  for (const row of document.found) {
    if (!Number.isSafeInteger(row.row) || ids.has(row.row)) throw new Error("Missing or duplicate source row identity");
    ids.add(row.row);
    const key = text(row, "Ключ"), targetKey = key === "priceOther" ? "priceRub" : key;
    const decision: SpecificationDecision = { row: row.row, slug: row.slug, key, targetKey, disposition: "rejected", reason: "", numeric: false };
    decisions.push(decision);
    if (!products.has(row.slug)) { decision.reason = "unknown-product-slug"; continue; }
    if (!(targetKey in CHARACTERISTIC_KEYS)) { decision.reason = "unknown-characteristic-key"; continue; }
    if (WRONG_MODEL_ROWS.has(row.row)) { decision.reason = "source-explicitly-describes-another-model"; continue; }
    if (!SOURCE_TYPES[text(row, "Тип источника")] || !/^https?:\/\//.test(text(row, "Ссылка")) || !text(row, "Цитата из источника") || !text(row, "Значение")) { decision.reason = "incomplete-source-provenance"; continue; }
    const { evidence, reason } = evidenceFor(row, targetKey);
    decision.reason = reason ?? "declared-source-fact"; decision.numeric = numeric(evidence.value);
    const groupKey = `${row.slug}:${targetKey}`, group = grouped.get(groupKey) ?? [];
    group.push({ row, evidence, decision }); grouped.set(groupKey, group);
  }
  const patches: Record<string, Patch> = {}, deltas: { slug: string; key: string; before: CharValue | null; after: CharValue; sourceRows: number[] }[] = [];
  for (const [groupKey, group] of grouped) {
    const split = groupKey.indexOf(":"), slug = groupKey.slice(0, split), key = groupKey.slice(split + 1), product = products.get(slug)!;
    const existing = product.characteristics[key], applicable = group.filter(item => !item.evidence.basis?.includes("Только справочно:")).sort((a, b) => sourcePriority(a.evidence, b.evidence));
    const variants = applicable.filter((item, index, all) => all.findIndex(other => equivalent(item.evidence, other.evidence)) === index);
    const def = CHARACTERISTIC_KEYS[key as keyof typeof CHARACTERISTIC_KEYS], numericField = def.kind === "num" || def.kind === "range";
    const sourceConflict = group.some(item => discrepancyRows.has(item.row.row));
    const numericConflict = applicable.some(item => (existing && conflicting(existing, item.evidence)) || applicable.some(other => conflicting(item.evidence, other.evidence)));
    const conflict = sourceConflict || numericConflict || (!existing && numericField && variants.length > 1);
    let primary: Sourced<CharValue>;
    if (missing(existing) && variants.length === 1) primary = { ...variants[0]!.evidence };
    else if (existing) primary = { ...existing, alternatives: existing.alternatives ? [...existing.alternatives] : undefined };
    else {
      const first = group[0]!.evidence;
      const values = variants.map(item => item.evidence.value);
      const list = [...new Set(values.flatMap(value => Array.isArray(value) ? value : [String(value)]))];
      const combined = LIST_KEYS.has(key) && list.every(value => value.length <= 300) ? list : list.join(" | ");
      primary = { ...first, sourceRef: `${SOURCE_REF}; сводка ${slug}.${key}`, value: variants.length > 1 && !numericField ? combined : variants.length > 1 ? "Источники расходятся; значения и условия приведены в альтернативах" : "Справочные данные; числовое применение требует уточнения условий", confirmed: false };
      delete primary.unit; delete primary.scope;
    }
    const alternatives = [...(primary.alternatives ?? [])];
    if (existing && primary.sourceRef !== existing.sourceRef) alternatives.unshift({ ...withoutAlternatives(existing), ...(conflict ? { conflict: true } : {}) });
    for (const item of group) {
      if (primary.sourceRef === item.evidence.sourceRef) { item.decision.disposition = "primary"; continue; }
      item.decision.disposition = item.evidence.basis?.includes("Только справочно:") ? "reference" : "alternative";
      const evidence = { ...item.evidence, ...(conflict ? { conflict: true } : {}) };
      if (!alternatives.some(alt => stableJson(alt) === stableJson(evidence))) alternatives.push(evidence);
      if (item.decision.disposition === "alternative") item.decision.reason = conflict ? "source-conflict-preserved-no-arbitrary-winner" : "additional-source-preserved";
    }
    if (alternatives.length) primary.alternatives = alternatives;
    const patch = patches[slug] ?? { characteristics: {} }; patch.characteristics[key] = primary; patches[slug] = patch;
    if (FINANCIAL_KEYS.has(key) && numeric(primary.value) && (!existing || !equivalent(primary, existing))) deltas.push({ slug, key, before: existing?.value ?? null, after: primary.value, sourceRows: group.filter(item => equivalent(item.evidence, primary)).map(item => item.row.row) });
  }
  const promoted: string[] = [];
  for (const [slug, patch] of Object.entries(patches)) {
    const product = products.get(slug)!;
    const substantive = Object.entries(patch.characteristics).filter(([key, value]) => {
      const def = CHARACTERISTIC_KEYS[key as keyof typeof CHARACTERISTIC_KEYS];
      return def && ["TECHNICAL", "INFRASTRUCTURE", "ECONOMICS"].includes(def.group) && !missing(value) && !/^Источники расходятся|^Справочные данные/.test(String(value.value)) && value.granularity === "field" && value.origin === "research";
    });
    if (product.level === "identification" && substantive.length > 0) { patch.level = "enriched"; promoted.push(slug); }
  }
  const counts = { primary: 0, alternative: 0, reference: 0, rejected: 0 };
  const reasons: Record<string, number> = {};
  for (const decision of decisions) { counts[decision.disposition]++; reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1; }
  const version = `${PARSED_SPECIFICATIONS_POLICY}@2026-10-20#${sourceSha256.slice(0, 16)}`;
  return {
    runtime: { version, patches, summary: { foundRows: decisions.length, sourceProducts: new Set(document.found.map(row => row.slug)).size, ...counts, reasons, updatedProducts: Object.keys(patches).length, promotedProducts: promoted.length, financialDeltas: deltas.length, sourceDiscrepancies: sourceDiscrepancies.length, confirmedAuthorFindings: [...grouped.values()].flat().filter(item => item.evidence.confirmed).length, numericPrimaryFindings: decisions.filter(item => item.disposition === "primary" && item.numeric).length } },
    audit: { version, sourceSha256, source: "Google Sheet 1eZSOrxSas0XSD2Ev3jO1HyU06WPIpyCr (v2); saved parsed-specs-v2.json", rules: "No network reverification. Author-table verification retained with provenance; unresolved ranges/conflicts, other-model claims and mismatched physical quantities never select a numeric input.", decisions: decisions.map((decision, index) => ({ ...decision, raw: document.found[index] })), excludedBySource: document.notConfirmed.slice(1), sourceDiscrepancies, deltas, promoted },
  };
}

const PATCHES = (generated as unknown as { patches: Record<string, Patch> }).patches;
/** Additive seed overlay; database sync continues to protect administrator edits and archives. */
export function withParsedSpecifications(product: ProductSeed): ProductSeed {
  const patch = PATCHES[product.slug];
  return patch ? { ...product, ...(patch.level ? { level: patch.level } : {}), characteristics: { ...product.characteristics, ...structuredClone(patch.characteristics) } } : product;
}
