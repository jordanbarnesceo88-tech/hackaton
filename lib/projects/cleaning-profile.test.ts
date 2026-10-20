import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { TEST_CLEANER, TEST_CLEANING_PROFILE, cleaningContext, cleaningSpecs } from "../tz/econ/cleaning-fixtures";
import { projectAuditDiff } from "./changes";
import { scenarioFromRow, scenarioSpecJson } from "./queries";
import { validatePendingChanges, validateScenarioSpecs } from "./validate";

const validate = (value: unknown) => validateScenarioSpecs(value, "warehouse", new Set([TEST_CLEANER.slug]), ["cleaning"]);
function scenarios() {
  const specs = cleaningSpecs(); specs.push({ ...structuredClone(specs[1]!), key: "c2", name: "Второй вариант уборки" });
  return specs;
}
describe("explicit cleaning profile persistence and audit", () => {
  it("preserves all working assumptions and purchase cost bases through server parsing and JSON snapshot storage", () => {
    const specs = scenarios();
    specs[1]!.items[0]!.costPackage = { softwareIncludedInIntegration: true, repairsIncludedInService: false, includedChargers: 0, allChargersIncluded: true,
      startup: { mode: "separate", amountRub: 80000, basis: "per-site" }, platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-robot" }, reason: "Явная тестовая оценка, не коммерческое предложение" };
    const checked = validate(JSON.parse(JSON.stringify(specs)));
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const restored = scenarioFromRow({ key: "c1", name: "Уборка", kind: "PURCHASE", spec: scenarioSpecJson(checked.value[1]!) as Prisma.JsonValue });
    expect(restored.items).toEqual(specs[1]!.items);
    const before = { params: cleaningContext().params, scenarios: cleaningSpecs() }, after = structuredClone(before);
    after.scenarios[1]!.items[0]!.cleaningProfile = { ...TEST_CLEANING_PROFILE, dailyCareMin: 20, source: "Уточнённая тестовая оценка" };
    const changes = projectAuditDiff(before, after);
    expect(changes).toHaveLength(1); expect(changes[0]).toMatchObject({ field: "item:cleaning:cleaningProfile", old: TEST_CLEANING_PROFILE, new: after.scenarios[1]!.items[0]!.cleaningProfile });
    expect(validatePendingChanges(changes).ok).toBe(true);
  });
  it("rejects misleading profile claims and conflicting throughput before durable enqueue", () => {
    const specs = scenarios();
    specs[1]!.items[0]!.throughputPerHOverride = 700;
    expect(validate(specs).ok).toBe(false);
    const malformed = scenarios();
    (malformed[1]!.items[0]!.cleaningProfile as unknown as Record<string, unknown>).approved = true;
    expect(validate(malformed).ok).toBe(false);
  });
});
