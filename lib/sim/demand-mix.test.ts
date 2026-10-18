import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { checkCalcInput } from "../api/calc";
import { FIXTURE_CARRIER_P, FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { buildProjectModel } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import { buildDecision } from "../tz/decision";
import { resultsFromInputsAsync } from "../projects/recalc";
import { createSim, isDone, stepSim } from "./engine";
import { runSimSync } from "./runner";
import { simInputIdentity } from "./identity";
import { warehouseBaseInput } from "./fixtures";
import { demandMixFromParams, validDemandMix } from "./demand-mix";
import { expectedLegsM } from "./analytic";
import { expectedClosedPodCycleS, expectedClosedPodLegsM } from "./closed-pod-cycle";
import { createSpatialProjectSnapshot } from "./spatial-bridge";

function tasks(mix?: { inbound: number; outbound: number; internal: number }) {
  const base = warehouseBaseInput(1), input = { ...base, demand: { ...base.demand, ...(mix ? { mix } : {}), avgPerH: 0, peakPerH: 600, warmupMin: 0, peakMin: 30 } };
  const state = createSim(input);
  while (!isDone(state)) stepSim(state);
  return state.tasks;
}

describe("customer direction mixture", () => {
  it("preserves balanced legacy draws and changes direction only when the submitted mix changes", () => {
    expect(tasks({ inbound: .5, outbound: .5, internal: 0 })).toEqual(tasks());
    const incoming = tasks({ inbound: .9, outbound: .1, internal: 0 });
    const outgoing = tasks({ inbound: .1, outbound: .9, internal: 0 });
    expect(incoming.map(t => t.arrivalS)).toEqual(outgoing.map(t => t.arrivalS));
    expect(incoming.filter(t => t.kind === "inbound").length / incoming.length).toBeGreaterThan(.85);
    expect(outgoing.filter(t => t.kind === "outbound").length / outgoing.length).toBeGreaterThan(.85);
    const internal = tasks({ inbound: 0, outbound: 0, internal: 1 });
    expect(internal.every(t => t.kind === "internal" && t.fromPoint === -1 && t.toPoint === -1 && t.countsTowardDemand !== false && (t.fromX !== t.toX || t.fromY !== t.toY))).toBe(true);
  });

  it("retains the actual mix in canonical inputs and rejects malformed shares at the bridge", () => {
    const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms() };
    const base = { ...live, facility: "warehouse", scenarios: fixtureSpecs(), params: { ...WAREHOUSE_BASE_PARAMS, activeAreaM2: 5000, inboundPalletsPerDay: 900, outboundPalletsPerDay: 100 } };
    const a = buildProjectModel(base).simInputs.p1!.calculated!;
    const b = buildProjectModel({ ...base, params: { ...base.params, inboundPalletsPerDay: 100, outboundPalletsPerDay: 900 } }).simInputs.p1!.calculated!;
    expect(a.demand.mix).toEqual({ inbound: .9, outbound: .1, internal: 0 });
    expect(simInputIdentity(a)).not.toBe(simInputIdentity(b));
    expect(validDemandMix({ inbound: .9, outbound: .9, internal: 0 })).toBe(false);
    expect(() => createSpatialProjectSnapshot({ requestId: "invalid-mix", scenarioKey: "p1", scenarioName: "test", variantId: "calculated", input: { ...a, demand: { ...a.demand, mix: { inbound: .9, outbound: .9, internal: 0 } } } })).toThrow("Доли");
    expect(demandMixFromParams({ inboundPalletsPerDay: 0, outboundPalletsPerDay: 0, internalPalletMovesPerDay: 100 })).toEqual({ inbound: 0, outbound: 0, internal: 1 });
  });

  it("cannot confirm internal storage moves when the declared warehouse is fully occupied", () => {
    const base=warehouseBaseInput(20);
    const summary=runSimSync({...base,demand:{...base.demand,mix:{inbound:0,outbound:0,internal:1},storageVacancyShare:0}});
    expect(summary.arrivedPeak).toBeGreaterThan(0);
    expect(summary).toMatchObject({verdict:"NOT_CONFIRMED",achievedPerH:0});
  });

  it("weights asymmetric routes and uses one carried leg with two handling operations for internal work", () => {
    const layout = createSim(warehouseBaseInput(1)).layout;
    layout.slots = [{ x: 10, y: 5 }, { x: 20, y: 5 }];
    layout.receiving = [{ id: "R", kind: "receiving", x: 0, y: 5 }];
    layout.shipping = [{ id: "S", kind: "shipping", x: 50, y: 5 }];
    const xs = [0, 2, 10, 12, 20, 22, 50, 52];
    layout.routingGraph = { clearanceM: .95, nodes: xs.map(x => ({ id: String(x), x, y: 5 })), edges: xs.slice(1).map((x, i) => ({ from: String(xs[i]), to: String(x) })) };
    const docks = [0, 10, 20, 50].map(x => ({ x, y: 5, entry: { x: x + 2, y: 5 }, heading: Math.PI }));
    const inbound = { inbound: 1, outbound: 0, internal: 0 }, outbound = { inbound: 0, outbound: 1, internal: 0 }, internal = { inbound: 0, outbound: 0, internal: 1 };
    expect(expectedLegsM(layout, inbound).loadedM).toBe(15);
    expect(expectedLegsM(layout, outbound).loadedM).toBe(35);
    expect(expectedLegsM(layout, internal).loadedM).toBe(10);
    expect(expectedClosedPodLegsM(layout, docks, inbound).loadedM).toBe(30);
    expect(expectedClosedPodLegsM(layout, docks, outbound).loadedM).toBe(70);
    const legs = expectedClosedPodLegsM(layout, docks, internal);
    expect(legs).toMatchObject({ loadedM: 10, physicalLegsPerCustomer: 1 });
    expect(expectedClosedPodCycleS({ ...legs, speedMps: 1, loadedSpeedFactor: 1, handlingSec: 20 })).toBe(legs.emptyM + 10 + 40);
  });

  it("does not confirm zero observed positive demand or invent a minimum stable fleet/pilot", async () => {
    const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_CARRIER_P], norms: resolveNorms(), paramDefsFrom: "code" as const };
    const params = { ...WAREHOUSE_BASE_PARAMS, inboundPalletsPerDay: 1, outboundPalletsPerDay: 0, internalPalletMovesPerDay: 0 };
    const scenarios = fixtureSpecs(FIXTURE_CARRIER_P);
    expect(checkCalcInput(live, "warehouse", params, scenarios).ok).toBe(true);
    const computed = await resultsFromInputsAsync(live, { facility: "warehouse", params, scenarios });
    const summary = computed.results.sim.p1!;
    expect(summary).toMatchObject({ verdict: "NOT_EVALUATED", observedPeakTasks: 0, achievedPerH: 0, minStableFleet: null });
    expect(summary.assessmentReason).toContain("увеличьте окно");
    expect(computed.results.conclusion.recommendedScenarioKey).toBeNull();
    expect(computed.results.conclusion.headline).toContain("не оценено");
    expect(buildDecision(computed.model, "p1", computed.model.simInputs.p1!.calculated, false, summary)).toMatchObject({ status: "unverified", pilot: { applicable: false } });
    const positive = runSimSync(warehouseBaseInput(50));
    expect(positive.arrivedPeak).toBeGreaterThan(0);
    expect(positive.verdict).toBe("CONFIRMED");
  });
});
