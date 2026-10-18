import { describe, expect, it } from "vitest";
import { parseDeploymentLogistics } from "../deployment-logistics";
import type { ScenarioOk } from "../types";
import { validatePendingChanges, validateScenarioSpecs } from "../../projects/validate";
import { projectAuditDiff } from "../../projects/changes";
import { computeScenariosCore } from "./core";
import { computeScenarios } from "./scenario";
import { fixtureContext, fixtureSpecs } from "./fixtures";

describe("explicit one-off deployment delivery", () => {
  it.each(["p1", "r1"])("adds delivery once before contingency in %s without changing annual OPEX", key => {
    const ctx = fixtureContext(), specs = fixtureSpecs();
    const base = computeScenariosCore(ctx, specs).find(r => r.key === key) as ScenarioOk;
    specs.find(s => s.key === key)!.logistics = { mode: "separate", costRub: 200_000, source: "Оценка доставки всего парка, включая страховку и НДС" };
    const result = computeScenariosCore(ctx, specs).find(r => r.key === key) as ScenarioOk;
    const delta = 200_000 * (1 + ctx.norms.capexReservePct);
    expect(result.capexRub - base.capexRub).toBeCloseTo(delta, 6);
    expect(result.cashflows[0]!.cashflowRub - base.cashflows[0]!.cashflowRub).toBeCloseTo(-delta, 6);
    expect(result.npvRub! - base.npvRub!).toBeCloseTo(-delta, 6);
    expect(result.tcoRub - base.tcoRub).toBeCloseTo(delta, 6);
    expect(result.opexYearRub).toBe(base.opexYearRub);
    expect(result.effectYearRub).toBe(base.effectYearRub);
    expect(result.capexLines.filter(line => line.key === "logistics")).toHaveLength(1);
    expect(result.capexLines.find(line => line.key === "logistics")).toMatchObject({ valueRub: 200_000, origin: "user" });
    expect(result.capexLines.find(line => line.key === "reserve")!.valueRub - base.capexLines.find(line => line.key === "reserve")!.valueRub).toBeCloseTo(200_000 * ctx.norms.capexReservePct, 6);
    expect(result.capexLines.find(line => line.key === "logistics")?.substituted).toContain("весь сценарий");
  });

  it("keeps absent delivery numbers unchanged, but marks it unassessed instead of free", () => {
    const ctx = fixtureContext(), specs = fixtureSpecs();
    const core = computeScenariosCore(ctx, specs).find(r => r.key === "p1") as ScenarioOk;
    const result = computeScenarios(ctx, specs).find(r => r.key === "p1") as ScenarioOk;
    expect(result.capexRub).toBe(core.capexRub);
    expect(result.capexLines.some(line => line.key === "logistics")).toBe(false);
    expect(result.risks.find(r => r.code === "LOGISTICS_NOT_ASSESSED")?.text).toContain("не оценена");
    specs[1]!.logistics = { mode: "included", source: "КП: доставка на объект включена в цену оборудования" };
    const included = computeScenarios(ctx, specs).find(r => r.key === "p1") as ScenarioOk;
    expect(included.capexRub).toBe(core.capexRub);
    expect(included.capexLines.find(line => line.key === "logistics")).toMatchObject({ valueRub: 0, origin: "user" });
    expect(included.risks.some(r => r.code === "LOGISTICS_NOT_ASSESSED")).toBe(false);
    expect(included.risks.find(r => r.code === "LOGISTICS_ASSUMPTION")?.text).toContain("КП:");
  });

  it.each([
    null, {}, { mode: "unknown", source: "КП" }, { mode: "included", source: " " },
    { mode: "included", source: "КП", costRub: 1 }, { mode: "separate", source: "КП" },
    ...[-1, NaN, Infinity, 1e13, "100"].map(costRub => ({ mode: "separate", source: "КП", costRub })),
    { mode: "separate", costRub: 100, source: "КП", other: 1 },
  ])("rejects invalid or ambiguous delivery input %#", value => {
    expect(() => parseDeploymentLogistics(value)).toThrow();
    const specs = fixtureSpecs();
    (specs[1] as unknown as Record<string, unknown>).logistics = value;
    expect(validateScenarioSpecs(specs, "warehouse", ["ronavi-h1500"], ["pallet-transport"]).ok).toBe(false);
    expect(computeScenariosCore(fixtureContext(), specs).find(r => r.key === "p1")?.status).toBe("refused");
  });

  it("validates explicit zero and inclusion, rejects baseline delivery and audits change/removal from server facts", () => {
    const before = fixtureSpecs(), after = structuredClone(before);
    after[1]!.logistics = { mode: "separate", costRub: 0, source: "КП: отдельная доставка бесплатно" };
    expect(validateScenarioSpecs(after, "warehouse", ["ronavi-h1500"], ["pallet-transport"]).ok).toBe(true);
    const diff = projectAuditDiff({ params: {}, scenarios: before }, { params: {}, scenarios: after });
    expect(diff).toEqual([expect.objectContaining({ field: "scenario:logistics", old: null, new: after[1]!.logistics })]);
    expect(validatePendingChanges(diff).ok).toBe(true);
    expect(projectAuditDiff({ params: {}, scenarios: after }, { params: {}, scenarios: before })[0]).toMatchObject({ field: "scenario:logistics", old: after[1]!.logistics, new: null });
    after[0]!.logistics = { mode: "included", source: "КП" };
    expect(validateScenarioSpecs(after, "warehouse", ["ronavi-h1500"], ["pallet-transport"]).ok).toBe(false);
    expect(computeScenariosCore(fixtureContext(), after).find(r => r.key === "asis")?.status).toBe("refused");
  });
});
