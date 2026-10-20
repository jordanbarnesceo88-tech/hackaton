import { describe, expect, it } from "vitest";
import { computeScenariosCore } from "./econ/core";
import { fixtureContext, fixtureSpecs } from "./econ/fixtures";
import { buildPilotBudget, defaultPilotPlan, type PilotBudgetModel } from "./pilot-budget";

function model(version = "tz-1.0.10", duplicate: "purchase" | "raas" = "purchase"): PilotBudgetModel {
  const ctx = fixtureContext(), scenarios = fixtureSpecs();
  const original = scenarios.find(row => row.kind === duplicate)!;
  const other = structuredClone(original);
  other.key = `${original.key}-other`; other.name = "Другое предложение того же продукта";
  Object.assign(other.items[0]!, duplicate === "purchase" ? { priceRubOverride: 3_700_000 } : { raasRubMonthOverride: 200_000 });
  scenarios.push(other);
  const results = computeScenariosCore(ctx, scenarios);
  if (results.some(row => row.status !== "ok")) throw new Error("Invalid pilot reference fixture");
  return { modelVersion: version, paramsUsed: ctx.params, normsUsed: ctx.norms, productSnapshots: ctx.products, scenarios, results };
}
const equipment = (budget: ReturnType<typeof buildPilotBudget>) => budget.lines.find(row => row.key === "equipment")!.valueRub;

describe("pilot acquisition reference", () => {
  it.each(["purchase", "raas"] as const)("rejects ambiguous opposite %s offers in either order in both entrypoints", acquisition => {
    const m = model("tz-1.0.10", acquisition), key = acquisition === "purchase" ? "r1" : "p1";
    const plan = { ...defaultPilotPlan(m, key), acquisition };
    const before = structuredClone(m);
    for (const candidate of [m, { ...m, results: [...m.results].reverse(), scenarios: [...m.scenarios].reverse() }]) {
      expect(() => defaultPilotPlan(candidate, key, acquisition)).toThrow(/несколько.*сценариев.*Откройте пилот/);
      expect(() => buildPilotBudget(candidate, key, plan)).toThrow(/несколько.*сценариев.*Откройте пилот/);
    }
    expect(m).toEqual(before);
  });
  it.each(["purchase", "raas"] as const)("uses the selected %s offer despite another matching offer", acquisition => {
    const m = model("tz-1.0.10", acquisition), key = acquisition === "purchase" ? "p1-other" : "r1-other";
    const before = structuredClone(m), plan = defaultPilotPlan(m, key, acquisition);
    const budget = buildPilotBudget(m, key, plan);
    expect(equipment(budget)).toBe(plan.fleet * (acquisition === "purchase" ? 3_700_000 : 200_000 * budget.subscriptionMonths));
    const otherKind = acquisition === "purchase" ? "raas" : "purchase";
    const counterpart = structuredClone(m.scenarios.find(row => row.kind === otherKind)!);
    counterpart.key += "-another";
    m.scenarios.push(counterpart);
    const counterpartResult = structuredClone(m.results.find(row => row.kind === otherKind)!);
    counterpartResult.key = counterpart.key; m.results.push(counterpartResult);
    expect(buildPilotBudget(m, key, defaultPilotPlan(m, key))).toEqual(buildPilotBudget(before, key, plan));
  });
  it("keeps one opposite offer and legacy first-match archives unchanged", () => {
    const single = model(); single.scenarios.pop(); single.results.pop();
    const plan = defaultPilotPlan(single, "r1", "purchase");
    expect(equipment(buildPilotBudget(single, "r1", plan))).toBe(plan.fleet * 2_700_000);
    for (const version of ["tz-1.0.9", "tz-1.0.8", "unknown"]) {
      const old = model(version), before = structuredClone(old);
      const oldPlan = defaultPilotPlan(old, "r1", "purchase");
      expect(equipment(buildPilotBudget(old, "r1", oldPlan))).toBe(oldPlan.fleet * 2_700_000);
      const reversed = { ...old, results: [...old.results].reverse() };
      expect(equipment(buildPilotBudget(reversed, "r1", defaultPilotPlan(reversed, "r1", "purchase")))).toBe(oldPlan.fleet * (version === "tz-1.0.9" ? 3_700_000 : 2_700_000));
      expect(old).toEqual(before);
    }
  });
});
