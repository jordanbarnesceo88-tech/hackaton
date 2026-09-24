/**
 * CSV для загрузки параметров объекта и для выгрузок (ТЗ §3.2.3, §3.7.3). Модуль без
 * зависимостей: его импортируют и сервер, и браузер, поэтому библиотека XLSX сюда не
 * подключается (она только на сервере, см. lib/tz/params/xlsx.ts).
 *
 * Формат рассчитан на русский Excel:
 * - в начале BOM, иначе Excel откроет UTF-8 как cp1251 и покажет «кракозябры»;
 * - разделитель «;», потому что запятая — десятичный знак;
 * - строки разделяются CRLF;
 * - ячейка в кавычках, если в ней есть разделитель, кавычка или перевод строки, а кавычки
 *   внутри удваиваются;
 * - защита от формул (CSV injection): текст, который начинается с = + - @, получает ведущий
 *   апостроф, чтобы Excel не выполнил его как формулу. Числа не трогаются: −5 остаётся числом.
 */

/** Разделитель полей CSV. Табуляция — для «Текст Юникод» из Excel. */
export type CsvSeparator = ";" | "," | "\t";

/** Значение ячейки при записи: текст, число или пусто. */
export type CsvCell = string | number | null | undefined;

export type ToCsvOptions = {
  /** Десятичная запятая в числах (по умолчанию да — для русского Excel). */
  decimalComma?: boolean;
  /** Разделитель полей (по умолчанию «;»). */
  separator?: ";" | ",";
};

const BOM = "﻿";

/** Сколько первых записей смотреть при определении разделителя. */
const DETECT_RECORDS = 20;

/**
 * Определяет разделитель по первым записям файла: считает «;», «,» и табуляции вне кавычек.
 * Побеждает «;», если его не меньше, чем запятых (при равенстве — тоже «;»: это формат
 * русского Excel и наших шаблонов). Табуляция выбирается, только если других разделителей нет.
 */
export function detectCsvSeparator(text: string): CsvSeparator {
  let semi = 0;
  let comma = 0;
  let tab = 0;
  let records = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length && records < DETECT_RECORDS; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n") records++;
    else if (ch === ";") semi++;
    else if (ch === ",") comma++;
    else if (ch === "\t") tab++;
  }
  if (semi === 0 && comma === 0 && tab > 0) return "\t";
  return comma > semi ? "," : ";";
}

/**
 * Разбирает CSV в массив строк. BOM срезается, разделитель определяется автоматически («;» или
 * «,»; табуляция — если других нет), поддерживаются поля в кавычках с разделителями, удвоенными
 * кавычками и переводами строк внутри, окончания строк CRLF, LF и CR.
 *
 * Пустая строка в середине файла даёт запись `[""]`, чтобы номер записи совпадал с номером
 * строки в файле (сообщения об ошибках ссылаются на строку). Перевод строки в конце файла
 * лишней записи не создаёт. Разбор мягкий: кавычка в середине поля без кавычек — обычный символ.
 */
export function parseCsv(text: string, separator?: CsvSeparator): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = separator ?? detectCsvSeparator(s);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "" && !quotedField) {
      inQuotes = true;
      quotedField = true;
      i++;
      continue;
    }
    if (ch === sep) {
      row.push(field);
      field = "";
      quotedField = false;
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quotedField = false;
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || quotedField || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Защита от формул: текст, который после обрезки пробелов начинается с = + - @ (или сразу
 * начинается с табуляции или CR), получает ведущий апостроф. Excel тогда покажет его как текст.
 */
export function guardFormula(text: string): string {
  if (/^[=+\-@]/.test(text.trim()) || /^[\t\r]/.test(text)) return `'${text}`;
  return text;
}

/**
 * Снимает апостроф, добавленный `guardFormula`, — при чтении собственного файла назад.
 * Апостроф перед обычным текстом не трогается.
 */
export function stripFormulaGuard(text: string): string {
  return /^'\s*[=+\-@]/.test(text) || /^'[\t\r]/.test(text) ? text.slice(1) : text;
}

/**
 * Число для CSV: без разделителей групп разрядов (иначе Excel прочтёт его как текст), с
 * десятичной запятой при `decimalComma`. NaN и ±∞ — пустая ячейка, «−0» — «0».
 */
export function formatCsvNumber(n: number, decimalComma = true): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  let s = String(n);
  if (/e/i.test(s)) s = expandExponent(n);
  return decimalComma ? s.replace(".", ",") : s;
}

/** Запись числа без экспоненты: 1e-7 → «0.0000001», 1e21 → «1000000000000000000000». */
function expandExponent(n: number): string {
  if (Math.abs(n) >= 1) return BigInt(Math.round(n)).toString();
  return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

function csvCell(cell: CsvCell, sep: string, decimalComma: boolean): string {
  if (cell === null || cell === undefined) return "";
  const text = typeof cell === "number" ? formatCsvNumber(cell, decimalComma) : guardFormula(cell);
  const needsQuotes = text.includes(sep) || text.includes(";") || /["\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Собирает CSV для русского Excel: BOM, разделитель «;», CRLF, числа с десятичной запятой,
 * кавычки по необходимости и защита текста от формул. Числа передавайте числами, а не
 * отформатированными строками: строка «-640 375» получит апостроф как потенциальная формула.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[], opts: ToCsvOptions = {}): string {
  const decimalComma = opts.decimalComma ?? true;
  const sep = opts.separator ?? ";";
  return BOM + rows.map((r) => r.map((c) => csvCell(c, sep, decimalComma)).join(sep)).join("\r\n");
}

/** Экранирует символ для вставки в регулярное выражение. */
function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Разбирает число в русской записи: «2 700 000,00» → 2700000, «1,302» → 1.302, «−25» → −25.
 * Пробелы любого вида (обычный, неразрывный, узкий, тонкий) игнорируются. Правила для
 * разделителей:
 * - одна запятая или одна точка — десятичный знак;
 * - есть и запятая, и точка — десятичный знак тот, что стоит последним, другой — разделитель
 *   групп по три цифры («2.700.000,00», «2,700,000.00»);
 * - несколько точек — только как разделитель групп по три цифры («2.700.000»);
 * - несколько запятых без точки — неоднозначно («2,700,000» по-русски не число) → null.
 * Экспоненциальная запись, проценты и единицы не разбираются. null — не число.
 */
export function parseRuNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input + 0 : null;
  if (typeof input !== "string") return null;
  let s = input.replace(/\s/g, "").replace(/^[−–—]/, "-");
  if (s === "") return null;
  const commas = countChar(s, ",");
  const dots = countChar(s, ".");
  if (commas > 0 && dots > 0) {
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thou = dec === "," ? "." : ",";
    if (countChar(s, dec) > 1) return null;
    const cut = s.lastIndexOf(dec);
    const intPart = s.slice(0, cut);
    const fracPart = s.slice(cut + 1);
    if (!new RegExp(`^[+-]?\\d{1,3}(${escapeRe(thou)}\\d{3})+$`).test(intPart)) return null;
    s = `${intPart.split(thou).join("")}.${fracPart}`;
  } else if (commas > 1) {
    return null;
  } else if (commas === 1) {
    s = s.replace(",", ".");
  } else if (dots > 1) {
    if (!/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) return null;
    s = s.replace(/\./g, "");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n + 0 : null;
}

/**
 * Текст файла из байтов. Порядок: UTF-16 LE с BOM («Текст Юникод» из Excel), затем строгий
 * UTF-8 (BOM срезается), а если байты не UTF-8 — Windows-1251: так сохраняет CSV русский
 * Excel («CSV (разделители — точка с запятой)»).
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}
