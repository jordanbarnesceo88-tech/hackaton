// USD→RUB conversion rate. Placeholder constant for Week 1; Week 2 replaces this with an
// editable value from the Assumption table (see execution plan §4 / Opus review C1-cluster).
// Update to a current rate before any live client demo.
export const USD_TO_RUB = 90;

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

// NOTE: deliberately NOT `style: "currency", currency: "USD"` here. Under en-US, CLDR
// treats USD as the locale's "home" currency and renders it with the bare "$" symbol
// (no "US" disambiguator) — confirmed on Node 22 / ICU 76 / CLDR 46, where no
// `currencyDisplay` variant ("symbol" | "narrowSymbol" | "code" | "name") produces
// "US$". That symbol choice is CLDR-version-dependent, which is exactly the kind of
// runtime drift a pinned formatter is meant to avoid. So: format the number only (still
// locale-pinned for deterministic grouping) and prefix the literal "US$" ourselves.
const usdNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/**
 * Format a USD amount for display: RUB primary (converted at `rateRub`), USD in parens.
 * `rateRub` defaults to the documented `USD_TO_RUB` constant; callers with the editable
 * `usdToRub` assumption in scope (I6) pass it so an edited rate is reflected live. Uses pinned
 * locales so server and client produce byte-identical output (no hydration mismatch).
 * Example: formatCost(45000) -> "4 050 000 ₽ (US$45,000)".
 */
export function formatCost(usd: number, rateRub: number = USD_TO_RUB): string {
  const rate = Number.isFinite(rateRub) && rateRub > 0 ? rateRub : USD_TO_RUB;
  const rub = rubFormatter.format(usd * rate);
  const usdStr = `US$${usdNumberFormatter.format(usd)}`;
  return `${rub} (${usdStr})`;
}
