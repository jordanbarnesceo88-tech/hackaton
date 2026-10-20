import { describe, expect, it } from "vitest";
import type { RaasPackage, ScenarioItem, ScenarioOk, ScenarioSpec } from "../types";
import { computeScenariosCore } from "./core";
import { computeScenarios } from "./scenario";
import { FIXTURE_H1500, fixtureContext } from "./fixtures";
import { parseRaasPackage, raasChargeAmount, validateRaasSiteCharges } from "./raas-package";

const included = { mode: "included" } as const;
const scope = (over: Partial<RaasPackage> = {}): RaasPackage => ({ startup: included, platform: included, service: included,
  consumables: included, repair: included, battery: included, reason: "Явная тестовая оценка состава услуги; не коммерческое предложение", ...over });
const spec = (raasPackage?: RaasPackage, extra: Partial<ScenarioItem> = {}): ScenarioSpec => ({ key: "raas", name: "RaaS по явной оценке", kind: "raas",
  items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, quantityOverride: 3, chargersOverride: 1, raasRubMonthOverride: 185000, ...(raasPackage ? { raasPackage } : {}), ...extra }] });
function calculate(value: ScenarioSpec, horizonYears = 5): ScenarioOk {
  const result = computeScenariosCore(fixtureContext(20, { params: { horizonYears } }), [value])[0];
  if (result?.status !== "ok") throw new Error(`Expected financial result: ${JSON.stringify(result)}`);
  return result;
}
function money(r: ScenarioOk, key: string, type: "capex" | "opex" = "opex") {
  return (type === "capex" ? r.capexLines : r.opexLines).find(line => line.key === key)?.valueRub ?? 0;
}

