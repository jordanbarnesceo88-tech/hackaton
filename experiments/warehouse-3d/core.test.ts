import { describe, expect, it } from "vitest";
import { rackRects } from "../../components/sim/scene-model";
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
import { calculateCase, createPlayback, DEMO_CASES, isPlaybackDone, playbackFrame, previewInterpolate, stepPlayback } from "./core";
import { isTrafficInput } from "./traffic";
import { complexSite } from "./site";
import { incidentSummary, type IncidentConfig } from "./incidents";

describe("standalone demo uses the production calculation and engine", () => {
  it("presets distinguish automatic sizing, insufficient fleet and increased flow", () => {
    expect(DEMO_CASES[0].id).toBe("complex");
    const [baseline, insufficient, increased] = (["baseline", "insufficient", "increased-flow"] as const).map((id) => calculateCase(id));
    expect(baseline?.input.robots.count).toBe(11);
    expect(baseline?.summary.verdict).toBe("NOT_CONFIRMED");
    expect(insufficient?.input.robots.count).toBe(3);
    expect(insufficient?.summary.verdict).toBe("NOT_CONFIRMED");
    expect(increased?.input.robots.count).toBe(11);
    expect(increased?.summary.requiredPerH).toBeGreaterThan(baseline!.summary.requiredPerH);
    expect(increased?.summary.verdict).toBe("NOT_CONFIRMED");
    expect(baseline?.finance).toBeNull();
    expect(baseline?.financeUnavailableReason).toContain("защитные остановки");
    expect(baseline?.summary.minStableFleet).toBeNull();
  });

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
    const { siteLayout: _site, demoTraffic: _traffic, demoIncidents: _incidents, ...physical } = result.input as typeof result.input & { demoTraffic: unknown; demoIncidents: IncidentConfig };
    expect(_incidents.enabled).toBe(true);
    expect(_site).toBeDefined(); expect(_traffic).toBeDefined();
    expect(physical).toEqual(model.simInputs.purchase?.calculated);
    const purchase = model.results.find((r) => r.key === "purchase");
    expect(purchase?.status).toBe("ok");
    if (purchase?.status !== "ok") throw new Error("fixture refused");
    expect(result.input.layout.chargers).toBe(purchase.items[0]?.chargers);
    expect(result.finance).toBeNull();
    expect(result.sources.some((s) => s.includes("robotrends.ru"))).toBe(true);
    expect(result.assumptions.some((s) => s.includes("не подтверждённое предложение"))).toBe(true);
  });

  it("playback batches retain exact headless terminal metrics", () => {
    const result = calculateCase("baseline");
    const state = createPlayback(result.input);
    let i = 0;
    const batches = [1, 17, 64];
    while (!isPlaybackDone(state)) stepPlayback(state, batches[i++ % batches.length]!);
    expect({ ...summarize(state, { scenarioKey: "purchase", assumedUtilPct: result.summary.assumedUtilPct }), incidentSummary: incidentSummary(state), verdictScope: "intake-sla", simModelVersion: result.simModelVersion }).toEqual(result.summary);
    const frame = playbackFrame(state);
    expect(frame.tS).toBe(frame.endS);
    const t = state.tS;
    stepPlayback(state, 3600);
    expect(state.tS).toBe(t);
    frame.robots[0]!.x = -999;
    frame.points[0]!.queue.push(-1);
    expect(state.robots[0]!.x).not.toBe(-999);
    expect(state.points[0]!.queue).not.toContain(-1);
  });

  it("racks share engine world coordinates, including resized active area", () => {
    const result = calculateCase("baseline", { areaM2: 5000 });
    expect(result.layout.widthM * result.layout.heightM).toBeCloseTo(5000);
    expect(result.racks).toEqual(rackRects(result.layout).map((r) => ({ ...r, y: result.layout.heightM - r.y - r.h })));
    expect(result.racks.every((r) => r.y >= 0 && r.y + r.h <= result.layout.heightM)).toBe(true);
  });

  it.each([
    { fleet: NaN }, { fleet: Infinity }, { fleet: 1.5 }, { fleet: 0 }, { fleet: 501 },
    { peakFactor: 0 }, { peakFactor: 2.6 }, { areaM2: -1 }, { areaM2: 4999 }, { areaM2: 50001 },
    { chargers: 2 },
  ])("rejects invalid or independent charger override %j", (overrides) => {
    expect(() => calculateCase("baseline", overrides)).toThrow();
  });

  it("rejects unknown cases and non-integral playback steps", () => {
    expect(() => calculateCase("unknown")).toThrow("Неизвестный сценарий");
    const state = createPlayback(calculateCase("baseline").input);
    for (const seconds of [NaN, Infinity, -1, 0.5, 3601]) expect(() => stepPlayback(state, seconds)).toThrow();
    stepPlayback(state, 0);
    expect(state.tS).toBe(0);
  });

  it("complex map routes around actual walls and racks through a connected graph", () => {
    const result = calculateCase("complex");
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
    const locations = [...result.layout.receiving, ...result.layout.shipping, ...result.layout.chargers, ...result.layout.slots];
    for (const a of locations) for (const b of locations) {
      const path = route(result.layout, a, b);
      for (let i = 1; i < path.length; i++) expect(siteSegmentIsClear(result.layout, path[i - 1]!, path[i]!)).toBe(true);
      expect(routeLengthBetween(result.layout, a.x, a.y, b.x, b.y)).toBe(routeLengthM(path));
    }
    const a = { x: 44, y: 34 };
    const b = { x: 54, y: 34 };
    expect(siteSegmentIsClear(result.layout, a, b)).toBe(false);
    expect(routeLengthBetween(result.layout, a.x, a.y, b.x, b.y)).toBeGreaterThan(10);
    const c = { x: 94, y: 74 };
    const d = { x: 144, y: 34 };
    expect(siteSegmentIsClear(result.layout, c, d)).toBe(false);
  });

  it("invalid custom graph is NOT_SUPPORTED, never a fallback successful rectangle", () => {
    const result = calculateCase("complex");
    const input = structuredClone(result.input);
    input.siteLayout!.routingGraph!.edges.push({ from: "node-44-34", to: "node-54-34" });
    expect(createSim(input).precheck).toBe("invalid");
    expect(runSimSync(input).verdict).toBe("NOT_SUPPORTED");
    input.siteLayout!.routingGraph!.nodes[0]!.x = NaN;
    expect(runSimSync(input).verdict).toBe("NOT_SUPPORTED");
  });

  it("scaled site keeps physical clearance and does not detour between positions on one graph edge", () => {
    for (const areaM2 of [5000, 50000]) {
      const layout = complexSite(areaM2, 1);
      expect(layout.routingGraph!.clearanceM).toBe(0.8);
      expect(validateSiteLayout(layout)).toEqual([]);
    }
    const layout = calculateCase("complex").layout;
    expect(route(layout, { x: 7, y: 24 }, { x: 9, y: 24 })).toEqual([{ x: 7, y: 24 }, { x: 9, y: 24 }]);
    expect(routeLengthBetween(layout, 7, 24, 9, 24)).toBe(2);
  });

  it("complex playback preserves headless metrics and reports actual counters/history/events", () => {
    const result = calculateCase("complex");
    const state = createPlayback(result.input);
    while (!isPlaybackDone(state)) stepPlayback(state, 64);
    expect({ ...summarize(state, { scenarioKey: "purchase", assumedUtilPct: result.summary.assumedUtilPct }), incidentSummary: incidentSummary(state), verdictScope: "intake-sla", simModelVersion: result.simModelVersion }).toEqual(result.summary);
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
  });

  it("smooth preview follows graph path, changes no state/counters and predicts canonical next positions", () => {
    const result = calculateCase("complex");
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
