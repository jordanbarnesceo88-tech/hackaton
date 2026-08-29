import { describe, it, expect } from "vitest";
import {
  sanitizeName,
  validateParams,
  validateAssumptions,
  isPlainObject,
  NAME_MAX_LEN,
} from "./validate";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";

describe("sanitizeName", () => {
  it("trims and accepts a normal name", () => {
    expect(sanitizeName("  Расчёт 1  ")).toBe("Расчёт 1");
  });
  it("caps length at NAME_MAX_LEN", () => {
    expect(sanitizeName("x".repeat(500))).toHaveLength(NAME_MAX_LEN);
  });
  it("rejects empty / non-string", () => {
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName(null)).toBeNull();
  });
});

describe("validateParams", () => {
  it("accepts the three required finite numbers", () => {
    expect(validateParams({ areaM2: 1000, opsPerDay: 500, staffCount: 10 })).toEqual({
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
    });
  });
  it("preserves an optional finite peakConcurrent", () => {
    const r = validateParams({ areaM2: 1, opsPerDay: 1, staffCount: 1, peakConcurrent: 20 });
    expect(r).toEqual({ areaM2: 1, opsPerDay: 1, staffCount: 1, peakConcurrent: 20 });
  });
  it("rejects missing / non-finite / wrong-type / non-object", () => {
    expect(validateParams({ areaM2: 1, opsPerDay: 1 })).toBeNull();
    expect(validateParams({ areaM2: 1, opsPerDay: 1, staffCount: Infinity })).toBeNull();
    expect(validateParams({ areaM2: 1, opsPerDay: 1, staffCount: "3" })).toBeNull();
    expect(validateParams({ areaM2: 1, opsPerDay: 1, staffCount: 1, peakConcurrent: NaN })).toBeNull();
    expect(validateParams([1, 2, 3])).toBeNull();
    expect(validateParams(null)).toBeNull();
  });
});

describe("validateAssumptions", () => {
  it("accepts a full, finite assumptions bag", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS })).toEqual(DEFAULT_ASSUMPTIONS);
  });
  it("rejects a bag missing a key or with a non-finite value", () => {
    const { roiHorizonYears, ...missing } = DEFAULT_ASSUMPTIONS;
    void roiHorizonYears;
    expect(validateAssumptions(missing)).toBeNull();
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, turnoverPerDay: Infinity })).toBeNull();
  });
});

describe("isPlainObject", () => {
  it("distinguishes objects from arrays/null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});
