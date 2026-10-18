import { describe, expect, it } from "vitest";
import { checkCalcInput } from "../api/calc";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { catalogProduct } from "../data/organizer/catalog";
import { paramSpecsFor } from "../data/organizer/params";
import { WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { buildProjectModel } from "./model";
import { resolveNorms, type NormValues } from "./norms";
import type { ScenarioOk, ScenarioSpec } from "./types";

const product = productForCalcFromSeed(catalogProduct("dikom-dmr-carrier-p")!);
const paramDefs = paramSpecsFor("warehouse");
const scenarios: ScenarioSpec[] = [
  { key: "asis", name: "Как есть", kind: "asis", items: [] },
  { key: "purchase", name: "Покупка Carrier P", kind: "purchase", items: [{ process: "pallet-transport", productSlug: product.slug }] },
  { key: "raas", name: "RaaS Carrier P", kind: "raas", items: [{ process: "pallet-transport", productSlug: product.slug, raasRubMonthOverride: 100_000 }] },
];

function model(norms: NormValues, specs: ScenarioSpec[]) {
  const checked = checkCalcInput({ products: [product], paramDefs } as Parameters<typeof checkCalcInput>[0], "warehouse", WAREHOUSE_BASE_PARAMS, specs);
  expect(checked.ok).toBe(true);
  if (!checked.ok) throw new Error(checked.error);
  return buildProjectModel({ facility: "warehouse", params: checked.params, paramDefs, products: [product], norms, scenarios: checked.scenarios! });
}

function purchase(result: ReturnType<typeof model>): ScenarioOk {
  const row = result.results.find(r => r.key === "purchase");
  expect(row?.status).toBe("ok");
  if (row?.status !== "ok") throw new Error("Purchase calculation refused");
  return row;
}

describe("implicit-layout physical norms of a financial scenario", () => {
  it.each([
    { handlingSecFork: 300 },
    { loadedSpeedFactor: 0.6 },
    { handlingSecFork: 300, loadedSpeedFactor: 0.6 },
  ])("uses the same cycle and fleet for global and scenario norms %j", overrides => {
    const baseline = model(resolveNorms(), scenarios);
    const specs = structuredClone(scenarios);
    specs[1]!.normOverrides = overrides;
    const local = model(resolveNorms(), specs);
    const global = model(resolveNorms(undefined, overrides), scenarios);
    const localRow = purchase(local), globalRow = purchase(global);
    expect(localRow.items[0]!.thrCycle).toBeLessThan(purchase(baseline).items[0]!.thrCycle!);
    expect(localRow.items[0]!.n).toBeGreaterThan(purchase(baseline).items[0]!.n!);
    for (const key of ["thrCycle", "thrEff", "n", "chargers"] as const) {
      expect(localRow.items[0]![key]).toBeCloseTo(globalRow.items[0]![key]!, 9);
    }
    for (const key of ["capexRub", "opexYearRub", "effectYearRub", "npvRub", "tcoRub"] as const) {
      expect(localRow[key]).toBeCloseTo(globalRow[key]!, 6);
    }
    expect(local.simInputs.purchase?.calculated?.robots).toEqual(global.simInputs.purchase?.calculated?.robots);
    // The other scenario retains its own unmodified norms.
    expect(local.simInputs.raas?.calculated?.robots).toEqual(baseline.simInputs.raas?.calculated?.robots);
  });
});
