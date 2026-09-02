import { formatCost } from "@/lib/format/currency";
import { formatYearsRu } from "@/lib/format/plural";
import type { CalculableResult } from "@/lib/economics/types";

export type EconomicsRow = { key: string; label: string; value: string };

/**
 * The canonical ordered label/value rows of a calculable economics result. The interactive
 * results panel and the print report render the same ten figures with the same formatting
 * rules — the null-payback wording, the RU year pluralisation, the whole-unit money
 * formatter — and each used to spell all of that out itself, so a new engine figure had to be
 * added twice and could drift in between.
 *
 * Only the container and two labels differ between the two surfaces, so callers pass the
 * label variant they want and lay the rows out in their own markup (a 2-column print grid vs.
 * a stacked card). Non-economical and invalid-input states are NOT rows: each surface words
 * and styles those notices differently, so they stay at the call site.
 */
export function economicsRows(
  result: CalculableResult,
  usdToRub: number,
  labels: { roi: string; npv: string }
): EconomicsRow[] {
  const money = (usd: number) => formatCost(usd, usdToRub);
  const rows: EconomicsRow[] = [
    { key: "quantity", label: "Требуется единиц", value: String(result.quantity) },
    {
      key: "displacedFte",
      label: "Замещается персонала (ЭПЗ)",
      value: result.displacedFte.toFixed(1),
    },
    { key: "capex", label: "CAPEX", value: money(result.capexUsd) },
    { key: "opex", label: "OPEX/год", value: money(result.opexAnnualUsd) },
    {
      key: "baseline",
      label: "Базовые затраты на труд/год",
      value: money(result.baselineAnnualUsd),
    },
  ];
  if (!result.economical) return rows;

  return [
    ...rows,
    { key: "savings", label: "Годовая экономия", value: money(result.annualSavingsUsd) },
    {
      key: "simplePayback",
      label: "Срок окупаемости (простой)",
      value: formatYearsRu(result.simplePaybackYears),
    },
    {
      key: "discountedPayback",
      label: "Срок окупаемости (дисконт.)",
      // A3 honesty discipline: an investment that never recovers inside the horizon says so
      // in words rather than showing a number the horizon does not support.
      value:
        result.discountedPaybackYears === null
          ? "не окупается в пределах горизонта"
          : formatYearsRu(result.discountedPaybackYears),
    },
    { key: "roi", label: labels.roi, value: `${result.simpleRoiPct.toFixed(0)}%` },
    { key: "npv", label: labels.npv, value: money(result.npvUsd) },
  ];
}

/** Labels used by the interactive calculator panel, which has room to spell the terms out. */
export const PANEL_LABELS = {
  roi: "ROI (простой, без дисконтирования)",
  npv: "NPV (чистая приведённая стоимость)",
};

/** Labels used by the print report, whose two-column grid is tighter. */
export const REPORT_LABELS = { roi: "ROI (простой)", npv: "NPV" };
