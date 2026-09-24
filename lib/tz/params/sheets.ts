import { stripFormulaGuard } from "../../files/csv";
import type { ParamIssue, ParamSpec, ParamValues } from "../types";
import { matchLabelsToDefs, normalizeLabel } from "./labels";
import { defaultSourceText, unmatchedRowIssue, withUnit } from "./messages";
import { isAbsent, isBlank } from "./schema";
import { FACILITY_LABELS } from "./template";
import { validateParamValues, type RawParamEntry } from "./validate";

/**
 * Разбор таблицы параметров, уже прочитанной из файла в строки (ТЗ §3.2.3–§3.2.4). Модуль
 * чистый: байты в таблицы превращает `import.ts` (там exceljs), а здесь только поиск
 * заголовка, сопоставление строк с параметрами, проверка и отчёт — это можно вызвать и в
 * браузере.
 *
 * Понимаются два вида таблиц:
 * - наш шаблон (`template.ts`): столбцы «Ключ» и «Значение», строки сопоставляются по ключу;
 * - лист датасета организатора: столбцы «Параметр» и «Базовое значение», строки сопоставляются
 *   по названию параметра (`labels.ts`). Лист выбирается по типу объекта: «Склад»,
 *   «Аэропорт», «Медучреждение».
 */

/** Лист файла: имя (у CSV — null) и строки ячеек. Строка i — это строка i+1 файла. */
export type SheetData = { name: string | null; rows: string[][] };

/** Вид таблицы: наш шаблон или лист датасета организатора. */
export type ParamsLayout = "template" | "organizer";

/** Строка отчёта без проблемы: значение загружено или взято по умолчанию. */
export type ParamInfoItem = {
  key: string;
  label: string;
  code: "ok" | "defaulted";
  severity: "info";
  message: string;
  row?: number;
};

/** Строка отчёта о загрузке: проблема проверки или информационная отметка. */
export type ParamReportItem = ParamIssue | ParamInfoItem;

/**
 * Итог разбора файла. `ok: false` — файл целиком не читается (не тот формат, нет заголовка,
 * нет нужного листа): `message` говорит, что сделать. `ok: true` — файл прочитан; ошибки в
 * отдельных значениях — в `report`, и применять значения при них нельзя (`errors > 0`).
 */
export type ParsedParamsFile =
  | {
      ok: true;
      layout: ParamsLayout;
      /** Лист, из которого взяты значения; у CSV — null. */
      sheetName: string | null;
      /** Полный набор значений: из файла, а где их нет — по умолчанию. */
      values: ParamValues;
      /** Отчёт по каждому параметру в порядке описаний, затем строки, не сопоставленные ни с чем. */
      report: ParamReportItem[];
      /** Сколько параметров найдено в файле. */
      found: number;
      errors: number;
      warnings: number;
    }
  | { ok: false; message: string };

/** Сколько первых строк листа просматривать в поисках заголовка. */
const HEADER_SCAN_ROWS = 20;

/** Названия листов организатора по типу объекта (нормализованные). */
const FACILITY_SHEET_NAMES: Readonly<Record<string, readonly string[]>> = {
  warehouse: ["склад"],
  airport: ["аэропорт"],
  medical: ["медучреждение", "медицинское учреждение"],
};

function cell(row: readonly string[] | undefined, col: number): string {
  if (col < 0 || !row) return "";
  return (row[col] ?? "").trim();
}

type Header = { row: number; cols: Record<string, number> };

/** Заголовок нашего шаблона: ячейки «Ключ» и «Значение» в одной строке. */
function findTemplateHeader(rows: readonly string[][]): Header | null {
  const scan = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < scan; r++) {
    const norm = (rows[r] ?? []).map((c) => normalizeLabel(c));
    const key = norm.indexOf("ключ");
    const value = norm.indexOf("значение");
    if (key >= 0 && value >= 0) {
      return {
        row: r,
        cols: { key, value, label: norm.indexOf("параметр"), unit: norm.indexOf("единица") },
      };
    }
  }
  return null;
}

/**
 * Заголовок листа организатора: ячейка со словом «Параметр» и ячейка, начинающаяся с «Баз»
 * («Базовое значение»). Единица — ячейка «Ед. изм.» или «Единица».
 */
