import { simSummaryRows } from "../../sim/export-rows";
import { originLabel } from "../../tz/characteristics";
import { FORMULAS, INCLUDED_IN_SUBSCRIPTION, MODEL_LIMITATIONS, sortRisks, type FormulaKey } from "../../tz/econ";
import { DEFAULT_NORMS, NORM_DEFS, isNormKey, normDef, type NormDef } from "../../tz/norms";
import { formatParamValue } from "../../tz/params/messages";
import { processDef } from "../../tz/processes";
import { SELECTION_STATUS_LABELS } from "../../tz/selection";
import type {
  ComparisonRow,
  ItemResult,
  LineItem,
  Risk,
  ScenarioKind,
  ScenarioResult,
  SelectionStatus,
  SensitivityRow,
} from "../../tz/types";
import { MANUAL_MARK, manualProductSlugs, processLabel, scenarioTitle, type ReportResults } from "./rows";

/**
 * Разделы отчёта сверх таблицы сценариев: подбор, сравнение решений, состав оборудования,
 * статьи CAPEX/OPEX, чувствительность, нормативы, имитация, риски, формулы. Чистые функции без
 * библиотеки XLSX и React: их используют книга XLSX (сервер) и печатный отчёт. Числа остаются числами
 * (null — нет данных), форматирование — на стороне потребителя.
 */

// ——————————————————————————— Подбор и сравнение ———————————————————————————

/** Заголовок таблицы подбора. */
export const SELECTION_HEADER = [
  "Процесс",
  "Продукт",
  "Статус",
  "Балл (0–100)",
  "Требует проверки",
  "Причины",
  "Ограничения",
  "Недостающие данные",
  "Вклад факторов",
] as const;

/** Результат подбора для печати и XLSX: причины, ограничения и недостающие данные одной строкой. */
export type SelectionReportRow = {
  process: string;
  processName: string;
  productSlug: string;
  productName: string;
  status: SelectionStatus;
  statusLabel: string;
  score: number | null;
  needsVerification: boolean;
  reasons: string;
  limitations: string;
  missing: string;
  contributions: string;
};

/**
 * Подбор по процессам (ТЗ §3.4) в порядке движка подбора (рекомендуемый, кандидаты,
 * «Недостаточно данных», исключённые). Продукт, добавленный в сценарий вручную, помечен ⚠.
 */
export function selectionReportRows(results: ReportResults): SelectionReportRow[] {
  const manual = manualProductSlugs(results);
  return results.selection.map((s) => ({
    process: s.process,
    processName: processLabel(s.process),
    productSlug: s.productSlug,
    productName: manual.has(s.productSlug) ? `${s.productName} ${MANUAL_MARK}` : s.productName,
    status: s.status,
    statusLabel: SELECTION_STATUS_LABELS[s.status] ?? s.status,
    score: s.score.total,
    needsVerification: s.needsVerification,
    reasons: s.reasons.join("; "),
    limitations: s.limitations.join("; "),
    missing: s.missing.map((m) => `${m.label}: ${m.howToFix}`).join("; "),
    contributions: s.score.contributions
      .map((c) => `${c.label}: ${formatParamValue(c.points)} из ${formatParamValue(Math.round(c.weight * 100))} — ${c.explanation}`)
      .join("; "),
  }));
}

/** Заголовок сравнения решений по единым характеристикам (ТЗ §2.2 шаг 4). */
export const COMPARISON_HEADER = [
  "Процесс",
  "Продукт",
  "Статус",
  "Грузоподъёмность, кг",
  "Скорость, м/с",
  "Норма, ед./ч",
  "По циклу, ед./ч",
  "Принято, ед./ч",
  "Автономность, ч",
  "Зарядка, мин",
  "Мин. ширина прохода, м",
  "Роботов",
  "Зарядных станций",
  "Цена, ₽",
  "CAPEX покупки, ₽",
  "NPV покупки, ₽",
  "Окупаемость покупки, лет",
  "Ставка RaaS, ₽/мес",
  "Полнота карточки, %",
] as const;

