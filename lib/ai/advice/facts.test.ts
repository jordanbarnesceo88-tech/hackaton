import { describe, expect, it } from "vitest";
import { fixtureResults } from "@/lib/report/tz/test-fixtures";
import type { ReportResults } from "@/lib/report/tz/rows";
import { buildAdviceFacts } from "./facts";
import { adviceFactsHash } from "./hash";

const results = fixtureResults() as ReportResults;

describe("buildAdviceFacts", () => {
  const facts = buildAdviceFacts(results);

  it("выбранный платформой сценарий идёт отдельно со всеми рисками по убыванию важности", () => {
    const chosen = results.results.find((r) => r.key === results.conclusion.recommendedScenarioKey)!;
    expect(facts.recommended?.name).toBe(chosen.name);
    expect(facts.recommended?.risks).toHaveLength(chosen.risks.length);
    const order = { high: 0, medium: 1, low: 2 };
    const severities = facts.recommended!.risks.map((r) => order[r.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it("у альтернатив — главный риск, выбранного среди них нет", () => {
    expect(facts.alternatives.map((a) => a.name)).not.toContain(facts.recommended?.name);
    expect(facts.alternatives).toHaveLength(results.results.length - 1);
    for (const a of facts.alternatives) expect(a.risks.length).toBeLessThanOrEqual(1);
  });

  it("показатели — подписи и ячейки таблицы сценариев отчёта, без прочерков и рисков", () => {
    const metrics = facts.recommended!.metrics;
    expect(Object.keys(metrics)).toEqual(expect.arrayContaining(["CAPEX", "NPV", "Состав оборудования"]));
    expect(Object.keys(metrics).some((label) => label.startsWith("TCO за"))).toBe(true);
    expect(Object.keys(metrics)).not.toContain("Риски");
    for (const a of [facts.recommended!, ...facts.alternatives]) expect(Object.values(a.metrics)).not.toContain("—");
  });

  it("без выбора платформы рекомендуемого нет, у альтернатив до трёх рисков", () => {
    const none = buildAdviceFacts({ ...results, conclusion: { ...results.conclusion, recommendedScenarioKey: null } });
    expect(none.recommended).toBeNull();
    expect(none.alternatives).toHaveLength(results.results.length);
    expect(Math.max(...none.alternatives.map((a) => a.risks.length))).toBeLessThanOrEqual(3);
    expect(none.platformConclusion.headline).toBe(results.conclusion.headline);
  });

  it("ключ один для тех же фактов и модели, иначе другой", () => {
    expect(adviceFactsHash(facts, "m")).toBe(adviceFactsHash(buildAdviceFacts(results), "m"));
    expect(adviceFactsHash(facts, "m")).not.toBe(adviceFactsHash(facts, "other"));
    expect(adviceFactsHash(facts, "m")).not.toBe(adviceFactsHash({ ...facts, object: "Магазин" }, "m"));
  });
});