describe("explicit RaaS payment scope", () => {
  it.each([1, 3, 5, 8])("charges a higher first month once at t0 for horizon %i, never in yearly OPEX or reserve", H => {
    const base = calculate(spec(scope()), H), extra = calculate(spec(scope({ firstMonthRub: 250000 })), H);
    expect(money(extra, "subscription")).toBe(3 * 185000 * 12);
    expect(money(extra, "firstMonthPremium", "capex")).toBe(3 * 65000);
    expect(money(extra, "reserve", "capex")).toBe(0);
    expect(extra.capexRub - base.capexRub).toBe(195000);
    expect(extra.opexYearRub).toBe(base.opexYearRub);
    expect(extra.cashflows[0]!.cashflowRub).toBe(-195000);
    expect(extra.cashflows.slice(1).map(row => row.cashflowRub)).toEqual(base.cashflows.slice(1).map(row => row.cashflowRub));
    expect(extra.npvRub! - base.npvRub!).toBeCloseTo(-195000, 6);
    expect(extra.tcoRub - base.tcoRub).toBeCloseTo(195000, 6);
    expect(money(extra, "subscription") + money(extra, "firstMonthPremium", "capex")).toBe(3 * (250000 + 11 * 185000));
  });

  it("replaces catalogued integration and training by one startup fee, without multiplying site cost by fleet", () => {
    const result = calculate(spec(scope({ startup: { mode: "separate", amountRub: 80000, basis: "per-site" } })));
    expect(money(result, "startup", "capex")).toBe(80000);
    expect(money(result, "reserve", "capex")).toBe(8000);
    expect(result.capexRub).toBe(88000);
    for (const key of ["integration", "training", "commissioning"]) expect(result.capexLines.some(line => line.key === key)).toBe(false);
    expect(calculate(spec(scope({ startup: { mode: "separate", amountRub: 80000, basis: "per-robot" } }))).capexRub).toBe(264000);
  });

  it("distinguishes a monthly platform per site from a platform per robot", () => {
    const site = calculate(spec(scope({ platform: { mode: "separate", amountRub: 12200, basis: "per-site" } })));
    const robot = calculate(spec(scope({ platform: { mode: "separate", amountRub: 12200, basis: "per-robot" } })));
    expect(money(site, "platform")).toBe(12200 * 12);
    expect(money(robot, "platform")).toBe(3 * 12200 * 12);
    expect(robot.opexYearRub - site.opexYearRub).toBe(2 * 12200 * 12);
  });

  it("never charges included TO, repairs or battery from purchase catalog/norms", () => {
    const base = calculate(spec(scope()));
    const service = calculate(spec(scope({ service: { mode: "separate", amountRub: 112000, basis: "per-robot" } })));
    for (const key of ["service", "repair", "consumables", "battery", "platform"]) expect(money(base, key)).toBe(0);
    expect(service.opexYearRub - base.opexYearRub).toBe(3 * 112000);
    expect(money(service, "repair")).toBe(0);
    expect(base.cashflows.every(row => row.batteryRub === 0 && row.reinvestRub === 0)).toBe(true);
  });

  it("uses explicit recurring estimates and actual replacement events rather than annual battery averaging in CF", () => {
    const base = calculate(spec(scope()));
    const result = calculate(spec(scope({ consumables: { mode: "separate", amountRub: 24000, basis: "per-robot" },
      repair: { mode: "separate", amountRub: 30000, basis: "per-site" },
      battery: { mode: "separate", amountRub: 90000, basis: "per-robot", everyYears: 2 } })));
    expect(money(result, "consumables")).toBe(72000); expect(money(result, "repair")).toBe(30000);
    expect(money(result, "battery")).toBe(135000);
    expect(result.cashflows.map(row => row.batteryRub)).toEqual([0, 0, 270000, 0, 270000, 0]);
    expect(result.cashflows.every(row => row.reinvestRub === 0)).toBe(true);
    expect(result.cashflows[1]!.opexRub - base.cashflows[1]!.opexRub).toBe(102000);
    expect(result.cashflows[2]!.opexRub - base.cashflows[2]!.opexRub).toBe(372000);
    expect(result.tcoRub - base.tcoRub).toBe(5 * 102000 + 2 * 270000);
  });

  it("retains legacy numbers but warns that all-inclusive scope is unconfirmed", () => {
    const legacy = spec(), before = structuredClone(legacy);
    const result = computeScenarios(fixtureContext(), [legacy])[0]!;
    expect(result.status).toBe("ok");
    expect(result.risks.some(risk => risk.code === "RAAS_PACKAGE_UNCONFIRMED" && risk.text.includes("не условие договора"))).toBe(true);
    expect(legacy).toEqual(before);
  });

  it("does not turn missing prices/inclusions into free services", () => {
    const value = spec(scope({ repair: { mode: "unassessed" }, battery: { mode: "unassessed" } }));
    const result = computeScenarios(fixtureContext(), [value])[0];
    expect(result).toMatchObject({ status: "refused", refusal: { reason: "raas_package_incomplete" } });
    expect(() => raasChargeAmount({ mode: "unassessed" }, 10)).toThrow("не является нулевой");
    expect(parseRaasPackage(value.items[0]!.raasPackage)).toEqual(value.items[0]!.raasPackage);
  });

  it("rejects discounts, conflicting service overrides, non-RaaS packages and duplicate site charges", () => {
    for (const value of [spec(scope({ firstMonthRub: 184999 })), spec(scope(), { serviceRubYearOverride: 100 }), { ...spec(scope()), kind: "purchase" as const }]) {
      expect(computeScenariosCore(fixtureContext(), [value])[0]?.status).toBe("refused");
    }
    const item = spec(scope({ platform: { mode: "separate", amountRub: 12200, basis: "per-site" } })).items[0]!;
    expect(() => validateRaasSiteCharges([item, { ...item, process: "another-process" }])).toThrow("в нескольких позициях");
    expect(() => validateRaasSiteCharges([item, { ...item, process: "another-process", raasPackage: scope() }])).not.toThrow();
  });

  it.each([null, {}, { ...scope(), extra: 1 }, { ...scope(), reason: " " }, { ...scope(), firstMonthRub: NaN },
    scope({ platform: { mode: "separate", amountRub: -1, basis: "per-site" } }),
    scope({ service: { mode: "separate", amountRub: Infinity, basis: "per-robot" } }),
    scope({ battery: { mode: "separate", amountRub: 100, basis: "per-site", everyYears: 0.5 } }),
    { ...scope(), service: { mode: "included", amountRub: 0 } },
  ])("rejects malformed scope at every boundary without mutating it: %j", input => {
    expect(() => parseRaasPackage(input)).toThrow();
    const value = spec(input as RaasPackage);
    if (input !== null) expect(() => computeScenarios(fixtureContext(), [value])).not.toThrow();
  });
});
