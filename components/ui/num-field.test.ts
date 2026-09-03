import { describe, it, expect } from "vitest";
import { displayValue } from "./num-field";

describe("displayValue", () => {
  it("shows the model's value when nothing is being typed", () => {
    expect(displayValue(null, 500)).toBe("500");
  });

  it("keeps the field empty while it is being cleared to retype", () => {
    // Binding to the number made Number("") === 0 rewrite the box the instant it was emptied.
    expect(displayValue("", 500)).toBe("");
  });

  it("keeps half-typed input", () => {
    expect(displayValue("-", 5)).toBe("-");
    expect(displayValue("12.", 12)).toBe("12.");
  });

  it("keeps the draft while the model agrees with it", () => {
    expect(displayValue("750", 750)).toBe("750");
    expect(displayValue("0.35", 0.35)).toBe("0.35");
  });

  it("lets the model win when it clamped what was typed", () => {
    // AssumptionsPanel clamps a 0..1 fraction: typing 5 must not leave "5" on screen while the
    // page recomputes against 1.
    expect(displayValue("5", 1)).toBe("1");
    expect(displayValue("-3", 0)).toBe("0");
  });

  it("falls back to 0 for a non-finite model value", () => {
    expect(displayValue(null, NaN)).toBe("0");
    expect(displayValue("5", NaN)).toBe("0");
  });
});
