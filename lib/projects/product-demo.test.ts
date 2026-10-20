import { expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { FIXTURE_H1500 } from "../tz/econ/fixtures";
import { resolveNorms } from "../tz/norms";
import { buildProductDemoPreview } from "./product-demo";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { productForCalcFromSeed } from "../catalog/product-for-calc";

const selected = { ...FIXTURE_H1500, slug: "chosen-amr", name: "Chosen AMR", raasRubMonth: null };
const live = { paramDefs: paramSpecsFor("warehouse").map(def => ({ ...def, base: def.key === "activeAreaM2" ? 1000 : def.key === "totalAreaM2" ? 2000 : def.base })), products: [FIXTURE_H1500, selected], norms: resolveNorms(), paramDefsFrom: "code" as const };
it("keeps the exact catalogue product in both purchase and RaaS, even if another product has a RaaS rate", () => {
  const preview = buildProductDemoPreview(live, "warehouse", selected.slug);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw Error(preview.reason);
  expect(preview.model.scenarios.filter(s => s.kind !== "asis").map(s => ({ kind: s.kind, products: s.items.map(i => i.productSlug) })))
    .toEqual([{ kind: "purchase", products: [selected.slug] }, { kind: "raas", products: [selected.slug] }]);
  expect(preview.model.results.find(s => s.kind === "raas")?.status).toBe("refused");
});
it("does not substitute the default robot when the selected product fails the object's payload constraint", () => {
  const incompatible = { ...selected, payloadKg: 100 };
  const preview = buildProductDemoPreview({ ...live, products: [FIXTURE_H1500, incompatible] }, "warehouse", selected.slug);
  expect(preview.ok).toBe(false);
  if (preview.ok) throw Error("Incompatible product was accepted");
  expect(preview.reason).toMatch(/100|груз/i);
  expect(preview).not.toHaveProperty("model");
});
it("declines an unsupported process or a product absent from the applicable live catalogue", () => {
  expect(buildProductDemoPreview(live, "airport", selected.slug).ok).toBe(false);
  expect(buildProductDemoPreview(live, "warehouse", "not-in-live-catalogue").ok).toBe(false);
});

it.each(VENDOR_CLEANING_PRODUCTS.map(productForCalcFromSeed))("opens $slug for an explicit working profile without substituting passport output", product => {
  const preview = buildProductDemoPreview({ ...live, products: [product] }, "warehouse", product.slug);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw Error(preview.reason);
  for (const scenario of preview.model.scenarios.filter(s => s.kind !== "asis")) {
    expect(scenario.items[0]?.productSlug).toBe(product.slug);
    expect(scenario.items[0]?.cleaningProfile).toBeUndefined();
    expect(preview.model.results.find(result => result.key === scenario.key)?.status).toBe("refused");
  }
});
