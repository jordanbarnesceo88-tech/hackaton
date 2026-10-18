import { describe, expect, it } from "vitest";
import { prepareWarehouseTraffic } from "../../experiments/warehouse-3d/traffic";
import { POD_RADIUS_M } from "../../experiments/warehouse-3d/carriers";
import { warehouseBaseInput } from "./fixtures";
import { siteSegmentIsClear, validateProjectSiteLayout, validateSiteLayout, WAREHOUSE_BODY_RADIUS_M } from "./site-layout";
import type { SimLayout } from "./types";

function site(): SimLayout {
  return { widthM: 40, heightM: 25, zones: [], crossAislesY: [5], rackAislesX: [1, 10, 20, 30], slots: [{ x: 20, y: 5 }],
    receiving: [{ id: "R", kind: "receiving", x: 1, y: 5 }], shipping: [{ id: "S", kind: "shipping", x: 30, y: 5 }], chargers: [{ id: "C", kind: "charger", x: 10, y: 5 }],
    footprint: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }], walls: [],
    routingGraph: { clearanceM: 0.8, nodes: [{ id: "a", x: 1, y: 5 }, { id: "b", x: 10, y: 5 }, { id: "c", x: 20, y: 5 }, { id: "d", x: 30, y: 5 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }] } };
}

describe("physical body clearance on explicit site routes", () => {
  it("preserves exact edge-membership and tolerance rules with the axis index", () => {
    const layout = site(), graph = layout.routingGraph!;
    graph.nodes.push({ id: "e", x: 20, y: 15 });
    graph.edges.push({ from: "c", to: "e" });
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const candidates = [
      { x: 15, y: 5 }, { x: 20, y: 12 }, { x: 20 + 9e-9, y: 12 },
      { x: 20 + 1.1e-8, y: 12 }, { x: 15, y: 5 + 9e-9 },
      { x: 15, y: 5 + 1.1e-8 }, { x: 20, y: 15 }, { x: 20, y: 15 + 1e-10 },
      { x: 1 - 1e-10, y: 5 }, { x: 30, y: 5 }, { x: 30 + 1e-10, y: 5 },
    ];
    for (const p of candidates) {
      const expected = graph.edges.some(edge => {
        const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
        return Math.abs(a.x - b.x) < 1e-8 && Math.abs(p.x - a.x) < 1e-8 && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y) ||
          Math.abs(a.y - b.y) < 1e-8 && Math.abs(p.y - a.y) < 1e-8 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x);
      });
      layout.slots = [p];
      expect(validateSiteLayout(layout).length === 0, JSON.stringify(p)).toBe(expected);
    }
  });
  it("rejects the actual zero-clearance wall-penetration counterexample without rewriting the source", () => {
    const layout = site(); layout.routingGraph!.clearanceM = 0; layout.walls = [{ x: 0, y: 5.2, w: 40, h: 0.2 }];
    expect(5.2 - 5 - WAREHOUSE_BODY_RADIUS_M).toBeCloseTo(-0.55);
    expect(validateSiteLayout(layout)).toEqual([]); // A geometrical centreline alone is insufficient for this body.
    expect(validateProjectSiteLayout(layout).join()).toContain("радиуса корпуса 0.75");
    const input = warehouseBaseInput(2); input.siteLayout = layout;
    const before = structuredClone(input);
    expect(() => prepareWarehouseTraffic(input)).toThrow(/радиуса корпуса/);
    expect(input).toEqual(before);
  });

  it("rejects sub-body declared margins and physical wall intersections at a valid declared margin", () => {
    const layout = site(); layout.routingGraph!.clearanceM = 0.74;
    expect(validateProjectSiteLayout(layout)).not.toEqual([]);
    layout.routingGraph!.clearanceM = 0.75;
    expect(validateProjectSiteLayout(layout)).toEqual([]);
    layout.walls = [{ x: 0, y: 5.2, w: 40, h: 0.2 }];
    expect(validateProjectSiteLayout(layout)).not.toEqual([]);
  });

  it("rejects original nodes and routes inside the polygon whose body crosses its outer boundary", () => {
    const layout = site();
    for (const point of [...layout.routingGraph!.nodes, ...layout.receiving, ...layout.shipping, ...layout.chargers, ...layout.slots]) point.y = 0.2;
    expect(siteSegmentIsClear(layout, { x: 1, y: 0.2 }, { x: 30, y: 0.2 })).toBe(false);
    expect(validateSiteLayout(layout)).not.toEqual([]);
  });

  it("uses the same body margin for derived parking/bypass candidates including concave corners", () => {
    const layout = site();
    layout.footprint = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 25 }, { x: 0, y: 25 }];
    expect(siteSegmentIsClear(layout, { x: 19.5, y: 9.5 }, { x: 19.5, y: 9.5 })).toBe(false);
    expect(siteSegmentIsClear(layout, { x: 10, y: 9.5 }, { x: 30, y: 9.5 })).toBe(false);
    expect(siteSegmentIsClear(layout, { x: 10, y: 9 }, { x: 30, y: 9 })).toBe(true);
    expect(siteSegmentIsClear(layout, { x: 0.8, y: 2 }, { x: 0.8, y: 8 })).toBe(true);
  });

  it("prepares only graph segments and parking bodies inside the unchanged physical site", () => {
    const input = warehouseBaseInput(2); input.siteLayout = site();
    const before = structuredClone(input.siteLayout), prepared = prepareWarehouseTraffic(input), graph = prepared.siteLayout!.routingGraph!;
    for (const edge of graph.edges) {
      const a = graph.nodes.find(n => n.id === edge.from)!, b = graph.nodes.find(n => n.id === edge.to)!;
      expect(siteSegmentIsClear(prepared.siteLayout!, a, b)).toBe(true);
    }
    for (const bay of prepared.demoTraffic.parkingBays) expect(siteSegmentIsClear(prepared.siteLayout!, bay, bay)).toBe(true);
    expect(prepared.demoTraffic.radiusM).toBe(POD_RADIUS_M);
    expect(graph.clearanceM).toBeGreaterThanOrEqual(POD_RADIUS_M + .05 - 1e-9);
    expect(input.siteLayout).toEqual(before);
  });
});
