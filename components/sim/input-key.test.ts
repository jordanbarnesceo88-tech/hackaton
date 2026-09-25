import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { runSimSync } from "@/lib/sim/runner";
import { parseSimInputKey, simInputKey } from "./input-key";

describe("simInputKey", () => {
  it("is equal for equal inputs built separately and differs when any number changes", () => {
    expect(simInputKey(warehouseBaseInput(11))).toBe(simInputKey(warehouseBaseInput(11)));
    expect(simInputKey(warehouseBaseInput(11))).not.toBe(simInputKey(warehouseBaseInput(9)));
    expect(simInputKey(warehouseBaseInput(11))).not.toBe(simInputKey(warehouseBaseInput(11, { seed: 2 })));
  });

  it("round-trips the input exactly, so the run from the key equals the run from the original", () => {
    const input = warehouseBaseInput(11);
    const back = parseSimInputKey(simInputKey(input));
    expect(back).toEqual(input);
    expect(runSimSync(back)).toEqual(runSimSync(input));
  });

  it("keeps NaN and infinities instead of turning them into null", () => {
    const input = warehouseBaseInput(11);
    const odd = { ...input, robots: { ...input.robots, speedMps: Number.NaN, autonomyH: Infinity, chargeMin: null } };
    const back = parseSimInputKey(simInputKey(odd));
    expect(back.robots.speedMps).toBeNaN();
    expect(back.robots.autonomyH).toBe(Infinity);
    expect(back.robots.chargeMin).toBeNull();
  });
});
