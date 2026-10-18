import { describe, expect, it } from "vitest";
import { fixtureResults } from "../report/tz/test-fixtures";
import { capacityNotEvaluated } from "../sim/capacity-protocol";
import { warehouseBaseInput } from "../sim/fixtures";
import { simInputIdentity } from "../sim/identity";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-version";
import type { ScenarioOk } from "./types";
import { withCapacityCandidates } from "./capacity-conclusion";

function qualified() {
  const saved = fixtureResults(), spec = saved.scenarios.find(row => row.kind === "purchase")!;
  const result = saved.results.find(row => row.key === spec.key) as ScenarioOk;
  Object.assign(result, { npvRub: 1000, discountedPaybackYears: 1 });
  result.items[0]!.n = 6; result.items[0]!.chargers = 2;
  const input = { ...warehouseBaseInput(6), transportWorkflow: "closed-pod-1" as const };
  input.demand.peakPerH = 10;
  const proof = capacityNotEvaluated(input, "Сохранённое измерение");
  Object.assign(proof, { terminal: true, status: "PASS", executionInputKey: "controlled-executor" });
  Object.assign(proof.metrics, { arrivedPerH: 11, deliveredCohort: 21, closedCohort: 20, deliveredCohortPerH: 10.5, closedCohortPerH: 10 });
  spec.spatialEvidence = {
    input, sourceInputKey: simInputIdentity(input), executionInputKey: "nominal-executor", simModelVersion: SPATIAL_MODEL_VERSION,
    assessment: { status: "PARTIAL", terminal: true, headline: "Номинальное окно с ограничением" },
    summary: { fleet: 6, requiredPerH: 10, achievedPerH: 9, queueEnd: 1, waitP95Min: 1 },
    capacityProof: proof, capacityNominalReview: { eligible: true, reasons: [], diagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } },
  };
  const conclusion = { ...saved.conclusion, recommendedScenarioKey: null, headline: "Нет полной рекомендации", bullets: ["Сохранённый риск"] };
  return { conclusion, result, spec, inputs: { [spec.key]: { calculated: input } } };
}

describe("frozen capacity candidate narrative", () => {
  it("explains a real candidate while retaining the raw shortfall, risks and absence of a full recommendation", () => {
    const { conclusion, result, spec, inputs } = qualified(), before = structuredClone({ conclusion, result, spec, inputs });
    const enriched = withCapacityCandidates(conclusion, [result], [spec], inputs);
    expect(enriched.headline).toContain("кандидаты для целевой мощности");
    expect(enriched.recommendedScenarioKey).toBeNull();
    expect(enriched.bullets.join(" ")).toContain("Номинальный прогон: PARTIAL");
    expect(enriched.bullets).toContain("Сохранённый риск");
    expect({ conclusion, result, spec, inputs }).toEqual(before);
  });

  it("does not enrich legacy, stale or unhealthy evidence", () => {
    for (const change of ["missing", "stale", "unhealthy"] as const) {
      const { conclusion, result, spec, inputs } = qualified();
      if (change === "missing") delete spec.spatialEvidence!.capacityProof;
      if (change === "stale") inputs[spec.key]!.calculated.seed++;
      if (change === "unhealthy") spec.spatialEvidence!.capacityNominalReview = { eligible: false, reasons: ["Очередь требует разбора"] };
      expect(withCapacityCandidates(conclusion, [result], [spec], inputs)).toBe(conclusion);
    }
  });

  it("does not turn a physically passing negative financial case into a promising financial candidate", () => {
    const { conclusion, result, spec, inputs } = qualified(); result.npvRub = -1;
    const enriched = withCapacityCandidates(conclusion, [result], [spec], inputs);
    expect(enriched.headline).toBe(conclusion.headline);
    expect(enriched.bullets.join(" ")).toContain("финансовые критерии не выполнены");
    expect(enriched.recommendedScenarioKey).toBeNull();
  });

  it("does not bypass blocked selection or compound scenarios", () => {
    const { conclusion, result, spec, inputs } = qualified();
    expect(withCapacityCandidates(conclusion, [result], [], inputs)).toBe(conclusion);
    result.risks.push({ code: "MANUAL_ADD", severity: "high", text: "Исключён подбором" });
    expect(withCapacityCandidates(conclusion, [result], [spec], inputs)).toBe(conclusion);
    result.risks = []; spec.items.push({ ...spec.items[0]! });
    expect(withCapacityCandidates(conclusion, [result], [spec], inputs)).toBe(conclusion);
  });

  it("retains an existing full recommendation for another scenario", () => {
    const { conclusion, result, spec, inputs } = qualified();
    const existing = { ...conclusion, recommendedScenarioKey: "other" };
    const enriched = withCapacityCandidates(existing, [result], [spec], inputs);
    expect(enriched.recommendedScenarioKey).toBe("other");
    expect(enriched.headline).toBe(existing.headline);
  });
});
