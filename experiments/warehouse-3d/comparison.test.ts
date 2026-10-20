import { describe, expect, it, vi } from "vitest";
import { simInputIdentity } from "../../lib/sim/identity";
import { summarize } from "../../lib/sim/metrics";
import { incidentSummary } from "./incidents";
import { applyFleetComparison, compareWarehouseFleet, fleetComparisonInput, type ComparisonProgress } from "./comparison";
import { assessPlayback, calculateCase, createPlayback, isPlaybackDone, stepPlayback } from "./core";

// Enumeration, replay and scripted targets need a real terminal run, but not the
// full 135-minute capacity example. Thirty minutes includes all four recoveries.
vi.mock("../../lib/tz/norms", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/tz/norms")>();
  return { ...actual, resolveNorms: (...args: Parameters<typeof actual.resolveNorms>) => ({
    ...actual.resolveNorms(...args), simWarmupMin: 0, simPeakMin: 30,
  }) };
});

const reference = calculateCase("complex");
const trace = (state: ReturnType<typeof createPlayback>) => "tasks" in state ? state.tasks.filter(task => task.countsTowardDemand !== false).map(({ id, kind, arrivalS, fromPoint, fromX, fromY, toPoint, toX, toY }) => ({ id, kind, arrivalS, fromPoint, fromX, fromY, toPoint, toX, toY })) : [];

