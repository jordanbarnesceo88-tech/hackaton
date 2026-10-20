import { describe, expect, it } from "vitest";
import { computeScenariosCore } from "./econ/core";
import { fixtureContext, fixtureSpecs } from "./econ/fixtures";
import { buildPilotBudget, defaultPilotPlan, parsePilotPlanInput, type PilotBudgetModel } from "./pilot-budget";

function model(version = "tz-1.0.10", allChargersIncluded = false): PilotBudgetModel {
  const ctx = fixtureContext(), scenarios = fixtureSpecs();
  Object.assign(scenarios[1]!.items[0]!, { quantityOverride: 5, chargersOverride: 5,
    costPackage: { softwareIncludedInIntegration: true, repairsIncludedInService: false,
      includedChargers: allChargersIncluded ? 0 : 2, allChargersIncluded, reason: "Поставка пяти роботов включает две зарядные станции; условия пилота ещё не подтверждены" } });
  scenarios[2]!.items[0]!.quantityOverride = 7;
  const results = computeScenariosCore(ctx, scenarios);
  if (results.some(row => row.status !== "ok")) throw new Error("Invalid financial fixture");
  return { modelVersion: version, paramsUsed: ctx.params, normsUsed: ctx.norms, productSnapshots: ctx.products, scenarios, results };
}
const charger = (budget: ReturnType<typeof buildPilotBudget>) => budget.lines.find(line => line.key === "chargers")!;

describe("fixed purchase charger bundle in a separately scoped pilot", () => {
  it.each([2, 6])("keeps the charger cost unknown for a %i-robot pilot with a different source fleet", fleet => {
    const m = model(), before = structuredClone(m), plan = defaultPilotPlan(m, "p1");
    plan.fleet = fleet; plan.chargers = 2;
    const budget = buildPilotBudget(m, "p1", plan);
    expect(charger(budget).valueRub).toBeNull();
    expect(charger(budget).source).toContain("5 роботов");
    expect(charger(budget).source).toContain("2 зарядных");
    expect(budget.unknowns).toContain("Зарядные станции пилота");
    expect(budget.reserveRub).toBeNull(); expect(budget.totalRub).toBeNull();
    expect(m).toEqual(before);
  });
  it.each([[1, 0], [2, 0], [5, 900000], [7, 1500000]])("deducts included stations at the same quoted fleet for C=%i", (chargers, expected) => {
    const m = model(), plan = defaultPilotPlan(m, "p1"); plan.fleet = 5; plan.chargers = chargers;
    const line = charger(buildPilotBudget(m, "p1", plan));
    expect(line.valueRub).toBe(expected);
    expect(line.formula).toContain("включено");
    expect(line.source).toContain("Поставка пяти роботов");
  });
  it.each([0, 125000])("accepts a separately sourced whole-pilot charger quote of %i", price => {
    const m = model(), plan = defaultPilotPlan(m, "p1"); plan.chargers = 2;
    plan.chargerBudgetRubOverride = price; plan.chargerBudgetSource = "Отдельная оценка всех станций малого пилота, включая комплектные";
    const budget = buildPilotBudget(m, "p1", plan);
    expect(charger(budget).valueRub).toBe(price);
    expect(charger(budget).source).toBe(plan.chargerBudgetSource);
    expect(budget.unknowns).not.toContain("Зарядные станции пилота");
    expect(() => parsePilotPlanInput({ ...plan, chargerBudgetSource: " " })).toThrow();
  });
  it("uses the purchase reference's fleet when opened from a RaaS scenario", () => {
    const m = model(), plan = defaultPilotPlan(m, "r1", "purchase"); plan.fleet = 5; plan.chargers = 5;
    expect(charger(buildPilotBudget(m, "r1", plan)).valueRub).toBe(900000);
    plan.fleet = 7;
    expect(charger(buildPilotBudget(m, "r1", plan)).valueRub).toBeNull();
  });
  it("preserves all-stations inclusion and old archived pricing without adding new assumptions", () => {
    const current = model("tz-1.0.10", true), plan = defaultPilotPlan(current, "p1"); plan.chargers = 2;
    expect(charger(buildPilotBudget(current, "p1", plan)).valueRub).toBe(0);
    for (const version of ["tz-1.0.9", "tz-1.0.8", "unknown"]) {
      const old = model(version), before = structuredClone(old), oldPlan = defaultPilotPlan(old, "p1"); oldPlan.chargers = 2;
      expect(charger(buildPilotBudget(old, "p1", oldPlan)).valueRub).toBe(600000);
      expect(old).toEqual(before);
    }
  });
  it("keeps an unbundled purchase and a pilot requesting no chargers unchanged", () => {
    const m = model(), plan = defaultPilotPlan(m, "p1"); plan.chargers = 0;
    const zero = charger(buildPilotBudget(m, "p1", plan));
    expect(zero.valueRub).toBe(0);
    expect(zero.source).toContain("не запрошены");
    expect(zero.source).not.toContain("RaaS");
    expect(zero.source).not.toContain("Неизвестно");
    m.scenarios[1]!.items[0]!.costPackage!.includedChargers = 0;
    plan.chargers = 2;
    expect(charger(buildPilotBudget(m, "p1", plan)).valueRub).toBe(600000);
  });
});
