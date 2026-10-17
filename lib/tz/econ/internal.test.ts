import { describe, expect, it } from "vitest";
import type { LineItem } from "../types";
import { mergeLines } from "./internal";

describe("merged conditional cost formulas", () => {
  const included: LineItem = { key: "software", label: "ПО", valueRub: 0, formula: "CAPEXпо = 0: включено", substituted: "0, пакет первой модели", origin: "user" };
  const separate: LineItem = { key: "software", label: "ПО", valueRub: 1_000_000, formula: "CAPEXпо = лицензия", substituted: "1 000 000, вторая модель", origin: "research" };
  it("retains both formulas when some products include a charge and others pay separately", () => {
    const before = structuredClone([included, separate]);
    const result = mergeLines([[included], [separate]])[0]!;
    expect(result.valueRub).toBe(1_000_000);
    expect(result.formula).toContain("Сумма по позициям"); expect(result.formula).toContain("CAPEXпо = лицензия");
    expect(result.substituted).toContain("вторая модель"); expect([included, separate]).toEqual(before);
  });
  it("preserves the historical common formula if all positions use the same rule", () => {
    expect(mergeLines([[separate], [{ ...separate }]])[0]!.formula).toBe(separate.formula);
    expect(mergeLines([[separate]])[0]).toEqual(separate);
  });
  it("marks a merged payment included only when it is included for every position", () => {
    const free = { ...included, includedInService: true };
    expect(mergeLines([[free], [separate]])[0]!.includedInService).toBeUndefined();
    expect(mergeLines([[separate], [free]])[0]!.includedInService).toBeUndefined();
    expect(mergeLines([[free], [free]])[0]!.includedInService).toBe(true);
  });
});
