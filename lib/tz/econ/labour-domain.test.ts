import { describe, expect, it } from "vitest";
import { validateScenarioSpecs } from "../../projects/validate";
import { normDef } from "../norms";
import { computeScenariosCore } from "./core";
import { fixtureContext, fixtureSpecs } from "./fixtures";
import { scenarioRisks } from "./risks";
import { baseOutsideSourceRange, scenarioSensitivity } from "./sensitivity";

describe("labour share: physical domain and estimate uncertainty are separate", () => {
  it.each([0, 0.1, 0.5, 0.9, 1])("preserves the explicit share %s in API and economics", share => {
    const ctx = fixtureContext(20, { params: { forkliftOperatorsCount: 20, nonStandardCargoPct: 0 } });
    const specs = fixtureSpecs();
    specs[1]!.normOverrides = { laborShareAutomatable: share };
    const parsed = validateScenarioSpecs(specs, "warehouse", Object.keys(ctx.products), Object.keys(ctx.processes));
    expect(parsed.ok).toBe(true);
    const result = computeScenariosCore(ctx, specs).find(r => r.key === "p1")!;
    expect(result.status).toBe("ok");
    expect(result.items[0]!.releasedFte).toBeCloseTo(20 * share, 10);
  });

  it.each([-0.01, 1.01, NaN, Infinity])("rejects invalid API share %s", share => {
    const ctx = fixtureContext(), specs = fixtureSpecs();
    specs[1]!.normOverrides = { laborShareAutomatable: share };
    expect(validateScenarioSpecs(specs, "warehouse", Object.keys(ctx.products), Object.keys(ctx.processes)).ok).toBe(false);
  });

  it.each([[0.5, 0.3, 0.7], [0.1, 0.1, 0.7], [0.9, 0.3, 0.9], [0, 0, 0.7], [1, 0.3, 1]])(
    "keeps the estimate band and includes explicit base %s", (share, low, high) => {
      const ctx = fixtureContext(), specs = fixtureSpecs();
      specs[1]!.normOverrides = { laborShareAutomatable: share };
      const result = computeScenariosCore(ctx, specs).find(r => r.key === "p1")!;
      const sensitivity = scenarioSensitivity(ctx, specs[1]!, specs, result);
      const row = sensitivity.find(r => r.lever === "laborShare")!;
      expect(row).toMatchObject({ base: share, low, high, boundsSource: "норматив" });
      expect(baseOutsideSourceRange(row)).toBe(share < 0.3 || share > 0.7);
      const text = scenarioRisks(ctx, result, sensitivity, specs[1]!).find(r => r.code === "LABOR_SHARE_ESTIMATE")!.text;
      expect(text).toContain("30–70 %");
      expect(text).toContain("до исключения нестандартных грузов");
      expect(text).not.toContain("0–100 % входит");
    },
  );

  it("applies nonstandard workload, annual coverage and cash realization once each", () => {
    const ctx = fixtureContext(20, { params: { forkliftOperatorsCount: 20, nonStandardCargoPct: 20 } });
    const specs = fixtureSpecs();
    specs[1]!.normOverrides = { laborShareAutomatable: 0.9 };
    specs[1]!.items[0]!.automationCoverageOverride = 0.25;
    for (const cash of [0, 0.25, 1]) {
      specs[1]!.cashRealizationShare = cash;
      const result = computeScenariosCore(ctx, specs).find(r => r.key === "p1")!;
      const item = result.items[0]!;
      expect(item.releasedFte).toBeCloseTo(20 * 0.9 * 0.8 * 0.25, 10);
      expect(item.remainingLabourRub).toBeCloseTo(item.baselineLabourRub - item.releasedFte * item.roleCostRubYear * cash, 6);
    }
    expect(normDef("laborShareAutomatable").basis).toContain("до исключения нестандартных грузов");
  });
});
