import { toCsv, type CsvCell } from "../../files/csv";
import { originLabel } from "../characteristics";
import type { ParamSpec } from "../types";
import { unitText } from "./messages";

/**
 * Шаблон загрузки параметров объекта (ТЗ §3.2.3: «загрузка данных из Excel/CSV по шаблону»).
 * Один и тот же набор столбцов в CSV (здесь, без зависимостей) и в XLSX (`xlsx.ts`, только
 * сервер). Столбец «Значение» заранее заполнен значениями по умолчанию, рядом — единица,
 * диапазон организатора, пример и источник значения (ТЗ §3.2.5: показывать значения по
 * умолчанию и источник каждого норматива).
 */

/** Заголовки столбцов шаблона. Разбор ищет строку с «Ключ» и «Значение». */
export const TEMPLATE_HEADERS = [
  "Ключ",
  "Раздел",
  "Параметр",
  "Единица",
  "Значение",
  "Мин",
  "Макс",
  "Обязательный",
  "Пример",
  "Источник/примечание",
] as const;

/** Номер столбца (с 0) по заголовку — чтобы XLSX-оформление не расходилось с CSV. */
export const TEMPLATE_COL = {
  key: 0,
  section: 1,
  label: 2,
  unit: 3,
  value: 4,
  min: 5,
  max: 6,
  required: 7,
  example: 8,
  source: 9,
} as const;

/** Подпись типа объекта для имени шаблона и листа инструкции. */
export const FACILITY_LABELS: Readonly<Record<string, string>> = {
  warehouse: "Склад",
  airport: "Аэропорт",
  medical: "Медучреждение",
};

/** Описания в порядке показа (`order`), при равенстве — в исходном порядке. */
export function sortDefs(defs: readonly ParamSpec[]): ParamSpec[] {
  return defs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.order - b.d.order || a.i - b.i)
    .map((x) => x.d);
}

/**
 * Источник и примечание одной строкой: происхождение значения по умолчанию, ссылка на место у
 * организатора или в сети, формула и основание для расчётных и оценочных значений, примечание
 * организатора дословно и отметка о фиксированном значении.
 */
export function paramSourceNote(def: ParamSpec): string {
  const parts: string[] = [];
  const where = def.sourceRef ?? def.sourceUrl;
  parts.push(where ? `${originLabel(def.origin)}: ${where}` : originLabel(def.origin));
  if (def.sourceRef && def.sourceUrl) parts.push(def.sourceUrl);
  if (def.formula) parts.push(`Формула: ${def.formula}`);
  if (def.basis) parts.push(`Основание: ${def.basis}`);
  if (def.organizerNote) parts.push(`Примечание организатора: ${def.organizerNote}`);
  if (def.locked) parts.push("Зафиксировано организатором — изменение будет записано в журнал");
  return parts.join(". ");
}

/** Строки шаблона без заголовка: по одной на параметр, в порядке показа. */
export function templateRows(defs: readonly ParamSpec[]): CsvCell[][] {
  return sortDefs(defs).map((def) => [
    def.key,
    def.section,
    def.label,
    unitText(def.unit),
    def.base,
    def.min,
    def.max,
    def.required ? "да" : "нет",
    def.example,
    paramSourceNote(def),
  ]);
}

/**
 * Шаблон параметров в CSV для русского Excel: BOM, «;», десятичная запятая, CRLF. Первая
 * строка — заголовки `TEMPLATE_HEADERS`.
 */
export function paramsTemplateCsv(defs: readonly ParamSpec[]): string {
  return toCsv([[...TEMPLATE_HEADERS], ...templateRows(defs)]);
}
