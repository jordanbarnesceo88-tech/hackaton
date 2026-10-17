import { describe, expect, it } from "vitest";
import { setImmediate } from "node:timers/promises";
import { calculateProjectPreview, calculateProjectPreviewAsync } from "../../experiments/warehouse-3d/project-input";
import { paramSpecsFor } from "../data/organizer/params";
import { createSpatialProjectSnapshot, SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { simInputIdentity } from "../sim/identity";
import { withServerCalculation } from "../sim/server-execution";
import { FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { buildProjectModel } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import { resultsFromInputs, resultsFromInputsAsync } from "./recalc";

const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms(), paramDefsFrom: "code" as const };
function fixture(fleet = 4) {
  const scenarios = fixtureSpecs().map(s => ({ ...s, items: s.items.map(i => ({ ...i, quantityOverride: fleet, chargersOverride: 1 })) }));
  const input = { facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, scenarios };
  const first = buildProjectModel({ ...live, ...input });
  const sim = first.simInputs.p1!.calculated!;
  const snapshot = createSpatialProjectSnapshot({ requestId: "async-test", scenarioKey: "p1", scenarioName: "Покупка", variantId: "calculated", input: sim });
  for (const s of scenarios) if (s.kind !== "asis") Object.assign(s, { spatialEvidence: {
    input: sim, sourceInputKey: simInputIdentity(sim), executionInputKey: "forged", simModelVersion: SPATIAL_MODEL_VERSION,
    assessment: { status: "OK", headline: "FORGED", terminal: true },
    summary: { fleet, requiredPerH: sim.demand.peakPerH, achievedPerH: 999999, queueEnd: 0, waitP95Min: 0 },
  } });
  return { input, snapshot };
}
const noClock = (results: ReturnType<typeof resultsFromInputs>["results"]) => ({ ...results, calculatedAt: "", sim: Object.fromEntries(Object.entries(results.sim).map(([k,v]) => [k,v && { ...v, durationMs: 0 }])) });

describe("cooperative server calculation", () => {
  it("retains exact canonical 3D and complete financial results, replacing client proof", async () => {
    const { input, snapshot } = fixture();
    expect(await calculateProjectPreviewAsync(snapshot, { yieldFn: setImmediate })).toEqual(calculateProjectPreview(snapshot));
    const expected = resultsFromInputs(live, input);
    const actual = await resultsFromInputsAsync(live, input);
    expect(noClock(actual.results)).toEqual(noClock(expected.results));
    expect(actual.results.scenarios[1]!.spatialEvidence!.summary.achievedPerH).not.toBe(999999);
  }, 30_000);

  it("allows repeated event-loop heartbeats DURING canonical replay", async () => {
    const { snapshot } = fixture(14);
    const beats: number[] = [], start = performance.now();
    const timer = setInterval(() => beats.push(performance.now()), 5);
    let finished = 0;
    try { await calculateProjectPreviewAsync(snapshot, { sliceMs: 8, yieldFn: setImmediate }); finished = performance.now(); }
    finally { clearInterval(timer); }
    expect(beats.length).toBeGreaterThan(3);
    expect(beats.filter(t => t > start + 20 && t < finished - 20).length).toBeGreaterThan(1);
    const gaps = beats.slice(1).map((t,i) => t-beats[i]!);
    expect(Math.max(...gaps)).toBeLessThan(500);
  }, 30_000);

  it("aborts during replay and refuses an expired project before producing a receipt", async () => {
    const { input, snapshot } = fixture(14);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20);
    try { await expect(calculateProjectPreviewAsync(snapshot, { signal: controller.signal, yieldFn: setImmediate })).rejects.toMatchObject({ name: "AbortError" }); }
    finally { clearTimeout(timer); }
    await expect(resultsFromInputsAsync(live, input, { budgetMs: 0 })).rejects.toMatchObject({ name: "SimBudgetExceeded" });
  });

  it("stops the loop on deadline and marks shared spatial-budget exhaustion unverified, never client OK", async () => {
    const { input, snapshot } = fixture(14);
    let clock = 0;
    await expect(calculateProjectPreviewAsync(snapshot, { now: () => clock, deadline: 1,
      yieldFn: async () => { clock += 2; } })).rejects.toMatchObject({ name: "SimBudgetExceeded" });
    let clockCalls = 0;
    await expect(calculateProjectPreviewAsync(snapshot, { now: () => ++clockCalls / 100, deadline: 1,
      yieldFn: setImmediate })).rejects.toMatchObject({ name: "SimBudgetExceeded" });
    // Preparation performs only a few clock reads: this expiry is checked inside model steps.
    expect(clockCalls).toBeGreaterThanOrEqual(100);
    const actual = await resultsFromInputsAsync(live, input, { spatialBudgetMs: 0 });
    expect(actual.results.scenarios.filter(s=>s.spatialEvidence).every(s=>s.spatialEvidence!.assessment.status === "NOT_EVALUATED")).toBe(true);
    expect(actual.results.conclusion.recommendedScenarioKey).not.toBe("p1");
    expect(actual.results.results.find(r=>r.key==="p1")!.risks.some(r=>r.code==="SIM_NOT_CONFIRMED")).toBe(true);
  });

  it("admits only two calculations and releases every slot after error and abort", async () => {
    let release!: () => void;
    const barrier = new Promise<void>(r => { release = r; });
    const first = withServerCalculation(async () => { await barrier; throw new Error("controlled failure"); });
    const second = withServerCalculation(async () => barrier);
    const caught = first.catch(e=>e);
    await expect(withServerCalculation(async()=>1)).rejects.toMatchObject({ name: "CalculationBusy" });
    release(); await caught; await second;
    const controller = new AbortController(); controller.abort();
    await expect(withServerCalculation(async()=>1, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(withServerCalculation(async()=>7)).resolves.toBe(7);
  });
});
