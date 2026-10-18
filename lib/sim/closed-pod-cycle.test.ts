import { describe, expect, it } from "vitest";
import { createSim } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import {
  expectedClosedPodCycleS,
  expectedClosedPodLegsM,
} from "./closed-pod-cycle";
import { buildClosedPodLayout } from "./underlift-layout";
import { underliftCycleHandlingS } from "./underlift-timing";

describe("closed-pod customer cycle", () => {
  it("counts two carried legs and two iid reposition legs from exit entries, not shelf centres", () => {
    const layout = createSim(warehouseBaseInput(1)).layout;
    layout.slots = [{ x: 10, y: 5 }];
    layout.receiving = [{ id: "R", kind: "receiving", x: 0, y: 5 }];
    layout.shipping = [{ id: "S", kind: "shipping", x: 20, y: 5 }];
    const xs = [0, 2, 10, 12, 20, 22];
    layout.routingGraph = {
      clearanceM: 0.95,
      nodes: xs.map((x) => ({ id: String(x), x, y: 5 })),
      edges: xs
        .slice(1)
        .map((x, i) => ({ from: String(xs[i]), to: String(x) })),
    };
    const docks = [0, 10, 20].map((x) => ({
      x,
      y: 5,
      entry: { x: x + 2, y: 5 },
      heading: Math.PI,
    }));
    const legs = expectedClosedPodLegsM(layout, docks);
    expect(legs).toEqual({ loadedM: 20, emptyM: 16.5 });
    expect(
      expectedClosedPodCycleS({
        ...legs,
        speedMps: 1,
        loadedSpeedFactor: 1,
        handlingSec: 20,
      }),
    ).toBe(116.5);
  });

  it("includes the actual minimum handling timer and slow physical reverse exit", () => {
    const stationary = {
      loadedM: 0,
      emptyM: 0,
      speedMps: 1.5,
      loadedSpeedFactor: 0.8,
      handlingSec: 0,
    };
    expect(expectedClosedPodCycleS(stationary)).toBe(24);
    expect(underliftCycleHandlingS(20, 1.5)).toBe(80);
    expect(
      expectedClosedPodCycleS({
        ...stationary,
        speedMps: 0.1,
        handlingSec: 20,
      }),
    ).toBeCloseTo(106.6666666667);
    expect(expectedClosedPodCycleS({ ...stationary, speedMps: 0 })).toBeNull();
  });

  it("builds the complete physical source recipe without altering its caller's parameters", () => {
    const params = { ...warehouseBaseInput(5).layout, activeAreaM2: 5000 },
      before = structuredClone(params);
    const { layout, config } = buildClosedPodLayout(params);
    expect(params).toEqual(before);
    expect(layout.slots).toHaveLength(896);
    expect(config.docks).toHaveLength(
      layout.slots.length + layout.receiving.length + layout.shipping.length,
    );
    expect(
      config.docks.every(
        (d) =>
          Math.abs(Math.hypot(d.x - d.entry.x, d.y - d.entry.y) - 2) < 1e-8,
      ),
    ).toBe(true);
  });
});