/** Числовые поля строки сравнения в порядке столбцов после «Статус». */
export const COMPARISON_NUMERIC_KEYS = [
  "payloadKg",
  "speedMps",
  "thrNorm",
  "thrCycle",
  "thrEff",
  "autonomyH",
  "chargeMin",
  "minAisleM",
  "n",
  "chargers",
  "priceRub",
  "capexPurchaseRub",
  "npvPurchaseRub",
  "paybackPurchaseYears",
  "raasRubMonth",
  "completenessPct",
] as const satisfies readonly (keyof ComparisonRow)[];

export type ComparisonReportRow = ComparisonRow & { processName: string; productTitle: string; statusLabel: string };

/** Строки сравнения решений; решение, добавленное вручную, помечено ⚠. */
export function comparisonReportRows(results: ReportResults): ComparisonReportRow[] {
  return results.comparison.map((c) => ({
    ...c,
    processName: processLabel(c.process),
    productTitle: c.manuallyAdded ? `${c.productName} ${MANUAL_MARK}` : c.productName,
    statusLabel: SELECTION_STATUS_LABELS[c.status] ?? c.status,
  }));
}

// ——————————————————————————— Состав оборудования ———————————————————————————

/** Заголовок таблицы состава оборудования и расчёта парка. */
export const EQUIPMENT_HEADER = [
  "Сценарий",
  "Процесс",
  "Продукт",
  "Единица потока",
  "Спрос в сутки",
  "Средний поток, ед./ч",
  "Пиковый поток, ед./ч",
  "Норма, ед./ч",
  "По циклу, ед./ч",
  "Принято, ед./ч",
  "Источник производительности",
  "Плечо с грузом, м",
  "Порожнее плечо, м",
  "Роботов (точно)",
  "Роботов",
  "Число задано вручную",
  "Охват пикового спроса, %",
  "Зарядных станций",
  "Постов диспетчера",
  "Численность персонала, чел.",
  "Высвобождается ставок",
  "ФОТ как есть, ₽/год",
  "ФОТ оставшегося персонала, ₽/год",
  "Персонал эксплуатации, ₽/год",
  "Примечание",
] as const;

/** Позиция сценария (или пояснение, если позиций нет): процесс, продукт и расчёт парка. */
export type EquipmentReportRow = {
  scenarioKey: string;
  scenarioTitle: string;
  processName: string;
  productName: string;
  unit: string;
  item: ItemResult | null;
  note: string;
};

/**
 * Состав оборудования по сценариям (ТЗ §3.5.2: роботы и вспомогательное оборудование). У
 * «Как есть» позиций нет — строка-пояснение; у отказа — сообщение отказа.
 */
export function equipmentRows(results: ReportResults): EquipmentReportRow[] {
  const rows: EquipmentReportRow[] = [];
  for (const r of results.results) {
    const title = scenarioTitle(results, r);
    const refusal = r.status === "refused" ? `Не рассчитан: ${r.refusal.message}` : "";
    if (r.items.length === 0) {
      rows.push({
        scenarioKey: r.key,
        scenarioTitle: title,
        processName: "—",
        productName: "—",
        unit: "",
        item: null,
        note: refusal || (r.kind === "asis" ? "текущий процесс, без роботов" : "позиций нет"),
      });
      continue;
    }
    for (const it of r.items) {
      rows.push({
        scenarioKey: r.key,
        scenarioTitle: title,
        processName: processLabel(it.process),
        productName: it.manuallyAdded ? `${it.productName} ${MANUAL_MARK}` : it.productName,
        unit: processDef(it.process)?.throughputUnit ?? "",
        item: it,
        note: refusal,
      });
    }
  }
  return rows;
}

// ——————————————————————————— CAPEX и OPEX по статьям ———————————————————————————

/** Заголовок таблицы статей CAPEX или OPEX. */
export const LINES_HEADER = ["Сценарий", "Статья", "Сумма, ₽", "Формула", "Подстановка", "Происхождение", "Примечание"] as const;

/** Статья с трассировкой (ТЗ §3.5.8): формула, подстановка, происхождение и примечание. */
export type LineReportRow = { line: LineItem; origin: string; note: string };