function findOrganizerHeader(rows: readonly string[][]): Header | null {
  const scan = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < scan; r++) {
    const norm = (rows[r] ?? []).map((c) => normalizeLabel(c));
    const label = norm.findIndex((c) => c.includes("параметр"));
    const base = norm.findIndex((c, i) => i !== label && c.startsWith("баз"));
    if (label >= 0 && base >= 0) {
      const unit = norm.findIndex((c) => c.startsWith("ед изм") || c === "единица" || c.startsWith("единица измерения"));
      return { row: r, cols: { label, base, unit } };
    }
  }
  return null;
}

/** Строка-раздел листа организатора («▌ ПЕРСОНАЛ», объединённые ячейки) или сноска. */
function isSectionRow(row: readonly string[], label: string, value: string, unit: string): boolean {
  if (/^[▌■►●•]/.test(label)) return true;
  const filled = row.map((c) => c.trim()).filter((c) => c !== "");
  if (filled.length > 1 && filled.every((c) => c === label)) return true;
  return value === "" && unit === "";
}

/** Лист относится к типу объекта `facility` (по имени). */
function sheetIsFacility(name: string | null, facility: string): boolean {
  if (!name) return false;
  const n = normalizeLabel(name);
  return (FACILITY_SHEET_NAMES[facility] ?? []).some((f) => n === f || n.startsWith(`${f} `));
}

/** Тип объекта, к которому по имени относится лист, или null. */
function sheetFacility(name: string | null): string | null {
  for (const f of Object.keys(FACILITY_SHEET_NAMES)) if (sheetIsFacility(name, f)) return f;
  return null;
}

type Extracted = {
  entries: RawParamEntry[];
  /** Строки организатора, не сопоставленные ни с одним параметром. */
  unmatched: { label: string; row: number }[];
};

function extractTemplate(sheet: SheetData, header: Header, defs: readonly ParamSpec[]): Extracted {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const entries: RawParamEntry[] = [];
  const pending: { label: string; key: string; value: string; unit: string; row: number }[] = [];
  const { key: kc, value: vc, label: lc, unit: uc } = header.cols as { key: number; value: number; label: number; unit: number };
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const key = cell(row, kc);
    const label = cell(row, lc);
    if (!key && !label) continue;
    const value = stripFormulaGuard(cell(row, vc));
    const unit = cell(row, uc);
    if (key && byKey.has(key)) entries.push({ key, value, unit, row: r + 1 });
    else pending.push({ key, label, value, unit, row: r + 1 });
  }
  // Ключ стёрт или испорчен, но название осталось — сопоставляем по названию.
  const matched = matchLabelsToDefs(
    pending.map((p) => ({ label: p.label, unit: p.unit })),
    defs.filter((d) => !entries.some((e) => e.key === d.key)),
  );
  pending.forEach((p, i) => {
    const def = matched[i];
    entries.push({ key: def ? def.key : p.key || p.label, value: p.value, unit: p.unit, row: p.row });
  });
  entries.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return { entries, unmatched: [] };
}

function extractOrganizer(sheet: SheetData, header: Header, defs: readonly ParamSpec[]): Extracted {
  const { label: lc, base: bc, unit: uc } = header.cols as { label: number; base: number; unit: number };
  const rows: { label: string; value: string; unit: string; row: number }[] = [];
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const label = cell(row, lc);
    if (!label) continue;
    const value = stripFormulaGuard(cell(row, bc));
    const unit = cell(row, uc);
    if (isSectionRow(row, label, value, unit)) continue;
    rows.push({ label, value, unit, row: r + 1 });
  }
  const matched = matchLabelsToDefs(rows, defs);
  const entries: RawParamEntry[] = [];
  const unmatched: Extracted["unmatched"] = [];
  rows.forEach((x, i) => {
    const def = matched[i];
    if (def) entries.push({ key: def.key, value: x.value, unit: x.unit, row: x.row });
    else unmatched.push({ label: x.label, row: x.row });
  });
  return { entries, unmatched };
}

/** Строка отчёта «загружено» или «по умолчанию» для параметра без проблем. */
function infoItem(def: ParamSpec, entry: RawParamEntry | undefined, value: number | string | null): ParamInfoItem {
  const fromFile = entry !== undefined && !isAbsent(entry.value) && !isBlank(def, entry.value);
  if (fromFile) {
    const item: ParamInfoItem = {
      key: def.key,
      label: def.label,
      code: "ok",
      severity: "info",
      message: `Загружено: ${withUnit(value, def.unit)}`,
    };
    if (entry.row !== undefined) item.row = entry.row;
    return item;
  }
  const where = entry ? "Пустое значение в файле" : "Нет в файле";
  const message =
    def.base === null
      ? `${where} — значение не задано (необязательный параметр)`
      : `${where} — взято значение по умолчанию: ${withUnit(def.base, def.unit)} (${defaultSourceText(def)})`;
  const item: ParamInfoItem = { key: def.key, label: def.label, code: "defaulted", severity: "info", message };
  if (entry?.row !== undefined) item.row = entry.row;
  return item;
}

