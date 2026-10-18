import { describe, expect, it } from "vitest";
import { productForCalcFromSeed } from "../../lib/catalog/product-for-calc";
import { CATALOG } from "../../lib/data/organizer/catalog";
import { baseValuesFor, paramSpecsFor } from "../../lib/data/organizer/params";
import { summarize } from "../../lib/sim/metrics";
import { createSim } from "../../lib/sim/engine";
import { route, routeLengthBetween, routeLengthM } from "../../lib/sim/routing";
import { runSimSync } from "../../lib/sim/runner";
import { siteSegmentIsClear, validateSiteLayout } from "../../lib/sim/site-layout";
import { buildProjectModel } from "../../lib/tz/model";
import { resolveNorms } from "../../lib/tz/norms";
import { calculateCase, createPlayback, DEMO_CASES, isPlaybackDone, playbackFrame, previewInterpolate, stepPlayback, type DemoModel } from "./core";
import { createWarehouseTrafficState, isTrafficInput, stepWarehouseTraffic, type DemoTrafficInput } from "./traffic";
import { complexSite } from "./site";
import { incidentSummary, type IncidentConfig } from "./incidents";

describe("warehouse visualization uses the production calculation and engine", () => {
  type CaseId="baseline"|"insufficient"|"increased-flow"|"complex";
  const models:Partial<Record<CaseId,DemoModel>>={};
  const fixture=(id:CaseId)=>models[id]??=calculateCase(id);
  const replayInput = (model: DemoModel) => {
    const input = structuredClone(model.input) as DemoTrafficInput;
    input.demand.warmupMin = 5;
    input.demand.peakMin = 30;
    return input;
  };
  const headless = (input: DemoTrafficInput) => {
    const state = createWarehouseTrafficState(input);
    while (!isPlaybackDone(state)) stepWarehouseTraffic(state);
    return state;
  };
  it.each(["baseline","insufficient","increased-flow"] as const)("preset %s uses the intended fleet and original demand units",id=>{
    const model=fixture(id);expect(DEMO_CASES[0].id).toBe("complex");expect(model.input.robots.count).toBe(id==="insufficient"?3:id==="baseline"?19:11);
    if(id!=="baseline")expect(model.summary.verdict).toBe("NOT_CONFIRMED");
    if(id==="increased-flow")expect(model.summary.requiredPerH).toBeGreaterThan(129.54545454545453);
    expect(model.finance).toBeNull();expect(model.financeUnavailableReason).toContain("защитные остановки");expect(model.summary.minStableFleet).toBeNull();
  },30000);

  it("manual fleet, chargers, finance and physical inputs match buildProjectModel", () => {
    const result = calculateCase("baseline", { fleet: 7 });
    const model = buildProjectModel({
      facility: "warehouse", params: baseValuesFor("warehouse"), paramDefs: paramSpecsFor("warehouse"), norms: resolveNorms(),
      products: CATALOG.map(productForCalcFromSeed),
      scenarios: [
        { key: "asis", name: "Как есть", kind: "asis", items: [] },
        { key: "purchase", name: "Покупка", kind: "purchase", items: [{ process: "pallet-transport", productSlug: "ronavi-h1500", quantityOverride: 7 }] },
        { key: "raas", name: "RaaS", kind: "raas", items: [{ process: "pallet-transport", productSlug: "ronavi-h1500", quantityOverride: 7 }] },
      ],
    });
    const { siteLayout: _site, demoTraffic: _traffic, demoIncidents: _incidents, demoUnderlift: _underlift, ...physical } = result.input as typeof result.input & { demoTraffic: unknown; demoIncidents: IncidentConfig };
    expect(_incidents.enabled).toBe(true);
    expect(_site).toBeDefined(); expect(_traffic).toBeDefined();
    expect(_underlift).toMatchObject({ version: "underlift-1" });
    expect(_underlift!.docks.length).toBe(_site!.slots.length + _site!.receiving.length + _site!.shipping.length);
    expect(physical).toEqual(model.simInputs.purchase?.calculated);
    const purchase = model.results.find((r) => r.key === "purchase");
    expect(purchase?.status).toBe("ok");
    if (purchase?.status !== "ok") throw new Error("fixture refused");
    expect(result.input.layout.chargers).toBe(purchase.items[0]?.chargers);
    expect(result.finance).toBeNull();
    expect(result.sources.some((s) => s.includes("robotrends.ru"))).toBe(true);
    expect(result.assumptions.some((s) => s.includes("не подтверждённое предложение"))).toBe(true);
  },30000);

  it("playback batches retain exact headless terminal metrics", () => {
    const result = fixture("baseline"), input = replayInput(result), terminal = headless(input);
    const state = createPlayback(input);
    let i = 0;
    const batches = [1, 17, 64];
    while (!isPlaybackDone(state)) stepPlayback(state, batches[i++ % batches.length]!);
    expect(summarize(state)).toEqual(summarize(terminal));
    expect(incidentSummary(state)).toEqual(incidentSummary(terminal));
    const frame = playbackFrame(state);
    expect(frame.tS).toBe(frame.endS);
    const t = state.tS;
    stepPlayback(state, 3600);
    expect(state.tS).toBe(t);
    frame.robots[0]!.x = -999;
    frame.points[0]!.queue.push(-1);
    expect(state.robots[0]!.x).not.toBe(-999);
    expect(state.points[0]!.queue).not.toContain(-1);
  },15000);

  it("racks share engine world coordinates, including resized active area", () => {
    const result = calculateCase("baseline", { areaM2: 5000 });
    expect(result.layout.widthM * result.layout.heightM).toBeCloseTo(5000);
    expect(result.racks).toEqual([]);expect(result.layout.slots.length).toBeGreaterThan(500);
    expect(result.racks.every((r) => r.y >= 0 && r.y + r.h <= result.layout.heightM)).toBe(true);
  },30000);

  it.each([
    { fleet: NaN }, { fleet: Infinity }, { fleet: 1.5 }, { fleet: 0 }, { fleet: 501 },
    { peakFactor: 0 }, { peakFactor: 2.6 }, { areaM2: -1 }, { areaM2: 4999 }, { areaM2: 50001 },
    { chargers: 2 },
  ])("rejects invalid or independent charger override %j", (overrides) => {
    expect(() => calculateCase("baseline", overrides)).toThrow();
  });

  it("rejects unknown cases and non-integral playback steps", () => {
    expect(() => calculateCase("unknown")).toThrow("Неизвестный сценарий");
    const state = createPlayback(fixture("baseline").input);
    for (const seconds of [NaN, Infinity, -1, 0.5, 3601]) expect(() => stepPlayback(state, seconds)).toThrow();
    stepPlayback(state, 0);
    expect(state.tS).toBe(0);
  });

  it("complex map routes around actual walls and racks through a connected graph", () => {
    const result = fixture("complex");
    expect(result.finance).toBeNull();
    expect(result.financeUnavailableReason).toContain("задайте годовой охват");
    expect(result.layout.footprint).toHaveLength(6);
    expect(result.layout.columns?.length).toBeGreaterThan(0);
    expect(validateSiteLayout(result.layout)).toEqual([]);
    const state = createPlayback(result.input);
    expect(state.layout).toEqual(result.layout);
    expect(isTrafficInput(result.input)).toBe(true);
    if (!isTrafficInput(result.input)) throw new Error("missing traffic");
    expect(state.robots.map(({ x, y }) => ({ x, y }))).toEqual(result.input.demoTraffic.initialPositions);
    const graph=result.layout.routingGraph!,nodes=new Map(graph.nodes.map(n=>[n.id,n]));
    for(const edge of graph.edges)expect(siteSegmentIsClear(result.layout,nodes.get(edge.from)!,nodes.get(edge.to)!)).toBe(true);
    // Graph connectivity plus all-edge clearance proves every home can reach every station.
    const adjacent=new Map(graph.nodes.map(n=>[n.id,[] as string[]]));for(const e of graph.edges){adjacent.get(e.from)!.push(e.to);adjacent.get(e.to)!.push(e.from);}
    const seen=new Set<string>(),pending=[graph.nodes[0]!.id];while(pending.length){const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);pending.push(...adjacent.get(id)!);}expect(seen.size).toBe(graph.nodes.length);
    const locations=[...result.layout.receiving,...result.layout.shipping,...result.layout.chargers,...result.layout.slots.filter((_,i)=>i%12===0),result.layout.slots.at(-1)!];
    const anchor=result.layout.receiving[0]!;for(const b of locations){const path=route(result.layout,anchor,b);for(let i=1;i<path.length;i++)expect(siteSegmentIsClear(result.layout,path[i-1]!,path[i]!)).toBe(true);expect(routeLengthBetween(result.layout,anchor.x,anchor.y,b.x,b.y)).toBeCloseTo(routeLengthM(path),8);}
    const a = { x: 44, y: 34 };
    const b = { x: 54, y: 34 };
    expect(siteSegmentIsClear(result.layout, a, b)).toBe(false);
    expect(routeLengthBetween(result.layout, a.x, a.y, b.x, b.y)).toBeGreaterThan(10);
    const c = { x: 94, y: 74 };
    const d = { x: 144, y: 34 };
    expect(siteSegmentIsClear(result.layout, c, d)).toBe(false);
  },30000);

  it("invalid custom graph is NOT_SUPPORTED, never a fallback successful rectangle", () => {
    const result = fixture("complex");
    const input = structuredClone(result.input) as DemoTrafficInput;
    input.siteLayout!.routingGraph!.edges.push({ from: "node-44-34", to: "node-54-34" });
    expect(createSim(input).precheck).toBe("invalid");
    expect(runSimSync({ ...input, transportWorkflow: "single-leg-pallet-1" }).verdict).toBe("NOT_SUPPORTED");
    expect(() => createWarehouseTrafficState(input)).toThrow(/Недопустимый вход/);
    input.siteLayout!.routingGraph!.nodes[0]!.x = NaN;
    expect(runSimSync({ ...input, transportWorkflow: "single-leg-pallet-1" }).verdict).toBe("NOT_SUPPORTED");
    expect(() => createWarehouseTrafficState(input)).toThrow(/Недопустимый вход/);
  });

  it("scaled site keeps physical clearance and does not detour between positions on one graph edge", () => {
    for (const areaM2 of [5000, 50000]) {
      const layout = complexSite(areaM2, 1);
      expect(layout.routingGraph!.clearanceM).toBe(0.8);
      expect(validateSiteLayout(layout)).toEqual([]);
    }
    const layout = fixture("complex").layout;
    expect(route(layout, { x: 7, y: 24 }, { x: 9, y: 24 })).toEqual([{ x: 7, y: 24 }, { x: 9, y: 24 }]);
    expect(routeLengthBetween(layout, 7, 24, 9, 24)).toBe(2);
  });

  it("complex playback preserves headless metrics and reports actual counters/history/events", () => {
    const result = fixture("complex"), input = replayInput(result), terminal = headless(input);
    const state = createPlayback(input);
    while (!isPlaybackDone(state)) stepPlayback(state, 64);
    expect(summarize(state)).toEqual(summarize(terminal));
    expect(incidentSummary(state)).toEqual(incidentSummary(terminal));
    const frame = playbackFrame(state);
    expect(frame.telemetry.tasksDone).toBe(state.doneCount);
    expect(frame.telemetry.distanceM).toBeGreaterThan(100);
    for (const r of frame.robots) {
      expect(Object.values(r.timeByPhase).reduce((a, b) => a + b, 0)).toBe(state.tS);
      expect(r.socHistory.length).toBeLessThanOrEqual(120);
      expect(r.socHistory[r.socHistory.length - 1]).toEqual({ tS: state.tS, soc: state.robots[r.id]!.soc });
    }
    expect(frame.events.length).toBeGreaterThan(0);
    expect(frame.events.filter((e) => e.type !== "incident").length).toBeLessThanOrEqual(200);
    expect(frame.events.filter((e) => e.type === "incident")).toHaveLength(20);
    expect(new Set(frame.events.map((e) => e.id)).size).toBe(frame.events.length);
    expect(frame.events.some((e) => e.type === "task-completed")).toBe(true);
    expect(frame.events.every((e) => e.tS >= 0 && e.tS <= state.tS)).toBe(true);
    expect(frame.events.every((e) => e.observedAtS! >= e.tS && e.observedAtS! <= state.tS)).toBe(true);
  },15000);

  it("smooth preview follows graph path, changes no state/counters and predicts canonical next positions", () => {
    const result = fixture("complex");
    const state = createPlayback(result.input);
    stepPlayback(state, 100);
    for (let n = 0; n < 50; n++) {
      const before = structuredClone(state);
      const telemetryBefore = playbackFrame(state).telemetry;
      const half = previewInterpolate(state, 0.5);
      const final = previewInterpolate(state, 1);
      expect(half.provenance.observedAtS).toBe(before.tS);
      expect(half.tS).toBe(before.tS + 0.5);
      expect(state).toEqual(before);
      expect(playbackFrame(state).telemetry).toEqual(telemetryBefore);
      stepPlayback(state);
      const canonical = playbackFrame(state);
      final.robots.forEach((r, i) => {
        expect(r.x).toBeCloseTo(canonical.robots[i]!.x, 8);
        expect(r.y).toBeCloseTo(canonical.robots[i]!.y, 8);
        expect(siteSegmentIsClear(state.layout, half.robots[i]!, half.robots[i]!)).toBe(true);
      });
    }
  });
});
