import { describe, it, expect } from "vitest";
import { pluralRu, formatYearsRu } from "./plural";

const YEARS: [string, string, string] = ["год", "года", "лет"];

describe("pluralRu", () => {
  it("uses the 'one' form for n ending in 1 (except 11)", () => {
    expect(pluralRu(1, YEARS)).toBe("год");
    expect(pluralRu(21, YEARS)).toBe("год");
    expect(pluralRu(101, YEARS)).toBe("год");
  });
  it("uses the 'few' form for n ending in 2-4 (except 12-14)", () => {
    expect(pluralRu(2, YEARS)).toBe("года");
    expect(pluralRu(3, YEARS)).toBe("года");
    expect(pluralRu(24, YEARS)).toBe("года");
  });
  it("uses the 'many' form for 0, 5-20, and the teens", () => {
    expect(pluralRu(0, YEARS)).toBe("лет");
    expect(pluralRu(5, YEARS)).toBe("лет");
    expect(pluralRu(11, YEARS)).toBe("лет");
    expect(pluralRu(12, YEARS)).toBe("лет");
    expect(pluralRu(14, YEARS)).toBe("лет");
    expect(pluralRu(100, YEARS)).toBe("лет");
  });
});

describe("formatYearsRu", () => {
  it("agrees for whole-number years", () => {
    expect(formatYearsRu(1)).toBe("1.0 год");
    expect(formatYearsRu(2)).toBe("2.0 года");
    expect(formatYearsRu(5)).toBe("5.0 лет");
    expect(formatYearsRu(21)).toBe("21.0 год");
  });
  it("uses the genitive singular for fractional years", () => {
    expect(formatYearsRu(0.3)).toBe("0.3 года");
    expect(formatYearsRu(1.5)).toBe("1.5 года");
    expect(formatYearsRu(12.7)).toBe("12.7 года");
  });
});
