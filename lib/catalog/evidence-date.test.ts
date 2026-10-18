import { expect, it } from "vitest";
import { CATALOG } from "../data/organizer/catalog";
import { productForCalcFromSeed } from "./product-for-calc";
import { assessOperatingEvidence, type OperatingEvidence } from "./operating-evidence";
import { productsAtEvidenceDate } from "./evidence-date";

it("reevaluates expiry on deliberate calculation without changing an archived product or the observation", () => {
  const product = productForCalcFromSeed(CATALOG[0]!);
  const evidence: OperatingEvidence = {
    schemaVersion: "operating-evidence-1", productSlug: product.slug, process: "pallet-transport", facility: "warehouse", mode: "test-mode", unit: "паллет/ч",
    site: "Синтетический участок теста", measuredAt: "2026-10-01", verifiedAt: "2026-10-02", validUntil: "2026-11-01",
    sourceRef: "Синтетический акт", measuredBy: "Тест", samples: 3, output: 100, operatingMinutes: 60, elapsedMinutes: 120, basis: "operating-hour", confirmed: true,
  };
  const archived = { [product.slug]: { ...product, operatingEvidence: evidence, operatingEvidenceConfirmed: true, operatingEvidenceEvaluatedOn: "2026-10-18" } };
  const original = JSON.stringify(archived);
  const context = { productSlug: product.slug, process: evidence.process, facility: evidence.facility, mode: evidence.mode, unit: evidence.unit, confirmed: true };
  expect(assessOperatingEvidence(evidence, { ...context, asOf: archived[product.slug]!.operatingEvidenceEvaluatedOn }).applied).toBe(true);
  const recalculated = productsAtEvidenceDate(archived, "2026-12-01");
  expect(assessOperatingEvidence(evidence, { ...context, asOf: recalculated[product.slug]!.operatingEvidenceEvaluatedOn }).applied).toBe(false);
  expect(recalculated[product.slug]!.operatingEvidence).toEqual(evidence);
  expect(JSON.stringify(archived)).toBe(original);
  expect(productsAtEvidenceDate({ [product.slug]: product }, "2026-12-01")[product.slug]).toBe(product);
  expect(() => productsAtEvidenceDate(archived, "2026-02-30")).toThrow();
});
