// только сервер: exceljs не попадает в клиентский бандл
import ExcelJS from "exceljs";
import type { ParamSpec } from "../types";
import type { SheetData } from "./sheets";
import { FACILITY_LABELS, TEMPLATE_COL, TEMPLATE_HEADERS, sortDefs, templateRows } from "./template";
import { rangeText } from "./messages";

/**
 * Чтение и запись XLSX для параметров объекта (ТЗ §3.2.3). Только сервер: exceljs — пакет
 * Node (потоки, zip), он подключён через `serverExternalPackages` и в браузер не попадает.
 * Разбор строк и проверка — в чистых модулях `sheets.ts` и `validate.ts`.
 */

/** Ограничения чтения: лишние строки и столбцы не превращаются в строки ячеек. */
export type ReadLimits = { maxRows?: number; maxCols?: number };

const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_MAX_COLS = 60;

/**
 * Процентный формат числа: «0%», «0,0%». Знак «%» внутри текста в кавычках («0" %"») и
 * экранированный («0\%») процентом не делают.
 */
function isPercentFormat(numFmt: string | undefined): boolean {
  if (!numFmt) return false;
  return numFmt.replace(/"[^"]*"/g, "").replace(/\\./g, "").includes("%");
}

/**
 * Текст ячейки ExcelJS: число — как в JS («1.302»), формула — её результат, дата — ГГГГ-ММ-ДД.
 * Число в процентном формате — как его видит пользователь: Excel хранит введённые «7%» как
 * 0,07, а проценты у параметров записаны целыми (5 = 5 %), поэтому возвращается «7%».
 */
function cellText(value: ExcelJS.CellValue | undefined, numFmt?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return isPercentFormat(numFmt) ? `${String(Math.round(value * 100 * 1e9) / 1e9)}%` : String(value);
  }
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if ("richText" in value) return value.richText.map((t) => t.text).join("");
  if ("formula" in value || "sharedFormula" in value) {
    return cellText((value as { result?: ExcelJS.CellValue }).result, numFmt);
  }
  if ("error" in value) return String(value.error);
  if ("text" in value) {
    const t = (value as { text: unknown }).text;
    if (typeof t === "string") return t;
    if (t && typeof t === "object" && "richText" in t) {
      return (t as { richText: { text: string }[] }).richText.map((x) => x.text).join("");
    }
  }
  return "";
}

/** Копия байтов в отдельный ArrayBuffer — exceljs и JSZip принимают его без оговорок. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

/**
 * Читает книгу XLSX в листы строк. Строка i массива — строка i+1 листа (пустые строки
 * сохраняются, чтобы номера в сообщениях совпадали с Excel). Объединённые ячейки дают значение
 * главной ячейки. Бросает исключение, если байты — не XLSX; вызывающий код переводит его в
 * сообщение пользователю.
 */
export async function readWorkbook(bytes: Uint8Array, limits: ReadLimits = {}): Promise<SheetData[]> {
  const maxRows = limits.maxRows ?? DEFAULT_MAX_ROWS;
  const maxCols = limits.maxCols ?? DEFAULT_MAX_COLS;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(bytes));
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    const last = Math.min(ws.rowCount, maxRows);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const n = Math.min(row.cellCount, maxCols);
      const cells: string[] = [];
      for (let c = 1; c <= n; c++) {
        const cell = row.getCell(c);
        cells.push(cellText(cell.value, cell.numFmt));
      }
      rows.push(cells);
    }
    return { name: ws.name, rows };
  });
}

/** Ширины столбцов шаблона в символах, по порядку TEMPLATE_HEADERS. */
const COLUMN_WIDTHS = [26, 30, 48, 14, 20, 11, 11, 14, 20, 80];

const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
const FILL_EDIT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const FILL_LOCKED: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };

/**
 * Список вариантов для проверки данных Excel: формула — строка в кавычках через запятую не
 * длиннее 255 символов, без запятых и кавычек внутри вариантов. Если не помещается —
 * выпадающего списка нет, варианты перечислены в примечании к ячейке.
 */
