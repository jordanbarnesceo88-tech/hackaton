import { pluralRu } from "../../format/plural";
import { formatNum } from "../../format/rub";

/**
 * Форматирование чисел в текстах подбора. Причины исключения и ограничения показываются
 * пользователю дословно (ТЗ §3.4.2: «причины соответствия, ограничения и недостающие данные»),
 * поэтому числа в них пишутся по-русски: десятичная запятая, минус «−», знак «+» у
 * положительной температуры. Форматтеры ru-RU закреплены в `lib/format/rub.ts`, так что сервер
 * и браузер дают одинаковые строки.
 */

/** Минус для отрицательных чисел в тексте (U+2212), а не дефис. */
const MINUS = "−";

/** Допуск сравнения при выборе числа знаков: 2,9 × 10 в двоичной арифметике не ровно 29. */
const EPS = 1e-9;

/**
 * Число без лишних нулей: целое — без дробной части, иначе один или два знака после запятой.
 * 2.9 → «2,9», 0.75 → «0,75», 1500 → «1 500» (разряды разделяет ICU неразрывным пробелом).
 * Нечисловое значение (NaN, ±∞) — «—»: в тексте причины не бывает «NaN».
 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const digits = Math.abs(n - Math.round(n)) < EPS ? 0 : Math.abs(n * 10 - Math.round(n * 10)) < EPS ? 1 : 2;
  const s = formatNum(Math.abs(n), digits);
  return n < 0 && s !== "0" ? `${MINUS}${s}` : s;
}

/** Температура со знаком: 5 → «+5», 0 → «0», −18 → «−18». */
export function fmtTemp(t: number): string {
  const s = fmtNum(t);
  return t > 0 ? `+${s}` : s;
}

/** Диапазон рабочих температур продукта: «+5…+25 °C», «от −35 °C», «до +40 °C». */
export function fmtTempRange(minC: number | null, maxC: number | null): string {
  if (minC !== null && maxC !== null) return `${fmtTemp(minC)}…${fmtTemp(maxC)} °C`;
  if (minC !== null) return `от ${fmtTemp(minC)} °C`;
  if (maxC !== null) return `до ${fmtTemp(maxC)} °C`;
  return "не опубликована";
}

/** Процент без знаков после запятой: 0.875 (доля) → «88 %». */
export function fmtShareAsPct(share: number): string {
  return `${fmtNum(Math.round(share * 100))} %`;
}

/** Названия базовых типов объектов для текстов причин. */
export const FACILITY_LABELS: Readonly<Record<string, string>> = {
  warehouse: "Склад",
  airport: "Аэропорт",
  medical: "Медучреждение",
};

/** Название типа объекта; для неизвестного slug — сам slug, чтобы причина не потеряла смысл. */
export function facilityLabel(facility: string): string {
  return FACILITY_LABELS[facility] ?? facility;
}

const ORDINALS = ["лучший", "второй", "третий", "четвёртый", "пятый", "шестой", "седьмой", "восьмой", "девятый", "десятый"];

/** Место в рейтинге словом: 1 → «лучший», 2 → «второй», 11 → «11-й». */
export function ordinalRu(rank: number): string {
  return ORDINALS[rank - 1] ?? `${rank}-й`;
}

/** «среди 4 кандидатов», «среди 21 кандидата» — родительный падеж после «среди». */
export function amongCandidates(n: number): string {
  return `среди ${n} ${pluralRu(n, ["кандидата", "кандидатов", "кандидатов"])}`;
}