/** Статьи одного сценария и их сумма (null — сценарий не рассчитан). */
export type LineGroup = {
  scenarioKey: string;
  scenarioTitle: string;
  refusal: string | null;
  lines: LineReportRow[];
  totalRub: number | null;
};

function lineRow(line: LineItem): LineReportRow {
  const origin = line.originNote ? `${originLabel(line.origin)} (${line.originNote})` : originLabel(line.origin);
  const notes: string[] = [];
  if (line.overridden) notes.push("задано вами вместо расчётного");
  if (line.includedInSubscription) notes.push(INCLUDED_IN_SUBSCRIPTION);
  return { line, origin, note: notes.join("; ") };
}

/** Статьи CAPEX или OPEX по сценариям (ТЗ §3.5.2), с итогом сценария из результата. */
export function lineGroups(results: ReportResults, which: "capex" | "opex"): LineGroup[] {
  return results.results.map((r) => {
    const title = scenarioTitle(results, r);
    if (r.status !== "ok") {
      return { scenarioKey: r.key, scenarioTitle: title, refusal: r.refusal.message, lines: [], totalRub: null };
    }
    const lines = which === "capex" ? r.capexLines : r.opexLines;
    return {
      scenarioKey: r.key,
      scenarioTitle: title,
      refusal: null,
      lines: lines.map(lineRow),
      totalRub: which === "capex" ? r.capexRub : r.opexYearRub,
    };
  });
}

// ——————————————————————————— Чувствительность ———————————————————————————

/** Заголовок таблицы чувствительности. */
export const SENSITIVITY_HEADER = [
  "Сценарий",
  "Параметр",
  "Ед.",
  "База",
  "Нижняя граница",
  "Верхняя граница",
  "Источник границ",
  "NPV при нижней, ₽",
  "NPV при верхней, ₽",
  "Размах, ₽",
  "Окупаемость при нижней, лет",
  "Окупаемость при верхней, лет",
  "TCO при нижней, ₽",
  "TCO при верхней, ₽",
  "Смена знака NPV",
] as const;

export type SensitivityGroup = { scenarioKey: string; scenarioTitle: string; kind: ScenarioKind; rows: SensitivityRow[] };

/** Анализ чувствительности по сценариям (ТЗ §3.5.6); сценарии без рычагов пропускаются. */
export function sensitivityGroups(results: ReportResults): SensitivityGroup[] {
  const out: SensitivityGroup[] = [];
  for (const r of results.results) {
    if (r.status !== "ok" || r.sensitivity.length === 0) continue;
    out.push({ scenarioKey: r.key, scenarioTitle: scenarioTitle(results, r), kind: r.kind, rows: r.sensitivity });
  }
  return out;
}

// ——————————————————————————— Нормативы и допущения ———————————————————————————

/** Заголовок таблицы нормативов. */
export const NORMS_HEADER = [
  "Группа",
  "Норматив",
  "Ключ",
  "Значение в расчёте",
  "Ед.",
  "По умолчанию",
  "Мин",
  "Макс",
  "Происхождение",
  "Обоснование",
  "Источник",
] as const;

export type NormReportRow = {
  key: string;
  group: string;
  label: string;
  value: number;
  unit: string;
  defaultValue: number;
  min: number | null;
  max: number | null;
  origin: string;
  basis: string;
  source: string;
  /** Значение в расчёте отличается от значения по умолчанию (правка администратора). */
  changed: boolean;
};

function normSource(d: NormDef): string {
  const parts = [d.sourceRef, d.sourceUrl, d.formula ? `Формула: ${d.formula}` : undefined].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return parts.join("; ") || "—";
}

/**
 * Нормативы, с которыми выполнен расчёт (ТЗ §3.5.8: допущения и источники видны): значение из
 * снимка проекта, значение по умолчанию, границы, происхождение и обоснование. Порядок — как
 * в описании нормативов (по группам).
 */
