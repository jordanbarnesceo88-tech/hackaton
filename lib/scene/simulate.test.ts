import { describe, it, expect } from "vitest";
import { spawnRobots, stepRobots } from "./simulate";
import type { Layout } from "./types";

const layout: Layout = {
  kind: "other",
  zones: [{ kind: "dock", x: 0, y: 0.45, w: 0.1, h: 0.1 }],
  pathTemplate: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ],
};

describe("spawnRobots", () => {
  it("spawns exactly `count` robots, each with the path and a start position", () => {
    const robots = spawnRobots(layout, 5);
    expect(robots).toHaveLength(5);
    for (const r of robots) {
      expect(r.path.length).toBe(4);
      expect(r.pos).toHaveProperty("x");
      expect(r.pos).toHaveProperty("y");
    }
    // staggered: not all at the exact same position
    const uniquePositions = new Set(robots.map((r) => `${r.pos.x.toFixed(3)},${r.pos.y.toFixed(3)}`));
    expect(uniquePositions.size).toBeGreaterThan(1);
  });
});

describe("stepRobots", () => {
  it("advances a robot along the current segment by speed*dt", () => {
    const robots = [{ id: 0, pos: { x: 0, y: 0 }, path: layout.pathTemplate, segment: 0, t: 0 }];
    // segment 0 is length 1 (from (0,0) to (1,0)); speed 0.5/sec * 0.5s = 0.25 progress
    const next = stepRobots(robots, 500, 0.5);
    expect(next[0].t).toBeCloseTo(0.25, 3);
    expect(next[0].pos.x).toBeCloseTo(0.25, 3);
    expect(next[0].pos.y).toBeCloseTo(0, 3);
  });
  it("rolls over to the next segment when t exceeds 1", () => {
    const robots = [{ id: 0, pos: { x: 1, y: 0 }, path: layout.pathTemplate, segment: 0, t: 0.9 }];
    const next = stepRobots(robots, 500, 0.5); // +0.25 -> 1.15 -> seg 1, t 0.15
    expect(next[0].segment).toBe(1);
    expect(next[0].t).toBeCloseTo(0.15, 3);
  });
  it("loops from the last segment back to the first", () => {
    const robots = [{ id: 0, pos: { x: 0, y: 1 }, path: layout.pathTemplate, segment: 3, t: 0.95 }];
    const next = stepRobots(robots, 200, 0.5); // +0.1 -> 1.05 -> wraps to segment 0
    expect(next[0].segment).toBe(0);
  });
  it("is pure — does not mutate the input array or robots", () => {
    const robots = [{ id: 0, pos: { x: 0, y: 0 }, path: layout.pathTemplate, segment: 0, t: 0 }];
    const snapshot = JSON.stringify(robots);
    stepRobots(robots, 500, 0.5);
    expect(JSON.stringify(robots)).toBe(snapshot);
  });
});
