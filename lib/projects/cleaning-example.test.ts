import { describe, expect, it } from "vitest";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { CATALOG } from "../data/organizer/catalog";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { buildProjectModel } from "../tz/model";
import { resolveNorms } from "../tz/norms";
import { checkCalcInput } from "../api/calc";
import { BUSINESS_EXAMPLES, businessExampleInputs } from "./business-examples";
import { warehouseCleaningInputs } from "./cleaning-example";

const products = [...CATALOG, ...VENDOR_CLEANING_PRODUCTS].map(productForCalcFromSeed);
const input = () => warehouseCleaningInputs(baseValuesFor("warehouse"), products);
const model = (data = input()) => buildProjectModel({ facility: "warehouse", ...data, products, norms: resolveNorms(), paramDefs: paramSpecsFor("warehouse") });

describe("editable warehouse cleaning business example", () => {
  it.each(["serviceLifeYearsDefault", "batteryReplacementYears"] as const)("rejects fractional %s instead of silently rounding the replacement year", key => {
    const data = input();
    data.scenarios[1]!.normOverrides![key] = 3.5;
    const accepted = checkCalcInput({ paramDefs: paramSpecsFor("warehouse"), products, norms: resolveNorms(), paramDefsFrom: "code" }, "warehouse", data.params, data.scenarios);
    expect(accepted.ok).toBe(false);
    expect(JSON.stringify(accepted)).toContain("целое число лет");
  });
  it.each(BUSINESS_EXAMPLES)("passes the server's complete parameter and scenario validation: $id", example => {
    const data = businessExampleInputs(example.id, baseValuesFor("warehouse"), products);
    const accepted = checkCalcInput({ paramDefs: paramSpecsFor("warehouse"), products, norms: resolveNorms(), paramDefsFrom: "code" }, "warehouse",
      JSON.parse(JSON.stringify(data.params)), JSON.parse(JSON.stringify(data.scenarios)));
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    if (!accepted.ok) throw new Error(JSON.stringify(accepted));
    expect(accepted.params).toEqual(data.params);
    expect(accepted.scenarios).toEqual(data.scenarios);
  });
  it("uses explicit team assumptions without modifying catalogue prices or measurements", () => {
    const before = structuredClone(products);
    const data = businessExampleInputs("warehouse-cleaning", baseValuesFor("warehouse"), products);
    expect(data.example.id).toBe("warehouse-cleaning");
    expect(data.params.cleanerSalaryRubMonth).toBeCloseTo(134482.75862068964, 6);
    expect(data.params.payrollTaxMultiplier).toBeCloseTo(1.4355, 8);
    expect(data.scenarios[1]!.items[0]!.cleaningProfile?.throughputM2PerH).toBe(550);
    expect(products).toEqual(before);
    expect(products.find(product => product.slug === "pudu-cc1")!.priceRub).toBeNull();
    expect(data.scenarios[1]!.items[0]!.priceRubOverride).toBe(2790000);
  });

  it("calculates the same cleaning scope, actual care and complete fee bases for purchase and RaaS", () => {
    const result = model();
    const purchase = result.results.find(scenario => scenario.key === "purchase")!;
    const raas = result.results.find(scenario => scenario.key === "raas")!;
    expect(purchase.status).toBe("ok");
    expect(raas.status).toBe("ok");
    if (purchase.status !== "ok" || raas.status !== "ok") throw new Error(JSON.stringify(result.results));
    const item = purchase.items[0]!;
    expect(item.chargers).toBe(item.n);
    expect(item.n).toBeGreaterThanOrEqual(4);
    expect(raas.items[0]!.n).toBe(item.n);
    expect(item.headcount).toBe(8);
    expect(item.roleCostRubYear).toBeCloseTo(193050 * 12, 5);
    expect(item.releasedFte).toBeGreaterThan(0);
    expect(item.releasedFte).toBeLessThan(4);
    expect(purchase.opexLines.find(line => line.key === "licences")!.valueRub).toBe(item.n! * 12200 * 12);
    expect(purchase.capexLines.find(line => line.key === "chargers")!.valueRub).toBe(0);
    expect(purchase.capexLines.find(line => line.key === "startup")!.valueRub).toBe(80000);
    expect(raas.capexLines.find(line => line.key === "firstMonthPremium")!.valueRub).toBe(item.n! * 65000);
    expect(result.simInputs.purchase?.calculated).toBeNull();
    expect(result.simInputs.raas?.calculated).toBeNull();
  });

  it("allows a longer feasible window to reduce the automatic fleet without losing bundled docks", () => {
    const normal = model();
    const changed = input();
    for (const spec of changed.scenarios) for (const item of spec.items) item.cleaningProfile!.windowH = 12;
    const longer = model(changed);
    const purchase = longer.results.find(scenario => scenario.key === "purchase")!;
    expect(purchase.status).toBe("ok");
    expect(purchase.items[0]!.n).toBeLessThan(normal.results.find(scenario => scenario.key === "purchase")!.items[0]!.n!);
    if (purchase.status === "ok") expect(purchase.capexLines.find(line => line.key === "chargers")!.valueRub).toBe(0);
  });
  it("uses the explicit three-year equipment life without clamping it to five, and preserves a published product life", () => {
    const data = input(), result = model(data), purchase = result.results.find(row => row.key === "purchase")!;
    if (purchase.status !== "ok") throw new Error(JSON.stringify(purchase));
    expect(resolveNorms(undefined, data.scenarios[1]!.normOverrides).serviceLifeYearsDefault).toBe(3);
    expect(purchase.cashflows.find(row => row.year === 3)!.reinvestRub).toBe(purchase.items[0]!.n! * 2790000);
    expect(purchase.cashflows.find(row => row.year === 3)!.batteryRub).toBe(0);
    const published = buildProjectModel({ facility: "warehouse", ...data,
      products: products.map(product => product.slug === "pudu-cc1" ? { ...product, serviceLifeYears: 6 } : product),
      norms: resolveNorms(), paramDefs: paramSpecsFor("warehouse") }).results.find(row => row.key === "purchase")!;
    if (published.status !== "ok") throw new Error(JSON.stringify(published));
    expect(published.cashflows.find(row => row.year === 3)!.reinvestRub).toBe(0);
    expect(products.find(product => product.slug === "pudu-cc1")!.serviceLifeYears).toBeNull();
  });
});
