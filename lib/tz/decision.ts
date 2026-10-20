import type { SimInput, SimSummaryStored } from "../sim/types";
import { simSummaryMatchesInput } from "../sim/identity";
import { capacityEvidenceQualifies, spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import { endQueueLimit } from "../sim/metrics";
import { formatNum } from "../format/rub";
import { coverage } from "./econ/fleet";
import { horizonOf, toNumber, workHours } from "./econ/context";
import { isViableScenario } from "./econ/conclusion";
import { scenarioNorms } from "../report/tz/rows";
import { originLabel } from "./characteristics";
import { processDef } from "./processes";
import type { ProjectResults, ScenarioSpec } from "./types";
import { evaluateCleaningPlan, isCleaningProcess, type CleaningPlanEvaluation } from "./cleaning-zones";

export type DecisionModel = Pick<ProjectResults, "results" | "scenarios" | "normsUsed" | "conclusion" | "paramsUsed" | "methodologySnapshot">;
export type DecisionStatus = "missing" | "refused" | "baseline" | "stale" | "unsupported" | "unverified" | "partial" | "invalid" | "financial-limit" | "suitable";
type SpatialEvidence = NonNullable<ScenarioSpec["spatialEvidence"]>;

/** Presentation data only: all money remains the financial engine's own result. */
export function buildDecision(model: DecisionModel, scenarioKey?: string, expectedInput?: SimInput | null, stale = false, simSummary?: SimSummaryStored | null) {
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
  const capacityQualified = fresh && capacityEvidenceQualifies(evidence, expectedInput);
  const partialFacts: string[] = [];
  const measured = fresh && evidence?.assessment.status === "PARTIAL" ? evidence.summary : null;
  const insufficientOutput = measured !== null && measured.achievedPerH + 1e-8 < measured.requiredPerH;
  const excessiveWait = measured !== null && measured.waitP95Min > evidence!.input.thresholds.p95WaitMaxMin;
  const excessiveQueue = measured !== null && measured.queueEnd > endQueueLimit(measured.requiredPerH);
  if (measured) {
    partialFacts.push(`Завершённые перевозки: ${formatNum(measured.achievedPerH, 1)} из ${formatNum(measured.requiredPerH, 1)} пал./ч.`);
    if (excessiveWait) partialFacts.push(`Ожидание до начала обработки p95: ${formatNum(measured.waitP95Min, 2)} мин при пределе ${formatNum(evidence!.input.thresholds.p95WaitMaxMin, 2)} мин.`);
    if (excessiveQueue) partialFacts.push(`Очередь в конце: ${formatNum(measured.queueEnd, 0)} при пределе ${formatNum(endQueueLimit(measured.requiredPerH), 2)}.`);
  }
  const spatialState = !evidence ? "none" : fresh ? "fresh" : stale || evidenceStale || expectedInput ? "stale" : "unverified";
  const ok = result?.status === "ok" ? result : null;
  // One transport receipt cannot confirm the other positions or processes of a compound scenario.
  const singleItem = ok?.items.length === 1 && spec?.items.length === 1;
  const cleaningItem = singleItem && ok?.items[0]?.cleaning ? ok.items[0] : null;
  const cleaningProfile = cleaningItem ? spec?.items[0]?.cleaningProfile : undefined;
  const cleaningPlanScope = Boolean(spec?.cleaningPlan && ok && spec.items.length && spec.items.every(item => isCleaningProcess(item.process)));
  let cleaningPlan: CleaningPlanEvaluation | null = null;
  let cleaningPlanError = "";
  if (cleaningPlanScope && spec?.cleaningPlan) {
    try {
      const process = processDef(spec.items[0]!.process), baselineFte = process?.headcountParam ? toNumber(model.paramsUsed[process.headcountParam]) : null;
      const cleaningArea = process?.demand?.sumParams[0] ? toNumber(model.paramsUsed[process.demand.sumParams[0]]) : null;
      if (baselineFte === null || cleaningArea === null) throw new Error("Не сохранены численность уборщиков или площадь для проверки зон");
      cleaningPlan = evaluateCleaningPlan(spec.cleaningPlan, { workDaysPerYear: workHours({ params: model.paramsUsed }).D, annualHoursPerFte: norms.annualHoursPerFte, baselineFte, items: spec.items, cleaningAreaM2: cleaningArea });
    } catch (error) { cleaningPlanError = error instanceof Error ? error.message : "План зон не проверен"; }
  }
  const verificationKind = cleaningPlanScope ? cleaningPlan ? "schedule" : "unsupported" : !singleItem ? "unsupported" :
    cleaningItem && cleaningProfile ? "schedule" :
    expectedInput?.transportWorkflow === "closed-pod-1" || (!expectedInput && evidence?.input.transportWorkflow === "closed-pod-1") ? "spatial" :
    expectedInput ? "analytical" : "unsupported";
  const capacityCandidate = verificationKind === "spatial" && capacityQualified;
  const analytical = verificationKind === "analytical" && !stale && !evidenceStale &&
    simSummary?.scenarioKey === selectedKey && simSummaryMatchesInput(simSummary, expectedInput) ? simSummary : null;
  const verified = verificationKind === "spatial" ? fresh && evidence?.assessment.status === "OK" : verificationKind === "analytical" && analytical?.verdict === "CONFIRMED";
  const planWindowH = cleaningPlan ? Math.max(...cleaningPlan.plan.zones.map(zone => zone.windowStartH + zone.windowH)) - Math.min(...cleaningPlan.plan.zones.map(zone => zone.windowStartH)) : null;
  const planCoveredM2PerDay = cleaningPlan?.zones.reduce((sum, zone) => sum + zone.robotAcceptedM2PerDay + zone.machineCoveredM2PerDay + zone.manualCoveredM2PerDay, 0) ?? null;
  const scheduleMetrics = cleaningPlan && planWindowH !== null && planCoveredM2PerDay !== null ? {
    fleet: cleaningPlan.plan.robots.length, achievedPerH: planCoveredM2PerDay / planWindowH,
    requiredPerH: cleaningPlan.demandM2PerDay / planWindowH, queueEnd: null, waitP95Min: null,
  } : cleaningItem?.cleaning && cleaningProfile && cleaningItem.n !== null ? {
    fleet: cleaningItem.n, achievedPerH: cleaningItem.n * cleaningItem.cleaning.capacityM2PerDay / cleaningProfile.windowH,
    requiredPerH: cleaningItem.peakPerHour, queueEnd: null, waitP95Min: null,
  } : null;
  const verificationMetrics = verificationKind === "schedule" ? scheduleMetrics : verificationKind === "spatial" ? fresh && evidence?.assessment.status !== "NOT_EVALUATED" ? evidence?.summary ?? null : null : analytical;
  const cashRealizationShare = spec?.cashRealizationShare ?? 1;
  const processes = (ok?.items ?? []).map(item => {
    const definition = processDef(item.process);
    const itemProfile = spec?.items.find(i => i.process === item.process && i.productSlug === item.productSlug)?.cleaningProfile;
    const zoneProfiles = cleaningPlan?.plan.zones.filter(zone => zone.assignments.some(a => cleaningPlan.plan.robots.find(robot => robot.id === a.robotId)?.productSlug === item.productSlug)).flatMap(zone => zone.assignments.map(a => a.profile)) ?? [];
    const shiftHourObservation = item.thrEvidence?.applied === true && item.thrEvidence.basis === "shift-hour";
    const effectiveUtilization = shiftHourObservation || item.cleaning ? 1 : norms.utilization;
    const effectiveAvailability = shiftHourObservation || item.cleaning ? 1 : norms.availability;
    const analyticCoverage = item.n !== null && item.thrEff !== null
      ? coverage(item.n, item.thrEff, effectiveUtilization, effectiveAvailability, item.peakPerHour) : null;
    return {
      process: item.process, label: definition?.name ?? item.process, productName: item.productName,
      n: item.n, chargers: item.chargers, requiredPerH: item.peakPerHour,
      unit: definition?.throughputUnit ?? "ед./ч", analyticCoverage,
      shiftHourObservation, effectiveUtilization, effectiveAvailability,
      cleaning: Boolean(item.cleaning),
      labourShare: zoneProfiles.length ? Math.min(...zoneProfiles.map(profile => profile.automatableLabourShare)) : itemProfile?.automatableLabourShare ?? norms.laborShareAutomatable,
      labourSource: zoneProfiles.length ? "минимальная доля профилей назначенных зон; итог высвобождения рассчитан позонно, уход и переносы учтены отдельно" : itemProfile ? `рабочий профиль: ${itemProfile.source}, ${itemProfile.date}` : spec?.normOverrides?.laborShareAutomatable !== undefined ? "задано в сценарии" : "норматив модели",
      financialCoverage: item.coverage,
      annualCoverageShare: spec?.items.find(i => i.process === item.process && i.productSlug === item.productSlug)?.automationCoverageOverride ?? null,
      coverageOverridden: spec?.items.find(i => i.process === item.process && i.productSlug === item.productSlug)?.automationCoverageOverride !== undefined,
      releasedFte: item.releasedFte, remainingWorkFte: Math.max(0, item.headcount - item.releasedFte),
      remainingLabourRub: item.remainingLabourRub,
      thrEff: item.thrEff, thrSource: item.thrSource,
    };
  });
  const financialViable = ok !== null && ok.kind !== "asis" && isViableScenario(ok);
  const scheduleFullCoverage = verificationKind === "schedule" && (cleaningPlan ? cleaningPlan.status === "full" : processes.every(p => (p.analyticCoverage ?? 0) >= 1 - 1e-9 && p.financialCoverage >= 1 - 1e-9));
  const scheduleDeficit = cleaningPlan ? cleaningPlan.zones.reduce((sum, zone) => sum + zone.uncoveredM2PerDay, 0) : cleaningItem?.cleaning && cleaningItem.n !== null ? Math.max(0, cleaningItem.demandPerDay - cleaningItem.n * cleaningItem.cleaning.capacityM2PerDay) : 0;
  const scheduleLimit = scheduleDeficit > 1e-8 ? `Расчётный дефицит ${formatNum(scheduleDeficit, 1)} м²/день: площадь и кратность уборки превышают выработку этого парка в заданном окне. `
    : !scheduleFullCoverage ? "Расчётная дневная мощность не снимает заданного ограничения годового охвата; уточните его основание. " : "";
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
  } else if (verificationKind === "schedule") {
    status = financialViable ? "partial" : "financial-limit";
    headline = !financialViable ? "Уборка рассчитана по рабочему профилю; финансовые критерии не выполнены"
      : !scheduleFullCoverage ? "Расчётный профиль не закрывает требуемую уборку полностью"
      : "Условный кандидат по рабочему профилю уборки; результат пилота не подтверждён";
    nextAction = `${scheduleLimit}${cleaningPlan ? `План зон: покрыто ${formatNum(planCoveredM2PerDay!, 1)} из ${formatNum(cleaningPlan.demandM2PerDay, 1)} м²/день роботами, существующими машинами и оставленным персоналом; общий интервал окон ${formatNum(planWindowH!, 1)} ч, включая промежутки. ` : ""}Расписание — прогноз по явным допущениям, не подтверждение 2D/3D. ${!financialViable ? "Сравните реальные затраты и денежную реализацию труда. " : ""}На измерительном пилоте проверьте принятую площадь, качество, ручную доработку, уход и зарядку; успешность пилота и безопасность этим расчётом не подтверждены.${!singleItem ? " Явно выберите модель и зону пилота; его смета охватывает только выбранную модель, а не весь смешанный состав." : ""}`;
  } else if (verificationKind === "unsupported") {
    status = "unsupported"; headline = "Экономика рассчитана; проверка нагрузки этого сценария не поддерживается";
    nextAction = cleaningPlanError || (!singleItem ? "Сценарий содержит несколько позиций: результат одного транспортного прогона не подтверждает весь состав. Уточните нагрузки каждого процесса и проверьте их отдельно."
      : "Для выбранного процесса нет применимой имитационной модели. Согласуйте замеры производительности и условия объекта при обследовании; расчёт экономики остаётся предварительным.");
  } else if (verificationKind === "analytical" && analytical?.verdict === "NOT_CONFIRMED") {
    status = "partial"; headline = "Аналитическая 2D-модель не подтвердила заданную нагрузку";
    nextAction = "Разберите показатели и узкое место аналитической имитации в шаге 7; измените условия и повторите серверный расчёт. 2D-модель не проверяет подхват мобильного стеллажа или пространственную безопасность.";
  } else if (verificationKind === "spatial" && fresh && evidence?.assessment.status === "FAIL") {
    status = "invalid"; headline = "Нельзя обосновать сценарий: нарушены проверки модели";
    nextAction = "Разберите нарушенный критерий и повторите проверку после исправления условий или модели.";
  } else if (verificationKind === "spatial" && fresh && evidence?.assessment.status === "PARTIAL") {
    status = "partial";
    headline = insufficientOutput ? "Измеренный выпуск ниже заданного потока"
      : excessiveWait && excessiveQueue ? "Заданный выпуск достигнут; превышены ожидание и очередь"
      : excessiveWait ? "Заданный выпуск достигнут; превышено ожидание до начала обработки"
      : excessiveQueue ? "Заданный выпуск достигнут; превышена допустимая очередь"
      : "Часть критериев пространственной модели не выполнена";
    nextAction = [...partialFacts, ...(!insufficientOutput && !excessiveWait && !excessiveQueue ? [evidence.assessment.headline] : []),
      capacityCandidate ? "Отдельный контролируемый тест подтвердил целевую мощность этой конфигурации полными циклами. Сравните экономику покупки и RaaS; наблюдённое ограничение номинального окна остаётся в результате и требует проверки на объекте."
        : "Откройте прогон в 3D и проверьте нарушенные критерии перед сравнением изменений."].join(" ");
  } else if (!verified) {
    status = "unverified"; headline = verificationKind === "analytical" ? "Финансы рассчитаны; актуальная аналитическая проверка нагрузки отсутствует"
      : spatialState === "stale" ? "Финансы рассчитаны; пространственная проверка устарела" : "Финансы рассчитаны; выполнение нагрузки в 3D ещё не подтверждено";
    nextAction = verificationKind === "analytical" ? analytical?.assessmentReason ?? "Повторите серверный расчёт текущих условий и проверьте итог аналитической 2D-имитации в шаге 7."
      : fresh && evidence?.assessment.status === "NOT_EVALUATED" ? simSummary?.assessmentReason ?? evidence.assessment.headline
      : "Проверьте текущий сценарий в 3D с тем же парком, зарядками и нагрузкой.";
  } else if (ok.risks.some(r => r.code === "SIM_NOT_CONFIRMED")) {
    status = "partial"; headline = "Проверки нагрузки расходятся — требуется разбор";
    nextAction = "Сопоставьте входы и критерии имитаций: сохранённый риск невыполнения потока нельзя снять одним положительным результатом другой проверки.";
  } else if (!financialViable) {
    status = "financial-limit"; headline = verificationKind === "analytical" ? "Критерии аналитической 2D-модели выполнены; финансовые критерии не выполнены" : "Нагрузка подтверждена моделью; финансовые критерии не выполнены";
    nextAction = "Сравните покупку и услугу, затраты и денежную реализацию труда в пределах существующей модели.";
  } else {
    status = "suitable"; headline = verificationKind === "analytical" ? "Критерии аналитической 2D-модели и финансов выполнены" : "Нагрузка и финансовые критерии модели выполнены";
    nextAction = "Сравните покупку и RaaS. Затем задайте участок, состав, бюджет и критерии пилота.";
  }
  const constraints = ok?.risks.map(r => r.text) ?? [];
  if (evidence && !fresh) constraints.unshift(spatialState === "unverified"
    ? "Сохранённая пространственная проверка показана справочно: без ожидаемого входа её актуальность не установлена."
    : "Сохранённая пространственная проверка не подтверждает текущие условия; её числа относятся к прежнему входу.");
  const sources = [...new Set((ok ? [...ok.capexLines, ...ok.opexLines] : []).map(line => `${line.label}: ${originLabel(line.origin)}${line.originNote ? ` — ${line.originNote}` : ""}${line.overridden ? "; корректировка сценария" : ""}`))];
  const criteria = processes.map(p => ({ label: p.label, requiredPerH: p.requiredPerH, unit: p.unit }));
  const laborDefinition = model.methodologySnapshot?.normDefinitions?.find(def => def.key === "laborShareAutomatable");
  return {
    scenarioKey: result?.key ?? selectedKey ?? null, scenarioName: result?.name ?? "Сценарий не выбран", status, headline, nextAction, capacityCandidate,
    horizonYears, discountRate: norms.discountRate, processes, constraints, sources,
    analyticAssumptions: { utilization: cleaningItem || cleaningPlan ? 1 : norms.utilization, availability: cleaningItem || cleaningPlan ? 1 : norms.availability, laborShare: cleaningPlan ? Math.min(...cleaningPlan.plan.zones.flatMap(zone => zone.assignments.map(a => a.profile.automatableLabourShare))) : cleaningProfile?.automatableLabourShare ?? norms.laborShareAutomatable,
      laborSource: cleaningPlan ? "минимальная доля профилей зон; итог труда рассчитан по зоне с учётом ухода и переносов" : cleaningProfile ? `рабочий профиль: ${cleaningProfile.source}, ${cleaningProfile.date}; ${cleaningProfile.reason}` : spec?.normOverrides?.laborShareAutomatable !== undefined ? "задано в сценарии" : laborDefinition ? originLabel(laborDefinition.origin) : "источник не сохранён" },
    spatial: { state: spatialState, evidence, metrics: evidence && evidence.assessment.status !== "NOT_EVALUATED" ? evidence.summary : null, partialFacts },
    finance: ok ? { capexRub: ok.capexRub, opexYearRub: ok.opexYearRub, effectYearRub: ok.effectYearRub, npvRub: ok.npvRub, paybackYears: ok.paybackYears, discountedPaybackYears: ok.discountedPaybackYears, tcoRub: ok.tcoRub, tcoYears: ok.tcoYears, viable: financialViable } : null,
    cashRealizationShare, cashRealizationExplicit: spec?.cashRealizationShare !== undefined,
    verification: { kind: verificationKind, metrics: verificationMetrics, analytical, supported: verificationKind !== "unsupported", verified, isForecast: verificationKind === "schedule", cleaningPlan: cleaningPlan ? { ...cleaningPlan, coveredM2PerDay: planCoveredM2PerDay!, windowSpanH: planWindowH! } : null },
    pilot: {
      applicable: status === "suitable" || (status === "partial" && financialViable && scheduleFullCoverage && Boolean(singleItem || cleaningPlan)), criteria,
      purpose: verificationKind === "schedule" ? `${cleaningPlan && !singleItem ? "Пилот выбранной модели/зоны: смета не охватывает остальные модели плана. " : ""}Измерительный пилот проверяет принятую площадь, качество, ручной труд и эксплуатационный профиль; расчётное расписание не считается успешной приёмкой.` : status === "suitable" ? "Проверить выбранный вариант на ограниченном участке по его нагрузке и критериям." : "Сначала разрешить показанное ограничение или получить актуальную проверку; пилот не подменяет вывод по сценарию.",
      p95WaitMaxMin: expectedInput?.thresholds.p95WaitMaxMin ?? (fresh ? evidence?.input.thresholds.p95WaitMaxMin : null) ?? null,
      servedShareMin: expectedInput?.thresholds.servedShareMin ?? (fresh ? evidence?.input.thresholds.servedShareMin : null) ?? null,
      preparation: ["Выбрать участок и согласовать границы работы, проходы, связь, питание и размещение зарядок.", "Зафиксировать ручные операции, вмешательства и способ денежной реализации высвобождаемого труда.", "Согласовать ответственных, длительность, критерии приёмки и условия остановки проверки."],
      budgetNote: "Состав, срок, смета и критерии участка задаются в плане пилота выбранного сценария. Неизвестные статьи не означают нулевой бюджет.",
    },
  };
}

export type Decision = ReturnType<typeof buildDecision>;
