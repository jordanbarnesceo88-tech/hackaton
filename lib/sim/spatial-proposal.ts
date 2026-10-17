import { processDef } from "../tz/processes";
import { SCENARIO_KEY_RE, SCENARIO_NAME_MAX } from "../projects/validate";
import type { ScenarioSpec } from "../tz/types";
import { simInputIdentity } from "./identity";
import { LAYOUT_LIMITS } from "./layout";
import {
  parseSpatialProjectResult, parseSpatialProjectSnapshot, SPATIAL_MODEL_VERSION,
  type SpatialProjectResult, type SpatialProjectSnapshot,
} from "./spatial-bridge";

export type SpatialScenarioProposal = {
  type: "spatial-scenario-proposal";
  requestId: string;
  originalInputKey: string;
  candidate: SpatialProjectSnapshot;
  result: SpatialProjectResult;
};

/** A different fleet is a new scenario, never a replacement for the original check. */
export function parseSpatialScenarioProposal(value: unknown, originalSnapshot: SpatialProjectSnapshot): SpatialScenarioProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Неверное предложение 3D-сценария");
  const v = value as Record<string, unknown>, original = parseSpatialProjectSnapshot(originalSnapshot);
  if (v.type !== "spatial-scenario-proposal" || v.requestId !== original.requestId || v.originalInputKey !== original.inputKey) throw new Error("Предложение 3D не относится к исходному снимку");
  const candidate = parseSpatialProjectSnapshot(v.candidate);
  if (candidate.input.layout.chargers > LAYOUT_LIMITS.maxPointsPerKind) throw new Error("Число зарядных станций превышает предел финансового сценария");
  if (candidate.requestId !== original.requestId || candidate.scenarioKey !== original.scenarioKey ||
      candidate.scenarioName !== original.scenarioName || candidate.variantId !== original.variantId ||
      JSON.stringify(candidate.provenance) !== JSON.stringify(original.provenance) || candidate.assumedUtilPct !== original.assumedUtilPct) throw new Error("В предложении изменена принадлежность исходного варианта");
  const comparable = structuredClone(candidate.input);
  comparable.robots.count = original.input.robots.count;
  comparable.layout.chargers = original.input.layout.chargers;
  if (simInputIdentity(comparable) !== original.inputKey) throw new Error("Предложение может менять только число роботов и зарядных станций");
  const result = parseSpatialProjectResult(v.result, candidate);
  if (result.simModelVersion !== SPATIAL_MODEL_VERSION || !["OK", "PARTIAL"].includes(result.assessment.status)) throw new Error("Для финансового сценария нужна актуальная завершённая проверка без критических ошибок");
  return { type: "spatial-scenario-proposal", requestId: original.requestId, originalInputKey: original.inputKey, candidate, result };
}

type BuildOptions = {
  source: ScenarioSpec;
  key: string;
  name: string;
  proposal: SpatialScenarioProposal;
  annualCoverageShare: number;
  cashRealizationShare: number;
};

/** Annual coverage and cash conversion are explicit estimates, not extrapolated peak output. */
export function buildSpatialFinancialScenario({ source, key, name, proposal, annualCoverageShare, cashRealizationShare }: BuildOptions): ScenarioSpec {
  if (!SCENARIO_KEY_RE.test(key) || key === source.key || !name.trim() || name.trim().length > SCENARIO_NAME_MAX) throw new Error("Нужны новый ключ и название финансового сценария");
  if (source.kind === "asis") throw new Error("Нельзя изменить парк в сценарии без роботизации");
  for (const share of [annualCoverageShare, cashRealizationShare]) if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error("Доли годового покрытия и денежного эффекта должны быть от 0 до 1");
  const supported = source.items.map((item, index) => processDef(item.process)?.simSupported ? index : -1).filter(index => index >= 0);
  if (supported.length !== 1) throw new Error("Для предложения нужен ровно один моделируемый процесс");
  const candidate = parseSpatialProjectSnapshot(proposal.candidate), result = parseSpatialProjectResult(proposal.result, candidate);
  if (candidate.input.layout.chargers > LAYOUT_LIMITS.maxPointsPerKind) throw new Error("Число зарядных станций превышает предел финансового сценария");
  if (proposal.type !== "spatial-scenario-proposal" || proposal.requestId !== candidate.requestId ||
      candidate.scenarioKey !== source.key || !proposal.originalInputKey || result.simModelVersion !== SPATIAL_MODEL_VERSION ||
      !["OK", "PARTIAL"].includes(result.assessment.status)) throw new Error("Предложение не подтверждает новый вариант исходного сценария");
  const scenario = structuredClone(source);
  scenario.key = key;
  scenario.name = name.trim();
  const item = scenario.items[supported[0]!]!;
  item.quantityOverride = candidate.input.robots.count;
  item.chargersOverride = candidate.input.layout.chargers;
  item.automationCoverageOverride = annualCoverageShare;
  scenario.cashRealizationShare = cashRealizationShare;
  // The economic model consumes the explicit estimates; the short run remains separate evidence.
  scenario.spatialEvidence = {
    sourceInputKey: result.sourceInputKey, executionInputKey: result.executionInputKey,
    simModelVersion: result.simModelVersion, input: structuredClone(candidate.input),
    assessment: result.assessment as NonNullable<ScenarioSpec["spatialEvidence"]>["assessment"],
    summary: result.summary,
  };
  return scenario;
}
