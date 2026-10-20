import { describe, expect, it } from "vitest";
import { CATALOG } from "../data/organizer/catalog";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { resolveNorms } from "../tz/norms";
import { buildDecision } from "../tz/decision";
import { buildBusinessExampleOffline as buildBusinessExample } from "./business-example-offline";
import { businessExample, businessExampleInputs } from "./business-examples";
import { resultsFromInputs } from "./recalc";
import { capacityEvidenceQualifies } from "../sim/spatial-evidence";

const products = CATALOG.map(productForCalcFromSeed);
const live = { paramDefs: paramSpecsFor("warehouse"), products, norms: resolveNorms(), paramDefsFrom: "code" as const };
describe("reproducible end-to-end business examples", () => {
  it("provides a controlled-capacity financial candidate while preserving the nominal shortfall", () => {
    const model = buildBusinessExample(live, "steady-flow").model;
    const d = buildDecision(model, "purchase", model.simInputs.purchase?.calculated);
    expect(d.spatial.state).toBe("fresh"); expect(d.spatial.evidence?.assessment.status).toBe("PARTIAL");
    expect(d.spatial.evidence!.summary.achievedPerH).toBeLessThan(d.spatial.evidence!.summary.requiredPerH);
    expect(capacityEvidenceQualifies(d.spatial.evidence, model.simInputs.purchase?.calculated)).toBe(true);
    expect(d.capacityCandidate).toBe(true);
    expect(d.nextAction).toContain("полными циклами");
    expect(d.spatial.evidence?.capacityProof?.metrics.closedCohortPerH).toBeGreaterThanOrEqual(d.spatial.evidence!.summary.requiredPerH);
    expect(d.finance?.npvRub).toBeGreaterThan(0); expect(d.finance?.effectYearRub).toBeGreaterThan(0);
    expect(d.status).toBe("partial");
    expect(model.conclusion.recommendedScenarioKey).toBeNull();
    expect(model.conclusion.headline).toContain("кандидаты для целевой мощности");
    expect(model.conclusion.bullets.some(text => text.includes("Номинальный прогон: PARTIAL"))).toBe(true);
    expect(d.processes[0]).toMatchObject({ n: 6, chargers: 2 });
  }, 30_000); // Includes the full nominal and controlled 135-minute physical replays.
  it("does not recommend full implementation when the doubled peak is not handled", () => {
    const model = buildBusinessExample(live, "peak-overload").model;
    const d = buildDecision(model, "purchase", model.simInputs.purchase?.calculated);
    expect(d.finance?.npvRub).toBeLessThan(0);
    expect(d.spatial.evidence?.assessment.status).toBe("PARTIAL"); expect(d.status).toBe("partial");
    expect(model.conclusion.recommendedScenarioKey).toBeNull();
  // Runs the canonical overloaded business example, including terminal spatial replay, before decision assertions.
  }, 120_000);
  it("keeps the previous five-robot case as a physical counterexample despite positive NPV", () => {
    const input = businessExampleInputs("steady-flow", baseValuesFor("warehouse"), products);
    input.scenarios.forEach(spec => spec.items.forEach(item => { item.quantityOverride = 5; }));
    const { model } = resultsFromInputs(live, { facility: "warehouse", params: input.params, scenarios: input.scenarios });
    const decision = buildDecision(model, "purchase", model.simInputs.purchase?.calculated);
    expect(decision.finance?.npvRub).toBeGreaterThan(0);
    expect(decision.spatial.evidence?.assessment.status).toBe("PARTIAL");
    expect(decision.spatial.evidence!.summary.achievedPerH).toBeLessThan(decision.spatial.evidence!.summary.requiredPerH);
    expect(decision.status).toBe("partial");
    expect(model.conclusion.recommendedScenarioKey).toBeNull();
  }, 90_000);
  it("retains the same physical work but no payroll savings if staff stays", () => {
    const a = buildBusinessExample(live, "steady-flow"), b = buildBusinessExample(live, "retained-staff");
    const ar = a.model.results.find(r => r.key === "purchase"), br = b.model.results.find(r => r.key === "purchase");
    if(ar?.status!=="ok" || br?.status!=="ok") throw new Error("Expected valid financial results");
    expect(br.items[0]?.releasedFte).toBe(ar.items[0]?.releasedFte);
    expect(br.items[0]?.remainingLabourRub).toBe(br.items[0]?.baselineLabourRub);
    expect(br.npvRub).toBeLessThan(0);
    expect(b.model.scenarios[1]?.spatialEvidence?.summary).toEqual(a.model.scenarios[1]?.spatialEvidence?.summary);
  }, 30_000);
  it("keeps the organizer defaults and products unchanged and rejects unknown examples", () => {
    const defaults=baseValuesFor("warehouse"),before=structuredClone(defaults),productBefore=structuredClone(products);
    businessExampleInputs("steady-flow",defaults,products);
    expect(defaults).toEqual(before);expect(products).toEqual(productBefore);
    expect(businessExample("random")).toBeNull();
    expect(()=>businessExampleInputs("random" as "steady-flow",defaults,products)).toThrow();
  });
});
