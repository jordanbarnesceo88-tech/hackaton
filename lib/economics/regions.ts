// Regional labor-cost + energy-factor presets for RF regions (#8a). Opt-in convenience: picking a
// region sets `laborCostPerHourUsd` and `energyCostFactor` (both remain editable). Sourced, not
// invented — see docs/data-provenance.md for the per-region citations + the "verify before a live
// demo" caveat.
//
// The wage is stored in RUBLES, which is the unit the sources are actually published in, and
// converted to USD at the rate currently in the assumptions. It used to be stored as a USD figure
// derived once at a hardcoded 90 ₽/$ — but `usdToRub` is an editable assumption (I6), so the two
// drifted apart the moment anyone touched it: at 110 ₽/$ the «Москва» preset implied a wage of
// 1 320 ₽/h against a cited 1 077 ₽/h, a 23% overstatement of a figure the docs present as
// sourced. Storing the ruble rate makes the citation the source of truth and the USD a derived
// display/engine value, which is the right way round.
//
// Derivation: cited 2025 average MONTHLY wage (₽, Rosstat-based) ÷ ~168 work hours/month.
// energyCostFactor is an APPROXIMATE regional index relative to Москва = 1.0 (RF industrial-tariff
// variation is ~±30%), not a per-kWh figure.

/** Work hours in an average month, the divisor behind every wage below. */
export const WORK_HOURS_PER_MONTH = 168;

export type RegionPreset = {
  id: string;
  name: string;
  /** Cited average monthly wage, ₽. Kept so the derivation stays auditable against the source. */
  monthlyWageRub: number;
  /** Derived hourly wage, ₽ — what the preset actually applies. */
  laborCostRubPerHour: number;
  energyCostFactor: number; // multiplier on energyUsdYear; Москва = 1.0 reference
};

const preset = (
  id: string,
  name: string,
  monthlyWageRub: number,
  energyCostFactor: number
): RegionPreset => ({
  id,
  name,
  monthlyWageRub,
  laborCostRubPerHour: Math.round(monthlyWageRub / WORK_HOURS_PER_MONTH),
  energyCostFactor,
});

export const REGION_PRESETS: RegionPreset[] = [
  preset("moscow", "Москва", 180860, 1.0),
  preset("spb", "Санкт-Петербург", 121475, 0.95),
  preset("rf-avg", "РФ — среднее", 100360, 0.9),
  // Сев. Кавказ, напр. Ингушетия/Чечня
  preset("low-cost", "Низкозатратный регион (СКФО)", 46281, 0.8),
];

/**
 * The preset's wage in the unit the engine works in. `usdToRub` is the live assumption, so a
 * region picked after the rate is edited reflects the rate the user is actually working with.
 */
export function regionLaborCostUsd(region: RegionPreset, usdToRub: number): number {
  const rate = Number.isFinite(usdToRub) && usdToRub > 0 ? usdToRub : 90;
  // To the cent: this lands in an editable field the user sees, and 11.966666666666667 is not a
  // wage. The rounding is well below the precision the underlying estimate carries anyway.
  return Math.round((region.laborCostRubPerHour / rate) * 100) / 100;
}
