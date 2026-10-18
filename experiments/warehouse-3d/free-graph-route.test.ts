import { describe, expect, it } from "vitest";
import type { SimLayout } from "../../lib/sim/types";
import { routeLengthM } from "../../lib/sim/routing";
import { freeGraphRoute, segmentDistance } from "./traffic";

function floor(nodes: { id: string; x: number; y: number }[], edges: { from: string; to: string }[]): SimLayout {
  return { widthM: 150, heightM: 150, zones: [], crossAislesY: [], rackAislesX: [], slots: [], receiving: [], shipping: [], chargers: [],
    footprint: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }], routingGraph: { nodes, edges, clearanceM: 0.95 } };
}

describe("dynamic graph search checks the explored links", () => {
  it("does not scan stock on an entire distant branch to reach a nearby target", () => {
    const nodes = Array.from({ length: 91 }, (_, i) => ({ id: `n${i}`, x: 10 + i, y: 10 }));
    const edges = nodes.slice(1).map((node, i) => ({ from: `n${i}`, to: node.id }));
    nodes.push({ id: "far", x: 100, y: 100 }); edges.push({ from: "n90", to: "far" });
    let checks = 0;
    const path = freeGraphRoute(floor(nodes, edges), nodes[0]!, nodes[4]!, [], 1.95, () => { checks++; return true; });
    expect(path).not.toBeNull(); expect(path!.at(-1)).toMatchObject({ x: 14, y: 10 });
    expect(routeLengthM(path!)).toBe(4);
    expect(checks).toBeLessThan(20);
  });

  it("rechecks dynamic blockers on the next search and keeps every detour segment clear", () => {
    const nodes = [{ id: "a", x: 10, y: 10 }, { id: "b", x: 16, y: 10 }, { id: "c", x: 10, y: 14 }, { id: "d", x: 16, y: 14 }];
    const layout = floor(nodes, [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "b" }]);
    expect(routeLengthM(freeGraphRoute(layout, nodes[0]!, nodes[1]!, [], 1.95)!)).toBe(6);
    const blocker = { id: 7, x: 13, y: 10 };
    const detour = freeGraphRoute(layout, nodes[0]!, nodes[1]!, [blocker], 1.95)!;
    expect(detour).not.toBeNull(); expect(routeLengthM(detour)).toBe(14);
    for (let i = 1; i < detour.length; i++) expect(segmentDistance(detour[i - 1]!, detour[i]!, blocker, blocker)).toBeGreaterThanOrEqual(1.95);
    expect(freeGraphRoute(layout, nodes[0]!, nodes[1]!, [{ ...nodes[1]!, id: 8 }], 1.95)).toBeNull();
    expect(freeGraphRoute(layout, nodes[0]!, nodes[1]!, [], 1.95, (a, b) => !(a.x === 16 && a.y === 10 && b.x === 16 && b.y === 10))).toBeNull();
  });
});
