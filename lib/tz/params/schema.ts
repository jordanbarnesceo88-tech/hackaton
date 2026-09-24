import { parseRuNumber, stripFormulaGuard } from "../../files/csv";
import type { ParamIssue, ParamSpec, ParamValues } from "../types";
import {
  badDimsIssue,
  badNumberFormatIssue,
  badOptionIssue,
  negativeIssue,
  notIntegerIssue,
  textTooLongIssue,
  unitMismatchIssue,
  wrongTypeIssue,
} from "./messages";

/**
 * Схема параметров объекта (ТЗ §3.2.2–§3.2.5): значения по умолчанию, приведение введённого
 * значения к типу параметра и проверка диапазона организатора. Чистый модуль без exceljs —
 * работает и в форме ручного ввода в браузере, и при разборе файла на сервере.
 */

/** Наибольшая длина текстового параметра: длиннее — это не значение, а вставленный абзац. */
export const MAX_TEXT_LENGTH = 500;

/** Значение отсутствует: не передано вовсе (undefined) или передано как null. */
export function isAbsent(raw: unknown): raw is null | undefined {
  return raw === undefined || raw === null;
}

/**
 * Значение явно оставлено пустым: пустая строка или одни пробелы. Для числовых параметров и
 * габаритов пустым считается и одиночный прочерк («-», «—», «–»), которым организатор отмечает
 * «нет значения». Для текста прочерк остаётся значением: «-» в поле ERP может значить «нет».
 */
export function isBlank(def: ParamSpec, raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (s === "") return true;
  return isNumericKind(def) || def.kind === "dims" ? /^[-—–]$/.test(s) : false;
}

/** Параметр числовой: число, целое или процент. */
export function isNumericKind(def: ParamSpec): boolean {
  return def.kind === "number" || def.kind === "integer" || def.kind === "percent";
}

/**
 * Полный набор значений по описаниям параметров: где значения нет (undefined, null, пустая
 * строка или NaN), подставляется базовое значение организатора `base`. Ключи, которых нет среди
 * описаний, отбрасываются; порядок ключей — порядок описаний.
 *
 * Типы здесь не проверяются: строка «1 000» останется строкой. Введённые пользователем
 * значения сначала проходят `validateParamValues`, который возвращает уже приведённые значения.
 */
export function applyDefaults(
  defs: readonly ParamSpec[],
  values: Readonly<Record<string, unknown>> | null | undefined,
): ParamValues {
  const out: ParamValues = {};
  for (const def of defs) {
    const v = values?.[def.key];
    if (typeof v === "number" && Number.isFinite(v)) out[def.key] = v;
    else if (typeof v === "string" && v.trim() !== "") out[def.key] = v;
    else out[def.key] = def.base;
  }
  return out;
}

/** Результат приведения: значение нужного типа или проблема с сообщением «как исправить». */
export type CoerceResult =
  | { ok: true; value: number | string | null }
  | { ok: false; issue: ParamIssue };

/** Допуск сравнения с границей диапазона: защищает от «2,8000000000000003 > 2,8». */
function eps(bound: number): number {
  return 1e-9 * Math.max(1, Math.abs(bound));
}

/**
 * Значение вне диапазона организатора [min, max]. Граница null — с этой стороны ограничения нет.
 * Нечисловое значение вне диапазона не бывает.
 */
export function isOutOfRange(def: Pick<ParamSpec, "min" | "max">, v: unknown): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (def.min !== null && v < def.min - eps(def.min)) return true;
  if (def.max !== null && v > def.max + eps(def.max)) return true;
  return false;
}

/** Строка для сравнения вариантов: без регистра, «ё» как «е», пробелы схлопнуты. */
function normText(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/**
 * Совпадает ли значение с базовым (для зафиксированных параметров): числа — с допуском,
 * строки — без регистра и лишних пробелов.
 */
export function sameParamValue(a: number | string | null, b: number | string | null): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= eps(b);
  if (typeof a === "string" && typeof b === "string") return normText(a) === normText(b);
  return a === b;
}

/**
 * Знак, потерянный при перекодировке: «?» — так русский Excel сохраняет в CSV (Windows-1251)
 * символы, которых нет в этой кодовой странице («²», «×», «−», «₽»), U+FFFD — замена
 * нераспознанного байта при декодировании.
 */
