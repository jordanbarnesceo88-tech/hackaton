import { describe, expect, it } from "vitest";
import { calculateProjectCapacityPreview, calculateProjectCapacityPreviewAsync, calculateProjectPreview } from "./project-input";
import { createSpatialProjectSnapshot } from "../../lib/sim/spatial-bridge";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";
import { isDone } from "../../lib/sim/engine";
import { capacityCohort, deriveCapacityInput } from "../../lib/sim/capacity-protocol";

function fixture() {
  const input = warehouseBaseInput(3);
  input.transportWorkflow = "closed-pod-1";
  input.layout = { ...input.layout, activeAreaM2: 1000, receivingDocksCount: 1, shippingDocksCount: 1, chargers: 1 };
  input.demand = { ...input.demand, avgPerH: 6, peakPerH: 12, warmupMin: 1, peakMin: 5, mix: { inbound: 0.5, outbound: 0.5, internal: 0 } };
  return createSpatialProjectSnapshot({ requestId: "capacity-test", scenarioKey: "small-closed", scenarioName: "Small closed workflow", variantId: "calculated", input });
}

describe("real canonical controlled runner", () => {
  it("runs the same strict input sync and async without changing the source or nominal observation", async () => {
    const snapshot = fixture(), before = structuredClone(snapshot), nominal = calculateProjectPreview(snapshot);
    const sync = calculateProjectCapacityPreview(snapshot);
    const async = await calculateProjectCapacityPreviewAsync(snapshot, { sliceMs: 1, yieldFn: async () => {} });
    expect(async).toEqual(sync); expect(snapshot).toEqual(before);
    expect(sync.input.demand.peakPerH).toBe(12); expect(sync.input.demand.offered?.perH).toBeCloseTo(13.2);
    expect(sync.metrics.measurementStartS).toBe(900); expect(sync.metrics.measurementEndS).toBe(8100);
    expect(sync.sourceInputKey).toBe(snapshot.inputKey); expect(sync.testInputKey).not.toBe(sync.executionInputKey);
    expect(sync.terminal).toBe(true); expect(sync.status).toBe("PASS");
    expect(sync.metrics.closedCohortPerH).toBeGreaterThanOrEqual(12);
    expect(calculateProjectPreview(snapshot).summary).toEqual(nominal.summary);
    expect(nominal.qualificationDiagnostics).toBeDefined();
  }, 15000);

  it("matches real prefetch/return kinds, pod ownership and geometry, rather than synthetic child assumptions", () => {
    const input = prepareWarehouseTraffic(deriveCapacityInput(fixture().input)), state = createWarehouseTrafficState(input);
    while (!isDone(state)) stepWarehouseTraffic(state);
    const counts = capacityCohort(state.tasks, 900, 8100);
    expect(counts.closed).toBeGreaterThanOrEqual(24);
    const completed = state.tasks.filter(t => t.countsTowardDemand !== false && t.arrivalS >= 900 && t.doneS !== null);
    expect(completed.some(t => t.kind === "inbound")).toBe(true); expect(completed.some(t => t.kind === "outbound")).toBe(true);
    expect(capacityCohort(state.tasks.filter(t => t.operation !== "return-pod"), 900, 8100).closed).toBeLessThan(counts.closed);
    expect(capacityCohort(state.tasks.filter(t => t.operation !== "prefetch-pod"), 900, 8100).closed).toBeLessThan(counts.closed);
  }, 15000);

  it("enforces cooperative deadlines/cancellation and the offered workload limit before execution", async () => {
    const snapshot = fixture(), abort = new AbortController(); abort.abort();
    expect(() => calculateProjectCapacityPreview(snapshot, { signal: abort.signal })).toThrow();
    await expect(calculateProjectCapacityPreviewAsync(snapshot, { now: () => 10, deadline: 10 })).rejects.toThrow();
    let clock = 0;
    expect(() => calculateProjectPreview(snapshot, { now: () => clock++, deadline: 3 })).toThrow();
    const large = fixture(); large.input.demand.peakPerH = 10000;
    const oversized = createSpatialProjectSnapshot({ ...large, input: large.input });
    expect(() => calculateProjectCapacityPreview(oversized)).toThrow(/20 000/);
  });
});
