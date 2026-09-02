import { describe, it, expect } from "vitest";
import { generateLayout, mapKind } from "./layout";
// generateLayout takes the area alone — it is the only input the scene grid is sized from.
const AREA = 1000;
const HUGE_AREA = 10_000_000;

describe("mapKind", () => {
  it("passes through known kinds", () => {
    expect(mapKind("warehouse")).toBe("warehouse");
    expect(mapKind("airport")).toBe("airport");
    expect(mapKind("medical")).toBe("medical");
    expect(mapKind("other")).toBe("other");
  });
  it("falls back to 'other' for unknown slugs", () => {
    expect(mapKind("spaceport")).toBe("other");
    expect(mapKind("")).toBe("other");
  });
});

describe("generateLayout", () => {
  it("is deterministic for the same inputs", () => {
    expect(generateLayout("warehouse", AREA)).toEqual(generateLayout("warehouse", AREA));
  });
  it("produces the requested kind and a valid path template", () => {
    for (const k of ["warehouse", "airport", "medical", "other"] as const) {
      const layout = generateLayout(k, AREA);
      expect(layout.kind).toBe(k);
      expect(layout.zones.length).toBeGreaterThan(0);
      expect(layout.pathTemplate.length).toBeGreaterThanOrEqual(2);
      // all coords normalized within [0,1]
      for (const z of layout.zones) {
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.x + z.w).toBeLessThanOrEqual(1.0001);
        expect(z.y + z.h).toBeLessThanOrEqual(1.0001);
      }
      for (const wp of layout.pathTemplate) {
        expect(wp.x).toBeGreaterThanOrEqual(0);
        expect(wp.x).toBeLessThanOrEqual(1);
        expect(wp.y).toBeGreaterThanOrEqual(0);
        expect(wp.y).toBeLessThanOrEqual(1);
      }
    }
  });
  it("includes a dock zone in every layout", () => {
    for (const k of ["warehouse", "airport", "medical", "other"] as const) {
      expect(generateLayout(k, AREA).zones.some((z) => z.kind === "dock")).toBe(true);
    }
  });
  it("clamps the grid for extreme inputs (I7) — never explodes past a 6x6 grid + a few fixtures", () => {
    for (const k of ["warehouse", "airport", "medical", "other"] as const) {
      const nonDock = generateLayout(k, HUGE_AREA).zones.filter((z) => z.kind !== "dock");
      // 6x6 = 36 grid cells, plus at most a couple of fixture zones (belt/corridor).
      expect(nonDock.length).toBeLessThanOrEqual(40);
    }
  });
});
