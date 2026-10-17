import type { SimInput } from "../sim/types";
import { spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import { coverage } from "./econ/fleet";
import { horizonOf } from "./econ/context";
import { isViableScenario } from "./econ/conclusion";
import { scenarioNorms } from "../report/tz/rows";
import { originLabel } from "./characteristics";
import { processDef } from "./processes";
import { normDef } from "./norms";
import type { ProjectResults, ScenarioSpec } from "./types";

export type DecisionModel = Pick<ProjectResults, "results" | "scenarios" | "normsUsed" | "conclusion" | "paramsUsed">;
export type DecisionStatus = "missing" | "refused" | "baseline" | "stale" | "unverified" | "partial" | "invalid" | "financial-limit" | "suitable";
type SpatialEvidence = NonNullable<ScenarioSpec["spatialEvidence"]>;

/** Presentation data only: all money remains the financial engine's own result. */
export function buildDecision(model: DecisionModel, scenarioKey?: string, expectedInput?: SimInput | null, stale = false) {
  const recommended = model.results.find(r => r.key === model.conclusion.recommendedScenarioKey);
  const selectedKey = scenarioKey ?? recommended?.key ?? model.results.find(r => r.kind !== "asis")?.key;
  const result = model.results.find(r => r.key === selectedKey) ?? null;
  const spec = model.scenarios.find(s => s.key === selectedKey);
  const norms = scenarioNorms(model, selectedKey ?? "");
  let horizonYears: number | null = null;
  try { horizonYears = horizonOf({ params: model.paramsUsed }, norms).H; } catch { /* Invalid inputs must not acquire a default financial horizon. */ }
  const evidence: SpatialEvidence | null = spec?.spatialEvidence ?? null;
  const evidenceStale = result?.risks.some(r => r.code === "SPATIAL_STALE") ?? false;
  const fresh = !stale && !evidenceStale && spatialEvidenceMatchesInput(evidence, expectedInput);
  const spatialState = !evidence ? "none" : fresh ? "fresh" : stale || evidenceStale || expectedInput ? "stale" : "unverified";
  const ok = result?.status === "ok" ? result : null;
  const cashRealizationShare = spec?.cashRealizationShare ?? 1;
  const processes = (ok?.items ?? []).map(item => {
    const definition = processDef(item.process);
    const analyticCoverage = item.n !== null && item.thrEff !== null
      ? coverage(item.n, item.thrEff, norms.utilization, norms.availability, item.peakPerHour) : null;
    return {
      process: item.process, label: definition?.name ?? item.process, productName: item.productName,
      n: item.n, chargers: item.chargers, requiredPerH: item.peakPerHour,
      unit: definition?.throughputUnit ?? "ед./ч", analyticCoverage,
      financialCoverage: item.coverage,
      annualCoverageShare: spec?.items.find(i => i.process === item.process && i.productSlug === item.productSlug)?.automationCoverageOverride ?? null,
      coverageOverridden: spec?.items.find(i => i.process === item.process && i.productSlug === item.productSlug)?.automationCoverageOverride !== undefined,
      releasedFte: item.releasedFte, remainingWorkFte: Math.max(0, item.headcount - item.releasedFte),
      remainingLabourRub: item.remainingLabourRub,
      thrEff: item.thrEff, thrSource: item.thrSource,
    };
  });
  const financialViable = ok !== null && ok.kind !== "asis" && isViableScenario(ok);
  let status: DecisionStatus, headline: string, nextAction: string;
  if (!result) {
    status = "missing"; headline = "Выберите рассчитанный сценарий для решения";
    nextAction = "Добавьте или выберите сценарий покупки либо услуги.";
  } else if (stale) {
    status = "stale"; headline = "Условия изменены — результат требует пересчёта";
    nextAction = "Пересчитайте условия; ниже показан предыдущий расчёт.";
  } else if (!ok) {
    status = "refused"; headline = "По этому сценарию расчёт не выполнен";
    nextAction = result.status === "refused" ? result.refusal.message : "Исправьте входные данные сценария.";
  } else if (ok.kind === "asis") {
    status = "baseline"; headline = "Текущий процесс без роботов — база сравнения";
    nextAction = "Сравните его стоимость с выбранным сценарием роботизации.";
  } else if (ok.risks.some(r => r.code === "MANUAL_ADD")) {
    status = "invalid"; headline = "Применимость выбранной техники не подтверждена подбором";
    nextAction = "Разберите причину исключения техники из подбора; финансовые числа ниже оставлены для сравнения.";
  } else if (fresh && evidence?.assessment.status === "FAIL") {
    status = "invalid"; headline = "Нельзя обосновать сценарий: нарушены проверки модели";
    nextAction = "Разберите нарушенный критерий и повторите проверку после исправления условий или модели.";
  } else if (fresh && evidence?.assessment.status === "PARTIAL") {
    status = "partial"; headline = "Парк не выполняет всю заданную нагрузку";
    nextAction = "Разберите ограничения в 3D и сравните варианты на одинаковых условиях. Причина не определяется автоматически числом роботов.";
  } else if (!fresh || evidence?.assessment.status !== "OK") {
    status = "unverified"; headline = spatialState === "stale" ? "Финансы рассчитаны; пространственная проверка устарела" : "Финансы рассчитаны; выполнение нагрузки в 3D ещё не подтверждено";
    nextAction = "Проверьте текущий сценарий в 3D с тем же парком, зарядками и нагрузкой.";
  } else if (ok.risks.some(r => r.code === "SIM_NOT_CONFIRMED")) {
    status = "partial"; headline = "Проверки нагрузки расходятся — требуется разбор";
    nextAction = "Сопоставьте входы и критерии имитаций: сохранённый риск невыполнения потока нельзя снять одним положительным результатом другой проверки.";
  } else if (!financialViable) {
    status = "financial-limit"; headline = "Нагрузка подтверждена моделью; финансовые критерии не выполнены";
    nextAction = "Сравните покупку и услугу, затраты и денежную реализацию труда в пределах существующей модели.";
  } else {
    status = "suitable"; headline = "Нагрузка и финансовые критерии модели выполнены";
    nextAction = "Сравните покупку и RaaS. Затем задайте участок, состав, бюджет и критерии пилота.";
  }
  const constraints = ok?.risks.map(r => r.text) ?? [];
  if (evidence && !fresh) constraints.unshift(spatialState === "unverified"
    ? "Сохранённая пространственная проверка показана справочно: без ожидаемого входа её актуальность не установлена."
    : "Сохранённая пространственная проверка не подтверждает текущие условия; её числа относятся к прежнему входу.");
  const sources = [...new Set((ok ? [...ok.capexLines, ...ok.opexLines] : []).map(line => `${line.label}: ${originLabel(line.origin)}${line.originNote ? ` — ${line.originNote}` : ""}${line.overridden ? "; корректировка сценария" : ""}`))];
  const criteria = processes.map(p => ({ label: p.label, requiredPerH: p.requiredPerH, unit: p.unit }));
  return {
    scenarioKey: result?.key ?? selectedKey ?? null, scenarioName: result?.name ?? "Сценарий не выбран", status, headline, nextAction,
    horizonYears, discountRate: norms.discountRate, processes, constraints, sources,
    analyticAssumptions: { utilization: norms.utilization, availability: norms.availability, laborShare: norms.laborShareAutomatable,
      laborSource: spec?.normOverrides?.laborShareAutomatable !== undefined ? "задано в сценарии" : originLabel(normDef("laborShareAutomatable").origin) },
    spatial: { state: spatialState, evidence, metrics: evidence && evidence.assessment.status !== "NOT_EVALUATED" ? evidence.summary : null },
    finance: ok ? { capexRub: ok.capexRub, opexYearRub: ok.opexYearRub, effectYearRub: ok.effectYearRub, npvRub: ok.npvRub, paybackYears: ok.paybackYears, discountedPaybackYears: ok.discountedPaybackYears, tcoRub: ok.tcoRub, tcoYears: ok.tcoYears, viable: financialViable } : null,
    cashRealizationShare, cashRealizationExplicit: spec?.cashRealizationShare !== undefined,
    pilot: {
      applicable: status === "suitable", criteria,
      purpose: status === "suitable" ? "Проверить выбранный вариант на ограниченном участке по его нагрузке и критериям." : "Сначала разрешить показанное ограничение или получить актуальную проверку; пилот не подменяет вывод по сценарию.",
      p95WaitMaxMin: expectedInput?.thresholds.p95WaitMaxMin ?? (fresh ? evidence?.input.thresholds.p95WaitMaxMin : null) ?? null,
      servedShareMin: expectedInput?.thresholds.servedShareMin ?? (fresh ? evidence?.input.thresholds.servedShareMin : null) ?? null,
      preparation: ["Выбрать участок и согласовать границы работы, проходы, связь, питание и размещение зарядок.", "Зафиксировать ручные операции, вмешательства и способ денежной реализации высвобождаемого труда.", "Согласовать ответственных, длительность, критерии приёмки и условия остановки проверки."],
      budgetNote: "Состав, срок, смета и критерии участка задаются в плане пилота выбранного сценария. Неизвестные статьи не означают нулевой бюджет.",
    },
  };
}

export type Decision = ReturnType<typeof buildDecision>;
