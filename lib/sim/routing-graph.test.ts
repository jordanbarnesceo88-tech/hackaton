import { describe, expect, it, vi } from "vitest";
import { createSim } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import { route, routeLengthBetween, routeLengthM, weightedMeanRouteLength } from "./routing";
import { validateSiteLayout } from "./site-layout";
import type { SimLayout } from "./types";

function grid(width: number, height: number): SimLayout {
  const layout = createSim(warehouseBaseInput(1)).layout;
  const nodes = Array.from({ length: width * height }, (_, i) => ({ id: `n${i}`, x: (i % width) * 1.2, y: Math.floor(i / width) * 2.6 }));
  const edges = nodes.flatMap((node, i) => [
    ...(i % width ? [{ from: nodes[i - 1]!.id, to: node.id }] : []),
    ...(i >= width ? [{ from: nodes[i - width]!.id, to: node.id }] : []),
  ]);
  return { ...layout, routingGraph: { nodes, edges, clearanceM: .95 } };
}

function nearNodesGraph(delta: number): SimLayout {
  const nodes = [{ id: "a", x: 5, y: 5 }, { id: "b", x: 5 + delta, y: 5 },
    { id: "c", x: 5, y: 15 }, { id: "d", x: 15, y: 15 },
    { id: "e", x: 15, y: 2 }, { id: "f", x: 5 + delta, y: 2 }];
  return { ...grid(2, 2), widthM: 20, heightM: 20, zones: [], crossAislesY: [], rackAislesX: [],
    footprint: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
    slots: [nodes[0]!], receiving: [{ ...nodes[0]!, kind: "receiving" }],
    shipping: [{ ...nodes[2]!, kind: "shipping" }], chargers: [],
    routingGraph: { clearanceM: 0, nodes, edges: [["a", "c"], ["c", "d"], ["d", "e"], ["e", "f"], ["f", "b"]].map(([from, to]) => ({ from: from!, to: to! })) } };
}

// Independent reference retains the previous linear-selection Dijkstra and its tie order.
function reference(layout: SimLayout, source: number) {
  const graph = layout.routingGraph!, count = graph.nodes.length;
  const distances = Array<number>(count).fill(Infinity), previous = Array<number>(count).fill(-1), seen = Array<boolean>(count).fill(false);
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  distances[source] = 0;
  for (let step = 0; step < count; step++) {
    let current = -1;
    for (let i = 0; i < count; i++) if (!seen[i] && (current < 0 || distances[i]! < distances[current]!)) current = i;
    if (current < 0 || !Number.isFinite(distances[current])) break;
    seen[current] = true;
    for (const edge of graph.edges) {
      const a = index.get(edge.from)!, b = index.get(edge.to)!, next = a === current ? b : b === current ? a : -1;
      if (next < 0) continue;
      const from = graph.nodes[current]!, to = graph.nodes[next]!;
      const length = distances[current]! + Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      if (length < distances[next]!) { distances[next] = length; previous[next] = current; }
    }
  }
  return { distances, previous };
}

