import { describe, expect, it } from "vitest";
import { MAX_DPR, bufferSize } from "./fit-canvas";

describe("bufferSize", () => {
  it("multiplies the CSS size by the device pixel ratio", () => {
    expect(bufferSize(761, 379, 2, 2)).toEqual({ W: 761, H: 379, dpr: 2, bw: 1522, bh: 758 });
  });

  it("uses the aspect ratio when the element has no height yet", () => {
    expect(bufferSize(720, 0, 2, 1)).toEqual({ W: 720, H: 360, dpr: 1, bw: 720, bh: 360 });
  });

  it("falls back to 720 px, dpr 1 and 2 : 1 for broken input, and caps the density", () => {
    expect(bufferSize(0, Number.NaN, Number.NaN, Number.NaN)).toEqual({ W: 720, H: 360, dpr: 1, bw: 720, bh: 360 });
    expect(bufferSize(100, 50, 2, 8).dpr).toBe(MAX_DPR);
  });
});