const LOST_CHAR = /[?\uFFFD]/;

/** В строке есть знак, потерянный при перекодировке (см. LOST_CHAR). */
export function hasLostChars(s: string): boolean {
  return LOST_CHAR.test(s);
}

/**
 * Строки совпадают, если считать каждый потерянный знак («?» или U+FFFD) в любой из них одним
 * любым символом: «м?» = «м²», «1200?800» = «1200×800». Длина (в символах) должна совпадать.
 */
export function equalsWithLostChars(a: string, b: string): boolean {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length !== y.length) return false;
  return x.every((ch, i) => {
    const other = y[i] ?? "";
    return ch === other || LOST_CHAR.test(ch) || LOST_CHAR.test(other);
  });
}

/** С этих знаков хвост-единица начаться не может: это часть числа. */
const NUMBER_CHAR = /[\d\s.,+\-−–—']/;
/** У габаритов к ним добавляются разделители «×», «x», «х», «*» и потерянный знак. */
const DIMS_CHAR = /[\d\s.,+\-−–—'×xXхХ*?\uFFFD]/;

/**
 * Делит ввод на число и дописанную после него единицу: «20 000 м²» → «20 000» и «м²»,
 * «1200×800×1600 мм» → «1200×800×1600» и «мм». Хвост начинается после цифры с первого знака,
 * который не может быть частью числа (у габаритов — и разделителем «×»). Не считается единицей
 * хвост с двумя цифрами подряд («1200x800» — это не число с единицей «x800») и экспонента
 * («1E+05»). Хвоста нет — null.
 */
function splitUnitSuffix(def: ParamSpec, s: string): { head: string; tail: string } | null {
  const numberChar = def.kind === "dims" ? DIMS_CHAR : NUMBER_CHAR;
  for (let i = 1; i < s.length; i++) {
    if (!/\d/.test(s[i - 1] ?? "")) continue;
    const rest = s.slice(i).trim();
    const first = rest.charAt(0);
    if (first === "" || numberChar.test(first)) continue;
    if (/\d\d/.test(rest) || /^e[+-]?\d/i.test(rest)) return null;
    return { head: s.slice(0, i).trim(), tail: rest };
  }
  return null;
}

/**
 * Дописанная к числу единица — это единица параметра (с учётом синонимов и потерянных при
 * перекодировке знаков): «м2» и «кв. м» для «м²», «шт» для «шт.», «%» для процента. У
 * безразмерного параметра дописанный хвост единицей не считается.
 */
function isUnitOfParam(def: ParamSpec, tail: string): boolean {
  if (def.kind === "percent" && tail === "%") return true;
  if (normalizeUnit(def.unit) === "") return false;
  return unitsCompatible(tail, def.unit);
}

/**
 * Срезает единицу, которую пользователь дописал к значению: «20 000 м²», «20 000 м2», «5 шт»,
 * «30 %». Если дописана другая единица («20 000 га» у параметра в м²), а перед ней стоит
 * значение (`isValue`), возвращается она: вызывающий код сообщит `unit_mismatch`, а не «не
 * число». Иначе строка возвращается без изменений — дальше её разберёт проверка формата.
 */
function stripUnitSuffix(
  def: ParamSpec,
  s: string,
  isValue: (head: string) => boolean,
): { value: string } | { wrongUnit: string } {
  const split = splitUnitSuffix(def, s);
  if (!split) return { value: s };
  if (isUnitOfParam(def, split.tail)) return { value: split.head };
  if (normalizeUnit(def.unit) !== "" && isValue(split.head)) return { wrongUnit: split.tail };
  return { value: s };
}

function coerceNumber(def: ParamSpec, raw: unknown, row?: number): CoerceResult {
  let n: number | null;
  if (typeof raw === "number") {
    n = Number.isFinite(raw) ? raw + 0 : null;
    if (n === null) return { ok: false, issue: wrongTypeIssue(def, raw, row) };
  } else if (typeof raw === "string") {
    const stripped = stripUnitSuffix(def, stripFormulaGuard(raw.trim()), (h) => parseRuNumber(h) !== null);
    if ("wrongUnit" in stripped) return { ok: false, issue: unitMismatchIssue(def, stripped.wrongUnit, row) };
    const s = stripped.value;
    n = parseRuNumber(s);
    if (n === null) {
      const issue = /\d/.test(s) ? badNumberFormatIssue(def, raw, row) : wrongTypeIssue(def, raw, row);
      return { ok: false, issue };
    }
  } else {
    return { ok: false, issue: wrongTypeIssue(def, raw, row) };
  }
  if (n < 0 && !(def.min !== null && def.min < 0)) return { ok: false, issue: negativeIssue(def, n, row) };
  if (def.kind === "integer") {
    const r = Math.round(n);
    if (Math.abs(n - r) > eps(n)) return { ok: false, issue: notIntegerIssue(def, raw, row) };
    n = r + 0;
  }
  return { ok: true, value: n };
}

function coerceEnum(def: ParamSpec, raw: unknown, row?: number): CoerceResult {
  let s: string;
  if (typeof raw === "boolean") s = raw ? "Да" : "Нет";
  else if (typeof raw === "number" && Number.isFinite(raw)) s = String(raw);
  else if (typeof raw === "string") s = stripFormulaGuard(raw.trim());
  else return { ok: false, issue: badOptionIssue(def, raw, row) };
  const wanted = normText(s);
  let hit = def.options.find((o) => normText(o) === wanted);
  if (hit === undefined && hasLostChars(wanted)) {
    // CSV из русского Excel: «Морозильный (ниже ?18 °C)» вместо «−18». Принимается, только
    // если под такой ввод подходит ровно один вариант.
    const close = def.options.filter((o) => equalsWithLostChars(wanted, normText(o)));
    if (close.length === 1) hit = close[0];
  }
  return hit === undefined ? { ok: false, issue: badOptionIssue(def, raw, row) } : { ok: true, value: hit };
}

function coerceText(def: ParamSpec, raw: unknown, row?: number): CoerceResult {
  let s: string;
  if (typeof raw === "string") s = stripFormulaGuard(raw.trim());
  else if (typeof raw === "number" && Number.isFinite(raw)) s = String(raw);
  else if (typeof raw === "boolean") s = raw ? "Да" : "Нет";
  else return { ok: false, issue: wrongTypeIssue(def, raw, row) };
  if (s.length > MAX_TEXT_LENGTH) return { ok: false, issue: textTooLongIssue(def, MAX_TEXT_LENGTH, row) };
  return { ok: true, value: s };
}

/**
 * Два или три положительных числа габаритов или null. Разделители — «×», латинская или русская
 * «х», «*», а также «?» и U+FFFD: так «×» приходит из CSV русского Excel (Windows-1251).
 */
function parseDims(s: string): number[] | null {
  const parts = s.split(/\s*[×xXхХ*?\uFFFD]\s*/);
  if (parts.length < 2 || parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = parseRuNumber(p);
    if (n === null || n <= 0) return null;
    nums.push(n);
  }
  return nums;
}

/**
 * Габариты «Д×Ш×В»: два или три положительных числа через «×», латинскую или русскую «х», «*»
 * или потерянный при перекодировке «×» («1200?800?1600»). Результат нормализуется к виду
 * «1200×800×1600» (дробная часть — через запятую).
 */
function coerceDims(def: ParamSpec, raw: unknown, row?: number): CoerceResult {
  if (typeof raw !== "string") return { ok: false, issue: badDimsIssue(def, raw, row) };
  const stripped = stripUnitSuffix(def, stripFormulaGuard(raw.trim()), (h) => parseDims(h) !== null);
  if ("wrongUnit" in stripped) return { ok: false, issue: unitMismatchIssue(def, stripped.wrongUnit, row) };
  const nums = parseDims(stripped.value);
  if (!nums) return { ok: false, issue: badDimsIssue(def, raw, row) };
  return { ok: true, value: nums.map((n) => String(n).replace(".", ",")).join("×") };
}

/**
 * Приводит одно введённое значение к типу параметра. Пустое значение (см. `isAbsent`,
 * `isBlank`) даёт `{ ok: true, value: null }` — решение «ошибка или значение по умолчанию»
 * принимает `validateParamValues`, потому что оно зависит от `required`.
 *
 * Правила по видам параметра:
 * - number / integer / percent: число или строка в русской записи («2 700 000,00», «1,5»);
 *   дописанная единица параметра («20 000 м²», «20 000 м2», «30 %») срезается, чужая
 *   («20 000 га» у параметра в м²) — ошибка `unit_mismatch`; отрицательное — ошибка
 *   `negative`, если диапазон организатора не уходит ниже нуля; для integer дробное —
 *   `not_integer`;
 * - enum: вариант без учёта регистра и лишних пробелов, возвращается в написании варианта;
 *   true/false — «Да»/«Нет»; знак, потерянный при перекодировке («?»), подходит к любому
 *   символу, если так совпадает ровно один вариант; вариантов нет — как text;
 * - text: строка без крайних пробелов, не длиннее MAX_TEXT_LENGTH;
 * - dims: «Д×Ш×В», разделителем может быть и потерянный при перекодировке «?».
 * `row` попадает в проблему — это номер строки файла при загрузке.
 */
export function coerce(def: ParamSpec, raw: unknown, row?: number): CoerceResult {
  if (isAbsent(raw) || isBlank(def, raw)) return { ok: true, value: null };
  switch (def.kind) {
    case "number":
    case "integer":
    case "percent":
      return coerceNumber(def, raw, row);
    case "enum":
      return def.options.length > 0 ? coerceEnum(def, raw, row) : coerceText(def, raw, row);
    case "text":
      return coerceText(def, raw, row);
    case "dims":
      return coerceDims(def, raw, row);
  }
}

/** Синонимы слов в единицах: «руб.» = «₽», «поддон» = «паллет», «сутки» = «сут» и т. п. */
const UNIT_WORDS: Readonly<Record<string, string>> = {
  руб: "₽",
  рубль: "₽",
  рубля: "₽",
  рублей: "₽",
  р: "₽",
  rub: "₽",
  поддон: "паллет",
  поддона: "паллет",
  поддоны: "паллет",
  поддонов: "паллет",
  паллета: "паллет",
  паллеты: "паллет",
  паллетов: "паллет",
  паллетоместа: "паллетомест",
  паллетомест: "паллетомест",
  мп: "паллетомест",
  сутки: "сут",
  суток: "сут",
  штук: "шт",
  штуки: "шт",
  час: "ч",
  часа: "ч",
  часов: "ч",
  дней: "дн",
  день: "дн",
  дня: "дн",
  год: "лет",
  года: "лет",
  месяц: "мес",
  человек: "чел",
  смена: "смен",
  смены: "смен",
  кг: "кг",
  kg: "кг",
  m: "м",
};

/**
 * Единица в сравнимом виде: без регистра, точек и пробелов, с заменой синонимов. «руб./мес.»,
 * «₽/мес» и «рублей/месяц» дают одно и то же; «м/п» и «паллетомест» — тоже; прочерк —
 * безразмерная величина (пустая строка).
 */
export function normalizeUnit(unit: string | null | undefined): string {
  let s = (unit ?? "").toLowerCase().replace(/ё/g, "е").trim();
  if (s === "-" || s === "—" || s === "–") return "";
  // «м/п» (паллетоместа у организатора) — до удаления точек и разбора слов, иначе «/» его разорвёт.
  // \b в JS не видит границ кириллических слов, поэтому границы заданы явно.
  s = s.replace(/(^|[^а-яa-z])м\s*\/\s*п(?=$|[^а-яa-z])/g, "$1мп");
  s = s.replace(/\./g, "");
  s = s.replace(/[a-zа-я]+/g, (w) => UNIT_WORDS[w] ?? w);
  s = s.replace(/\s+/g, "");
  s = s.replace(/кв(м)$/, "м²").replace(/м2(?=\/|$)/g, "м²").replace(/м\^2/g, "м²");
  return s;
}

/**
 * Совместимы ли единицы файла и параметра. Если одна из них не указана или безразмерная,
 * проверять нечего — считаются совместимыми.
 *
 * Знак, потерянный при перекодировке («?» или U+FFFD), совпадает с любым одним символом: CSV,
 * сохранённый русским Excel в Windows-1251, приносит «м?» вместо «м²» и «?/мес» вместо «₽/мес».
 * Обе единицы сначала нормализуются, поэтому «м?» совместима с «м2» и «кв. м».
 */
export function unitsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeUnit(a);
  const y = normalizeUnit(b);
  if (x === "" || y === "" || x === y) return true;
  return (hasLostChars(x) || hasLostChars(y)) && equalsWithLostChars(x, y);
}