describe("dense graph routing preserves shortest routes and bounded-cache replay", () => {
  it("matches independent weighted pair enumeration for nodes, fuzzy anchors and mid-edge shortcuts", () => {
    const cases = [grid(5, 4), nearNodesGraph(5e-10)];
    for (const layout of cases) {
      const nodes = layout.routingGraph!.nodes;
      const from = nodes.slice(0, 3).map((p, i) => ({ ...p, weight: i + 1 }));
      const to = nodes.slice(-3).map((p, i) => ({ ...p, weight: i + .5 }));
      const total = from.reduce((s, a) => s + to.reduce((n, b) => n + a.weight * b.weight * routeLengthBetween(layout, a.x, a.y, b.x, b.y), 0), 0);
      expect(weightedMeanRouteLength(layout, from, to)).toBeCloseTo(total / (6 * 4.5), 10);
    }
    const layout = grid(5, 4);
    expect(weightedMeanRouteLength(layout, [{ x: .3, y: 0, weight: 2 }], [{ x: .9, y: 0, weight: 3 }])).toBeCloseTo(.6, 10);
    expect(() => weightedMeanRouteLength(layout, [{ x: 0, y: 0, weight: -1 }], [{ x: 0, y: 0, weight: 1 }])).toThrow(/weights/);
  });
  it("keeps cached first fuzzy matches without collapsing a non-transitive chain", () => {
    const layout = nearNodesGraph(.75e-9), graph = layout.routingGraph!;
    graph.nodes.push({ id: "g", x: 5 + 1.5e-9, y: 5 });
    graph.edges.push({ from: "g", to: "f" });
    expect(validateSiteLayout(layout)).toEqual([]);
    const scan = vi.spyOn(graph.nodes, "findIndex");
    try {
      // g is close to b, not a. Mapping b's alias transitively to a would shorten 36 m to 10 m.
      expect(routeLengthBetween(layout, graph.nodes[6]!.x, 5, 5, 15)).toBeCloseTo(36, 6);
      expect(routeLengthBetween(layout, graph.nodes[1]!.x, 5, 5, 15)).toBeCloseTo(10, 6);
      expect(scan).not.toHaveBeenCalled();
    } finally { scan.mockRestore(); }
  });
  it("retains the first fuzzy anchor when distinct validated nodes are closer than its tolerance", () => {
    const layout = nearNodesGraph(5e-10), nodes = layout.routingGraph!.nodes;
    expect(validateSiteLayout(layout)).toEqual([]);
    const expected = [nodes[1]!, nodes[2]!].map(({ x, y }) => ({ x, y }));
    expect(route(layout, nodes[1]!, nodes[2]!)).toEqual(expected);
    expect(routeLengthBetween(layout, nodes[1]!.x, nodes[1]!.y, nodes[2]!.x, nodes[2]!.y)).toBeCloseTo(routeLengthM(expected), 8);
  });

  it("keeps distinct exact anchors beyond the fuzzy tolerance on the same validated topology", () => {
    const layout = nearNodesGraph(1e-8), nodes = layout.routingGraph!.nodes;
    expect(validateSiteLayout(layout)).toEqual([]);
    const expected = [1, 5, 4, 3, 2].map(i => ({ x: nodes[i]!.x, y: nodes[i]!.y }));
    expect(route(layout, nodes[1]!, nodes[2]!)).toEqual(expected);
    expect(routeLengthBetween(layout, nodes[1]!.x, nodes[1]!.y, nodes[2]!.x, nodes[2]!.y)).toBeCloseTo(routeLengthM(expected), 12);
  });

  it("matches the previous route selection on all pairs, including equal-cost alternatives", () => {
    const layout = grid(7, 5), nodes = layout.routingGraph!.nodes;
    for (let source = 0; source < nodes.length; source++) {
      const old = reference(layout, source);
      for (let target = 0; target < nodes.length; target++) {
        const indices = [target];
        while (indices.at(-1) !== source) indices.push(old.previous[indices.at(-1)!]!);
        const expected = indices.reverse().map(i => ({ x: nodes[i]!.x, y: nodes[i]!.y }));
        expect(route(layout, nodes[source]!, nodes[target]!)).toEqual(expected);
        expect(routeLengthBetween(layout, nodes[source]!.x, nodes[source]!.y, nodes[target]!.x, nodes[target]!.y)).toBeCloseTo(routeLengthM(expected), 9);
      }
    }
  });

  it("keeps mid-edge anchors and direct same-edge travel equivalent to the constructed path", () => {
    const layout = grid(5, 4);
    for (const [a, b] of [[{ x: .3, y: 0 }, { x: .9, y: 0 }], [{ x: .3, y: 0 }, { x: 4.8, y: 1.3 }], [{ x: 1.2 + 1e-10, y: 0 }, { x: 4.8, y: 7.8 }]]) {
      expect(routeLengthBetween(layout, a!.x, a!.y, b!.x, b!.y)).toBeCloseTo(routeLengthM(route(layout, a!, b!)), 8);
    }
  });

  it("recomputes evicted sources without changing paths on a dense graph", () => {
    const layout = grid(50, 30), nodes = layout.routingGraph!.nodes, last = nodes.at(-1)!;
    const first = route(layout, nodes[0]!, last);
    for (let source = 1; source <= 140; source++) {
      const point = nodes[source]!;
      expect(routeLengthBetween(layout, point.x, point.y, last.x, last.y)).toBeCloseTo(Math.abs(last.x - point.x) + Math.abs(last.y - point.y), 8);
    }
    expect(route(layout, nodes[0]!, last)).toEqual(first);
  });

  it("preserves mid-edge routes and off-graph failures after anchor-cache eviction", () => {
    const layout = grid(5, 4), a = { x: .3, y: 0 }, b = { x: .9, y: 0 };
    const first = route(layout, a, b);
    for (let i = 0; i < 300; i++) {
      const invalid = { x: -1 - i / 1000, y: -1 };
      expect(() => route(layout, invalid, b)).toThrow("Route endpoint is outside the site routing graph");
      expect(() => route(layout, invalid, b)).toThrow("Route endpoint is outside the site routing graph");
    }
    expect(route(layout, a, b)).toEqual(first);
    expect(routeLengthBetween(layout, a.x, a.y, b.x, b.y)).toBeCloseTo(.6, 10);
  });
});
