import { describe, it, expect } from "vitest";
import { economicsRows, PANEL_LABELS, REPORT_LABELS } from "./economics-rows";
import { computeEconomics } from "@/lib/economics/calculate";
import { makeAssumptions, makeCapacity, makeParams } from "@/lib/economics/fixtures";
import { isCalculable, type CalculableResult } from "@/lib/economics/types";

function calculable(overrides = {}, paramOverrides = {}): CalculableResult {
  const r = computeEconomics(
    makeCapacity(overrides),
    makeParams(paramOverrides),
    makeAssumptions()
  );
  if (!isCalculable(r)) throw new Error("fixture expected to be calculable");
  return r;
}

describe("economicsRows", () => {
  it("emits the ten figures in order for an economical result", () => {
    const rows = economicsRows(calculable(), 90, PANEL_LABELS);
    expect(rows.map((r) => r.key)).toEqual([
      "quantity",
      "displacedFte",
      "capex",
      "opex",
      "baseline",
      "savings",
      "simplePayback",
      "discountedPayback",
      "roi",
      "npv",
    ]);
  });

  it("stops after the five common figures when the solution does not pay back", () => {
    // OPEX far above any labor saving -> no_savings, which carries the common fields only.
    const r = calculable({ maintenanceUsdYear: 5_000_000 });
    expect(r.economical).toBe(false);
    expect(economicsRows(r, 90, PANEL_LABELS).map((x) => x.key)).toEqual([
      "quantity",
      "displacedFte",
      "capex",
      "opex",
      "baseline",
    ]);
  });

  it("uses the caller's ROI/NPV label variant and nothing else differs", () => {
    const panel = economicsRows(calculable(), 90, PANEL_LABELS);
    const report = economicsRows(calculable(), 90, REPORT_LABELS);
    expect(panel.map((r) => r.value)).toEqual(report.map((r) => r.value));
    const differing = panel
      .filter((r, i) => r.label !== report[i].label)
      .map((r) => r.key);
    expect(differing).toEqual(["roi", "npv"]);
    expect(report.find((r) => r.key === "roi")!.label).toBe("ROI (простой)");
    expect(panel.find((r) => r.key === "npv")!.label).toBe("NPV (чистая приведённая стоимость)");
  });

  it("words a payback that never lands inside the horizon rather than printing a number", () => {
    // Savings barely positive against a large CAPEX -> discounted payback exceeds the horizon.
    const r = calculable({ priceUsd: 400_000 });
    const row = economicsRows(r, 90, PANEL_LABELS).find((x) => x.key === "discountedPayback");
    expect(row?.value).toBe("не окупается в пределах горизонта");
  });

  it("formats money against the supplied USD→RUB rate", () => {
    const rows = economicsRows(calculable(), 90, PANEL_LABELS);
    const capex = rows.find((r) => r.key === "capex")!.value;
    const doubled = economicsRows(calculable(), 180, PANEL_LABELS).find(
      (r) => r.key === "capex"
    )!.value;
    expect(capex).not.toBe(doubled); // the RUB half of the label tracks the rate
    expect(capex).toContain("57"); // 1 unit x $50k x 1.15 install = $57,500
  });
});