export function normsReportRows(results: ReportResults): NormReportRow[] {
  const used = results.normsUsed as Readonly<Record<string, number | undefined>>;
  return (NORM_DEFS as readonly NormDef[]).map((d) => {
    const def = DEFAULT_NORMS[d.key as keyof typeof DEFAULT_NORMS];
    const raw = used[d.key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : def;
    return {
      key: d.key,
      group: d.group,
      label: d.label,
      value,
      unit: d.unit,
      defaultValue: d.value,
      min: d.min,
      max: d.max,
      origin: originLabel(d.origin),
      basis: d.basis,
      source: normSource(d),
      changed: value !== d.value,
    };
  });
}

/** Переопределение норматива в сценарии (ТЗ §3.5.4 — пользовательские корректировки). */
export type NormOverrideRow = { scenarioTitle: string; key: string; label: string; value: number; unit: string };

/** Нормативы, переопределённые в сценариях. */
export function normOverrideRows(results: ReportResults): NormOverrideRow[] {
  const out: NormOverrideRow[] = [];
  for (const spec of results.scenarios) {
    const o = spec.normOverrides ?? {};
    const r = results.results.find((x) => x.key === spec.key);
    const title = r ? scenarioTitle(results, r) : spec.name;
    for (const [key, value] of Object.entries(o)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const d = isNormKey(key) ? normDef(key) : null;
      out.push({ scenarioTitle: title, key, label: d?.label ?? key, value, unit: d?.unit ?? "" });
    }
  }
  return out;
}

// ——————————————————————————— Имитация ———————————————————————————

/**
 * Итоги имитации по сценариям (ТЗ §3.6.2): строки `simSummaryRows` (подпись — значение) по
 * столбцу на сценарий с прогоном. Сценарии роботизации без прогона перечислены отдельно.
 */
export type SimTable = {
  columns: { scenarioKey: string; title: string }[];
  labels: string[];
  /** values[i][j] — значение строки i для сценария j (число или текст). */
  values: (number | string)[][];
  notChecked: string[];
};

export function simTable(results: ReportResults): SimTable {
  const columns: SimTable["columns"] = [];
  const perScenario: (readonly [string, number | string][])[] = [];
  const notChecked: string[] = [];
  for (const r of results.results) {
    const s = results.sim?.[r.key] ?? null;
    if (s) {
      columns.push({ scenarioKey: r.key, title: scenarioTitle(results, r) });
      perScenario.push(simSummaryRows(s));
    } else if (r.kind !== "asis") {
      notChecked.push(scenarioTitle(results, r));
    }
  }
  const labels = (perScenario[0] ?? []).map(([label]) => label);
  const values = labels.map((_, i) => perScenario.map((rows) => rows[i]?.[1] ?? "—"));
  return { columns, labels, values, notChecked };
}

// ——————————————————————————— Риски, формулы, ограничения ———————————————————————————

const SEVERITY_LABELS: Readonly<Record<Risk["severity"], string>> = { high: "высокий", medium: "средний", low: "низкий" };

/** Заголовок таблицы рисков. */
export const RISKS_HEADER = ["Сценарий", "Важность", "Код", "Описание"] as const;

export type RiskReportRow = { scenarioTitle: string; severity: string; code: string; text: string };

/** Риски сценариев (ТЗ §3.5.7) по важности внутри сценария. */
export function riskRows(results: ReportResults): RiskReportRow[] {
  return results.results.flatMap((r: ScenarioResult) =>
    sortRisks(r.risks).map((x) => ({
      scenarioTitle: scenarioTitle(results, r),
      severity: SEVERITY_LABELS[x.severity] ?? x.severity,
      code: x.code,
      text: x.text,
    })),
  );
}

/** Формулы модели (ТЗ §3.5.8) для листа «О расчёте» и раздела отчёта «Формулы». */
export type FormulaReportRow = { key: string; title: string; expression: string; units: string; source: string };

export function formulaRows(): FormulaReportRow[] {
  return (Object.keys(FORMULAS) as FormulaKey[]).map((key) => {
    const f = FORMULAS[key];
    return { key, title: f.title, expression: f.expression, units: f.units, source: f.source };
  });
}

/** Ограничения модели (ТЗ §3.5.8, §5.7). */
export function modelLimitations(): readonly string[] {
  return MODEL_LIMITATIONS;
}