describe("matched warehouse fleet enumeration", () => {
  it("freezes infrastructure and enumerates every requested N without mutating its reference", async () => {
    const before = structuredClone(reference), progress: ComparisonProgress[] = [];
    const result = await compareWarehouseFleet(reference, { maxFleet: 3, onProgress: (p) => progress.push(p) });
    expect(reference).toEqual(before);
    expect(result.status).toBe("COMPLETE");
    expect(result.runs.map((r) => r.fleet)).toEqual([1, 2, 3]);
    expect(result.runs.every((r) => r.status === "COMPLETE" && r.workloadMatched)).toBe(true);
    expect(new Set(result.runs.map((r) => r.workloadTraceKey)).size).toBe(1);
    expect(result.context.workload.tasks).toHaveLength(reference.summary.arrivedPeak);
    expect(result.context.chargerCount).toBe(reference.input.layout.chargers);
    expect(result.context.fixedInput.demoIncidents).toMatchObject({ enabled: false, schedule: [] });
    for (const n of [1, 2, 3]) {
      const input = fleetComparisonInput(result.context, n);
      expect(input.siteLayout).toEqual(result.context.fixedInput.siteLayout);
      expect(input.demoTraffic.initialPositions).toEqual(result.context.fixedInput.demoTraffic.initialPositions.slice(0, n));
      input.robots.count = 3; input.demoTraffic.initialPositions = result.context.fixedInput.demoTraffic.initialPositions;
      expect(input).toEqual(result.context.fixedInput);
    }
    expect(progress.some((p) => p.phase === "prepared" && p.contextSummary?.workloadCount === reference.summary.arrivedPeak)).toBe(true);
    expect(progress.filter((p) => p.phase === "candidate").map((p) => p.run!.fleet)).toEqual([1, 2, 3]);
    expect(result.runs.every((r) => !("inputKey" in r.summary!))).toBe(true);
  });

  it("matches all job fields and final RNG for 3/11/60 on one common 60-capacity site", async () => {
    const workload = structuredClone(reference);
    workload.input.demand = { ...workload.input.demand, warmupMin: 0, peakMin: 30 };
    workload.financialSourceInput!.demand = structuredClone(workload.input.demand);
    const result = await compareWarehouseFleet(workload, { minFleet: 60, maxFleet: 60 });
    expect(result.status).toBe("COMPLETE");
    const common = structuredClone(result.context.fixedInput);
    for (const n of [3, 11, 60]) {
      const state = createPlayback(fleetComparisonInput(result.context, n));
      while (!isPlaybackDone(state)) stepPlayback(state, 900);
      expect(trace(state)).toEqual(result.context.workload.tasks);
      expect(state.rng.a).toBe(result.context.workload.finalRng);
      expect(state.layout).toEqual(common.siteLayout);
      expect(state.layout.chargers).toHaveLength(reference.input.layout.chargers);
    }
    expect(result.context.fixedInput).toEqual(common);
  // Comparison plus three terminal replays, including N60, share CI CPUs; this is a correctness budget, not an execution SLA.
  }, 120_000);

  it("keeps scripted targets fixed and marks smaller candidates ineligible, not failed", async () => {
    const result = await compareWarehouseFleet(reference, { maxFleet: 4, faultMode: "scripted" });
    expect(result.status).toBe("COMPLETE");
    expect(result.context.eligibleMinFleet).toBe(4);
    expect(result.coverage.ineligibleFleets).toEqual([1, 2, 3]);
    expect(result.runs.slice(0, 3).every((r) => r.status === "INELIGIBLE" && !r.assessment)).toBe(true);
    expect(result.runs[3]!.summary!.incidentSummary).toMatchObject({ detected: 4, resolved: 4 });
    expect(result.context.fixedInput.demoIncidents!.schedule.map((s) => s.robotId)).toEqual([0, 3, 1, 2]);
  });

  it("establishes a minimum only after full enumeration and does not stop after the first pass", async () => {
    const low = structuredClone(reference); low.input.seed = 3;
    low.input.demand = { avgPerH: 2, peakPerH: 2, warmupMin: 0, peakMin: 60 };
    if (low.financialSourceInput) { low.financialSourceInput.seed = low.input.seed; low.financialSourceInput.demand = structuredClone(low.input.demand); }
    const result = await compareWarehouseFleet(low, { maxFleet: 3 });
    expect(result.runs.map((r) => r.assessment!.status)).toEqual(["PARTIAL", "OK", "OK"]);
    expect(result.minimumFleet).toBe(2); expect(result.minimumScope).toBe("tested-range");
    expect(result.runs.map((r) => r.fleet)).toEqual([1, 2, 3]);
    const controller = new AbortController();
    const partial = await compareWarehouseFleet(low, { maxFleet: 3, signal: controller.signal, onProgress: (p) => { if (p.run?.fleet === 2) controller.abort(); } });
    expect(partial.status).toBe("PARTIAL"); expect(partial.stopReason).toBe("cancelled");
    expect(partial.bestTestedPassingFleet).toBe(2); expect(partial.minimumFleet).toBeNull(); expect(partial.minimumScope).toBe("not-established");
  // Five full 1-hour replays of the complex plan include the pedestrian audit.
  // Correctness assertions remain exact; runtime performance is measured separately.
  }, 30_000);

  it("rejects an edited scene seed or physical wall that no longer matches its source plan", async () => {
    const seed = structuredClone(reference); seed.input.seed++;
    await expect(compareWarehouseFleet(seed, { maxFleet: 1 })).rejects.toThrow(/Условия сцены/);
    const wall = structuredClone(reference); wall.input.siteLayout!.walls!.push({ x: 1, y: 1, w: 1, h: 1 });
    await expect(compareWarehouseFleet(wall, { maxFleet: 1 })).rejects.toThrow(/Геометрия сцены/);
    const gap=structuredClone(reference);gap.input.pedestrians!.clearanceM+=.1;
    await expect(compareWarehouseFleet(gap,{maxFleet:1})).rejects.toThrow(/Условия сцены/);
    const trajectory=structuredClone(reference);trajectory.input.pedestrians!.people[0]!.trajectory[1]!.tS++;
    await expect(compareWarehouseFleet(trajectory,{maxFleet:1})).rejects.toThrow(/Условия сцены/);
  });

  it("does not label an interrupted candidate as a tested pass", async () => {
    const controller = new AbortController();
    const result = await compareWarehouseFleet(reference, { maxFleet: 3, signal: controller.signal, onProgress: (p) => { if (p.phase === "progress") controller.abort(); } });
    expect(result).toMatchObject({ status: "PARTIAL", stopReason: "cancelled", minimumFleet: null });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ status: "INTERRUPTED", observedAtS: 0 });
    expect(result.runs[0]!.assessment).toBeUndefined();
    expect(() => applyFleetComparison(reference, result, 1)).toThrow();
  });

  it("returns a bounded partial report when the preparation budget expires", async () => {
    let tick = 0; const clock = vi.spyOn(performance, "now").mockImplementation(() => ++tick * 10);
    try {
      const result = await compareWarehouseFleet(reference, { maxFleet: 3, budgetMs: 1 });
      expect(result).toMatchObject({ status: "PARTIAL", stopReason: "budget", minimumFleet: null, minimumScope: "not-established" });
      expect(result.runs).toEqual([]); expect(result.context.workload.complete).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it("applies the exact completed row and replays to identical metrics and assessment", async () => {
    const result = await compareWarehouseFleet(reference, { maxFleet: 3 });
    const model = applyFleetComparison(reference, result, 2), row = result.runs[1]!;
    expect(model.input).toEqual(fleetComparisonInput(result.context, 2));
    expect(model.layout).toBe(model.input.siteLayout);
    expect(model.summary.inputKey).toBe(simInputIdentity(model.input));
    expect(model.comparisonOrigin).toMatchObject({ contextKey: result.context.contextKey, fleet: 2, faultMode: "baseline" });
    const state = createPlayback(model.input); while (!isPlaybackDone(state)) stepPlayback(state, 900);
    expect(model.summary).toEqual({ ...summarize(state, { scenarioKey: "purchase", assumedUtilPct: row.summary!.assumedUtilPct }), incidentSummary: incidentSummary(state), simModelVersion: reference.simModelVersion, verdictScope: "intake-sla" });
    expect(assessPlayback(state)).toEqual(model.assessment);
    expect(() => applyFleetComparison(reference, result, 4)).toThrow();
    const changed = structuredClone(reference); changed.input.demand.peakPerH++;
    expect(() => applyFleetComparison(changed, result, 2)).toThrow("изменён");
    result.context.fixedInput.demoTraffic.maxActiveRoutes++;
    expect(() => applyFleetComparison(reference, result, 2)).toThrow("изменены");
  // Enumerates N1–3 and independently replays the chosen row; allow CPU scheduling without relaxing exact equality.
  }, 60_000);

  it("does not allow progress observers to change canonical comparison rows", async () => {
    const result = await compareWarehouseFleet(reference, { maxFleet: 1, onProgress: (p) => { if (p.run?.summary) p.run.summary.achievedPerH = 999999; } });
    expect(result.runs[0]!.summary!.achievedPerH).not.toBe(999999);
  });

  it.each([{ maxFleet: 0 }, { maxFleet: 61 }, { maxFleet: 2.5 }, { minFleet: 3, maxFleet: 2 }, { budgetMs: 0 }, { budgetMs: NaN }, { faultMode: "random" }])("rejects invalid comparison settings %j", async (options) => {
    await expect(compareWarehouseFleet(reference, options as never)).rejects.toThrow();
  });
});
