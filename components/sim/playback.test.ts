import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED, MAX_FRAME_DT_S, SPEEDS, stepsForFrame } from "./playback";

describe("stepsForFrame", () => {
  it("plays one model second per real second at ×1", () => {
    let carry = 0;
    let steps = 0;
    // 60 кадров по 1/60 с = одна секунда.
    for (let i = 0; i < 60; i++) {
      const f = stepsForFrame(1, 1 / 60, carry);
      steps += f.steps;
      carry = f.carry;
    }
    expect(steps + carry).toBeCloseTo(1);
  });

  it("scales model time honestly at ×2, ×8 and ×480", () => {
    for (const speed of [2, 8, 480]) {
      let carry = 0;
      let steps = 0;
      for (let i = 0; i < 60; i++) {
        const next = stepsForFrame(speed, 1 / 60, carry);
        steps += next.steps;
        carry = next.carry;
      }
      expect(steps + carry).toBeCloseTo(speed);
    }
  });

  it("caps a long frame so a background tab does not jump minutes ahead", () => {
    expect(stepsForFrame(16, 5, 0).steps).toBe(Math.floor(16 * MAX_FRAME_DT_S));
  });

  it("makes no steps on the first frame or for broken input", () => {
    expect(stepsForFrame(8, 0, 0)).toEqual({ steps: 0, carry: 0 });
    expect(stepsForFrame(Number.NaN, 1 / 60, 0)).toEqual({ steps: 0, carry: 1 / 60 });
    expect(stepsForFrame(8, Number.NaN, 0.5)).toEqual({ steps: 0, carry: 0.5 });
  });

  it("starts in real time and offers an explicitly accelerated overview", () => {
    expect([...SPEEDS]).toEqual([1, 2, 4, 8, 16, 480]);
    expect(DEFAULT_SPEED).toBe(1);
  });
});
