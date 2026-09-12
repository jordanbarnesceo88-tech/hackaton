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
// Д-1. МЕНЯЕТ ЧИСЛА. The same argument, one level up. The presets used to compute
// `monthlyWageRub / 168`, which is a WAGE — while `laborCostPerHourUsd`, the field a preset
// writes into, is defined (docs/data-provenance.md, «Стоимость труда») as the EMPLOYER's cost of
// an hour: gross salary plus the 30% единый тариф страховых взносов (п. 3 ст. 425 НК РФ). One
// field, two meanings, and the presets came out ~31% low on the dominant lever of the whole
// model. They now apply the document's own derivation, so «picked a region» and «left the default
// alone» mean the same thing:
//
//     laborCostRubPerHour = monthlyWageRub × 1,30 ÷ (hoursPerYear / 12)
//
// The stored, auditable figure stays the cited monthly wage. The citation is the source of truth;
// every hourly and USD figure is derived from it in code, where a test can re-run the arithmetic.
//
// What the two derivations do NOT share is their wage input, and that is deliberate. The global
// default comes from five warehouse/production salary surveys (65 000–90 000 ₽/мес, no Moscow
// premium); these presets are Rosstat-based regional AVERAGES across all sectors, so «РФ —
// среднее» (100 360 ₽/мес) sits above that band by construction. Same formula, different
// population — not a discrepancy to average away.
//
// energyCostFactor is an APPROXIMATE regional index relative to Москва = 1.0 (RF industrial-tariff
// variation is ~±30%), not a per-kWh figure.

import { DEFAULT_ASSUMPTIONS } from "./assumptions";

/**
 * Work hours in an average month, the divisor behind every wage below.
 *
 * 166,67 — **not** 168. One quantity had two divisors: this file used a flat 168 while
 * docs/data-provenance.md derives the labour rate at `hoursPerYear / 12`. The engine breaks the
 * tie. `calculate.ts` annualises the rate as `laborCostPerHourUsd * hoursPerYear` (2 000 h), so
 * dividing by 168 (⇒ 2 016 h/год) would turn a cited monthly wage into a yearly salary nobody
 * cited: the round trip `monthlyWageRub × взносы × 12 === laborCostRubPerHour × hoursPerYear`
 * would miss by ~0,8%. Derived from the assumption instead of retyped as a literal, so the two
 * cannot drift apart again — pinned by regions.test.ts.
 */
export const WORK_HOURS_PER_MONTH = DEFAULT_ASSUMPTIONS.hoursPerYear / 12;

/**
 * Страховые взносы работодателя как множитель к окладу: единый тариф **30%** с выплат до
 * предельной базы (п. 3 ст. 425 НК РФ). При окладах этого порядка годовая база остаётся ниже
 * предельной, поэтому пониженная ставка 15,1% сверх базы не включается. Источники и полная
 * арифметика — docs/data-provenance.md, раздел «Стоимость труда».
 */
export const EMPLOYER_CONTRIBUTION_MULTIPLIER = 1.3;

export type RegionPreset = {
  id: string;
  name: string;
  /** Cited average monthly wage, ₽. Kept so the derivation stays auditable against the source. */
  monthlyWageRub: number;
  /**
   * Derived EMPLOYER cost of an hour, ₽ — wage × взносы ÷ hours, the same quantity
   * `laborCostPerHourUsd` holds. This is what the preset actually applies.
   */
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
  laborCostRubPerHour: Math.round(
    (monthlyWageRub * EMPLOYER_CONTRIBUTION_MULTIPLIER) / WORK_HOURS_PER_MONTH
  ),
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
  // To the cent: this lands in an editable field the user sees, and 15.677777777777777 is not a
  // wage. The rounding is well below the precision the underlying estimate carries anyway.
  return Math.round((region.laborCostRubPerHour / rate) * 100) / 100;
}
