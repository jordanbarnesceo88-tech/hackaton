// только сервер: через xlsx.ts подключает exceljs
import { decodeText, parseCsv } from "../../files/csv";
import type { ParamSpec } from "../types";
import { parseParamsSheets, type ParsedParamsFile, type SheetData } from "./sheets";
import { readWorkbook } from "./xlsx";

export type { ParamInfoItem, ParamReportItem, ParamsLayout, ParsedParamsFile } from "./sheets";

/**
 * Загрузка параметров объекта из файла (ТЗ §2.2 шаг 2, §3.2.3–§3.2.4): .xlsx или .csv по
 * нашему шаблону либо лист датасета организатора. Файл разбирается в памяти и нигде не
 * сохраняется (§4.4.6). Размер файла проверяет вызывающий код (действие загрузки).
 */

/** Сообщение для неподдерживаемого формата. */
export const UNSUPPORTED_FILE_MESSAGE = "Поддерживаются файлы .xlsx и .csv по шаблону";

function extensionOf(fileName: string): string {
  const m = /\.([^.\\/]+)$/.exec(fileName.trim().toLowerCase());
  return m?.[1] ?? "";
}

/** XLSX — это zip-архив: первые байты «PK». */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Разбирает файл параметров. По расширению выбирается чтение: .csv — текст (UTF-8, UTF-16 или
 * Windows-1251, разделитель «;» или «,»), .xlsx — книга Excel. Затем `parseParamsSheets`
 * находит наш шаблон (столбец «Ключ») или лист организатора (по имени типа объекта: «Склад»,
 * «Аэропорт», «Медучреждение»), сопоставляет строки и проверяет значения с origin 'upload'.
 *
 * Возвращает `ok: false` с сообщением «что сделать», если файл целиком не читается, иначе —
 * полный набор значений, отчёт по каждому параметру и вид таблицы (`layout`).
 */
export async function parseParamsFile(
  bytes: Uint8Array,
  fileName: string,
  defs: readonly ParamSpec[],
): Promise<ParsedParamsFile> {
  const ext = extensionOf(fileName);
  let sheets: SheetData[];
  if (ext === "csv") {
    sheets = [{ name: null, rows: parseCsv(decodeText(bytes)) }];
  } else if (ext === "xlsx") {
    if (!looksLikeZip(bytes)) {
      return {
        ok: false,
        message:
          "Файл не похож на книгу Excel .xlsx (возможно, он защищён паролем или переименован). Откройте его в Excel и сохраните как «Книга Excel (*.xlsx)»",
      };
    }
    try {
      sheets = await readWorkbook(bytes);
    } catch {
      return {
        ok: false,
        message: "Не удалось прочитать файл .xlsx. Откройте его в Excel и сохраните заново как «Книга Excel (*.xlsx)»",
      };
    }
  } else if (ext === "xls") {
    return {
      ok: false,
      message: `${UNSUPPORTED_FILE_MESSAGE}. Старый формат .xls сохраните в Excel как «Книга Excel (*.xlsx)»`,
    };
  } else {
    return { ok: false, message: UNSUPPORTED_FILE_MESSAGE };
  }
  return parseParamsSheets(sheets, defs);
}
