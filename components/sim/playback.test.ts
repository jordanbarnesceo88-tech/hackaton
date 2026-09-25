import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED, MAX_FRAME_DT_S, SPEEDS, stepsForFrame } from "./playback";

describe("stepsForFrame", () => {
  it("plays one model minute per second at ×1", () => {
    let carry = 0;
    let steps = 0;
    // 60 кадров по 1/60 с = одна секунда.
    for (let i = 0; i < 60; i++) {
      const f = stepsForFrame(1, 1 / 60, carry);
      steps += f.steps;
      carry = f.carry;
    }
    expect(steps + Math.round(carry)).toBe(60);
  });

  it("scales with speed: ×16 makes 16 model seconds per 1/60 s frame", () => {
    expect(stepsForFrame(16, 1 / 60, 0).steps).toBe(16);
  });

  it("caps a long frame so a background tab does not jump minutes ahead", () => {
    expect(stepsForFrame(16, 5, 0).steps).toBe(Math.floor(16 * 60 * MAX_FRAME_DT_S));
  });

  it("makes no steps on the first frame or for broken input", () => {
    expect(stepsForFrame(8, 0, 0)).toEqual({ steps: 0, carry: 0 });
    expect(stepsForFrame(Number.NaN, 1 / 60, 0).steps).toBe(1);
    expect(stepsForFrame(8, Number.NaN, 0.5)).toEqual({ steps: 0, carry: 0.5 });
  });

  it("offers ×1 … ×16 with ×8 by default", () => {
    expect([...SPEEDS]).toEqual([1, 2, 4, 8, 16]);
    expect(SPEEDS).toContain(DEFAULT_SPEED);
  });
});
