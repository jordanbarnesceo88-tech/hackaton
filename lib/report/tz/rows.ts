import { formatYearsRu, pluralRu } from "../../format/plural";
import { formatMRub, formatNum, formatPct, formatRub } from "../../format/rub";
import { BOTTLENECK_LABELS } from "../../sim/export-rows";
import type { SimSummaryStored } from "../../sim/types";
import { originLabel } from "../../tz/characteristics";
import {
  DEFAULT_PARAM_LABELS,
  DISCLAIMER,
  horizonOf,
  interpretBand,
  isViableScenario,
  normsForSpec,
  sortRisks,
} from "../../tz/econ";
import { DEFAULT_NORMS, isNormKey, normDef, type NormValues } from "../../tz/norms";
import { defaultSourceText, formatParamValue, rangeText, unitText } from "../../tz/params/messages";
import { FACILITY_LABELS, sortDefs } from "../../tz/params/template";
import { processDef } from "../../tz/processes";
import type {
  CashflowRow,
  ParamSpec,
  ProjectResults,
  ScenarioKind,
  ScenarioOk,
  ScenarioResult,
  ScenarioSpec,
} from "../../tz/types";

/**
 * Строки отчёта по проекту модели tz-1.0.0 — общий источник для страницы отчёта (печать в PDF),
 * выгрузки CSV и книги XLSX (ТЗ §3.7.2, §3.7.3, §3.5.8). Чистые функции без React, Prisma и
 * библиотеки XLSX: модуль импортируют и сервер, и браузер (гостевая выгрузка CSV собирается на
 * клиенте). Числа форматируются только через lib/format/rub и lib/format/plural, поэтому строки
 * отчёта совпадают с экраном.
 *
 * Каждая строка несёт и исходные числа (для числовых ячеек XLSX и CSV), и готовый текст ячеек
 * `cells` (для печатного отчёта). Ничего не пересчитывается: всё берётся из сохранённых
 * результатов (`ProjectResults`), кроме горизонта H и ставки дисконтирования, которые
 * восстанавливаются из сохранённых параметров и нормативов теми же функциями, что у движка.
 */

// ——————————————————————————— Вход и общие помощники ———————————————————————————

/**
 * Результаты, из которых строится отчёт. Это `ProjectResults`, у которого момент расчёта и
 * сводки имитации необязательны: гостевой расчёт в браузере (модель проекта без сохранения)
 * тоже выгружается в CSV, а у него нет ни даты сохранения, ни серверной имитации.
 */
export type ReportResults = Omit<ProjectResults, "calculatedAt" | "sim"> & {
  calculatedAt?: string | null;
  sim?: Readonly<Record<string, SimSummaryStored | null>>;
};

/** Значок решения, добавленного вручную вопреки подбору (ТЗ §3.4: ручное добавление с предупреждением). */
export const MANUAL_MARK = "⚠";

/** Пояснение к значку ⚠ — выводится в легенде отчёта, CSV и XLSX. */
export const MANUAL_NOTE =
  "⚠ — решение добавлено в сравнение вручную, хотя подбор его исключил или не рекомендовал: проверьте причины и ограничения";

/** Примечание к ROI услуги (RaaS): при малом CAPEX процент ROI огромен и ничего не говорит. */
export const RAAS_ROI_NOTE = "ROI неинформативен при малом CAPEX — сравнивайте NPV и TCO";

/** Оговорка о предварительной оценке (ТЗ §3.7.4) — дословно как в выводе движка. */
export function disclaimerOf(results: Pick<ReportResults, "conclusion">): string {
  return results.conclusion.disclaimer || DISCLAIMER;
}

/** Подпись типа объекта: «Склад», «Аэропорт», «Медучреждение». */
export function facilityLabelOf(facility: string): string {
  return FACILITY_LABELS[facility] ?? facility;
}

/** Название процесса по slug (для строк оборудования, подбора и журнала). */
export function processLabel(slug: string): string {
  return processDef(slug)?.name ?? slug;
}

