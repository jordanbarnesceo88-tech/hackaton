import { describe, expect, it } from "vitest";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { CATALOG } from "../data/organizer/catalog";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { toStored } from "../sim/metrics";
import { runSimSync } from "../sim/runner";
import { fixtureSpecs } from "./econ/fixtures";
import { buildProjectModel } from "./model";
import { resolveNorms } from "./norms";

describe("рекомендация и актуальная проверка потока", () => {
  it("авто-N26, обслужено около80,2%: числа остаются, рекомендации нет; stale не выдаётся за проверку", () => {
    const products = CATALOG.map(productForCalcFromSeed);
    const product = products.find((p) => p.slug === "moros-amr-800");
    if (!product) throw new Error("Нет контрольного Moros AMR800");
    const input = {
      facility: "warehouse",
      params: {
        ...baseValuesFor("warehouse"),
        forkliftOperatorsCount: 60,
        inboundPalletsPerDay: 2_000,
        outboundPalletsPerDay: 2_000,
        peakFactor: 2.5,
        receivingDocksCount: 1,
        shippingDocksCount: 1,
      },
      paramDefs: paramSpecsFor("warehouse"),
      products,
      scenarios: fixtureSpecs(product).filter((s) => s.kind !== "raas"),
      norms: resolveNorms(),
    };
    const base = buildProjectModel(input);
    const physical = base.simInputs.p1?.calculated;
    if (!physical) throw new Error("Нет входа проверки контрольного парка");
    const summary = toStored(runSimSync(physical, { scenarioKey: "p1" }));
    expect(summary.fleet).toBe(26);
    expect(summary.servedShare).toBeCloseTo(0.802, 2);
    expect(summary.verdict).toBe("NOT_CONFIRMED");

    const fresh = buildProjectModel({ ...input, sims: { p1: summary } });
    const result = fresh.results.find((r) => r.key === "p1");
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") throw new Error("Контрольная экономика не рассчитана");
    expect(result.npvRub).toBeGreaterThan(0);
    expect(result.risks.some((r) => r.code === "SIM_NOT_CONFIRMED")).toBe(true);
    expect(fresh.conclusion.recommendedScenarioKey).toBeNull();
    expect(fresh.conclusion.headline).toContain("не подтвердили заданную нагрузку");
    expect(fresh.conclusion.headline).not.toContain("не окупается");
    expect(fresh.conclusion.bullets.some((b) => b.startsWith("При горизонте"))).toBe(false);

    const stale = buildProjectModel({ ...input, sims: { p1: { ...summary, inputKey: "stale" } } });
    expect(stale.results.find((r) => r.key === "p1")?.risks.some((r) => r.code === "SIM_NOT_CONFIRMED")).toBe(false);
    expect(stale.conclusion.recommendedScenarioKey).toBe("p1");
    expect(stale.conclusion.headline).toContain("Предварительный финансовый выбор");
    expect(stale.conclusion.headline).not.toContain("подтверждён");
  });
});
