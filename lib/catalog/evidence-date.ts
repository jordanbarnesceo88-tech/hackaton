import type { ProductForCalc } from "../tz/types";

/** Explicit recalculation reevaluates expiry; archive reads never call this helper. */
export function productsAtEvidenceDate(products: Readonly<Record<string, ProductForCalc>>, asOf: string): Record<string, ProductForCalc> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) throw new Error("Некорректная дата оценки замера");
  return Object.fromEntries(Object.entries(products).map(([slug, product]) => [slug,
    product.operatingEvidence ? { ...product, operatingEvidenceEvaluatedOn: asOf } : product,
  ]));
}