const CALC_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Дата расчёта «25.09.2026 14:05 МСК». Часовой пояс закреплён (Москва), чтобы сервер в
 * контейнере с UTC и браузер пользователя печатали одно и то же время. Нет даты — «не сохранён».
 */
export function formatCalcDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "не сохранён (расчёт без сохранения)";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${CALC_DATE.format(d).replace(",", "")} МСК`;
}

/** Спецификация сценария по ключу (позиции, ручные корректировки, переопределения нормативов). */
export function scenarioSpecOf(results: Pick<ReportResults, "scenarios">, key: string): ScenarioSpec | undefined {
  return results.scenarios.find((s) => s.key === key);
}

/**
 * Нормативы сценария — как у движка: сохранённые нормативы расчёта плюс переопределения
 * сценария (`normsForSpec`). Недостающие ключи (результаты старой версии) берутся по умолчанию.
 */
export function scenarioNorms(results: Pick<ReportResults, "normsUsed" | "scenarios">, key: string): NormValues {
  const base: NormValues = { ...DEFAULT_NORMS, ...results.normsUsed };
  const spec = scenarioSpecOf(results, key);
  return normsForSpec({ norms: base }, spec ?? {});
}

/** Решение в сценарии добавлено вручную (по спецификации или по результату позиции). */
export function isManualScenario(results: Pick<ReportResults, "scenarios">, r: ScenarioResult): boolean {
  const spec = scenarioSpecOf(results, r.key);
  return (spec?.items ?? []).some((i) => i.manuallyAdded === true) || r.items.some((i) => i.manuallyAdded);
}

/** Slug'и продуктов, добавленных вручную хотя бы в одном сценарии. */
export function manualProductSlugs(results: Pick<ReportResults, "scenarios">): Set<string> {
  const out = new Set<string>();
  for (const s of results.scenarios) for (const i of s.items) if (i.manuallyAdded) out.add(i.productSlug);
  return out;
}

/** Колонка сравнения сценариев: название (с ⚠ у ручного решения) и признаки. */
export type ScenarioColumn = {
  key: string;
  name: string;
  /** Название для заголовка: с « ⚠», если решение добавлено вручную. */
  title: string;
  kind: ScenarioKind;
  status: ScenarioResult["status"];
  manual: boolean;
  recommended: boolean;
};

/** Колонки таблицы сценариев в порядке результатов. */
export function scenarioColumns(results: ReportResults): ScenarioColumn[] {
  const rec = results.conclusion.recommendedScenarioKey;
  return results.results.map((r) => {
    const manual = isManualScenario(results, r);
    return {
      key: r.key,
      name: r.name,
      title: manual ? `${r.name} ${MANUAL_MARK}` : r.name,
      kind: r.kind,
      status: r.status,
      manual,
      recommended: rec !== null && rec === r.key,
    };
  });
}

/** Название сценария для строк отчёта: с « ⚠», если решение добавлено вручную. */
export function scenarioTitle(results: Pick<ReportResults, "scenarios">, r: ScenarioResult): string {
  return isManualScenario(results, r) ? `${r.name} ${MANUAL_MARK}` : r.name;
}

/**
 * Финансовые параметры сценария для денежного потока: горизонт расчёта H, горизонт TCO T,
 * ставка дисконтирования и OPEX «Как есть» того же охвата.
 * - H восстанавливается из сохранённых параметров функцией движка `horizonOf`; если параметр
 *   испорчен (сценарий тогда был бы отказом, но проверяем честно), H = null, и NPV/ROI в XLSX
 *   записываются числами без формул.
 * - OPEX «Как есть» = эффект + OPEX сценария: движок считает E = OPEXкак есть − OPEXсценария.
 */
export type ScenarioFinance = { H: number | null; T: number; rate: number; opexAsisRub: number };

export function scenarioFinance(results: ReportResults, r: ScenarioOk): ScenarioFinance {
  const norms = scenarioNorms(results, r.key);
  const maxYear = Math.max(0, r.cashflows.length - 1);
  let H: number | null = null;
  try {
    H = Math.min(horizonOf({ params: results.paramsUsed }, norms).H, maxYear);
  } catch {
    H = null;
  }
  const rate = Number.isFinite(norms.discountRate) ? norms.discountRate : DEFAULT_NORMS.discountRate;
  return { H: H !== null && H >= 1 ? H : null, T: r.tcoYears, rate, opexAsisRub: r.effectYearRub + r.opexYearRub };
}

/** Текстовое значение для ячейки: число без потери дробной части, текст как есть, остальное — JSON. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number" || typeof v === "string") return formatParamValue(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return "—";
  }
}

/** Целое число лет со словом: «1 год», «3 года», «5 лет». */
export function yearsCount(n: number): string {
  return `${formatNum(n)} ${pluralRu(n, ["год", "года", "лет"])}`;
}

function signedMRub(v: number): string {
  return v > 0 ? `+${formatMRub(v)}` : formatMRub(v);
}

// ——————————————————————————— Таблица сценариев ———————————————————————————

/** Вид значения строки таблицы сценариев — от него зависят числовой формат XLSX и единица в CSV. */
export type CellKind = "rub" | "years" | "pct" | "text";

/**
 * Строки таблицы сценариев в порядке экрана (T2.6, ScenarioTable): состав, деньги, окупаемость,
 * ROI, NPV, TCO, имитация, риски и вывод. Подпись TCO дополняется горизонтом («TCO за 5 лет»).
 */
export const SCENARIO_TABLE_ROWS = [
  { key: "composition", label: "Состав оборудования", kind: "text" },
  { key: "capex", label: "CAPEX", kind: "rub" },
  { key: "opex", label: "OPEX в год", kind: "rub" },
  { key: "labour", label: "ФОТ процесса", kind: "rub" },
  { key: "effect", label: "Годовой эффект", kind: "rub" },
  { key: "payback", label: "Окупаемость (простая)", kind: "years" },
  { key: "band", label: "Интерпретация", kind: "text" },
  { key: "roiTz", label: "ROI по ТЗ", kind: "pct" },
  { key: "roiNet", label: "ROI чистый", kind: "pct" },
  { key: "npv", label: "NPV", kind: "rub" },
  { key: "dpb", label: "Дисконтированная окупаемость", kind: "years" },
  { key: "tco", label: "TCO", kind: "rub" },
  { key: "tcoDelta", label: "Изменение TCO к «Как есть»", kind: "rub" },
  { key: "sim", label: "Имитация", kind: "text" },
  { key: "risks", label: "Риски", kind: "text" },
  { key: "verdict", label: "Вывод", kind: "text" },
] as const satisfies readonly { key: string; label: string; kind: CellKind }[];

export type ScenarioRowKey = (typeof SCENARIO_TABLE_ROWS)[number]["key"];

/**
 * Строка таблицы сценариев: `cells` — текст для печати (по ячейке на сценарий), `values` — число
 * для XLSX и CSV (null — у ячейки нет числа: текст, «—», отказ).
 */
export type ScenarioTableRow = {
  rowKey: ScenarioRowKey;
  label: string;
  kind: CellKind;
  cells: string[];
  values: (number | null)[];
};

/** Состав оборудования одной строкой: «11 роботов · 1 зарядка · 1 пост диспетчера». */
export function compositionText(r: ScenarioResult): string {
  if (r.kind === "asis") return "текущий процесс, без роботов";
  if (r.status === "refused") return `Не рассчитан: ${r.refusal.message}`;
  const parts = r.items.map((it) => {
    const bits: string[] = [];
    if (it.n !== null) bits.push(`${formatNum(it.n)} ${pluralRu(it.n, ["робот", "робота", "роботов"])}`);
    if (it.chargers > 0) bits.push(`${formatNum(it.chargers)} ${pluralRu(it.chargers, ["зарядка", "зарядки", "зарядок"])}`);
    if (it.operatorPosts > 0) {
      bits.push(
        `${formatNum(it.operatorPosts)} ${pluralRu(it.operatorPosts, ["пост диспетчера", "поста диспетчера", "постов диспетчера"])}`,
      );
    }
    const text = bits.join(" · ") || "—";
    if (r.items.length < 2) return text;
    return `${it.productName}${it.manuallyAdded ? ` ${MANUAL_MARK}` : ""}: ${text}`;
  });
  return parts.join("; ") || "—";
}

/** Ячейка «Имитация»: «✓ подтверждено», «✗ не подтверждено: {узкое место}» или «—». */
export function simCellText(s: SimSummaryStored | null | undefined): string {
  if (!s) return "—";
  if (s.verdict === "CONFIRMED") return s.oversized ? "✓ подтверждено (парк избыточен)" : "✓ подтверждено";
  if (s.verdict === "NOT_CONFIRMED") return `✗ не подтверждено: ${BOTTLENECK_LABELS[s.bottleneck]}`;
  return "—";
}

/** Ячейка «Риски»: число рисков и тексты двух главных (по важности). */
export function risksCellText(r: ScenarioResult): string {
  const risks = sortRisks(r.risks);
  if (risks.length === 0) return "нет";
  const top = risks.slice(0, 2).map((x) => x.text);
  const more = risks.length > 2 ? ` · и ещё ${risks.length - 2}` : "";
  return `${risks.length}: ${top.join(" · ")}${more}`;
}

/** Ячейка «Вывод»: ★ у рекомендуемого сценария. */
export function verdictCellText(r: ScenarioResult, recommendedKey: string | null): string {
  if (r.status === "refused") return "Не рассчитан";
  if (recommendedKey !== null && r.key === recommendedKey) return "★ Рекомендуется";
  if (r.kind === "asis") return "Базовый вариант (текущий процесс)";
  return isViableScenario(r) ? "Окупается (NPV ≥ 0), но уступает рекомендуемому" : "Не окупается в пределах горизонта";
}

type Cell = [value: number | null, text: string];

const DASH: Cell = [null, "—"];

function tableCell(key: ScenarioRowKey, r: ScenarioResult, results: ReportResults): Cell {
  const rec = results.conclusion.recommendedScenarioKey;
  switch (key) {
    case "composition":
      return [null, compositionText(r)];
    case "sim":
      return [null, simCellText(results.sim?.[r.key])];
    case "risks":
      return [null, risksCellText(r)];
    case "verdict":
      return [null, verdictCellText(r, rec)];
    default:
      break;
  }
  if (r.status !== "ok") return DASH;
  const asis = r.kind === "asis";
  const money = (v: number | null): Cell => (v === null ? DASH : [v, formatMRub(v)]);
  const years = (v: number | null, none: string): Cell => (v === null ? [null, none] : [v, formatYearsRu(v)]);
  const roi = (v: number | null): Cell => {
    if (v === null) return DASH;
    return [v, r.kind === "raas" ? `${formatPct(v)} (${RAAS_ROI_NOTE})` : formatPct(v)];
  };
  switch (key) {
    case "capex":
      return money(r.capexRub);
    case "opex":
      return money(r.opexYearRub);
    case "labour":
      return money(r.processLabourYearRub);
    case "effect":
      return asis ? DASH : money(r.effectYearRub);
    case "payback":
      return asis ? DASH : years(r.paybackYears, "не окупается");
    case "band":
      return asis ? [null, "базовый вариант"] : [null, interpretBand(r.paybackYears, scenarioNorms(results, r.key)).text];
    case "roiTz":
      return asis ? DASH : roi(r.roiTzPct);
    case "roiNet":
      return asis ? DASH : roi(r.roiNetPct);
    case "npv":
      return asis ? DASH : money(r.npvRub);
    case "dpb":
      return asis ? DASH : years(r.discountedPaybackYears, "не окупается в горизонте");
    case "tco":
      return money(r.tcoRub);
    case "tcoDelta":
      return asis ? DASH : [r.tcoDeltaVsAsIsRub, signedMRub(r.tcoDeltaVsAsIsRub)];
    default:
      return DASH;
  }
}

/**
 * Подпись строки TCO: «TCO за 5 лет» (горизонт TCO сценариев — целые годы); если горизонты
 * сценариев различаются — «TCO за горизонт TCO».
 */
function tcoLabel(results: ReportResults): string {
  const Ts = new Set(results.results.filter((r): r is ScenarioOk => r.status === "ok").map((r) => r.tcoYears));
  if (Ts.size !== 1) return "TCO за горизонт TCO";
  const [T] = [...Ts];
  return T === undefined ? "TCO" : `TCO за ${yearsCount(T)}`;
}

/**
 * Таблица сценариев (ТЗ §3.5.5, §3.7.1): строки в порядке `SCENARIO_TABLE_ROWS`, по ячейке на
 * сценарий в порядке результатов. Отказ показывается в строке состава («Не рассчитан: …»), в
 * числовых строках — «—», никогда не ноль.
 */
export function scenarioTableRows(results: ReportResults): ScenarioTableRow[] {
  return SCENARIO_TABLE_ROWS.map((def) => {
    const cells: string[] = [];
    const values: (number | null)[] = [];
    for (const r of results.results) {
      const [v, text] = tableCell(def.key, r, results);
      values.push(v);
      cells.push(text);
    }
    return { rowKey: def.key, label: def.key === "tco" ? tcoLabel(results) : def.label, kind: def.kind, cells, values };
  });
}

/** Единица строки таблицы сценариев для заголовка столбца CSV: «CAPEX, ₽». */
export function kindUnit(kind: CellKind): string {
  if (kind === "rub") return "₽";
  if (kind === "years") return "лет";
  if (kind === "pct") return "%";
  return "";
}

// ——————————————————————————— Параметры объекта ———————————————————————————

/** Заголовок таблицы параметров. */
export const PARAMS_HEADER = [
  "Раздел",
  "Параметр",
  "Значение",
  "Ед.",
  "По умолчанию",
  "Диапазон организатора",
  "Источник",
  "Замечания",
] as const;

/** Строка «Параметры объекта»: значение в расчёте, значение по умолчанию, диапазон и источник. */
export type ParamReportRow = {
  key: string;
  section: string;
  label: string;
  value: number | string | null;
  unit: string;
  base: number | string | null;
  min: number | null;
  max: number | null;
  /** Числовое значение вне диапазона организатора (для подсветки ⚠). */
  outOfRange: boolean;
  /** Значение отличается от значения по умолчанию — его задал пользователь. */
  changed: boolean;
  source: string;
  notes: string[];
  cells: string[];
};

function sameValue(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a).trim() === String(b ?? "").trim();
}

/**
 * Параметры объекта в порядке показа (`order` описания). Значение — то, с которым выполнен
 * расчёт (`paramsUsed`); источник — «Задано вами», если оно отличается от значения по умолчанию,
 * иначе происхождение значения по умолчанию (организатор, оценка и т. п.). Замечания проверки
 * (`paramIssues`) и выход за диапазон организатора — в столбце «Замечания». Ключи, которых нет в
 * описаниях, идут в конце разделом «Прочие».
 */
export function paramsRows(results: ReportResults, defs: readonly ParamSpec[]): ParamReportRow[] {
  const used = results.paramsUsed;
  const issuesByKey = new Map<string, string[]>();
  for (const i of results.paramIssues) {
    const list = issuesByKey.get(i.key) ?? [];
    list.push(i.message);
    issuesByKey.set(i.key, list);
  }
  const rows: ParamReportRow[] = [];
  const seen = new Set<string>();
  for (const def of sortDefs(defs)) {
    seen.add(def.key);
    const value = used[def.key] ?? null;
    const unit = unitText(def.unit);
    const outOfRange =
      typeof value === "number" && ((def.min !== null && value < def.min) || (def.max !== null && value > def.max));
    const missing = value === null || value === "";
    const changed = !missing && !sameValue(value, def.base);
    const notes = [...(issuesByKey.get(def.key) ?? [])];
    if (outOfRange) notes.unshift(`⚠ вне диапазона организатора (${rangeText(def)})`);
    const source = missing
      ? "не задано — в расчёт не входит"
      : changed
        ? `Задано вами (по умолчанию ${formatParamValue(def.base)})`
        : defaultSourceText(def);
    rows.push({
      key: def.key,
      section: def.section,
      label: def.label,
      value,
      unit,
      base: def.base,
      min: def.min,
      max: def.max,
      outOfRange,
      changed,
      source,
      notes,
      cells: [
        def.section,
        def.label,
        formatParamValue(value),
        unit,
        formatParamValue(def.base),
        rangeText(def) || "—",
        source,
        notes.join("; "),
      ],
    });
  }
  for (const key of Object.keys(used).sort()) {
    if (seen.has(key)) continue;
    const value = used[key] ?? null;
    const label = DEFAULT_PARAM_LABELS[key] ?? key;
    const notes = issuesByKey.get(key) ?? [];
    rows.push({
      key,
      section: "Прочие",
      label,
      value,
      unit: "",
      base: null,
      min: null,
      max: null,
      outOfRange: false,
      changed: false,
      source: "—",
      notes,
      cells: ["Прочие", label, formatParamValue(value), "", "—", "—", "—", notes.join("; ")],
    });
  }
  return rows;
}

// ——————————————————————————— Денежный поток ———————————————————————————

/** Заголовок таблицы денежного потока (год 0 — вложения). Все суммы в ₽. */
export const CASHFLOW_HEADER = [
  "Год",
  "CAPEX",
  "OPEX",
  "АКБ",
  "Докупка",
  "Эффект",
  "Поток",
  "Накопленный поток",
] as const;

export type CashflowReportRow = CashflowRow & { cells: string[] };

/**
 * Денежный поток сценария по годам t = 0…T как есть из результата (ТЗ §3.5.2): CAPEX, OPEX
 * года (с фактической заменой АКБ), замена АКБ, докупка, эффект, поток и накопленный поток.
 */
export function cashflowRows(result: ScenarioOk): CashflowReportRow[] {
  return result.cashflows.map((c) => ({
    ...c,
    cells: [
      String(c.year),
      formatRub(c.capexRub),
      formatRub(c.opexRub),
      formatRub(c.batteryRub),
      formatRub(c.reinvestRub),
      formatRub(c.effectRub),
      formatRub(c.cashflowRub),
      formatRub(c.cumulativeRub),
    ],
  }));
}

// ——————————————————————————— Источники данных ———————————————————————————

/** Заголовок таблицы источников. */
export const SOURCES_HEADER = [
  "Продукт",
  "Характеристика",
  "Значение",
  "Происхождение",
  "Подтверждено",
  "Дата",
  "Ссылка",
  "Где у организатора",
] as const;

/** Характеристика продукта с источником (ТЗ §3.3.4: источник, дата, признак подтверждения). */
export type SourceReportRow = {
  productSlug: string;
  productName: string;
  key: string;
  label: string;
  value: string;
  origin: string;
  confirmed: boolean;
  date: string | null;
  url: string | null;
  ref: string | null;
  cells: string[];
};

/**
 * Источники данных по продуктам снимка проекта (`productSnapshots` — ровно те продукты, с
 * которыми выполнен расчёт). Продукты по названию, характеристики в порядке карточки; продукт,
 * добавленный вручную, помечен ⚠.
 */
export function sourcesRows(results: ReportResults): SourceReportRow[] {
  const manual = manualProductSlugs(results);
  const products = Object.values(results.productSnapshots).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const rows: SourceReportRow[] = [];
  for (const p of products) {
    const name = manual.has(p.slug) ? `${p.name} ${MANUAL_MARK}` : p.name;
    for (const s of p.sources) {
      const origin = originLabel(s.origin);
      rows.push({
        productSlug: p.slug,
        productName: name,
        key: s.key,
        label: s.label,
        value: s.value,
        origin,
        confirmed: s.confirmed,
        date: s.date,
        url: s.sourceUrl,
        ref: s.sourceRef,
        cells: [name, s.label, s.value, origin, s.confirmed ? "да" : "нет", s.date ?? "—", s.sourceUrl ?? "—", s.sourceRef ?? "—"],
      });
    }
  }
  return rows;
}

// ——————————————————————————— Журнал корректировок ———————————————————————————

/**
 * Запись журнала корректировок для отчёта (ТЗ §3.5.4): поля таблицы ChangeLog в плоском виде.
 * `field` — в формате PendingChange ('param:<key>', 'item:<process>:quantity', 'norm:<key>', …);
 * `fieldLabel`, если задан, заменяет подпись, выведенную из `field`.
 */
export type ReportChange = {
  at: string | Date;
  user?: string | null;
  scenario?: string | null;
  field: string;
  fieldLabel?: string | null;
  auto: unknown;
  old: unknown;
  new: unknown;
  unit?: string | null;
  reason?: string | null;
};

/** Заголовок журнала корректировок. */
export const CHANGES_HEADER = [
  "Дата",
  "Пользователь",
  "Сценарий",
  "Что изменено",
  "Авто",
  "Было",
  "Стало",
  "Ед.",
  "Причина",
] as const;

export type ChangeReportRow = {
  at: string;
  user: string;
  scenario: string;
  fieldLabel: string;
  auto: string;
  old: string;
  new: string;
  unit: string;
  reason: string;
  cells: string[];
};

const ITEM_FIELD_LABELS: Readonly<Record<string, string>> = {
  quantity: "количество роботов",
  price: "цена робота",
  throughput: "производительность",
  service: "сервис за робота в год",
  raasRate: "ставка RaaS за робота в месяц",
  manual: "решение добавлено вручную",
};

/**
 * Подпись изменённого поля по-русски: «Параметр «Горизонт расчёта окупаемости»», «Перемещение
 * паллет: количество роботов», «Норматив «Коэффициент загрузки робота»», «Сценарий добавлен».
 * `paramLabels` — подписи параметров проекта (из описаний), иначе встроенные.
 */
export function changeFieldLabel(field: string, paramLabels?: Readonly<Record<string, string>>): string {
  const [kind, a, b] = field.split(":");
  if (kind === "param" && a) return `Параметр «${paramLabels?.[a] ?? DEFAULT_PARAM_LABELS[a] ?? a}»`;
  if (kind === "norm" && a) return isNormKey(a) ? `Норматив «${normDef(a).label}»` : `Норматив «${a}»`;
  if (kind === "item" && a) {
    const what = b ? (ITEM_FIELD_LABELS[b] ?? b) : "позиция";
    return `${processLabel(a)}: ${what}`;
  }
  if (field === "scenario:add") return "Сценарий добавлен";
  if (field === "scenario:remove") return "Сценарий удалён";
  return field;
}

/** Журнал корректировок в порядке записи (как пришёл), даты — по Москве. */
export function changeRows(
  changes: readonly ReportChange[],
  opts: {
    paramLabels?: Readonly<Record<string, string>>;
    /** Название сценария для показа по его ключу или имени (с ⚠ у ручного решения). */
    scenarioTitles?: Readonly<Record<string, string>>;
  } = {},
): ChangeReportRow[] {
  return changes.map((c) => {
    const at = formatCalcDate(c.at);
    const user = c.user?.trim() || "—";
    const rawScenario = c.scenario?.trim() ?? "";
    const scenario = (rawScenario && opts.scenarioTitles?.[rawScenario]) || rawScenario || "—";
    const fieldLabel = c.fieldLabel?.trim() || changeFieldLabel(c.field, opts.paramLabels);
    const auto = valueText(c.auto);
    const old = valueText(c.old);
    const next = valueText(c.new);
    const unit = c.unit?.trim() ?? "";
    const reason = c.reason?.trim() || "—";
    return {
      at,
      user,
      scenario,
      fieldLabel,
      auto,
      old,
      new: next,
      unit,
      reason,
      cells: [at, user, scenario, fieldLabel, auto, old, next, unit, reason],
    };
  });
}
