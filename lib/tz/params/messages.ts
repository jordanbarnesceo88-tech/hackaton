import { formatNum } from "../../format/rub";
import { originLabel } from "../characteristics";
import type { ParamIssue, ParamIssueCode, ParamSpec } from "../types";

/**
 * Тексты проверки параметров (ТЗ §3.2.4, требования к интерфейсу §4.5.3): каждое сообщение
 * по-русски говорит, что не так, и как это исправить. Модуль чистый — его используют и форма
 * ручного ввода в браузере, и разбор файла на сервере.
 */

/** Единица для текста: прочерк и пустая строка организатора означают «безразмерная». */
export function unitText(unit: string | null | undefined): string {
  const u = (unit ?? "").trim();
  return u === "-" || u === "—" || u === "–" ? "" : u;
}

/** Сколько знаков после запятой нужно, чтобы показать число без потерь (не больше 6). */
function fractionDigits(n: number): number {
  const m = /\.(\d+)$/.exec(String(n));
  return m?.[1] ? Math.min(6, m[1].length) : 0;
}

/** Число по-русски без потери дробной части: 1.302 → «1,302», 20000 → «20 000». */
export function formatNumberRu(n: number): string {
  return formatNum(n, fractionDigits(n));
}

/** Значение параметра для сообщения или отчёта: число по-русски, текст как есть, null — «—». */
export function formatParamValue(v: number | string | null | undefined): string {
  if (typeof v === "number") return formatNumberRu(v);
  if (typeof v === "string") return v;
  return "—";
}

/** Значение с единицей: «20 000 м²»; для безразмерных — только число. */
export function withUnit(v: number | string | null | undefined, unit: string | null | undefined): string {
  const u = unitText(unit);
  const text = formatParamValue(v);
  return u && v !== null && v !== undefined ? `${text} ${u}` : text;
}

