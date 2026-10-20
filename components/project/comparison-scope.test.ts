import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "@/lib/tz/types";
import { comparisonRowsForScenarios } from "./comparison-table";

const rows = [
  { process: "pallet-transport", productSlug: "pallet-a" },
  { process: "cleaning", productSlug: "pudu-cc1" },
  { process: "storage", productSlug: "storage-a" },
  { process: "cleaning", productSlug: "agibot-c5" },
];
const spec = (kind: ScenarioSpec["kind"], ...processes: string[]): Pick<ScenarioSpec, "kind" | "items"> => ({
  kind, items: processes.map(process => ({ process, productSlug: process === "cleaning" ? "pudu-cc1" : "pallet-a" })),
});
describe("project comparison process scope", () => {
  it("keeps cleaning alternatives and excludes unrelated warehouse processes", () => {
    expect(comparisonRowsForScenarios(rows, [spec("asis"), spec("purchase", "cleaning"), spec("raas", "cleaning")]))
      .toEqual([rows[1], rows[3]]);
  });

  it("keeps the pallet project scoped to its process rather than only its selected product", () => {
    const palletRows = [...rows, { process: "pallet-transport", productSlug: "pallet-b" }];
    expect(comparisonRowsForScenarios(palletRows, [spec("purchase", "pallet-transport")]))
      .toEqual([rows[0], palletRows[4]]);
    expect(palletRows).toHaveLength(5);
  });

  it("includes processes from every purchase and RaaS scenario in a mixed project", () => {
    expect(comparisonRowsForScenarios(rows, [spec("purchase", "cleaning"), spec("raas", "pallet-transport")]))
      .toEqual([rows[0], rows[1], rows[3]]);
  });

  it("retains the catalogue when no robot scenario has a process", () => {
    for (const specs of [[], [spec("asis")], [spec("asis"), spec("purchase")]]) {
      expect(comparisonRowsForScenarios(rows, specs)).toBe(rows);
    }
  });
});