function listFormula(options: readonly string[]): string | null {
  if (options.length === 0 || options.some((o) => /[,"]/.test(o))) return null;
  const f = `"${options.join(",")}"`;
  return f.length <= 255 ? f : null;
}

/**
 * Шаблон параметров объекта в XLSX. Лист «Параметры» со столбцами `TEMPLATE_HEADERS`:
 * закреплённая строка заголовков, ширины столбцов, фильтр, «Значение» заранее заполнено
 * значениями по умолчанию и выделено цветом; у перечислений — выпадающий список, у чисел с
 * диапазоном — мягкая проверка Excel (предупреждение, а не запрет: вне диапазона значение
 * принимается). Второй лист «Как заполнить» — короткая инструкция.
 */
export async function writeParamsTemplateXlsx(defs: readonly ParamSpec[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Платформа оценки роботизации";
  const facility = defs[0]?.facility ?? "";
  const facilityLabel = FACILITY_LABELS[facility] ?? facility;

  const ws = wb.addWorksheet("Параметры", { views: [{ state: "frozen", xSplit: 0, ySplit: 1 }] });
  ws.columns = TEMPLATE_HEADERS.map((header, i) => ({ header, width: COLUMN_WIDTHS[i] ?? 14 }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };
  head.eachCell((c) => {
    c.fill = FILL_HEADER;
  });
  head.getCell(TEMPLATE_COL.value + 1).note =
    "Меняйте только этот столбец. Дробную часть — через запятую, габариты — через «×».";
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TEMPLATE_HEADERS.length } };

  const sorted = sortDefs(defs);
  const rows = templateRows(sorted);
  rows.forEach((values, i) => {
    const def = sorted[i];
    if (!def) return;
    const row = ws.addRow(values.map((v) => (v === undefined ? null : v)));
    row.alignment = { vertical: "top", wrapText: true };
    const valueCell = row.getCell(TEMPLATE_COL.value + 1);
    valueCell.fill = def.locked ? FILL_LOCKED : FILL_EDIT;
    valueCell.alignment = { vertical: "top", wrapText: false };

    if (def.kind === "enum" && def.options.length > 0) {
      const formula = listFormula(def.options);
      if (formula) {
        valueCell.dataValidation = {
          type: "list",
          allowBlank: !def.required,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: "stop",
          errorTitle: "Нет такого варианта",
          error: `Выберите один из вариантов: ${def.options.join(", ")}`,
        };
      } else {
        valueCell.note = `Варианты: ${def.options.join("; ")}`;
      }
    } else if (
      (def.kind === "number" || def.kind === "integer" || def.kind === "percent") &&
      def.min !== null &&
      def.max !== null &&
      !def.locked
    ) {
      valueCell.dataValidation = {
        type: def.kind === "integer" ? "whole" : "decimal",
        operator: "between",
        allowBlank: !def.required,
        formulae: [def.min, def.max],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Вне диапазона организатора",
        error: `Диапазон организатора: ${rangeText(def)}. Значение будет принято с предупреждением.`,
      };
    }
  });

  const help = wb.addWorksheet("Как заполнить");
  help.getColumn(1).width = 110;
  const lines = [
    `Шаблон параметров объекта — ${facilityLabel}`,
    "1. Меняйте только столбец «Значение» на листе «Параметры». Остальные столбцы — справка: единица, диапазон организатора, пример и источник значения по умолчанию.",
    "2. Дробную часть вводите через запятую (1,5). Габариты — три числа через «×»: 1200×800×1600.",
    "3. Значение вне диапазона «Мин»–«Макс» будет принято с предупреждением. Обязательные поля (столбец «Обязательный» = да) нельзя оставлять пустыми.",
    "4. Удалённая строка и пустое значение необязательного параметра заменяются значением по умолчанию; у обязательного параметра без значения по умолчанию это ошибка. Отчёт о загрузке покажет каждую такую строку.",
    "5. Не меняйте столбец «Ключ»: по нему значения сопоставляются с параметрами.",
    "6. Можно загрузить и лист датасета организатора (Датасеты_хакатон.xlsx): строки сопоставляются по названию параметра.",
  ];
  lines.forEach((text, i) => {
    const c = help.getCell(i + 1, 1);
    c.value = text;
    c.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) c.font = { bold: true, size: 13 };
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
