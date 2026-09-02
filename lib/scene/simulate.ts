import type { Layout, RobotState, Waypoint } from "./types";

function lerp(a: Waypoint, b: Waypoint, t: number): Waypoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function spawnRobots(layout: Layout, count: number): RobotState[] {
  const n = Math.max(1, Math.floor(count));
  const path = layout.pathTemplate;
  const segs = path.length; // looping: last point connects back to first
  // Every generateLayout branch returns at least two waypoints, but nothing enforced it here:
  // with an empty path `segment % 0` is NaN, `path[NaN]` is undefined, and lerp would throw
  // from inside the animation loop rather than anywhere useful.
  if (segs === 0) return [];
  const robots: RobotState[] = [];
  for (let i = 0; i < n; i++) {
    // stagger each robot's phase evenly around the loop
    const phase = (i / n) * segs;
    const segment = Math.floor(phase) % segs;
    const t = phase - Math.floor(phase);
    const from = path[segment]!;
    const to = path[(segment + 1) % segs]!;
    robots.push({ id: i, pos: lerp(from, to, t), path, segment, t });
  }
  return robots;
}

export function stepRobots(
  robots: RobotState[],
  dtMs: number,
  speed: number
): RobotState[] {
  const dSeg = speed * (dtMs / 1000); // progress in segment-units this frame
  return robots.map((r) => {
    const segs = r.path.length;
    if (segs === 0) return r; // nothing to advance along
    let segment = r.segment;
    let t = r.t + dSeg;
    while (t >= 1) {
      t -= 1;
      segment = (segment + 1) % segs;
    }
    const from = r.path[segment]!;
    const to = r.path[(segment + 1) % segs]!;
    return { ...r, segment, t, pos: lerp(from, to, t) };
  });
}
