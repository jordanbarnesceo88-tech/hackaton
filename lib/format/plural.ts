/**
 * Pick the Russian plural form of a noun for a count.
 * `forms` = [one, few, many], e.g. ["год", "года", "лет"] or ["робот", "робота", "роботов"].
 */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

// Pinned ru-RU formatter, matching the money formatter's approach: server and client must
// produce byte-identical output or hydration mismatches. Russian writes a decimal comma, so
// `toFixed` was wrong here — it emits a Latin point regardless of locale, which put "4.9 года"
// on the same screen as the assumption inputs' "0,15" and the money formatter's "4 500 000 ₽".
const yearsFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Format a duration in years (shown to one decimal) with correct RU noun agreement.
 * Fractional quantities take the genitive singular ("1,5 года"); whole numbers follow the
 * standard count rules ("1 год", "3 года", "5 лет", "21 год").
 */
export function formatYearsRu(years: number): string {
  const rounded = Math.round(years * 10) / 10;
  const isWhole = Number.isInteger(rounded);
  const word = isWhole ? pluralRu(rounded, ["год", "года", "лет"]) : "года";
  return `${yearsFormatter.format(rounded)} ${word}`;
}
