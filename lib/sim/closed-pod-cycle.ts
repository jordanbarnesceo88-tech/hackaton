import { weightedMeanRouteLength } from "./routing";
import type { SimLayout } from "./types";
import type { Dock } from "./underlift-layout";
import type { ExpectedLegs, CycleInputs } from "./analytic";
import { underliftCycleHandlingS } from "./underlift-timing";

type Point = { x: number; y: number };
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

function meanRoute(
  layout: SimLayout,
  from: readonly Point[],
  to: readonly Point[],
): number {
  if (!from.length || !to.length)
    throw new Error("Для цикла нужны места хранения и точки обработки");
  return weightedMeanRouteLength(layout, from.map(p => ({ ...p, weight: 1 })), to.map(p => ({ ...p, weight: 1 })));
}

/**
 * Distances per customer pallet task, including its one physical prefetch/return job.
 * The generator selects inbound/outbound 50/50 and uniform homes/docks. Physical jobs
 * K→R, R→K, K→S, S→K therefore each have weight 1/4.
 * Reposition is an analytical iid endpoint approximation, not a dispatch prediction:
 * previous robot stops at the destination's exit entry; next pickup is at pod centre.
 * Exit movement is already covered by handling time and is not charged twice here.
 */
export function expectedClosedPodLegsM(
  layout: SimLayout,
  docks: readonly Dock[],
): ExpectedLegs {
  const groups = [layout.slots, layout.receiving, layout.shipping];
  const weights = [0.5, 0.25, 0.25];
  const exits = groups.map((points) =>
    points.map((point) => {
      const dock = docks.find((candidate) => same(point, candidate));
      if (!dock)
        throw new Error("Для расчёта цикла отсутствует физический выезд точки");
      return dock.entry;
    }),
  );
  // The graph is undirected: start at the few shipping docks rather than every home.
  const loadedM = meanRoute(layout, layout.receiving, layout.slots) + meanRoute(layout, layout.shipping, layout.slots);
  const weighted = (sets: readonly (readonly Point[])[]) => sets.flatMap((points, i) => {
    if (!points.length) throw new Error("Для цикла нужны места хранения и точки обработки");
    return points.map(point => ({ ...point, weight: weights[i]! / points.length }));
  });
  const emptyPerPhysicalJobM = weightedMeanRouteLength(layout, weighted(exits), weighted(groups));
  return { loadedM, emptyM: 2 * emptyPerPhysicalJobM };
}

/** Two pickups and two setdowns, including the actual minimum timer and slow reverse exit. */
export function expectedClosedPodCycleS(c: CycleInputs): number | null {
  const { speedMps: v, loadedSpeedFactor: f, loadedM, emptyM, handlingSec } = c;
  if (
    ![v, f, loadedM, emptyM, handlingSec].every(Number.isFinite) ||
    v <= 0 ||
    f <= 0 ||
    loadedM < 0 ||
    emptyM < 0 ||
    handlingSec < 0
  )
    return null;
  const total =
    emptyM / v + loadedM / (v * f) + underliftCycleHandlingS(handlingSec, v);
  return total > 0 && Number.isFinite(total) ? total : null;
}
