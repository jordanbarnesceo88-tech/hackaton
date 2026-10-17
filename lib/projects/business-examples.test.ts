import { describe, expect, it } from "vitest";
import { CATALOG } from "../data/organizer/catalog";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { resolveNorms } from "../tz/norms";
import { buildDecision } from "../tz/decision";
import { buildBusinessExample } from "./business-example-model";
import { businessExample, businessExampleInputs } from "./business-examples";

const products = CATALOG.map(productForCalcFromSeed);
const live = { paramDefs: paramSpecsFor("warehouse"), products, norms: resolveNorms(), paramDefsFrom: "code" as const };
describe("reproducible end-to-end business examples", () => {
  it("provides a real workload-qualified financial option without hand-written ROI", () => {
    const model = buildBusinessExample(live, "steady-flow").model;
    const d = buildDecision(model, "purchase", model.simInputs.purchase?.calculated);
    expect(d.spatial.state).toBe("fresh"); expect(d.spatial.evidence?.assessment.status).toBe("OK");
    expect(d.finance?.npvRub).toBeGreaterThan(0); expect(d.finance?.effectYearRub).toBeGreaterThan(0);
    expect(d.status).toBe("suitable");
    expect(d.processes[0]).toMatchObject({ n: 5, chargers: 2 });
  });
  it("does not recommend full implementation from positive NPV when the peak is not handled", () => {
    const model = buildBusinessExample(live, "peak-overload").model;
    const d = buildDecision(model, "purchase", model.simInputs.purchase?.calculated);
    expect(d.finance?.npvRub).toBeGreaterThan(0);
    expect(d.spatial.evidence?.assessment.status).toBe("PARTIAL"); expect(d.status).toBe("partial");
    expect(model.conclusion.recommendedScenarioKey).toBeNull();
  });
  it("retains the same physical work but no payroll savings if staff stays", () => {
    const a = buildBusinessExample(live, "steady-flow"), b = buildBusinessExample(live, "retained-staff");
    const ar = a.model.results.find(r => r.key === "purchase"), br = b.model.results.find(r => r.key === "purchase");
    if(ar?.status!=="ok" || br?.status!=="ok") throw new Error("Expected valid financial results");
    expect(br.items[0]?.releasedFte).toBe(ar.items[0]?.releasedFte);
    expect(br.items[0]?.remainingLabourRub).toBe(br.items[0]?.baselineLabourRub);
    expect(br.npvRub).toBeLessThan(0);
    expect(b.model.scenarios[1]?.spatialEvidence?.summary).toEqual(a.model.scenarios[1]?.spatialEvidence?.summary);
  });
  it("keeps the organizer defaults and products unchanged and rejects unknown examples", () => {
    const defaults=baseValuesFor("warehouse"),before=structuredClone(defaults),productBefore=structuredClone(products);
    businessExampleInputs("steady-flow",defaults,products);
    expect(defaults).toEqual(before);expect(products).toEqual(productBefore);
    expect(businessExample("random")).toBeNull();
    expect(()=>businessExampleInputs("random" as "steady-flow",defaults,products)).toThrow();
  });
});
