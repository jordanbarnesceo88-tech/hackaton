import { capacityDisplayRows, capacityNominalDisplayRows } from "../../sim/capacity-presentation";
import type { ReportResults } from "./rows";

export function capacityReportRows(results: ReportResults) {
  return results.scenarios.flatMap(scenario => {
    const evidence = scenario.spatialEvidence;
    if (!evidence?.capacityProof) return [];
    return [
      { scenarioName: scenario.name, label: "Номинальный прогон — сохранённый статус", value: evidence.assessment.status, unit: "" },
      { scenarioName: scenario.name, label: "Номинальный прогон — доставлено", value: evidence.assessment.status === "NOT_EVALUATED" ? "Не оценено" : evidence.summary.achievedPerH, unit: "пал./ч" },
      ...[...capacityNominalDisplayRows(evidence.capacityNominalReview), ...capacityDisplayRows(evidence.capacityProof)].map(row => ({ scenarioName: scenario.name, ...row })),
    ];
  });
}