/** Введённое значение для цитаты в сообщении: обрезанное до 60 символов. */
export function rawText(raw: unknown): string {
  let s: string;
  if (typeof raw === "string") s = raw.trim();
  else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
  else if (raw === null || raw === undefined) s = "";
  else s = Object.prototype.toString.call(raw);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/**
 * Пример ввода: берётся из `ParamSpec.example`; если он уже начинается со слова «например»
 * (генератор данных пишет «например, 1 000»), второй раз слово не добавляется. Нет примера —
 * показывается значение по умолчанию.
 */
export function examplePhrase(def: ParamSpec): string {
  const ex = def.example.trim();
  if (ex) return /^например/i.test(ex) ? ex : `например ${ex}`;
  if (def.base !== null) return `например ${formatParamValue(def.base)}`;
  return "";
}

/** Диапазон организатора словами: «10 000–100 000 м²», «не меньше 0 %», «не больше 5 лет». */
export function rangeText(def: ParamSpec): string {
  const u = unitText(def.unit);
  const tail = u ? ` ${u}` : "";
  if (def.min !== null && def.max !== null) return `${formatNumberRu(def.min)}–${formatNumberRu(def.max)}${tail}`;
  if (def.min !== null) return `не меньше ${formatNumberRu(def.min)}${tail}`;
  if (def.max !== null) return `не больше ${formatNumberRu(def.max)}${tail}`;
  return "";
}

/** Источник значения по умолчанию одной строкой: «Организатор, Датасеты_хакатон.xlsx › Склад › стр. 4». */
export function defaultSourceText(def: ParamSpec): string {
  const parts = [originLabel(def.origin)];
  if (def.sourceRef) parts.push(def.sourceRef);
  else if (def.sourceUrl) parts.push(def.sourceUrl);
  return parts.join(", ");
}

function issue(
  def: Pick<ParamSpec, "key" | "label">,
  code: ParamIssueCode,
  severity: ParamIssue["severity"],
  message: string,
  row?: number,
): ParamIssue {
  return row === undefined
    ? { key: def.key, label: def.label, code, severity, message }
    : { key: def.key, label: def.label, code, severity, message, row };
}

/** Обязательное поле пусто. */
export function missingRequiredIssue(def: ParamSpec, row?: number): ParamIssue {
  const u = unitText(def.unit);
  const ex = examplePhrase(def);
  const how = [u ? `Введите значение в ${u}` : "Введите значение", ex].filter(Boolean).join(", ");
  return issue(def, "missing_required", "error", `Не заполнено обязательное поле «${def.label}». ${how}`, row);
}

/** Вместо числа — текст («abc») или значение не того типа. */
export function wrongTypeIssue(def: ParamSpec, raw: unknown, row?: number): ParamIssue {
  return issue(
    def,
    "wrong_type",
    "error",
    `${def.label}: «${rawText(raw)}» — не число. Введите число, дробную часть через запятую`,
    row,
  );
}

/** Похоже на число, но записано неверно («12,5,3», «1.2.3»). */
export function badNumberFormatIssue(def: ParamSpec, raw: unknown, row?: number): ParamIssue {
  return issue(
    def,
    "bad_number_format",
    "error",
    `${def.label}: «${rawText(raw)}» — не число. Введите число, дробную часть через запятую`,
    row,
  );
}

/** Габариты записаны не как «Д×Ш×В». */
export function badDimsIssue(def: ParamSpec, raw: unknown, row?: number): ParamIssue {
  const u = unitText(def.unit);
  const ex = typeof def.base === "string" && def.base ? def.base : "1200×800×1600";
  return issue(
    def,
    "wrong_type",
    "error",
    `${def.label}: «${rawText(raw)}» — не габариты. Введите два или три положительных числа${u ? ` в ${u}` : ""} через «×», например ${ex}`,
    row,
  );
}

/** Текст длиннее допустимого. */
export function textTooLongIssue(def: ParamSpec, max: number, row?: number): ParamIssue {
  return issue(def, "wrong_type", "error", `${def.label}: слишком длинный текст — сократите до ${max} символов`, row);
}

/** Отрицательное значение там, где диапазон организатора его не допускает. */
export function negativeIssue(def: ParamSpec, v: number, row?: number): ParamIssue {
  return issue(
    def,
    "negative",
    "error",
    `${def.label}: ${formatNumberRu(v)} — значение не может быть отрицательным. Введите число не меньше 0`,
    row,
  );
}

/** Дробное значение у целочисленного параметра. */
export function notIntegerIssue(def: ParamSpec, raw: unknown, row?: number): ParamIssue {
  const ex = examplePhrase(def);
  return issue(
    def,
    "not_integer",
    "error",
    `${def.label}: «${rawText(raw)}» — нужно целое число. Введите число без дробной части${ex ? `, ${ex}` : ""}`,
    row,
  );
}

/** Значение не из списка вариантов. */
export function badOptionIssue(def: ParamSpec, raw: unknown, row?: number): ParamIssue {
  const list = def.options.map((o) => `«${o}»`).join(", ");
  return issue(
    def,
    "bad_option",
    "error",
    `${def.label}: «${rawText(raw)}» — нет такого варианта. Выберите один из: ${list}`,
    row,
  );
}

/** Вне диапазона организатора — предупреждение: значение принимается и подсвечивается. */
export function outOfRangeIssue(def: ParamSpec, v: number, row?: number): ParamIssue {
  return issue(
    def,
    "out_of_range",
    "warning",
    `${def.label}: ${formatNumberRu(v)} вне диапазона организатора ${rangeText(def)} — проверьте значение`,
    row,
  );
}

/** Изменено значение, зафиксированное организатором (min = max) — принимается с записью в журнал. */
export function lockedChangedIssue(def: ParamSpec, row?: number): ParamIssue {
  return issue(
    def,
    "locked_changed",
    "warning",
    `${def.label}: значение зафиксировано организатором (${withUnit(def.base, def.unit)}); изменение будет записано в журнал`,
    row,
  );
}

/** Параметр, которого нет среди описаний объекта. */
export function unknownKeyIssue(key: string, row?: number): ParamIssue {
  return issue(
    { key, label: key },
    "unknown_key",
    "error",
    `Неизвестный параметр «${rawText(key)}» — уберите строку или сверьтесь с шаблоном`,
    row,
  );
}

/**
 * Строка листа организатора, которую не удалось сопоставить ни с одним параметром по названию.
 * Предупреждение, а не ошибка: это ограничение сопоставления, а не ошибка пользователя, и
 * остальные строки загружаются. Ключ проблемы — название строки из файла.
 */
export function unmatchedRowIssue(label: string, row?: number): ParamIssue {
  return issue(
    { key: label, label },
    "unknown_key",
    "warning",
    `Строка «${rawText(label)}» не сопоставлена ни с одним параметром — значение не загружено. Проверьте название или загрузите шаблон`,
    row,
  );
}

/** Параметр указан в файле больше одного раза. */
export function duplicateKeyIssue(def: ParamSpec, firstRow: number | undefined, row?: number): ParamIssue {
  const where =
    firstRow !== undefined && row !== undefined ? ` (строки ${firstRow} и ${row})` : "";
  return issue(
    def,
    "duplicate_key",
    "error",
    `${def.label}: параметр указан дважды${where} — оставьте одну строку`,
    row,
  );
}

/** Единица в файле не совпадает с единицей параметра. */
export function unitMismatchIssue(def: ParamSpec, fileUnit: string, row?: number): ParamIssue {
  const u = unitText(def.unit);
  return issue(
    def,
    "unit_mismatch",
    "error",
    `${def.label}: единица «${rawText(fileUnit)}» не совпадает с «${u}» — пересчитайте значение в ${u}`,
    row,
  );
}
