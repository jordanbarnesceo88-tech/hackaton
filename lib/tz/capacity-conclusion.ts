import { formatNum, formatRub } from "../format/rub";
import { capacityEvidenceQualifies } from "../sim/spatial-evidence";
import type { SimInput } from "../sim/types";
import { isViableScenario } from "./econ/conclusion";
import type { Conclusion, ScenarioResult, ScenarioSpec } from "./types";

/** Written only during calculation; archives retain their original conclusion unchanged. */
export function withCapacityCandidates(
  conclusion: Conclusion,
  results: readonly ScenarioResult[],
  eligibleSpecs: readonly ScenarioSpec[],
  simInputs: Readonly<Record<string, { calculated: SimInput | null }>>,
): Conclusion {
  const candidates = eligibleSpecs.flatMap(spec => {
    const result = results.find(row => row.key === spec.key);
    if (spec.items.length !== 1 || result?.status !== "ok" || result.kind === "asis" || result.items.length !== 1 ||
      result.risks.some(risk => ["MANUAL_ADD", "SPATIAL_STALE"].includes(risk.code)) ||
      !capacityEvidenceQualifies(spec.spatialEvidence, simInputs[spec.key]?.calculated)) return [];
    return [{ spec, result }];
  });
  if (!candidates.length) return conclusion;
  const viable = candidates.filter(candidate => isViableScenario(candidate.result));
  return {
    ...conclusion,
    headline: conclusion.recommendedScenarioKey === null && viable.length > 0
      ? "Найдены финансово перспективные кандидаты для целевой мощности по контролируемому тесту. Сравните их условия и ограничения номинального прогона перед выбором пилота."
      : conclusion.headline,
    bullets: [
      ...candidates.map(({ spec, result }) => {
        const evidence = spec.spatialEvidence!, proof = evidence.capacityProof!;
        return `Кандидат по модельной мощности «${spec.name}»: ${proof.input.robots.count} роботов, ${proof.input.layout.chargers} зарядки; закрытые циклы ${formatNum(proof.metrics.closedCohortPerH, 2)} при цели ${formatNum(proof.metrics.requiredPerH, 2)} пал./ч. Номинальный прогон: ${evidence.assessment.status}, доставлено ${formatNum(evidence.summary.achievedPerH, 2)} пал./ч. NPV ${formatRub(result.npvRub)}; финансовые критерии ${isViableScenario(result) ? "выполнены" : "не выполнены"}.`;
      }),
      "Проверка мощности относится к объявленному тестовому профилю. Статус номинального прогона сохранён; выбор кандидата для пилота не является рекомендацией полного внедрения.",
      ...conclusion.bullets,
    ],
  };
}
