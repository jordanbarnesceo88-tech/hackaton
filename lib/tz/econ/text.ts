import { formatMRub, formatRub } from "../../format/rub";
import { pluralRu } from "../../format/plural";

/**
 * Форматирование чисел для подстановок в формулы и текстов рисков и вывода. Локаль ru-RU
 * закреплена, как в lib/format/rub.ts: сервер и браузер обязаны выдавать одинаковые строки,
 * иначе сохранённый результат не совпадёт с пересчитанным на экране.
 */

const formatters = new Map<number, Intl.NumberFormat>();

/** Форматтер ru-RU «до `digits` знаков после запятой» (лишние нули не печатаются). */
function upTo(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

/**
 * Число для подстановки в формулу: целые — без дробной части, от тысячи — до целых, от единицы —
 * до сотых, доли — до четырёх знаков. «−0» не выводится; нечисловое значение — «—».
 */
export function fx(v: number, digits?: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = digits ?? (Number.isInteger(v) ? 0 : a >= 1000 ? 0 : a >= 1 ? 2 : 4);
  const shown = a < 0.5 * 10 ** -d ? 0 : v;
  return upTo(d).format(shown);
}

/** Сумма в рублях без копеек: «2 700 000 ₽». */
export function rub(v: number): string {
  return formatRub(v);
}

/** Крупная сумма: от 10 млн — «35,4 млн ₽», меньше — полностью. */
export function mrub(v: number): string {
  return formatMRub(v);
}

/** Доля как процент для текста: 0.052 → «5,2 %». */
export function share(v: number, digits = 1): string {
  return `${fx(v * 100, digits)} %`;
}

/** Название в кавычках-«ёлочках». */
export function q(name: string): string {
  return `«${name}»`;
}

/** «5 лет», «3 года», «1 год» — именительный падеж для счёта лет. */
export function yearsNom(n: number): string {
  const r = Math.round(n * 10) / 10;
  const word = Number.isInteger(r) ? pluralRu(r, ["год", "года", "лет"]) : "года";
  return `${fx(r, 1)} ${word}`;
}

/**
 * Родительный падеж после «менее», «более», «≥»: «менее 3 лет», «более 1 года», «≥ 21 года».
 * Дробное значение — «года» («менее 2,5 года»).
 */
export function yearsGen(n: number): string {
  const r = Math.round(n * 10) / 10;
  const whole = Number.isInteger(r);
  const oneLike = whole && Math.abs(r) % 10 === 1 && Math.abs(r) % 100 !== 11;
  return `${fx(r, 1)} ${!whole || oneLike ? "года" : "лет"}`;
}

/** Сокращение единицы потока для текстов: «паллет/ч» → «пал./ч». */
export function unitShort(unit: string): string {
  return unit === "паллет/ч" ? "пал./ч" : unit;
}

/**
 * Диапазон рычага с единицей: доли показываются процентами («30–70 %», «8–20 % в год»),
 * остальное — как есть («80 000–170 000 ₽/мес»).
 */
export function rangeText(low: number, high: number, unit: string): string {
  if (unit === "доля" || unit.startsWith("доля ")) {
    const tail = unit === "доля" ? "" : unit.slice("доля".length);
    return `${fx(low * 100, 1)}–${fx(high * 100, 1)} %${tail}`;
  }
  return `${fx(low)}–${fx(high)} ${unit}`;
}