function buildResult(
  layout: ParamsLayout,
  sheetName: string | null,
  extracted: Extracted,
  defs: readonly ParamSpec[],
): ParsedParamsFile {
  const { values, issues } = validateParamValues(defs, extracted.entries, { origin: "upload" });
  const defKeys = new Set(defs.map((d) => d.key));
  const firstEntry = new Map<string, RawParamEntry>();
  for (const e of extracted.entries) if (defKeys.has(e.key) && !firstEntry.has(e.key)) firstEntry.set(e.key, e);

  const report: ParamReportItem[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    const own = issues.filter((i) => i.key === def.key);
    if (own.length > 0) report.push(...own);
    else report.push(infoItem(def, firstEntry.get(def.key), values[def.key] ?? null));
  }
  report.push(...issues.filter((i) => !defKeys.has(i.key)));
  for (const u of extracted.unmatched) report.push(unmatchedRowIssue(u.label, u.row));

  const found = firstEntry.size;
  if (found === 0) {
    return {
      ok: false,
      message:
        "В файле не найдено ни одного параметра этого объекта. Скачайте шаблон и перенесите значения в столбец «Значение»",
    };
  }
  return {
    ok: true,
    layout,
    sheetName,
    values,
    report,
    found,
    errors: report.filter((i) => i.severity === "error").length,
    warnings: report.filter((i) => i.severity === "warning").length,
  };
}

/**
 * Разбирает листы файла в значения параметров объекта. Сначала ищется наш шаблон (на листе
 * «Параметры», если он есть, иначе на любом), затем лист организатора для типа объекта из
 * `defs`. Значения проверяются `validateParamValues` с origin 'upload'.
 *
 * `defs` — описания параметров ОДНОГО типа объекта (тип берётся из первого описания): по нему
 * выбирается лист организатора, и с ними сопоставляются строки.
 */
export function parseParamsSheets(sheets: readonly SheetData[], defs: readonly ParamSpec[]): ParsedParamsFile {
  if (defs.length === 0) {
    return { ok: false, message: "Для этого типа объекта не описаны параметры — обратитесь к администратору" };
  }
  const facility = defs[0]?.facility ?? "";
  const facilityLabel = FACILITY_LABELS[facility] ?? facility;

  // 1. Наш шаблон.
  const ordered = [...sheets].sort(
    (a, b) => Number(normalizeLabel(b.name ?? "") === "параметры") - Number(normalizeLabel(a.name ?? "") === "параметры"),
  );
  for (const sheet of ordered) {
    const header = findTemplateHeader(sheet.rows);
    if (header) return buildResult("template", sheet.name, extractTemplate(sheet, header, defs), defs);
  }

  // 2. Лист организатора.
  const candidates = sheets
    .map((sheet) => ({ sheet, header: findOrganizerHeader(sheet.rows) }))
    .filter((c): c is { sheet: SheetData; header: Header } => c.header !== null);
  if (candidates.length === 0) {
    return {
      ok: false,
      message:
        "Не найдена строка заголовков. Используйте шаблон (столбцы «Ключ» и «Значение») или лист датасета организатора (столбцы «Параметр» и «Базовое значение»)",
    };
  }
  const own = candidates.find((c) => sheetIsFacility(c.sheet.name, facility));
  let chosen = own;
  if (!chosen) {
    const only = candidates.length === 1 ? candidates[0] : undefined;
    const otherFacility = only ? sheetFacility(only.sheet.name) : null;
    if (only && (otherFacility === null || otherFacility === facility)) chosen = only;
    else if (only) {
      const other = FACILITY_LABELS[otherFacility ?? ""] ?? only.sheet.name ?? "";
      return {
        ok: false,
        message: `Лист «${other}» относится к другому типу объекта — загрузите лист «${facilityLabel}» или смените тип объекта`,
      };
    } else {
      return {
        ok: false,
        message: `В файле несколько листов с параметрами, но нет листа «${facilityLabel}». Оставьте нужный лист или переименуйте его в «${facilityLabel}»`,
      };
    }
  }
  return buildResult("organizer", chosen.sheet.name, extractOrganizer(chosen.sheet, chosen.header, defs), defs);
}
