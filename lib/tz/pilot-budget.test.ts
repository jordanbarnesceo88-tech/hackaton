import { describe, expect, it } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { validateScenarioSpecs } from "../projects/validate";
import { buildProjectModel } from "./model";
import { FIXTURE_PRODUCTS, WAREHOUSE_BASE_PARAMS, fixtureSpecs } from "./econ/fixtures";
import { resolveNorms } from "./norms";
import { catalogProduct } from "../data/organizer/catalog";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { buildPilotBudget, defaultPilotPlan, parsePilotPlanInput, PILOT_WORKS, pilotProductSource } from "./pilot-budget";

const model = () => buildProjectModel({ facility: "warehouse", params: { ...WAREHOUSE_BASE_PARAMS }, paramDefs: paramSpecsFor("warehouse"), products: FIXTURE_PRODUCTS, norms: resolveNorms(), scenarios: fixtureSpecs() });

describe("pilot scope and budget", () => {
  it("retains the actual catalogue country provenance for selected warehouse products", () => {
    for (const slug of ["ronavi-h1500", "dikom-dmr-carrier-p", "moros-amr-1500"]) {
      const seed = catalogProduct(slug);
      if (!seed) throw new Error(`Missing catalogue product ${slug}`);
      const product = productForCalcFromSeed(seed), country = product.sources.find(source => source.key === "countryOfOrigin");
      expect(country).toMatchObject({ value: "Россия", confirmed: true, sourceUrl: expect.any(String), date: expect.any(String) });
      expect(pilotProductSource(product)).toContainEqual(country);
    }
  });
  it("starts with sourced equipment/work estimates but never treats unknown logistics as zero", () => {
    const m = model(), before = structuredClone(m), budget = buildPilotBudget(m, "p1");
    expect(budget.plan).toMatchObject({ fleet: 2, durationDays: 10, dayBasis: "working", targetThroughputPerH: null });
    expect(budget.calendarDays).toBe(14);
    expect(budget.knownSubtotalRub).toBeGreaterThan(5_400_000);
    expect(budget.unknowns).toContain("Доставка и обратная логистика");
    expect(budget.totalRub).toBeNull(); expect(budget.reserveRub).toBeNull();
    expect(budget.criteria[0]).toContain("не перенесена");
    expect(budget.warning).toContain("полный сценарий");
    expect(m).toEqual(before);
  });
  it("completes the estimate from explicit work costs and sources, including explicit included zero", () => {
    const m = model(), plan = defaultPilotPlan(m, "p1");
    for (const key of Object.keys(PILOT_WORKS) as (keyof typeof PILOT_WORKS)[]) plan.costs[key] = { valueRub: 0, source: "Входит в согласованную оценку поставки; подтвердить договором" };
    plan.costs.logistics = { valueRub: 60_000, source: "Оценка команды по маршруту поставки" };
    plan.targetThroughputPerH = 12; plan.readiness = ["sitePlan", "safety"];
    const budget = buildPilotBudget(m, "p1", plan);
    expect(budget.totalRub).toBeCloseTo(budget.knownSubtotalRub * 1.1);
    expect(budget.unknowns).toEqual([]);
    expect(budget.criteria[0]).toContain("12 операций/ч");
    expect(budget.readiness.filter(item => item.ready)).toHaveLength(2);
    expect(m.results.find(result => result.key === "p1")?.items[0]?.n).not.toBe(2);
  });
  it("prices RaaS in whole months, showing working/calendar conversion without hidden daily proration", () => {
    const m = model(), plan = defaultPilotPlan(m, "r1"); plan.fleet = 1;
    const short = buildPilotBudget(m, "r1", plan);
    expect(short.subscriptionMonths).toBe(1);
    expect(short.lines[0]?.valueRub).toBe(100_000);
    plan.dayBasis = "calendar"; plan.durationDays = 31;
    const long = buildPilotBudget(m, "r1", plan);
    expect(long.subscriptionMonths).toBe(2); expect(long.lines[0]?.valueRub).toBe(200_000);
    expect(long.lines[0]?.formula).toContain("без дневной пропорции");
  });
  it("honors the selected subscription's included chargers and work rather than charging them twice", () => {
    const m = model(), plan = defaultPilotPlan(m, "r1");
    expect(plan.costs.setup.valueRub).toBe(0);
    const reference = m.results.find(result => result.key === "r1");
    if (reference?.status !== "ok") throw new Error("Expected RaaS");
    expect(plan.costs.integration.valueRub).toBe(reference.capexLines.find(line => line.key === "integration")?.valueRub);
    expect(plan.costs.training.valueRub).toBe(reference.capexLines.find(line => line.key === "training")?.valueRub);
    for (const key of Object.keys(PILOT_WORKS) as (keyof typeof PILOT_WORKS)[]) plan.costs[key] = { valueRub: 0, source: "Включено в согласованный пилот, оценка" };
    const budget = buildPilotBudget(m, "r1", plan);
    expect(budget.lines.find(line => line.key === "chargers")).toMatchObject({ valueRub: 0, source: expect.stringContaining("Включено в подписку") });
    expect(budget.totalRub).toBe(220_000);
    expect(defaultPilotPlan(m, "p1", "raas").costs.setup.valueRub).toBe(0);
  });
  it("keeps unknown subscription inclusions unresolved and allows an explicit sourced charger quote", () => {
    const m = model(); m.results = m.results.filter(result => result.kind !== "raas");
    const plan = defaultPilotPlan(m, "p1", "raas");
    expect(buildPilotBudget(m, "p1", plan).lines.find(line => line.key === "chargers")?.valueRub).toBeNull();
    plan.chargerBudgetRubOverride = 0;
    expect(() => parsePilotPlanInput(plan)).toThrow(/источник ручной/);
    plan.chargerBudgetSource = "Зарядки включены в предоставленную поставщиком оценку";
    expect(buildPilotBudget(m, "p1", plan).lines.find(line => line.key === "chargers")?.valueRub).toBe(0);
  });
  it("preserves editable prices and flags a missing catalogue price instead of fabricating it", () => {
    const m = model(), plan = defaultPilotPlan(m, "p1");
    plan.equipmentUnitRubOverride = 100;
    expect(buildPilotBudget(m, "p1", plan).lines[0]).toMatchObject({ valueRub: 200, source: expect.stringContaining("Ручная оценка") });
    const product = m.productSnapshots["ronavi-h1500"]!; product.priceRub = null;
    plan.equipmentUnitRubOverride = null;
    expect(buildPilotBudget(m, "p1", plan).lines[0]?.valueRub).toBeNull();
  });
  it("strictly validates persisted metadata, nullable costs, finite values and readiness names", () => {
    const valid = defaultPilotPlan(model(), "p1");
    expect(parsePilotPlanInput(valid)).toEqual(valid);
    for (const patch of [{ fleet: 0 }, { fleet: 1.5 }, { fleet: 501 }, { durationDays: 0 }, { durationDays: 366 }, { chargers: -1 }, { dayBasis: "hours" }, { contingencyPct: 101 }, { targetThroughputPerH: 0 }, { maxP95WaitMin: Infinity }, { readiness: ["constructor"] }, { readiness: ["sitePlan", "sitePlan"] }, { extra: true }]) expect(() => parsePilotPlanInput({ ...valid, ...patch })).toThrow();
    expect(() => parsePilotPlanInput({ ...valid, costs: { ...valid.costs, logistics: { valueRub: -1, source: "x" } } })).toThrow();
    expect(() => parsePilotPlanInput({ ...valid, costs: { ...valid.costs, logistics: { valueRub: 0, source: " " } } })).toThrow();
    expect(() => parsePilotPlanInput({ ...valid, costs: { ...valid.costs, logistics: { valueRub: NaN, source: "x" } } })).toThrow();
    const copy = parsePilotPlanInput(valid); copy.costs.logistics.source = "Changed"; expect(valid.costs.logistics.source).not.toBe("Changed");
  });
  it("roundtrips pilot/residual through the scenario validator without allowing them on the baseline", () => {
    const m = model(), specs = fixtureSpecs(); specs[1]!.pilotPlan = defaultPilotPlan(m, "p1"); specs[1]!.terminalResidualRub = 100_000;
    const checked = validateScenarioSpecs(specs, "warehouse", FIXTURE_PRODUCTS.map(p => p.slug), ["pallet-transport"]);
    expect(checked.ok).toBe(true); if (!checked.ok) throw new Error(checked.errors.join());
    expect(checked.value[1]?.pilotPlan).toEqual(specs[1]?.pilotPlan); expect(checked.value[1]?.terminalResidualRub).toBe(100_000);
    specs[0]!.pilotPlan = specs[1]!.pilotPlan; expect(validateScenarioSpecs(specs, "warehouse", FIXTURE_PRODUCTS.map(p => p.slug), ["pallet-transport"]).ok).toBe(false);
  });
});
