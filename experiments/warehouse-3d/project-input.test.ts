import { describe, expect, it } from "vitest";
import { createSim } from "../../lib/sim/engine";
import { warehouseBaseInput } from "../../lib/sim/fixtures";
import { simInputIdentity } from "../../lib/sim/identity";
import { applyFleetComparison, compareWarehouseFleet } from "./comparison";
import { calculateProjectPreview } from "./project-input";
import { complexSite } from "./site";

function fixture() {
  const input = warehouseBaseInput(3);
  input.seed = 19; input.robots.speedMps = 0.8; input.robots.handlingSec = 42;
  input.layout.activeAreaM2 = 8000; input.layout.chargers = 2;
  input.demand = { avgPerH: 20, peakPerH: 30, warmupMin: 2, peakMin: 20 };
  return { schemaVersion: "spatial-project-1" as const, requestId: "request-19", scenarioKey: "custom-purchase", scenarioName: "Мой рассчитанный сценарий", variantId: "calculated" as const, input, inputKey: simInputIdentity(input) };
}

describe("project spatial preview", () => {
  it("keeps exact project parameters and source identity without catalog or complex-demo defaults", () => {
    const snapshot = fixture(), before = structuredClone(snapshot), sourceLayout = createSim(snapshot.input).layout;
    const model = calculateProjectPreview(snapshot);
    expect(snapshot).toEqual(before);
    expect(model.id).toBe("project"); expect(model.input.seed).toBe(19);
    expect(model.input.robots).toEqual(snapshot.input.robots); expect(model.input.demand).toEqual(snapshot.input.demand);
    expect(model.input.layout).toEqual(snapshot.input.layout);
    expect(model.layout.slots).toEqual(sourceLayout.slots); expect(model.layout.receiving).toEqual(sourceLayout.receiving);
    expect([model.layout.widthM, model.layout.heightM]).toEqual([sourceLayout.widthM, sourceLayout.heightM]);
    expect(model.projectOrigin?.sourceInputKey).toBe(snapshot.inputKey);
    expect(model.projectOrigin?.executionInputKey).toBe(simInputIdentity(model.input));
    expect(model.projectOrigin?.executionInputKey).not.toBe(snapshot.inputKey);
    expect(model.summary.scenarioKey).toBe(snapshot.scenarioKey); expect(model.finance).toBeNull();
    expect((model.input as typeof model.input & { demoIncidents: { enabled: boolean } }).demoIncidents.enabled).toBe(false);
  });

  it("preserves a supplied physical site through comparison and exact row application", async () => {
    const snapshot = fixture(); snapshot.input.siteLayout = complexSite(8000, 2);
    snapshot.input.layout.receivingDocksCount = snapshot.input.siteLayout.receiving.length;
    snapshot.input.layout.shippingDocksCount = snapshot.input.siteLayout.shipping.length;
    snapshot.inputKey = simInputIdentity(snapshot.input);
    const model = calculateProjectPreview(snapshot), result = await compareWarehouseFleet(model, { maxFleet: 2 });
    expect(result.status).toBe("COMPLETE"); expect(result.runs.every(r => r.workloadMatched)).toBe(true);
    expect(result.context.fixedInput.siteLayout?.walls).toEqual(snapshot.input.siteLayout.walls);
    expect(result.context.fixedInput.siteLayout?.slots).toEqual(snapshot.input.siteLayout.slots);
    expect(result.context.chargerCount).toBe(2);
    const applied = applyFleetComparison(model, result, 1);
    expect(applied.input.robots.count).toBe(1); expect(applied.projectOrigin?.sourceInputKey).toBe(snapshot.inputKey);
    expect(applied.projectOrigin?.executionInputKey).toBe(simInputIdentity(applied.input));
    expect(applied.summary.scenarioKey).toBe(snapshot.scenarioKey);
    expect(applied.layout).toEqual(result.context.fixedInput.siteLayout);
  });

  it("rejects a stale identity and unsupported fleet instead of silently substituting a preset", () => {
    const stale = fixture(); stale.input.seed++;
    expect(() => calculateProjectPreview(stale)).toThrow();
    const large = fixture(); large.input.robots.count = 61; large.inputKey = simInputIdentity(large.input);
    expect(() => calculateProjectPreview(large)).toThrow(/60/);
  });
});
