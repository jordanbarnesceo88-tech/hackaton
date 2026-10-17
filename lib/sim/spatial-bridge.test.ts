import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "./fixtures";
import { toSimInput } from "./adapter";
import { FIXTURE_H1500, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { resolveNorms } from "../tz/norms";
import { buildSimVariants } from "../../components/sim/variants";
import { simInputIdentity } from "./identity";
import { createSpatialProjectSnapshot, parseSpatialProjectResult, parseSpatialProjectSnapshot, spatialProjectMessageMatches, type SpatialProjectResult } from "./spatial-bridge";

function snapshot() {
  const input = warehouseBaseInput(7);
  input.seed = 719;
  input.layout.activeAreaM2 = 6300;
  input.layout.chargers = 3;
  input.robots.speedMps = 0.83;
  input.demand.peakPerH = 73;
  return createSpatialProjectSnapshot({ requestId: "ticket-1", scenarioKey: "p7", scenarioName: "Выбранный вариант", variantId: "byNorm", input, provenance: [{ field: "calc:fleet", label: "Парк", value: 7, unit: "шт.", origin: "user", note: undefined }], assumedUtilPct: 64 });
}

function reply(): SpatialProjectResult {
  const s = snapshot();
  return { type: "spatial-project-result", requestId: s.requestId, sourceInputKey: s.inputKey, executionInputKey: "spatial-execution-key", assessment: { status: "PARTIAL", headline: "Заданная нагрузка не выполнена", terminal: true }, summary: { fleet: 7, requiredPerH: 73, achievedPerH: 59, queueEnd: 32, waitP95Min: 12 }, simModelVersion: "spatial-test-1", modified: false };
}

describe("project → spatial handoff", () => {
  it("rejects zero operation docks instead of allowing layout defaults to add them", () => {
    for (const field of ["receivingDocksCount", "shippingDocksCount"] as const) {
      const s = snapshot(); s.input.layout[field] = 0; s.inputKey = simInputIdentity(s.input);
      expect(() => parseSpatialProjectSnapshot(s)).toThrow(/ворота/);
    }
  });
  it("preserves the selected variant's exact custom input, seed and provenance without baseline defaults", () => {
    const s = snapshot(), parsed = parseSpatialProjectSnapshot(JSON.parse(JSON.stringify(s)));
    expect(parsed).toEqual(s);
    expect(parsed.input).toMatchObject({ seed: 719, layout: { activeAreaM2: 6300, chargers: 3 }, robots: { count: 7, speedMps: 0.83 }, demand: { peakPerH: 73 } });
    expect(parsed.inputKey).toBe(simInputIdentity(parsed.input));
    parsed.input.robots.count = 12;
    expect(s.input.robots.count).toBe(7);
  });

  it("accepts actual adapter and buildSimVariants provenance, including optional undefined metadata", () => {
    const adapter = toSimInput({ params: WAREHOUSE_BASE_PARAMS, product: FIXTURE_H1500, fleet: 11, chargers: 1, peakPerH: 129.5, avgPerH: 86.3, norms: resolveNorms(), seed: 49 });
    if (!adapter.ok) throw new Error(adapter.message);
    const variants = buildSimVariants({ scenarioName: "Покупка", calculated: adapter.input, byNorm: adapter.input, minStableFleet: 9, provenance: adapter.provenance });
    for (const variant of variants) {
      if (!variant.input) throw new Error("Expected a real variant");
      const result = createSpatialProjectSnapshot({ requestId: `actual-${variant.id}`, scenarioKey: "p1", scenarioName: "Покупка", variantId: variant.id, input: variant.input, provenance: variant.provenance, assumedUtilPct: adapter.assumedUtilPct });
      expect(result.input).toEqual(variant.input);
      expect(result.inputKey).toBe(simInputIdentity(variant.input));
      expect(result.provenance).toEqual(JSON.parse(JSON.stringify(variant.provenance)));
    }
    const invalid = { ...adapter.input, robots: { ...adapter.input.robots, speedMps: Infinity } };
    expect(() => createSpatialProjectSnapshot({ requestId: "invalid-number", scenarioKey: "p", scenarioName: "Покупка", variantId: "calculated", input: invalid, provenance: adapter.provenance })).toThrow("нечисловое");
  });

  it("does not add financial or user metadata to the handoff", () => {
    const s = parseSpatialProjectSnapshot({ ...snapshot(), projectName: "Private", userEmail: "private@example.test", finance: { npvRub: 100 } });
    expect(s).not.toHaveProperty("projectName");
    expect(s).not.toHaveProperty("userEmail");
    expect(s).not.toHaveProperty("finance");
  });

  it("rejects an identity for another input instead of repairing seed, geometry or fleet", () => {
    const s = snapshot();
    s.input.seed++;
    expect(() => parseSpatialProjectSnapshot(s)).toThrow("Идентификатор");
    expect(() => parseSpatialProjectSnapshot({ ...snapshot(), schemaVersion: "spatial-project-0" })).toThrow();
    expect(() => parseSpatialProjectSnapshot({ ...snapshot(), requestId: "../bad#ticket" })).toThrow();
  });

  it("rejects malformed/nonfinite inputs at the message boundary", () => {
    const s = snapshot();
    expect(() => parseSpatialProjectSnapshot({ ...s, input: { ...s.input, robots: null } })).toThrow();
    s.input.robots.speedMps = Number.NaN;
    expect(() => parseSpatialProjectSnapshot(s)).toThrow("нечисловое");
    expect(() => parseSpatialProjectSnapshot({ ...snapshot(), assumedUtilPct: 101 })).toThrow();
  });

  it("preserves intentionally unknown robot characteristics and zero handling time", () => {
    const input = warehouseBaseInput(2);
    input.robots = { ...input.robots, autonomyH: null, chargeMin: null, payloadKg: null, handlingSec: 0 };
    const s = createSpatialProjectSnapshot({ requestId: "null-specs", scenarioKey: "p", scenarioName: "Сценарий", variantId: "calculated", input });
    expect(s.input).toEqual(input);
  });

  it("accepts only the exact origin, window source and request ticket", () => {
    const source = {} as Window, other = {} as Window;
    const expected = { origin: "https://example.test", source, requestId: "ticket-1" };
    const event = { origin: expected.origin, source, data: { type: "spatial-project-ready", requestId: expected.requestId } };
    expect(spatialProjectMessageMatches(event, expected)).toBe(true);
    expect(spatialProjectMessageMatches({ ...event, origin: "https://other.test" }, expected)).toBe(false);
    expect(spatialProjectMessageMatches({ ...event, source: other }, expected)).toBe(false);
    expect(spatialProjectMessageMatches({ ...event, data: { requestId: "old-ticket" } }, expected)).toBe(false);
    expect(spatialProjectMessageMatches({ ...event, data: null }, expected)).toBe(false);
    expect(spatialProjectMessageMatches(event, { ...expected, source: null })).toBe(false);
    expect(spatialProjectMessageMatches({ ...event, origin: "null" }, { ...expected, origin: "null" })).toBe(false);
  });

  it("accepts a terminal PARTIAL as separate evidence, without changing the input", () => {
    const s = snapshot(), r = reply();
    expect(parseSpatialProjectResult(r, s)).toEqual(r);
    expect(s.input.robots.count).toBe(7);
    expect(parseSpatialProjectResult(r, s)).not.toHaveProperty("npvRub");
  });

  it("rejects another variant, modified comparison row, incomplete result or nonfinite metrics", () => {
    for (const patch of [{ sourceInputKey: "old-key" }, { requestId: "old-ticket" }, { modified: true }, { assessment: { ...reply().assessment, status: "RUNNING", terminal: false } }, { summary: { ...reply().summary, fleet: 8 } }, { summary: { ...reply().summary, requiredPerH: 99 } }, { summary: { ...reply().summary, achievedPerH: Number.NaN } }]) {
      expect(() => parseSpatialProjectResult({ ...reply(), ...patch }, snapshot())).toThrow();
    }
  });

  it("keeps unexpected financial fields out of a valid spatial reply", () => {
    const result = parseSpatialProjectResult({ ...reply(), npvRub: 1_000_000, finance: { paybackYears: 1 } }, snapshot());
    expect(result).not.toHaveProperty("npvRub");
    expect(result).not.toHaveProperty("finance");
  });
});
