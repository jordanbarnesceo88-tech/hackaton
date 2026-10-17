import { describe, expect, it } from "vitest";
import { computeScenariosCore } from "./core";
import { fixtureContext, fixtureSpecs } from "./fixtures";
import type { ScenarioOk } from "../types";

describe("scenario terminal net residual", () => {
  it.each([3, 5])("horizon H=%s preserves operating economics and values disposal at TCO end only", H => {
    const ctx = fixtureContext(20, { params: { horizonYears: H } }), specs = fixtureSpecs();
    const base = computeScenariosCore(ctx, specs).find(r => r.key === "p1") as ScenarioOk;
    specs[1]!.terminalResidualRub = 1_000_000;
    const withResidual = computeScenariosCore(ctx, specs).find(r => r.key === "p1") as ScenarioOk;
    expect(withResidual.status).toBe("ok");
    expect(withResidual.capexRub).toBe(base.capexRub); expect(withResidual.effectYearRub).toBe(base.effectYearRub); expect(withResidual.opexYearRub).toBe(base.opexYearRub);
    expect(withResidual.tcoYears).toBe(5); expect(withResidual.tcoRub).toBe(base.tcoRub - 1_000_000);
    expect((withResidual.npvRub ?? 0) - (base.npvRub ?? 0)).toBeCloseTo(H < 5 ? 0 : 1_000_000 / (1 + ctx.norms.discountRate) ** 5);
    expect(withResidual.cashflows.filter(row => row.residualRub)).toHaveLength(1);
    expect(withResidual.trace.find(row => row.key === "terminalResidual")).toMatchObject({ value: 1_000_000, origin: "user" });
    expect(withResidual.trace.find(row => row.key === "terminalResidual")?.substituted).toContain(H < 5 ? "не входит в NPV" : "включено в NPV");
    specs[1]!.terminalResidualRub = 0;
    expect(computeScenariosCore(ctx, specs).find(r => r.key === "p1")).toEqual(base);
  });
  it("rejects invalid residual assumptions and residual on the no-investment baseline", () => {
    for (const residual of [-1, NaN, Infinity, 1e13]) {
      const specs = fixtureSpecs(); specs[1]!.terminalResidualRub = residual;
      expect(computeScenariosCore(fixtureContext(), specs).find(row => row.key === "p1")?.status).toBe("refused");
    }
    const specs = fixtureSpecs(); specs[0]!.terminalResidualRub = 1;
    expect(computeScenariosCore(fixtureContext(), specs).find(row => row.key === "asis")?.status).toBe("refused");
  });
});
