/**
 * Форматирование рублёвых сумм и чисел для модели tz-1.0.0. Модель считает только в рублях,
 * без конвертации (в отличие от v1 `formatCost`, который показывает доллары в скобках).
 *
 * Форматтеры закреплены на локали ru-RU и созданы один раз: сервер и браузер обязаны выдавать
 * одинаковые строки, иначе гидратация расходится. Два вида пробелов, и это часть контракта:
 * - между числом и единицей («₽», «%», «млн») — обычный пробел U+0020, как в контракте T0.1:
 *   `formatMRub(35420000) === "35,4 млн ₽"` и `formatPct(140.31) === "140 %"` верны буквально;
 * - разделитель групп разрядов ставит ICU — в ru-RU это неразрывный пробел (U+00A0), поэтому
 *   строки с тысячами («2 700 000 ₽») сравниваются после замены `/\s/g` на обычный пробел.
 * Чтобы единица не отрывалась от числа при переносе, ячейка задаёт `white-space: nowrap`
 * (в Tailwind — `whitespace-nowrap`); форматтер за перенос не отвечает.
 *
 * Нечисловой вход (NaN, ±∞, null) показывается как «—»: расчёт не должен подсовывать на экран
 * «NaN ₽».
 */

/** Пробел между числом и единицей измерения — обычный (U+0020), см. комментарий к модулю. */
const UNIT_SEP = " ";

/** Прочерк для отсутствующего или нечислового значения. */
const DASH = "—";

const formatters = new Map<number, Intl.NumberFormat>();

/** Форматтер ru-RU с ровно `digits` знаками после запятой (кэшируется по числу знаков). */
function formatterFor(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

/** Нормализует число знаков: целое от 0 до 20 (предел Intl.NumberFormat). */
function normDigits(digits: number): number {
  if (!Number.isFinite(digits)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(digits)));
}

/**
 * Число в ru-RU без «−0»: значения, которые округляются до нуля, выводятся как «0», а не
 * «-0» (Intl сохраняет знак отрицательного нуля).
 */
function fmt(n: number, digits: number): string {
  const d = normDigits(digits);
  const v = Math.abs(n) < 0.5 * 10 ** -d ? 0 : n;
  return formatterFor(d).format(v);
}

/** Сумма в рублях без копеек: 2700000 → «2 700 000 ₽». */
export function formatRub(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  return `${fmt(n, 0)}${UNIT_SEP}₽`;
}

/**
 * Крупная сумма в миллионах с одним знаком: 35420000 → «35,4 млн ₽». Суммы меньше 10 млн
 * показываются полностью через `formatRub`, чтобы «1,5 млн» не скрывало разницу в сотни тысяч.
 */
export function formatMRub(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  if (Math.abs(n) < 10_000_000) return formatRub(n);
  return `${fmt(n / 1_000_000, 1)}${UNIT_SEP}млн${UNIT_SEP}₽`;
}

/**
 * Сумма всегда в миллионах с одним знаком: 38500000 → «38,5 млн ₽», 1055102 → «1,1 млн ₽».
 * Для отчёта, где все суммы основной части — в одних единицах (точные рубли — в приложениях).
 */
export function formatMlnRub(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  return `${fmt(n / 1_000_000, 1)}${UNIT_SEP}млн${UNIT_SEP}₽`;
}

/**
 * Суммы от миллиона рублей внутри готовой фразы — в миллионах, как `formatMlnRub`:
 * «цена 2 200 000 ₽ не подтверждена» → «цена 2,2 млн ₽ не подтверждена». Меньшие суммы
 * («при зарплате от 110 939 ₽/мес») не меняются: в миллионах они потеряли бы смысл.
 */
export function mlnInText(text: string): string {
  return text.replace(/([-−])?(\d{1,3}(?:[ \u00A0\u202F]\d{3}){2,})[ \u00A0\u202F]?₽/g, (_m, sign: string | undefined, digits: string) => {
    const v = Number(digits.replace(/[ \u00A0\u202F]/g, ""));
    return formatMlnRub(sign ? -v : v);
  });
}

/** Число в ru-RU с заданным числом знаков после запятой: 2.9 → «2,9» при digits = 1. */
export function formatNum(n: number | null | undefined, digits = 0): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  return fmt(n, digits);
}

/**
 * Процент: `n` уже в процентах (140.31), а не доля (1.4031) → «140 %». Так формулы ROI по ТЗ
 * (× 100 %) и подписи в интерфейсе используют одно и то же значение.
 */
export function formatPct(n: number | null | undefined, digits = 0): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  return `${fmt(n, digits)}${UNIT_SEP}%`;
}
