import { describe, expect, it } from "vitest";
import { computeScenariosCore } from "./econ/core";
import { cleaningContext, TEST_CLEANER, TEST_CLEANING_PROFILE } from "./econ/cleaning-fixtures";
import { buildPilotBudget, defaultPilotPlan, parsePilotPlanInput, type PilotBudgetModel } from "./pilot-budget";
import type { CleaningPlan, RaasPackage, ScenarioSpec } from "./types";

const second = "second-cleaner";
function model(): PilotBudgetModel {
  const ctx = cleaningContext();
  ctx.products[second] = { ...TEST_CLEANER, slug: second, name: "Вторая модель" };
  const plan: CleaningPlan = { schemaVersion: "cleaning-zones-1", source: "Тестовые допущения", disjointAreaReason: "Непересекающиеся зоны",
    robots: [TEST_CLEANER.slug, second].flatMap(productSlug => [0, 1].map(i => ({ id: `${productSlug}-${i}`, productSlug }))), existingMachines: [],
    zones: [TEST_CLEANER.slug, second].map((slug, i) => ({ id: `zone-${i}`, name: `Зона ${i}`, floor: 1, areaM2: 800, cleaningsPerDay: 1, windowStartH: i * 3, windowH: 2,
      baselineLabourHoursPerDay: 4, retainedLabourHoursPerDay: 2, manualThroughputM2PerH: 100, existingMachineIds: [],
      assignments: [0, 1].map(n => ({ robotId: `${slug}-${n}`, transferMin: 0, transferLabourMin: 0, profile: { ...TEST_CLEANING_PROFILE, workBeforeChargeH: 8, chargeH: 1, windowH: 2 } })) })) };
  ctx.params.cleaningAreaM2 = 1600;
  const included = { mode: "included" } as const;
  const raas = (firstMonthRub: number): RaasPackage => ({ firstMonthRub, startup: included, platform: included, service: included, consumables: included, repair: included, battery: included, reason: "Тестовый состав услуги выбранной модели" });
  const scenarios: ScenarioSpec[] = [{ key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "purchase", name: "Две модели, покупка", kind: "purchase", cleaningPlan: plan, items: [TEST_CLEANER.slug, second].map((productSlug, i) => ({ process: "cleaning", productSlug, priceRubOverride: i ? 4_000_000 : 2_000_000,
      costPackage: { includedChargers: i ? 1 : 0, allChargersIncluded: !i, softwareIncludedInIntegration: true, repairsIncludedInService: false, startup: { mode: "separate", basis: "per-robot", amountRub: i ? 4000 : 2000 }, reason: `Оценка поставки модели ${productSlug}` } })) },
    { key: "raas", name: "Две модели, услуга", kind: "raas", cleaningPlan: plan, items: [TEST_CLEANER.slug, second].map((productSlug, i) => ({ process: "cleaning", productSlug, raasRubMonthOverride: i ? 300_000 : 100_000, raasPackage: raas(i ? 400_000 : 150_000) })) }];
  const results = computeScenariosCore(ctx, scenarios);
  if (results.some(row => row.status !== "ok")) throw new Error(JSON.stringify(results));
  return { modelVersion: "tz-1.1.0", paramsUsed: ctx.params, normsUsed: ctx.norms, productSnapshots: ctx.products, scenarios, results };
}
const line = (budget: ReturnType<typeof buildPilotBudget>, key: string) => budget.lines.find(row => row.key === key)!;

describe("explicit selected-model pilot in a mixed scenario", () => {
  it("never silently selects the first model, regardless of item order", () => {
    const m = model();
    for (let order = 0; order < 2; order++) {
      expect(() => defaultPilotPlan(m, "purchase")).toThrow("явно выберите модель");
      expect(() => buildPilotBudget(m, "purchase")).toThrow("явно выберите модель");
      m.scenarios[1]!.items.reverse(); m.results[1]!.items.reverse();
    }
  });
  it("costs only the explicitly selected model, keeps its own price/package and preserves the archive", () => {
    const m = model(), before = structuredClone(m), plan = defaultPilotPlan(m, "purchase", undefined, second);
    expect(plan).toMatchObject({ productSlug: second, fleet: 2, chargers: 2 });
    expect(parsePilotPlanInput(plan)).toEqual(plan);
    const budget = buildPilotBudget(m, "purchase", plan);
    expect(budget.product.slug).toBe(second); expect(budget.fullFleet).toBe(2);
    expect(line(budget, "equipment").valueRub).toBe(8_000_000);
    expect(line(budget, "setup").valueRub).toBe(8000);
    expect(line(budget, "chargers").valueRub).toBe(m.normsUsed.chargerRub);
    expect(budget.warning).toContain("остальные модели смешанного сценария не входят");
    expect(budget.totalRub).toBeNull(); expect(m).toEqual(before);
    m.scenarios[1]!.pilotPlan = plan;
    expect(buildPilotBudget(m, "purchase").plan).toEqual(plan);
  });
  it("looks up the selected model in an opposite-acquisition mixed reference, not reference item zero", () => {
    const m = model();
    const purchasePlan = defaultPilotPlan(m, "raas", "purchase", second);
    expect(line(buildPilotBudget(m, "raas", purchasePlan), "equipment").valueRub).toBe(8_000_000);
    expect(line(buildPilotBudget(m, "raas", purchasePlan), "chargers").valueRub).toBe(m.normsUsed.chargerRub);
    const raasPlan = defaultPilotPlan(m, "purchase", "raas", second), raas = buildPilotBudget(m, "purchase", raasPlan);
    expect(line(raas, "equipment").valueRub).toBe(600_000);
    expect(line(raas, "firstMonthPremium").valueRub).toBe(200_000);
    m.scenarios[1]!.items.reverse(); m.results[1]!.items.reverse(); m.scenarios[2]!.items.reverse(); m.results[2]!.items.reverse();
    expect(line(buildPilotBudget(m, "raas", purchasePlan), "equipment").valueRub).toBe(8_000_000);
    expect(line(buildPilotBudget(m, "purchase", raasPlan), "firstMonthPremium").valueRub).toBe(200_000);
  });
  it("does not turn aggregate implementation/training charges into a selected-model quote", () => {
    const m = model(); delete m.scenarios[1]!.items[1]!.costPackage;
    const result = m.results[1]!;
    if (result.status !== "ok") throw new Error("Expected result");
    result.capexLines.push({ ...result.capexLines[0]!, key: "integration", valueRub: 12_345_678, label: "Общие работы" });
    const plan = defaultPilotPlan(m, "purchase", undefined, second);
    expect(plan.costs.integration.valueRub).toBeNull(); expect(plan.costs.training.valueRub).toBeNull();
  });
  it("uses cleaning-area acceptance for zone-only profiles and rejects unknown or ambiguous selections", () => {
    const m = model(), plan = defaultPilotPlan(m, "purchase", undefined, second); plan.targetThroughputPerH = 200;
    const budget = buildPilotBudget(m, "purchase", plan);
    expect(budget.criteria[0]).toContain("м²/ч рабочего окна"); expect(budget.criteria.join()).not.toContain("операций/ч");
    expect(() => buildPilotBudget(m, "purchase", { ...plan, productSlug: "absent" })).toThrow("отсутствует");
    expect(() => parsePilotPlanInput({ ...plan, productSlug: " " })).toThrow("Выберите модель");
    m.scenarios[1]!.items.push(structuredClone(m.scenarios[1]!.items[1]!));
    expect(() => buildPilotBudget(m, "purchase", plan)).toThrow("неоднозначна");
  });
});
