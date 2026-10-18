import { weightedMeanRouteLength } from "./routing";
import type { SimLayout } from "./types";
import type { Dock } from "./underlift-layout";
import type { ExpectedLegs, CycleInputs } from "./analytic";
import { underliftCycleHandlingS } from "./underlift-timing";
import { LEGACY_DEMAND_MIX, type DemandMix } from "./demand-mix";

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
 * Distances per customer task with the declared inbound/outbound/internal mixture.
 * Inbound/outbound include a service prefetch/return; storage relocation has one loaded leg.
 * Historical inputs without a mixture retain balanced inbound/outbound demand.
 * Reposition is an analytical iid endpoint approximation, not a dispatch prediction:
 * previous robot stops at the destination's exit entry; next pickup is at pod centre.
 * Exit movement is already covered by handling time and is not charged twice here.
 */
export function expectedClosedPodLegsM(
  layout: SimLayout,
  docks: readonly Dock[],
  mix: Readonly<DemandMix> = LEGACY_DEMAND_MIX,
): ExpectedLegs {
  const groups = [layout.slots, layout.receiving, layout.shipping];
  const physicalLegs = 2 - mix.internal;
  const weights = [1 / physicalLegs, mix.inbound / physicalLegs, mix.outbound / physicalLegs];
  const exits = groups.map((points) =>
    points.map((point) => {
      const dock = docks.find((candidate) => same(point, candidate));
      if (!dock)
        throw new Error("Для расчёта цикла отсутствует физический выезд точки");
      return dock.entry;
    }),
  );
  // The graph is undirected: start at the few shipping docks rather than every home.
  const slots = layout.slots.length;
  const internalLoaded = mix.internal > 0 && slots > 1
    ? meanRoute(layout, layout.slots, layout.slots) * slots / (slots - 1) : 0;
  const loadedM = 2 * mix.inbound * meanRoute(layout, layout.receiving, layout.slots) +
    2 * mix.outbound * meanRoute(layout, layout.shipping, layout.slots) + mix.internal * internalLoaded;
  const weighted = (sets: readonly (readonly Point[])[]) => sets.flatMap((points, i) => {
    if (!points.length) throw new Error("Для цикла нужны места хранения и точки обработки");
    return points.map(point => ({ ...point, weight: weights[i]! / points.length }));
  });
  const emptyPerPhysicalJobM = weightedMeanRouteLength(layout, weighted(exits), weighted(groups));
  return { loadedM, emptyM: physicalLegs * emptyPerPhysicalJobM,
    ...(mix.internal > 0 ? { physicalLegsPerCustomer: physicalLegs } : {}) };
}

/** Inbound/outbound use two pickup/setdown pairs; internal storage work uses one pair. */
export function expectedClosedPodCycleS(c: CycleInputs & { physicalLegsPerCustomer?: number }): number | null {
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
    emptyM / v + loadedM / (v * f) + underliftCycleHandlingS(handlingSec, v) * (c.physicalLegsPerCustomer ?? 2) / 2;
  return total > 0 && Number.isFinite(total) ? total : null;
}
