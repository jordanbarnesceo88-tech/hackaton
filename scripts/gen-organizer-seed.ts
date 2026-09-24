/**
 * Генератор данных организатора для модели tz-1.0.0.
 *
 * Читает JSON-выгрузки из папки ORGANIZER_DATA_DIR (оригиналы организатора — xlsx, csv, docx —
 * в репозиторий не попадают) и пишет детерминированные модули:
 * - lib/data/organizer/params.generated.ts — параметры объектов (склад, аэропорт, больница);
 * - lib/data/organizer/catalog.generated.json — каталог продуктов с провенансом характеристик;
 * - lib/data/organizer/version.generated.ts — версии исходных данных и счётчики каталога.
 *
 * Ручные решения (ключи параметров, дополнения, отнесение к процессам, исключения, выбор
 * основного значения) — в lib/data/organizer/decisions.ts. Повторный запуск на тех же данных
 * даёт побайтно тот же результат.
 *
 * Входные файлы в ORGANIZER_DATA_DIR:
 * - organizer_datasets.json — листы «Склад», «Аэропорт», «Медучреждение» датасета организатора;
 * - organizer_catalog.json — каталог организатора (catalog_export_v4.csv);
 * - rows.json — 61 исследованная строка свода (номер, id, раздел);
 * - svod.json — полный дамп свода «Роботы_свод.xlsx» (значения без обрезки и «Подтверждено»);
 * - found_batch1.json … found_batch6.json — второй проход исследования (находки со ссылками);
 * - verify_result.json — проверка находок по страницам (вердикт на каждую находку).
 *
 * Запуск: ORGANIZER_DATA_DIR=<папка> npx tsx scripts/gen-organizer-seed.ts
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CATALOG_FILE,
  DATASET_FILE,
  DUPLICATE_ROW_MERGES,
  EXAMPLES_DOC,
  EXAMPLE_ONLY_PRODUCTS,
  FACILITY_SHEETS,
  FLEET_FIGURE_RE,
  NUMERIC_KEY_UNITS,
  ORGANIZER_DATE,
  ORGANIZER_EXAMPLES,
  PARAM_DECISIONS,
  PARAM_EXTRAS,
  PLACEHOLDER_PRICES,
  PRODUCT_DECISIONS,
  RESEARCH_DATE,
  RND_EXCLUDED_REASON,
  RU_CONFIDENCE,
  RU_SOURCE_TYPE,
  SCENARIO_TO_PROCESS,
  SUBTYPE_TO_SOLUTION_TYPE,
  SVOD_COLUMN_TO_KEY,
  TYPE_TO_SOLUTION_TYPE,
  USE_LETTERS,
  type Confidence,
  type DecidedValue,
  type ProductDecision,
} from "../lib/data/organizer/decisions";
import {
  SLUG_RE,
  cutDescription,
  formatExample,
  parseNumericText,
  parseRuNumber,
  parseTempRange,
  slugify,
  typicalOf,
  type ParsedNumber,
} from "../lib/data/organizer/parse";
import { CHARACTERISTIC_KEYS, type CharKey } from "../lib/tz/characteristics";
import { PROCESS_DEFS, SOLUTION_TYPE_DEFS, processDef, type FacilitySlug } from "../lib/tz/processes";
import type {
  CharValue,
  Origin,
  ParamKind,
  ParamSpec,
  ProductFlag,
  ProductSeed,
  ProductStatus,
  Range,
  SourceType,
  Sourced,
} from "../lib/tz/types";

const HEADER = "// СГЕНЕРИРОВАНО scripts/gen-organizer-seed.ts — не править руками";
const OUT_DIR = path.join(process.cwd(), "lib", "data", "organizer");
const FACILITIES: readonly FacilitySlug[] = ["warehouse", "airport", "medical"];

// ——————————————————————————— Чтение входных данных ———————————————————————————

const dataDir = process.env.ORGANIZER_DATA_DIR;
if (!dataDir) {
  console.error(
    "Укажите ORGANIZER_DATA_DIR — папку с JSON-выгрузками организатора (organizer_datasets.json, " +
      "organizer_catalog.json, rows.json, found_batch*.json)",
  );
  process.exit(1);
}

const BATCHES = [1, 2, 3, 4, 5, 6] as const;
const REQUIRED_FILES = [
  "organizer_datasets.json",
  "organizer_catalog.json",
  "rows.json",
  "svod.json",
  "verify_result.json",
  ...BATCHES.map((b) => `found_batch${b}.json`),
];
const missingFiles = REQUIRED_FILES.filter((f) => !existsSync(path.join(dataDir, f)));
if (missingFiles.length > 0) {
  console.error(`В ORGANIZER_DATA_DIR (${dataDir}) нет файлов: ${missingFiles.join(", ")}`);
  process.exit(1);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(dataDir as string, file), "utf8")) as T;
}

type DatasetRow = {
  section: string | null;
  name: string;
  unit: string | null;
  base: number | string | null;
  min: number | string | null;
  max: number | string | null;
  note: string | null;
};
type CatalogRow = Record<string, string>;
type CuratedRow = { n: number; excelRow: number; section: string; id: string; model: string };
type SvodCell = string | number | null;
type Finding = {
  n: number;
  column: string;
  value: string;
  as_in_source: string;
  source_url: string;
  source_type: string;
  confidence: string;
};
type Conflict = { n: number; column: string; existing: unknown; found: string; source_url: string };
type Batch = { findings: Finding[]; conflicts?: Conflict[] };
type Verdict = { key: string; verdict: string; corrected_value?: string };

const datasets = readJson<Record<string, DatasetRow[]>>("organizer_datasets.json");
const catalogRows = readJson<CatalogRow[]>("organizer_catalog.json");
const curatedRows = readJson<CuratedRow[]>("rows.json");
const svod = readJson<Record<string, SvodCell[][]>>("svod.json");
const batches: Batch[] = BATCHES.map((b) => readJson<Batch>(`found_batch${b}.json`));
const verdicts = new Map(readJson<{ final: Verdict[] }>("verify_result.json").final.map((v) => [v.key, v]));

// Момент заморозки исследования — самое позднее изменение файлов found_batch.
const researchFrozenAt = new Date(
  Math.max(...BATCHES.map((b) => statSync(path.join(dataDir, `found_batch${b}.json`)).mtimeMs)),
)
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z");

// ——————————————————————————— Общие помощники ———————————————————————————

function fail(message: string): never {
  throw new Error(`gen-organizer-seed: ${message}`);
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Кириллица в нижний регистр, первая буква — заглавная: «ОБЩИЕ ПАРАМЕТРЫ» → «Общие параметры». */
function prettySection(s: string): string {
  const lower = s.replace(/[А-ЯЁ]/g, (ch) => ch.toLowerCase());
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

function httpsUrls(raw: string): string[] {
  return raw
    .split(/\s*\|\s*|\s+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ——————————————————————————— Параметры объектов ———————————————————————————

const COUNT_UNITS = new Set([
  "шт.",
  "чел.",
  "смен",
  "дн.",
  "SKU",
  "коек",
  "наименований",
  "паллетомест",
  "поддон/сут",
  "строк/сут",
  "шт./сут",
  "ед./сут",
  "пасс./сут",
  "пасс./ч",
  "рейсов/сут",
  "рейсов/ч",
  "порций/сут",
  "конт./сут",
  "заявок/сут",
  "проб/сут",
  "посещений/сут",
  "операций",
  "лет",
  "раз/сут",
  "смен/сут",
]);

function usedBy(letters: string): string[] {
  return ["F", "L", "C", "V", "E"].filter((l) => letters.includes(l)).map((l) => USE_LETTERS[l] as string);
}

function inferKind(base: number | string | null, unit: string | null, min: number | null, max: number | null): ParamKind {
  if (typeof base === "string") return /^\d+\s*×\s*\d+\s*×\s*\d+$/.test(base) ? "dims" : "text";
  if (unit === "%") return "percent";
  const allInt = [base, min, max].every((v) => v === null || Number.isInteger(v));
  return allInt && unit !== null && COUNT_UNITS.has(unit) ? "integer" : "number";
}

function buildParams(): ParamSpec[] {
  const specs: ParamSpec[] = [];
  for (const facility of FACILITIES) {
    const sheet = FACILITY_SHEETS[facility];
    const rows = datasets[sheet] ?? fail(`в датасете нет листа «${sheet}»`);
    const decisions = PARAM_DECISIONS[facility];
    const seen = new Set<string>();
    // Номер строки листа: строки 1–2 — заголовок, перед каждой группой — строка раздела «▌…».
    let excelRow = 2;
    let prevSection: string | null = null;
    let order = 0;
    for (const row of rows) {
      if (row.section !== prevSection) {
        excelRow++;
        prevSection = row.section;
      }
      excelRow++;
      const name = str(row.name);
      const d = decisions[name] ?? fail(`нет решения для строки «${name}» листа «${sheet}» (PARAM_DECISIONS)`);
      seen.add(name);
      const rawBase = typeof row.base === "string" ? row.base.trim() : row.base;
      const numMin = typeof row.min === "number" ? row.min : null;
      const numMax = typeof row.max === "number" ? row.max : null;
      const locked =
        row.min !== null && row.min !== "-" && str(row.min) !== "" && str(row.min) === str(row.max);
      const unit = d.unit !== undefined ? d.unit : str(row.unit) === "-" || str(row.unit) === "" ? null : str(row.unit);
      const kind = d.kind ?? inferKind(rawBase, unit, numMin, numMax);
      const options = d.options ?? [];
      if (kind === "enum" && !options.includes(String(rawBase))) {
        fail(`базовое значение «${String(rawBase)}» параметра ${d.key} не входит в варианты`);
      }
      const note = row.note ? row.note.trim() : null;
      specs.push({
        key: d.key,
        facility,
        section: prettySection(str(row.section)),
        label: name,
        unit,
        kind,
        options,
        base: rawBase,
        min: numMin,
        max: numMax,
        locked,
        required: d.required ?? true,
        tzMinimum: d.tz ?? null,
        usedBy: usedBy(d.use),
        hint:
          (note ? note.replace(/\s*\n\s*/g, " ") : null) ??
          d.hint ??
          `${name}${unit ? `, ${unit}` : ""} — значение из датасета организатора.`,
        example: formatExample(rawBase ?? ""),
        organizerNote: note,
        origin: "organizer",
        sourceRef: `${DATASET_FILE} › ${sheet} › стр. ${excelRow}`,
        sourceUrl: null,
        basis: d.basis ?? null,
        formula: d.formula ?? null,
        order: ++order,
      });
    }
    const unused = Object.keys(decisions).filter((n) => !seen.has(n));
    if (unused.length > 0) fail(`решения без строки в листе «${sheet}»: ${unused.join("; ")}`);
    for (const x of PARAM_EXTRAS[facility]) {
      specs.push({
        key: x.key,
        facility,
        section: x.section,
        label: x.label,
        unit: x.unit,
        kind: x.kind,
        options: x.options ?? [],
        base: x.base,
        min: x.min,
        max: x.max,
        locked: false,
        required: x.required,
        tzMinimum: x.tz ?? null,
        usedBy: usedBy(x.use),
        hint: x.hint,
        example: x.base === null ? "например, 12" : formatExample(x.base),
        organizerNote: null,
        origin: x.origin,
        sourceRef: x.sourceRef ?? null,
        sourceUrl: null,
        basis: x.basis,
        formula: x.formula ?? null,
        order: ++order,
      });
    }
    const keys = specs.filter((s) => s.facility === facility).map((s) => s.key);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dup.length > 0) fail(`повтор ключей параметров (${facility}): ${dup.join(", ")}`);
  }
  return specs;
}

// ——————————————————————————— Каталог: кандидаты значений ———————————————————————————

/**
 * Кандидат значения характеристики до выбора основного. `rank` — приоритет источника (меньше —
 * важнее), `confirming` — может ли значение подтвердить значение организатора (первоисточник
 * с уверенностью выше низкой), `role: "alternative"` — никогда не становится основным.
 */
type Cand = Omit<Sourced<CharValue>, "alternatives"> & {
  key: CharKey;
  rank: number;
  confRank: number;
  seq: number;
  role: "primary" | "alternative";
  confirming: boolean;
};

let candSeq = 0;

const SOURCE_RANK: Readonly<Record<SourceType, number>> = {
  "organizer:examples": 1,
  "organizer:catalog": 2,
  "organizer:dataset": 2,
  "manufacturer-doc": 3,
  manufacturer: 4,
  dealer: 5,
  aggregator: 6,
  press: 7,
  calc: 8,
  "team-estimate": 9,
  "admin-edit": 10,
};
const CONF_RANK: Readonly<Record<Confidence, number>> = { high: 0, medium: 1, low: 3 };
const PRIMARY_SOURCES: ReadonlySet<SourceType> = new Set(["manufacturer", "manufacturer-doc"]);

function downgrade(c: Confidence): Confidence {
  return c === "high" ? "medium" : "low";
}

type CandInput = Omit<Cand, "rank" | "confRank" | "seq" | "role" | "confirming" | "confirmed"> & {
  role?: "primary" | "alternative";
  decision?: boolean;
  /** Строка свода подтверждена владельцем данных («Подтверждено = да»). */
  rowConfirmed?: boolean;
};

function makeCand(input: CandInput): Cand {
  const { role, decision, rowConfirmed, ...rest } = input;
  const conf = rest.confidence;
  const isResearch = rest.origin === "research";
  const primarySource = PRIMARY_SOURCES.has(rest.sourceType);
  // Правило подтверждения research: первоисточник (сайт или документ производителя) и
  // уверенность не низкая; для значения из строки свода — ещё и отметка «Подтверждено».
  const confirmedSelf =
    isResearch && primarySource && conf !== "low" && (rest.granularity !== "row" || rowConfirmed === true);
  let rank = decision ? 0 : SOURCE_RANK[rest.sourceType];
  if (rest.origin === "derived" || rest.origin === "estimate" || rest.origin === "choice") rank = 8;
  if (rest.granularity === "row") rank += 0.5;
  return {
    ...rest,
    confirmed: confirmedSelf,
    rank,
    confRank: conf ? CONF_RANK[conf] : 2,
    seq: candSeq++,
    role: role ?? "primary",
    confirming: confirmedSelf,
  };
}

/** Числа совпадают в пределах 10 % от значения организатора (для диапазона — от ближайшей границы). */
function agrees(orgValue: CharValue, other: CharValue): boolean {
  if (!isNumeric(orgValue) || !isNumeric(other)) return false;
  const o = typicalOf(orgValue);
  if (o === 0) return false;
  let nearest = typicalOf(other);
  if (typeof other !== "number") {
    const lo = other.min ?? other.typical;
    const hi = other.max ?? other.typical;
    nearest = Math.min(hi, Math.max(lo, o));
  }
  return Math.abs(o - nearest) / Math.abs(o) <= 0.1 + 1e-9;
}

function isNumeric(v: CharValue): v is number | Range {
  return typeof v === "number" || (typeof v === "object" && !Array.isArray(v));
}

function valueKey(v: CharValue): string {
  return JSON.stringify(v);
}

// ——————————————————————————— Каталог: разбор ячеек ———————————————————————————

const TEXT_MAX = 300;
const QUOTE_MAX = 200;
const CASES_MAX = 200;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Список навигации из короткого текста: «QR-метки + SLAM» → ["QR-метки", "SLAM"]. */
function navList(text: string): string[] {
  const t = text.trim();
  if (t.length > 60) return [clip(t, TEXT_MAX)];
  return uniq(
    t
      .split(/\s*(?:\+|;|,|\sи\s)\s*/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

/** Модели приобретения из текста: «покупка / аренда / лизинг / pay-per-use» → список. */
function acquisitionList(text: string): string[] | null {
  // Части текста с отрицанием («аренда/RaaS не заявлены») модели не добавляют.
  const t = text
    .toLowerCase()
    .split(/[;.]/)
    .filter((part) => !/не (упомина|заявл|предусм|публику)/.test(part))
    .join(";");
  const out: string[] = [];
  if (/покупк|купить|приобрет|поставка/.test(t)) out.push("покупка");
  if (/лизинг/.test(t)) out.push("лизинг");
  if (/аренд|raas|подписк|pay-per-use|оплат[аы] за (действие|использование)|как услуг|как сервис/.test(t)) {
    out.push("аренда / RaaS");
  }
  return out.length > 0 ? out : null;
}

function countryValue(text: string): string {
  const t = text.trim();
  return /^россия(?![а-яё])/i.test(t) ? "Россия" : clip(t, 160);
}

/**
 * Значение ячейки для ключа характеристики: число или диапазон для числовых ключей (строгий
 * разбор), список для навигации и моделей приобретения, иначе текст.
 */
function cellValue(key: CharKey, raw: SvodCell | string): { value: CharValue; unit?: string } {
  const text = typeof raw === "number" ? String(raw) : str(raw);
  const unit = NUMERIC_KEY_UNITS[key];
  if (unit !== undefined) {
    const parsed: ParsedNumber | null = typeof raw === "number" ? raw : parseNumericText(text);
    if (parsed !== null) return { value: parsed, unit };
    return { value: clip(text, TEXT_MAX) };
  }
  if (key === "navigation") return { value: navList(text) };
  if (key === "acquisitionModels") return { value: acquisitionList(text) ?? [clip(text, TEXT_MAX)] };
  if (key === "countryOfOrigin") return { value: countryValue(text) };
  if (key === "connectivity" || key === "integration") return { value: [clip(text, TEXT_MAX)] };
  return { value: clip(text, TEXT_MAX) };
}

const INTEGRATION_RE = /API|WMS|ERP|MES|1С|интеграц/i;

// ——————————————————————————— Каталог: исходные таблицы ———————————————————————————

const svodSheet = svod["Справочник"] ?? fail("в svod.json нет листа «Справочник»");
const svodHeader = (svodSheet[0] ?? []).map((h) => str(h));
const svodByN = new Map<number, SvodCell[]>();
for (const r of svodSheet.slice(1)) if (typeof r[0] === "number") svodByN.set(r[0], r);
function svodCell(n: number, column: string): SvodCell {
  const i = svodHeader.indexOf(column);
  if (i < 0) fail(`в своде нет колонки «${column}»`);
  return svodByN.get(n)?.[i] ?? null;
}

// Домены производителя по строкам свода (лист «Источники»).
const vendorHostsByN = new Map<number, string[]>();
for (const r of (svod["Источники"] ?? []).slice(1)) {
  if (typeof r[0] !== "number") continue;
  vendorHostsByN.set(
    r[0],
    str(r[5])
      .split(",")
      .map((h) => h.trim().replace(/^www\./, ""))
      .filter(Boolean),
  );
}

// Тип источника по домену — из находок found_batch (самый частый тип). PDF и страницы домена
// считаются отдельно: robob2b.ru хранит паспорта производителей в PDF, но его страницы — каталог.
function hostKey(url: string): string {
  return `${hostOf(url)}|${/\.pdf($|\?)/i.test(url) ? "pdf" : "page"}`;
}
const hostTypeCounts = new Map<string, Map<SourceType, number>>();
for (const b of batches) {
  for (const f of b.findings) {
    const st = RU_SOURCE_TYPE[f.source_type];
    const url = httpsUrls(f.source_url)[0];
    if (!st || !url) continue;
    const hk = hostKey(url);
    const m = hostTypeCounts.get(hk) ?? new Map<SourceType, number>();
    m.set(st, (m.get(st) ?? 0) + 1);
    hostTypeCounts.set(hk, m);
  }
}

/** Тип источника для ссылки без явной пометки: домен производителя строки или тип домена по находкам. */
function classifyUrl(url: string, rows: number[], dropHosts: string[]): SourceType | null {
  const host = hostOf(url);
  if (!host || dropHosts.includes(host)) return null;
  const vendor = rows.flatMap((n) => vendorHostsByN.get(n) ?? []).filter((h) => !dropHosts.includes(h));
  if (vendor.some((v) => host === v || host.endsWith(`.${v}`))) {
    return /\.pdf($|\?)/i.test(url) ? "manufacturer-doc" : "manufacturer";
  }
  const counts = hostTypeCounts.get(hostKey(url));
  if (!counts) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || SOURCE_RANK[a[0]] - SOURCE_RANK[b[0]])[0]?.[0] ?? null;
}

// ——————————————————————————— Каталог: группы продуктов ———————————————————————————

type Group = {
  id: string;
  records: { index: number; row: CatalogRow }[];
  curated: number[];
};

const groupsById = new Map<string, Group>();
catalogRows.forEach((row, index) => {
  const id = str(row.id);
  if (!id) fail(`в каталоге запись ${index + 1} без id`);
  const g = groupsById.get(id) ?? { id, records: [], curated: [] };
  g.records.push({ index, row });
  groupsById.set(id, g);
});
for (const r of curatedRows) {
  const g = groupsById.get(r.id) ?? fail(`строка свода ${r.n}: id ${r.id} нет в каталоге организатора`);
  g.curated.push(r.n);
}
for (const g of groupsById.values()) g.curated.sort((a, b) => a - b);

// Сверка слияний дублей свода с фактическими повторами id.
const actualMerges = [...groupsById.values()]
  .filter((g) => g.curated.length > 1)
  .map((g) => g.curated.join("/"))
  .sort();
const declaredMerges = DUPLICATE_ROW_MERGES.map((p) => p.join("/")).sort();
if (JSON.stringify(actualMerges) !== JSON.stringify(declaredMerges)) {
  fail(`слияния дублей свода ${actualMerges.join(", ")} не совпадают с DUPLICATE_ROW_MERGES ${declaredMerges.join(", ")}`);
}

// ——————————————————————————— Каталог: сборка продукта ———————————————————————————

const STATUS_LABEL: Readonly<Record<ProductStatus, string>> = {
  operation: "в эксплуатации",
  piloting: "пилотирование",
  rnd: "НИОКР",
};
const FLAG_ORDER: readonly ProductFlag[] = [
  "duplicate-merged",
  "model-not-found",
  "variant-unpublished",
  "manufacturer-disputed",
  "price-disputed",
  "price-may-be-subscription",
  "price-placeholder",
  "case-unconfirmed",
  "values-from-other-product",
  "no-price",
  "rnd-exclude",
];
const CHAR_ORDER = Object.keys(CHARACTERISTIC_KEYS) as CharKey[];
const PAYLOAD_IN_NAME = /грузоподъемност[ьи]\s+до\s+([\d\s ]+)\s*кг/i;

const stats = {
  rowValuesWithoutSource: 0,
  unmappedFindingColumns: new Map<string, number>(),
  fleetFiguresToCases: 0,
  conflictsSkipped: 0,
};

function parseStatus(raw: string): ProductStatus {
  const s = raw.trim();
  if (s === "operation" || s === "piloting" || s === "rnd") return s;
  return fail(`неизвестный статус каталога «${raw}»`);
}

function processesForScenario(row: CatalogRow): string[] {
  if (str(row["тип"]) === "bas" || str(row["Тип"]) === "Морские роботы") return [];
  return uniq(
    str(row["Сценарий"])
      .split(",")
      .flatMap((s) => SCENARIO_TO_PROCESS[s.trim().toLowerCase()] ?? []),
  );
}

function solutionTypeFor(row: CatalogRow): string {
  return (
    SUBTYPE_TO_SOLUTION_TYPE[str(row["Подтип"]).toLowerCase()] ??
    TYPE_TO_SOLUTION_TYPE[str(row["Тип"]).toLowerCase()] ??
    "other"
  );
}

function facilitiesOf(processes: string[]): string[] {
  const set = new Set(processes.flatMap((p) => processDef(p)?.facilityTypes ?? []));
  return FACILITIES.filter((f) => set.has(f));
}

function processNames(processes: string[]): string[] {
  return processes.map((p) => {
    const def = processDef(p) ?? fail(`неизвестный процесс ${p}`);
    const facilityLabel = def.facilityTypes.map((f) => FACILITY_SHEETS[f as FacilitySlug] ?? f).join(", ");
    return `${def.name} (${facilityLabel.toLowerCase()})`;
  });
}

/** Контекст сборки одного продукта: кандидаты по ключам и учёт использованных находок. */
class ProductBuilder {
  readonly cands: Cand[] = [];
  readonly consumedFindings = new Set<string>();

  add(key: CharKey, input: Omit<CandInput, "key">): void {
    this.cands.push(makeCand({ ...input, key }));
  }

  /** Выбирает основное значение по каждому ключу и собирает характеристики в порядке словаря. */
  finish(): Record<string, Sourced<CharValue>> {
    const out: Record<string, Sourced<CharValue>> = {};
    for (const key of CHAR_ORDER) {
      const all = this.cands.filter((c) => c.key === key);
      // Значение строки свода, которое совпало со значением с точным источником по полю,
      // лишнее: ссылка строки — только первая из списка и может не содержать этого числа.
      const precise = new Set(all.filter((c) => c.granularity !== "row").map((c) => valueKey(c.value)));
      const list = all.filter((c) => c.granularity !== "row" || !precise.has(valueKey(c.value)));
      if (list.length === 0) continue;
      const sorted = [...list].sort(
        (a, b) =>
          (a.role === "alternative" ? 1 : 0) - (b.role === "alternative" ? 1 : 0) ||
          a.rank - b.rank ||
          a.confRank - b.confRank ||
          a.seq - b.seq,
      );
      const primary = sorted[0];
      if (!primary || primary.role === "alternative") continue;
      const rest: Cand[] = [];
      const seen = new Set<string>([dedupeKey(primary)]);
      for (const c of sorted.slice(1)) {
        const k = dedupeKey(c);
        if (seen.has(k)) continue;
        seen.add(k);
        rest.push(c);
      }
      let confirmed = primary.confirmed;
      if (primary.origin === "organizer") {
        confirmed = rest.some((c) => c.confirming && agrees(primary.value, c.value));
      }
      const sourced: Sourced<CharValue> = { ...toSourced(primary), confirmed };
      if (rest.length > 0) sourced.alternatives = rest.map(toSourced);
      out[key] = sourced;
    }
    return out;
  }
}

function dedupeKey(c: Cand): string {
  return `${valueKey(c.value)}|${c.sourceUrl ?? c.sourceRef ?? ""}|${c.asInSource ?? ""}`;
}

/** Кандидат → Sourced: служебные поля отбрасываются, порядок полей фиксирован. */
function toSourced(c: Cand): Omit<Sourced<CharValue>, "alternatives"> {
  const s: Omit<Sourced<CharValue>, "alternatives"> = {
    value: c.value,
    origin: c.origin,
    sourceType: c.sourceType,
    sourceUrl: c.sourceUrl,
    date: c.date,
    confirmed: c.confirmed,
  };
  if (c.unit !== undefined) s.unit = c.unit;
  if (c.sourceRef !== undefined) s.sourceRef = c.sourceRef;
  if (c.confidence !== undefined) s.confidence = c.confidence;
  if (c.asInSource !== undefined) s.asInSource = c.asInSource;
  if (c.basis !== undefined) s.basis = c.basis;
  if (c.formula !== undefined) s.formula = c.formula;
  if (c.scope !== undefined) s.scope = c.scope;
  if (c.granularity !== undefined) s.granularity = c.granularity;
  return s;
}

/** Провенанс строки свода: ссылки, тип источника, дата, отметка «Подтверждено». */
type RowSource = { urls: string[]; sourceType: SourceType; date: string; confirmed: boolean };

function rowSource(n: number, dropHosts: string[]): RowSource | null {
  let urls = httpsUrls(str(svodCell(n, "Источник (ссылка)")));
  let typeText = str(svodCell(n, "Тип источника"));
  let date = str(svodCell(n, "Дата актуализации"));
  // Строки без ссылки в своде: ссылку, тип и дату дописал второй проход исследования.
  batches.forEach((b) => {
    for (const f of b.findings) {
      if (f.n !== n) continue;
      if (f.column === "Источник (ссылка)" && urls.length === 0) urls = httpsUrls(f.value);
      if (f.column === "Тип источника" && !typeText) typeText = f.value;
      if (f.column === "Дата актуализации" && !date) date = f.value.trim();
    }
  });
  urls = urls.filter((u) => !dropHosts.includes(hostOf(u)));
  if (urls.length === 0) return null;
  const first = typeText.split("+")[0]?.trim() ?? "";
  return {
    urls,
    sourceType: RU_SOURCE_TYPE[first] ?? "press",
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : RESEARCH_DATE,
    confirmed: str(svodCell(n, "Подтверждено (да/нет)")).toLowerCase() === "да",
  };
}

type FindingRef = { ref: string; batch: number; index: number; f: Finding };

function findingsFor(rows: number[]): FindingRef[] {
  const out: FindingRef[] = [];
  batches.forEach((b, bi) => {
    b.findings.forEach((f, index) => {
      if (rows.includes(f.n)) out.push({ ref: `${bi + 1}:${index}`, batch: bi + 1, index, f });
    });
  });
  return out;
}

function findingByRef(ref: string): FindingRef {
  const [b, i] = ref.split(":").map(Number);
  const f = batches[(b ?? 0) - 1]?.findings[i ?? -1];
  if (!f || b === undefined || i === undefined) return fail(`находка ${ref} не найдена`);
  return { ref, batch: b, index: i, f };
}

/** Провенанс находки с поправкой уверенности по вердикту проверки. null — находку не брать. */
function findingProvenance(fr: FindingRef): {
  url: string;
  sourceType: SourceType;
  confidence: Confidence;
  asInSource: string;
  text: string;
} | null {
  const v = verdicts.get(fr.ref);
  const url = httpsUrls(fr.f.source_url)[0];
  const st = RU_SOURCE_TYPE[fr.f.source_type];
  let conf = RU_CONFIDENCE[fr.f.confidence];
  if (!url || !st || !conf) return null;
  let text = fr.f.value;
  switch (v?.verdict) {
    case "supported":
    case "not_on_page":
      break;
    case "partially":
      conf = downgrade(conf);
      if (v.corrected_value && v.corrected_value.trim()) text = v.corrected_value.trim();
      break;
    case "unreachable":
      conf = downgrade(conf);
      break;
    case "contradicted":
      return null;
    default:
      conf = downgrade(conf);
  }
  return { url, sourceType: st, confidence: conf, asInSource: clip(fr.f.as_in_source, QUOTE_MAX), text };
}

function conflictFor(batch: number, rows: number[], column: string): Conflict {
  const c = batches[batch - 1]?.conflicts?.find((x) => rows.includes(x.n) && x.column === column);
  return c ?? fail(`конфликт found_batch${batch} «${column}» для строк ${rows.join("/")} не найден`);
}

/** Кандидат из ручного решения PRODUCT_DECISIONS. */
function addDecided(pb: ProductBuilder, rows: number[], d: DecidedValue, dropHosts: string[]): void {
  const base = { unit: d.unit, scope: d.scope, basis: d.basis, role: d.role, decision: d.role !== "alternative" };
  const src = d.source;
  if (src.from === "finding") {
    const fr = findingByRef(src.ref);
    if (!rows.includes(fr.f.n)) fail(`находка ${src.ref} относится к строке ${fr.f.n}, а не ${rows.join("/")}`);
    const p = findingProvenance(fr) ?? fail(`находка ${src.ref} не проходит проверку источника`);
    if (!src.keepGeneric) {
      // Находка и её дубль по второй строке слитой пары больше не идут общим путём.
      for (const other of findingsFor(rows)) {
        if (other.f.column === fr.f.column && other.f.as_in_source === fr.f.as_in_source) {
          pb.consumedFindings.add(other.ref);
        }
      }
    }
    pb.add(d.key, {
      ...base,
      value: d.value,
      origin: "research",
      sourceType: p.sourceType,
      sourceUrl: p.url,
      date: RESEARCH_DATE,
      confidence: p.confidence,
      asInSource: p.asInSource,
      granularity: "field",
    });
  } else if (src.from === "row") {
    const n = rows[0] as number;
    const rs = rowSource(n, dropHosts) ?? fail(`у строки ${n} нет источника для решения по «${src.column}»`);
    pb.add(d.key, {
      ...base,
      value: d.value,
      origin: "research",
      sourceType: rs.sourceType,
      sourceUrl: rs.urls[0] as string,
      date: rs.date,
      asInSource: clip(str(svodCell(n, src.column)), QUOTE_MAX),
      granularity: "row",
      rowConfirmed: rs.confirmed,
    });
  } else if (src.from === "conflict") {
    const c = conflictFor(src.batch, rows, src.column);
    const url = httpsUrls(c.source_url)[0] ?? fail(`у конфликта «${src.column}» нет ссылки`);
    const st = classifyUrl(url, rows, dropHosts) ?? fail(`не удалось определить тип источника ${url}`);
    pb.add(d.key, {
      ...base,
      value: d.value,
      origin: "research",
      sourceType: st,
      sourceUrl: url,
      date: RESEARCH_DATE,
      confidence: "medium",
      asInSource: clip(c.found, QUOTE_MAX),
      granularity: "field",
    });
  } else {
    pb.add(d.key, {
      ...base,
      value: d.value,
      origin: "research",
      sourceType: src.sourceType,
      sourceUrl: src.url,
      date: RESEARCH_DATE,
      confidence: src.confidence,
      asInSource: src.asInSource,
      granularity: "field",
    });
  }
}

/** Характеристики, дополняющие одно значение: температурный диапазон, интеграция. */
function addDerivedFromText(pb: ProductBuilder, key: CharKey, text: string, input: Omit<CandInput, "key" | "value">): void {
  if (key === "operatingConditions") {
    const t = parseTempRange(text);
    if (t) {
      pb.add("tempMinC", { ...input, value: t.min, unit: "°C" });
      pb.add("tempMaxC", { ...input, value: t.max, unit: "°C" });
    }
  }
  if (key === "connectivity" && INTEGRATION_RE.test(text)) {
    pb.add("integration", { ...input, value: [clip(text, TEXT_MAX)] });
  }
}

function catalogRef(group: Group): string {
  const nums = group.records.map((r) => r.index + 1);
  return `${CATALOG_FILE} › №${nums.join(", ")}`;
}

function buildProduct(group: Group): ProductSeed {
  const first = group.records[0]?.row ?? fail(`пустая группа ${group.id}`);
  const curated = group.curated.length > 0;
  const decisionKey = group.curated[0];
  const decision: ProductDecision | undefined = decisionKey !== undefined ? PRODUCT_DECISIONS[decisionKey] : undefined;
  if (curated && !decision) fail(`нет решения PRODUCT_DECISIONS для строки ${decisionKey}`);
  const rows = group.curated;
  const dropHosts = decision?.dropRowUrlHosts ?? [];
  const pb = new ProductBuilder();
  const orgRef = catalogRef(group);
  const org = { origin: "organizer" as Origin, sourceType: "organizer:catalog" as SourceType, sourceUrl: null, sourceRef: orgRef, date: ORGANIZER_DATE };

  // ——— Поля каталога организатора ———
  const name = str(first["Название"]);
  const manufacturer = str(first["компания"]) || null;
  const status = parseStatus(str(first["статус"]));
  if (manufacturer) pb.add("manufacturer", { ...org, value: manufacturer });
  pb.add("modelName", { ...org, value: name });
  const scenarios = uniq(group.records.map((r) => str(r.row["Сценарий"]).replace(/\s+/g, " ")).filter(Boolean));
  if (scenarios.length > 0) pb.add("purpose", { ...org, value: scenarios.join("; ") });
  pb.add("availabilityStatus", { ...org, value: STATUS_LABEL[status] });

  const prices = uniq(
    group.records.map((r) => parseRuNumber(str(r.row["Цена изделия"]))).filter((p): p is number => p !== null && p > 0),
  ).sort((a, b) => a - b);
  let priceValue: number | Range | null = null;
  if (prices.length === 1) priceValue = prices[0] as number;
  if (prices.length > 1) {
    const lo = prices[0] as number;
    const hi = prices[prices.length - 1] as number;
    priceValue = { min: lo, max: hi, typical: Math.round((lo + hi) / 2) };
  }
  if (priceValue !== null) {
    pb.add("priceRub", {
      ...org,
      value: priceValue,
      unit: "₽",
      asInSource: uniq(group.records.map((r) => str(r.row["Цена изделия"]))).join(" / "),
    });
  }
  const cases = uniq(group.records.map((r) => str(r.row["Кейсы"]).replace(/\s+/g, " ")).filter(Boolean));
  // Кейсы — краткое описание для карточки; полный текст — в записи каталога по sourceRef.
  if (cases.length > 0) pb.add("cases", { ...org, value: clip(cases.join(" "), CASES_MAX) });
  const payloadMatch = PAYLOAD_IN_NAME.exec(name);
  if (payloadMatch?.[1]) {
    const kg = parseRuNumber(payloadMatch[1]);
    if (kg !== null) pb.add("payloadKg", { ...org, value: { max: kg, typical: kg, qualifier: "до" }, unit: "кг", asInSource: name });
  }
  const regions = uniq(group.records.map((r) => str(r.row["Регион"])).filter(Boolean));

  // ——— Классификация ———
  const solutionType = decision?.solutionType ?? solutionTypeFor(first);
  const processes = decision ? [...decision.processes] : uniq(group.records.flatMap((r) => processesForScenario(r.row)));
  const stDef = SOLUTION_TYPE_DEFS.find((s) => s.slug === solutionType) ?? fail(`неизвестный тип решения ${solutionType}`);
  const classify = decision
    ? {
        origin: "choice" as Origin,
        sourceType: "team-estimate" as SourceType,
        sourceUrl: null,
        date: RESEARCH_DATE,
        basis:
          `Назначено вручную по описанию и ТТХ (PRODUCT_DECISIONS, строка свода ${rows.join("/")}).`,
      }
    : {
        origin: "derived" as Origin,
        sourceType: "calc" as SourceType,
        sourceUrl: null,
        date: ORGANIZER_DATE,
        basis: "По каталогу организатора.",
      };
  pb.add("solutionType", {
    ...classify,
    value: stDef.name,
    formula: decision ? undefined : "Подтип → SUBTYPE_TO_SOLUTION_TYPE",
  });
  if (processes.length > 0) {
    pb.add("applicability", {
      ...classify,
      value: processNames(processes),
      formula: decision ? undefined : "Сценарий → SCENARIO_TO_PROCESS",
    });
  }

  // ——— «Примеры решений» организатора ———
  const example = ORGANIZER_EXAMPLES.find((e) => e.rows.some((r) => rows.includes(r)));
  const exampleRef = example ? `${EXAMPLES_DOC} › ${example.sections.join(", ")} › ${example.model}` : null;
  if (example && exampleRef) {
    for (const v of example.values) {
      const input = {
        value: v.value,
        unit: v.unit,
        scope: v.scope,
        origin: "organizer" as Origin,
        sourceType: "organizer:examples" as SourceType,
        sourceUrl: null,
        sourceRef: exampleRef,
        date: ORGANIZER_DATE,
        asInSource: v.asInSource,
        formula: v.formula,
      };
      pb.add(v.key, input);
      if (typeof v.value === "string") {
        const { value: _omit, ...rest } = input;
        void _omit;
        addDerivedFromText(pb, v.key, v.value, rest);
      }
    }
  }

  // ——— Ручные решения ———
  const decided = decision?.values ?? [];
  for (const d of decided) addDecided(pb, rows, d, dropHosts);
  const decidedThroughput = decided.some((d) => d.key === "throughput" && d.role !== "alternative");

  // ——— Строки свода (первый проход исследования, источник на всю строку) ———
  // Строки свода, заполненные из «Примеров решений»: значения по ключам, которые покрывает пример,
  // выведены из него же (переписаны или усреднены), поэтому представлены самим примером.
  const exampleKeys = new Set<string>(example ? example.values.map((v) => v.key) : []);
  for (const n of rows) {
    const rs = rowSource(n, dropHosts);
    const fromExamples = str(svodCell(n, "Источник имеющихся ТТХ")).startsWith("Примеры решений");
    for (const [column, key] of Object.entries(SVOD_COLUMN_TO_KEY)) {
      if (!svodHeader.includes(column)) continue;
      if (decision?.dropRowColumns?.includes(column)) continue;
      const raw = svodCell(n, column);
      if (raw === null || str(raw) === "") continue;
      if (!rs) {
        stats.rowValuesWithoutSource++;
        continue;
      }
      // Решение уже взяло значение из этой ячейки — повторять его не нужно.
      if (decided.some((d) => d.source.from === "row" && d.source.column === column)) continue;
      if (fromExamples && exampleKeys.has(key)) continue;
      const cv = cellValue(key, raw);
      const input: Omit<CandInput, "key"> = {
        value: cv.value,
        unit: cv.unit,
        origin: "research",
        sourceType: rs.sourceType,
        sourceUrl: rs.urls[0] as string,
        date: rs.date,
        asInSource: clip(str(raw), QUOTE_MAX),
        granularity: "row",
        rowConfirmed: rs.confirmed,
      };
      if (key === "throughput") {
        if (FLEET_FIGURE_RE.test(str(raw))) {
          stats.fleetFiguresToCases++;
          pb.add("cases", { ...input, value: clip(`Производительность из источника: ${str(raw)}`, TEXT_MAX), unit: undefined });
          continue;
        }
        pb.add("throughput", { ...input, role: decidedThroughput ? "alternative" : "primary" });
        continue;
      }
      pb.add(key, input);
      const { value: _omit, ...rest } = input;
      void _omit;
      addDerivedFromText(pb, key, str(raw), rest);
    }
  }

  // ——— Находки второго прохода (источник на каждое поле) ———
  for (const fr of findingsFor(rows)) {
    if (pb.consumedFindings.has(fr.ref)) continue;
    const column = fr.f.column;
    if (column === "Источник (ссылка)" || column === "Тип источника" || column === "Дата актуализации") continue;
    const key = SVOD_COLUMN_TO_KEY[column];
    if (!key) {
      stats.unmappedFindingColumns.set(column, (stats.unmappedFindingColumns.get(column) ?? 0) + 1);
      continue;
    }
    const p = findingProvenance(fr);
    if (!p) continue;
    const cv = cellValue(key, p.text);
    const input: Omit<CandInput, "key"> = {
      value: cv.value,
      unit: cv.unit,
      origin: "research",
      sourceType: p.sourceType,
      sourceUrl: p.url,
      date: RESEARCH_DATE,
      confidence: p.confidence,
      asInSource: p.asInSource,
      granularity: "field",
    };
    if (key === "throughput") {
      if (FLEET_FIGURE_RE.test(p.text)) {
        stats.fleetFiguresToCases++;
        pb.add("cases", { ...input, value: clip(`Производительность из источника: ${p.text}`, TEXT_MAX), unit: undefined });
        continue;
      }
      pb.add("throughput", { ...input, role: decidedThroughput ? "alternative" : "primary" });
      continue;
    }
    pb.add(key, input);
    const { value: _omit, ...rest } = input;
    void _omit;
    addDerivedFromText(pb, key, p.text, rest);
  }

  // ——— Конфликты: только альтернативы (показываются как «⚠ расхождение») ———
  batches.forEach((b) => {
    for (const c of b.conflicts ?? []) {
      if (!rows.includes(c.n)) continue;
      const key = SVOD_COLUMN_TO_KEY[c.column];
      const url = httpsUrls(c.source_url)[0];
      const st = url ? classifyUrl(url, rows, dropHosts) : null;
      if (!key || !url || !st) {
        stats.conflictsSkipped++;
        continue;
      }
      pb.add(key, {
        value: clip(c.found, TEXT_MAX),
        origin: "research",
        sourceType: st,
        sourceUrl: url,
        date: RESEARCH_DATE,
        confidence: "low",
        asInSource: clip(c.found, QUOTE_MAX),
        granularity: "field",
        role: "alternative",
      });
    }
  });
  // «Конфликты» свода с пометкой kept existing: производитель проверил значение по полю.
  for (const r of (svod["Конфликты"] ?? []).slice(1)) {
    if (typeof r[0] !== "number" || !rows.includes(r[0]) || str(r[6]) !== "kept existing") continue;
    const key = SVOD_COLUMN_TO_KEY[str(r[2])];
    const url = httpsUrls(str(r[5]))[0];
    const st = url ? classifyUrl(url, rows, dropHosts) : null;
    if (!key || !url || !st || r[4] === null) continue;
    const cv = cellValue(key, r[4] ?? null);
    pb.add(key, {
      value: cv.value,
      unit: cv.unit,
      origin: "research",
      sourceType: st,
      sourceUrl: url,
      date: RESEARCH_DATE,
      asInSource: clip(str(r[4]), QUOTE_MAX),
      granularity: "field",
      role: "alternative",
    });
  }

  // Страна по региону компании — только если ни один источник страну не назвал.
  if (regions.length > 0 && !pb.cands.some((c) => c.key === "countryOfOrigin")) {
    pb.add("countryOfOrigin", {
      value: "Россия",
      origin: "derived",
      sourceType: "calc",
      sourceUrl: null,
      date: ORGANIZER_DATE,
      formula: "«Регион» → Россия",
      basis: `Регион компании: ${regions.join(", ")}.`,
    });
  }

  const characteristics = pb.finish();

  // ——— Флаги и исключение ———
  const flags = new Set<ProductFlag>(decision?.flags ?? []);
  if (group.curated.length > 1) flags.add("duplicate-merged");
  if (prices.length > 1) flags.add("price-disputed");
  if (curated && status === "rnd") flags.add("rnd-exclude");
  const price = characteristics.priceRub;
  if (price && isNumeric(price.value) && PLACEHOLDER_PRICES.includes(typicalOf(price.value))) {
    const researchMatch = (price.alternatives ?? []).some((a) => a.origin === "research" && agrees(price.value, a.value));
    if (!researchMatch) flags.add("price-placeholder");
  }
  if (!price) flags.add("no-price");
  const orderedFlags = FLAG_ORDER.filter((f) => flags.has(f));
  const excludedReason =
    decision?.excludedReason ?? (orderedFlags.includes("rnd-exclude") ? RND_EXCLUDED_REASON : null);

  addDataQuality(characteristics, { curated, rows, dropHosts, orgRef, rowConfirmed: rows.some((n) => rowSource(n, dropHosts)?.confirmed) });

  const country = characteristics.countryOfOrigin?.value;
  return {
    slug: decision?.slug ?? "",
    organizerCatalogId: group.id,
    organizerRows: rows,
    level: curated ? "enriched" : "identification",
    name,
    manufacturer,
    // В колонку страны — только короткое название; развёрнутый текст остаётся в характеристике.
    country: typeof country === "string" && country.length <= 40 ? country : null,
    solutionType,
    status,
    processes,
    facilityTypes: facilitiesOf(processes),
    industries: uniq(group.records.map((r) => str(r.row["Отрасль"])).filter(Boolean)).sort(),
    description: cutDescription(str(first["описание"])),
    characteristics,
    flags: orderedFlags,
    excludedReason,
  };
}

/** Характеристики «Качество данных»: основной источник, дата проверки, подтверждение. */
function addDataQuality(
  chars: Record<string, Sourced<CharValue>>,
  ctx: { curated: boolean; rows: number[]; dropHosts: string[]; orgRef: string | null; rowConfirmed?: boolean },
): void {
  const values = Object.values(chars);
  const total = values.length;
  const confirmedCount = values.filter((c) => c.confirmed).length;
  const researchUrls = values.flatMap((c) => (c.origin === "research" && c.sourceUrl ? [c.sourceUrl] : []));
  const rowUrl = ctx.rows.map((n) => rowSource(n, ctx.dropHosts)?.urls[0]).find((u): u is string => Boolean(u));
  const primaryUrl = rowUrl ?? researchUrls[0] ?? null;
  const dates = values.map((c) => c.date).sort();
  const latest = dates[dates.length - 1] ?? ORGANIZER_DATE;
  const calc = { origin: "derived" as Origin, sourceType: "calc" as SourceType, date: latest, confirmed: false };
  if (primaryUrl) {
    chars.primarySourceUrl = {
      ...calc,
      value: primaryUrl,
      sourceUrl: primaryUrl,
      formula: "1-я ссылка строки свода",
      basis: "Ссылки по полям — у характеристик.",
    };
  }
  // Без открытого источника «Основной источник» не заполняется: карточка честно неполная.
  chars.verifiedAt = {
    ...calc,
    value: latest,
    sourceUrl: null,
    formula: "max(date)",
    basis: "Последняя дата проверки.",
  };
  const parts = [`${confirmedCount} из ${total} подтверждены`];
  if (ctx.curated) parts.push(`строка свода: ${ctx.rowConfirmed ? "да" : "нет"}`);
  chars.confirmation = {
    ...calc,
    value: parts.join("; "),
    sourceUrl: null,
    formula: "confirmed / всего",
    basis: "Совпадение с производителем.",
  };
}

/** Продукт уровня «examples» — модель есть только в «Примерах решений» организатора. */
function buildExampleOnly(item: (typeof EXAMPLE_ONLY_PRODUCTS)[number]): ProductSeed {
  const example = ORGANIZER_EXAMPLES.find((e) => e.model === item.model) ?? fail(`нет примера ${item.model}`);
  const ref = `${EXAMPLES_DOC} › ${example.sections.join(", ")} › ${example.model}`;
  const pb = new ProductBuilder();
  const org = { origin: "organizer" as Origin, sourceType: "organizer:examples" as SourceType, sourceUrl: null, sourceRef: ref, date: ORGANIZER_DATE };
  pb.add("manufacturer", { ...org, value: item.manufacturer, asInSource: `${item.manufacturer} — страница сервиса-робота ${item.name}` });
  pb.add("modelName", { ...org, value: item.name, asInSource: `Робот-доставщик (на примере ${item.name})` });
  pb.add("purpose", { ...org, value: "Робот-доставщик", asInSource: `Робот-доставщик (на примере ${item.name})` });
  const stDef = SOLUTION_TYPE_DEFS.find((s) => s.slug === item.solutionType) ?? fail(`неизвестный тип ${item.solutionType}`);
  const choice = {
    origin: "choice" as Origin,
    sourceType: "team-estimate" as SourceType,
    sourceUrl: null,
    date: RESEARCH_DATE,
    basis: "Назначено вручную по разделу «Примеров решений», где организатор приводит модель (EXAMPLE_ONLY_PRODUCTS).",
  };
  pb.add("solutionType", { ...choice, value: stDef.name });
  pb.add("applicability", { ...choice, value: processNames(item.processes) });
  pb.add("availabilityStatus", {
    value: STATUS_LABEL.operation,
    origin: "estimate",
    sourceType: "team-estimate",
    sourceUrl: null,
    sourceRef: ref,
    date: ORGANIZER_DATE,
    basis:
      "В каталоге организатора модели нет, статус не указан; «Примеры решений» приводят её как типовое " +
      "серийное решение со ссылкой на страницу производителя — принят статус «в эксплуатации».",
  });
  for (const v of example.values) {
    pb.add(v.key, { ...org, value: v.value, unit: v.unit, scope: v.scope, asInSource: v.asInSource, formula: v.formula });
  }
  const characteristics = pb.finish();
  addDataQuality(characteristics, { curated: false, rows: [], dropHosts: [], orgRef: ref });
  return {
    slug: item.slug,
    organizerCatalogId: null,
    organizerRows: [],
    level: "examples",
    name: item.name,
    manufacturer: item.manufacturer,
    country: null,
    solutionType: item.solutionType,
    status: "operation",
    processes: [...item.processes],
    facilityTypes: facilitiesOf(item.processes),
    industries: [],
    description: cutDescription(item.description),
    characteristics,
    flags: ["no-price"],
    excludedReason: null,
  };
}

/** Slug'и: решение → транслитерация названия → org-<id>; повторы получают суффикс id. */
function assignSlugs(products: ProductSeed[]): void {
  const auto = products.map((p) => (p.slug ? p.slug : slugify(p.name) || `org-${(p.organizerCatalogId ?? "").slice(0, 8)}`));
  const counts = new Map<string, number>();
  for (const s of auto) counts.set(s, (counts.get(s) ?? 0) + 1);
  products.forEach((p, i) => {
    const s = auto[i] as string;
    if (p.slug) return;
    p.slug = (counts.get(s) ?? 0) > 1 ? `${s}-${(p.organizerCatalogId ?? "").slice(0, 8)}` : s;
  });
  const all = products.map((p) => p.slug);
  const dup = all.filter((s, i) => all.indexOf(s) !== i);
  if (dup.length > 0) fail(`повтор slug: ${uniq(dup).join(", ")}`);
  const bad = all.filter((s) => !SLUG_RE.test(s));
  if (bad.length > 0) fail(`slug не в kebab-case: ${bad.join(", ")}`);
}

function buildCatalog(): ProductSeed[] {
  const groups = [...groupsById.values()];
  const products = groups.map(buildProduct);
  for (const item of EXAMPLE_ONLY_PRODUCTS) products.push(buildExampleOnly(item));
  assignSlugs(products);
  for (const p of products) {
    for (const proc of p.processes) if (!processDef(proc)) fail(`${p.slug}: неизвестный процесс ${proc}`);
  }
  return products.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// ——————————————————————————— Запись файлов ———————————————————————————

function writeIfChanged(file: string, content: string): boolean {
  const full = path.join(OUT_DIR, file);
  const prev = existsSync(full) ? readFileSync(full, "utf8") : null;
  if (prev === content) return false;
  writeFileSync(full, content, "utf8");
  return true;
}

function paramsModule(specs: ParamSpec[]): string {
  const body = specs.map((s) => `  ${JSON.stringify(s, null, 2).replace(/\n/g, "\n  ")},`).join("\n");
  return [
    HEADER,
    "// Источник: датасет организатора (Датасеты_хакатон.xlsx) и решения lib/data/organizer/decisions.ts.",
    'import type { ParamSpec } from "../../tz/types";',
    "",
    "/** Параметры объектов: строки датасета организатора и дополнения (PARAM_EXTRAS), в порядке показа. */",
    "export const PARAM_SPECS: readonly ParamSpec[] = [",
    body,
    "];",
    "",
  ].join("\n");
}

function catalogJson(products: ProductSeed[]): string {
  return `[\n${products.map((p) => JSON.stringify(p)).join(",\n")}\n]\n`;
}

function versionModule(products: ProductSeed[]): string {
  const counts = { identification: 0, enriched: 0, examples: 0 };
  for (const p of products) counts[p.level]++;
  return [
    HEADER,
    "",
    "/**",
    " * Версии исходных данных организатора (дата выгрузки # первые 8 символов md5 оригинала) и",
    " * момент заморозки исследования открытых источников. Входят в dataVersion проекта (§3.1.5).",
    " */",
    "export const ORGANIZER_DATA_VERSION = {",
    '  datasets: "2026-09-22#4be0fac8",',
    '  catalog: "2026-09-22#da43c64c",',
    '  examples: "2026-09-22#6e738822",',
    `  research: "svod 2026-09-23 + found_batch1-6@${researchFrozenAt}",`,
    "} as const;",
    "",
    "/** Число продуктов каталога по глубине описания. */",
    "export const CATALOG_COUNTS = {",
    `  identification: ${counts.identification},`,
    `  enriched: ${counts.enriched},`,
    `  examples: ${counts.examples},`,
    "} as const;",
    "",
  ].join("\n");
}

function main(): void {
  const specs = buildParams();
  const products = buildCatalog();
  const written = [
    ["params.generated.ts", paramsModule(specs)],
    ["catalog.generated.json", catalogJson(products)],
    ["version.generated.ts", versionModule(products)],
  ].map(([file, content]) => `${file}: ${writeIfChanged(file as string, content as string) ? "обновлён" : "без изменений"}`);

  const byLevel = (l: string) => products.filter((p) => p.level === l).length;
  console.log(`Параметры: ${specs.length} (${FACILITIES.map((f) => `${f} ${specs.filter((s) => s.facility === f).length}`).join(", ")})`);
  console.log(
    `Каталог: ${products.length} продуктов — идентификация ${byLevel("identification")}, ` +
      `обогащено ${byLevel("enriched")}, примеры ${byLevel("examples")}`,
  );
  console.log(`Процессы с продуктами: ${PROCESS_DEFS.map((p) => `${p.slug} ${products.filter((x) => x.processes.includes(p.slug) && x.level !== "identification").length}`).join(", ")}`);
  console.log(
    `Пропущено: значений свода без источника ${stats.rowValuesWithoutSource}, конфликтов без типа источника ` +
      `${stats.conflictsSkipped}; цифр парка/кейса перенесено в «Кейсы» ${stats.fleetFiguresToCases}`,
  );
  if (stats.unmappedFindingColumns.size > 0) {
    console.log(
      `Колонки находок без характеристики: ${[...stats.unmappedFindingColumns.entries()].map(([c, k]) => `${c} (${k})`).join(", ")}`,
    );
  }
  console.log(`Исследование заморожено: ${researchFrozenAt}`);
  for (const line of written) console.log(line);
}

main();
