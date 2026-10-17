import { createSim, isDone, stepSim } from "../../lib/sim/engine";
import { simInputIdentity } from "../../lib/sim/identity";
import { stableJson } from "../../lib/tz/version";
import { summarize } from "../../lib/sim/metrics";
import type { SimTask } from "../../lib/sim/state";
import { assessWarehouse, type DemoAssessment } from "./assessment";
import type { DemoModel } from "./core";
import { defaultDemoIncidents, incidentSummary } from "./incidents";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic, type DemoTrafficInput } from "./traffic";

export type ComparisonFaultMode = "baseline" | "scripted";
export type WorkloadTask = Pick<SimTask, "id" | "kind" | "arrivalS" | "fromPoint" | "fromX" | "fromY" | "toPoint" | "toX" | "toY">;
export type ComparisonSummary = Omit<ReturnType<typeof summarize>, "inputKey"> & { verdictScope: "intake-sla"; incidentSummary: ReturnType<typeof incidentSummary> };
export type ComparisonContextSummary = { contextKey: string; workloadTraceKey: string; workloadCount: number; chargerCount: number; admissionCap: number; parkingCapacity: number; eligibleMinFleet: number; faultMode: ComparisonFaultMode };
export type ComparisonContext = ComparisonContextSummary & {
  referenceKey: string; fixedInput: DemoTrafficInput; layoutKey: string; seed: number;
  workload: { tasks: WorkloadTask[]; traceKey: string; complete: boolean; finalRng: number | null };
};
export type ComparisonRun = {
  fleet: number; status: "COMPLETE" | "INELIGIBLE" | "INTERRUPTED"; reason?: string;
  summary?: ComparisonSummary; assessment?: DemoAssessment; workloadTraceKey?: string; workloadMatched?: boolean;
  /** Wall-clock duration of this candidate; model clocks below are seconds. */
  elapsedMs: number; observedAtS?: number; endS?: number;
  inputFingerprint?: string;
  finalRng?: number;
  firstWorkloadDifference?: { index: number; expected: WorkloadTask | null; actual: WorkloadTask | null };
};
/** completed counts processed COMPLETE + INELIGIBLE rows; total includes the entire requested interval. */
export type ComparisonProgress = { phase: "prepared" | "candidate" | "progress"; contextSummary?: ComparisonContextSummary; run?: ComparisonRun; completed: number; total: number; nextFleet?: number; elapsedMs: number };
export type FleetComparisonResult = {
  schemaVersion: "warehouse-comparison-1"; status: "COMPLETE" | "PARTIAL" | "INVALID";
  stopReason: "complete" | "budget" | "cancelled" | "workload-mismatch";
  context: ComparisonContext; runs: ComparisonRun[]; elapsedMs: number;
  /** eligibleFleets is the requested eligible domain; completedFleets contains only actual terminal runs. */
  coverage: { requestedMin: number; requestedMax: number; completedFleets: number[]; eligibleFleets: number[]; ineligibleFleets: number[]; incompleteFleet: number | null };
  minimumFleet: number | null; bestTestedPassingFleet: number | null;
  minimumScope: "tested-range" | "eligible-tested-range" | "not-established";
};
export type ComparisonOptions = { minFleet?: number; maxFleet?: number; faultMode?: ComparisonFaultMode; budgetMs?: number; signal?: AbortSignal; onProgress?: (value: ComparisonProgress) => void };

// Display/cache fingerprint only. Workload verification below compares every actual field, not this hash.
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Нет данных для идентификатора сравнения");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function taskTrace(tasks: SimTask[]): WorkloadTask[] {
  return tasks.map(({ id, kind, arrivalS, fromPoint, fromX, fromY, toPoint, toX, toY }) => ({ id, kind, arrivalS, fromPoint, fromX, fromY, toPoint, toX, toY }));
}
function summaryOf(context: ComparisonContext): ComparisonContextSummary {
  const { contextKey, workloadTraceKey, workloadCount, chargerCount, admissionCap, parkingCapacity, eligibleMinFleet, faultMode } = context;
  return { contextKey, workloadTraceKey, workloadCount, chargerCount, admissionCap, parkingCapacity, eligibleMinFleet, faultMode };
}
function validate(reference: DemoModel, options: ComparisonOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Недопустимые параметры сравнения");
  if (!reference || !["complex", "baseline", "capacity-reserve", "insufficient", "increased-flow", "project"].includes(reference.id) || (reference.id === "project" && !reference.projectOrigin) || !reference.input?.robots || !reference.layout || !reference.simModelVersion) throw new Error("Сравнение поддерживается только для рассчитанного склада");
  const minFleet = options.minFleet ?? 1, maxFleet = options.maxFleet ?? 12, faultMode = options.faultMode ?? "baseline", budgetMs = options.budgetMs ?? 30000;
  if (!Number.isInteger(minFleet) || !Number.isInteger(maxFleet) || minFleet < 1 || maxFleet > 60 || minFleet > maxFleet) throw new Error("Диапазон сравнения: целые размеры парка от 1 до 60");
  if (faultMode !== "baseline" && faultMode !== "scripted") throw new Error("Режим отказов: baseline или scripted");
  if (!Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 120000) throw new Error("Бюджет сравнения: от 1 до 120000 мс");
  return { minFleet, maxFleet, faultMode, budgetMs };
}

function prepareContext(reference: DemoModel, maxFleet: number, faultMode: ComparisonFaultMode): ComparisonContext {
  const raw = structuredClone(reference.projectOrigin?.sourceInput ?? reference.financialSourceInput ?? reference.input);
  if (reference.projectOrigin || reference.financialSourceInput) {
    const source = { ...raw, robots: { ...raw.robots, count: reference.input.robots.count } };
    const fields = ["seed", "layout", "robots", "demand", "loadMassKg", "thresholds", "charge"] as const;
    const key = (value: typeof raw) => JSON.stringify(fields.map(field => value[field]));
    if (key(source) !== key(reference.input)) throw new Error("Условия сцены отличаются от исходного сценария; сначала повторите расчёт на согласованных исходных данных");
  }
  raw.robots.count = maxFleet;
  // Rebuild from physical geometry, never augment an already N-specific parking graph again.
  const fixedInput = prepareWarehouseTraffic(raw);
  const physicalPlan = (site: typeof reference.layout) => { const { routingGraph: _routingGraph, ...physical } = site; void _routingGraph; return stableJson(physical); };
  if (physicalPlan(fixedInput.siteLayout!) !== physicalPlan(reference.input.siteLayout ?? reference.layout)) throw new Error("Геометрия сцены отличается от исходного плана; повторите расчёт перед сравнением");
  // Fixed targets 0..3, including for ranges below 4: those candidates are explicitly ineligible.
  fixedInput.demoIncidents = defaultDemoIncidents("warehouse", 4);
  fixedInput.demoIncidents.enabled = faultMode === "scripted";
  if (faultMode === "baseline") fixedInput.demoIncidents.schedule = [];
  const contextKey = fingerprint({ version: "warehouse-comparison-1", model: reference.simModelVersion, input: fixedInput });
  return {
    contextKey, referenceKey: fingerprint({ id: reference.id, model: reference.simModelVersion, input: simInputIdentity(reference.input) }),
    fixedInput, layoutKey: fingerprint(fixedInput.siteLayout), seed: fixedInput.seed, faultMode,
    chargerCount: fixedInput.layout.chargers, admissionCap: fixedInput.demoTraffic.maxActiveRoutes,
    parkingCapacity: fixedInput.demoTraffic.parkingBays.length, eligibleMinFleet: faultMode === "scripted" ? 4 : 1,
    workloadCount: 0, workloadTraceKey: "", workload: { tasks: [], traceKey: "", complete: false, finalRng: null },
  };
}
export function fleetComparisonInput(context: ComparisonContext, fleet: number): DemoTrafficInput {
  if (!Number.isInteger(fleet) || fleet < context.eligibleMinFleet || fleet > context.fixedInput.robots.count) throw new Error("Этот размер парка не входит в применимый диапазон сравнения");
  const input = structuredClone(context.fixedInput);
  input.robots.count = fleet;
  input.demoTraffic.initialPositions = input.demoTraffic.initialPositions.slice(0, fleet);
  return input;
}

/** Ascending enumeration on one frozen site. No monotonicity, binary search or global optimum claim. */
export async function compareWarehouseFleet(reference: DemoModel, options: ComparisonOptions = {}): Promise<FleetComparisonResult> {
  const { minFleet, maxFleet, faultMode, budgetMs } = validate(reference, options);
  const started = performance.now(), deadline = started + budgetMs, context = prepareContext(reference, maxFleet, faultMode), runs: ComparisonRun[] = [];
  const total = maxFleet - minFleet + 1;
  let lastYield = started, lastProgress = started;
  const stop = (): "budget" | "cancelled" | null => options.signal?.aborted ? "cancelled" : performance.now() >= deadline ? "budget" : null;
  const emit = (value: Omit<ComparisonProgress, "elapsedMs" | "completed" | "total">) => options.onProgress?.(structuredClone({ ...value, completed: runs.filter((r) => r.status !== "INTERRUPTED").length, total, elapsedMs: performance.now() - started }));
  const yieldIfNeeded = async () => {
    if (performance.now() - lastYield >= 8) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); lastYield = performance.now(); }
  };
  const finish = (stopReason: FleetComparisonResult["stopReason"]): FleetComparisonResult => {
    const complete = stopReason === "complete" && runs.length === total && runs.every((r) => r.status !== "INTERRUPTED");
    const passed = runs.filter((r) => r.status === "COMPLETE" && r.workloadMatched && r.assessment?.status === "OK").map((r) => r.fleet);
    const best = passed.length ? Math.min(...passed) : null;
    return {
      schemaVersion: "warehouse-comparison-1", status: stopReason === "workload-mismatch" ? "INVALID" : complete ? "COMPLETE" : "PARTIAL", stopReason,
      context, runs, elapsedMs: performance.now() - started,
      coverage: { requestedMin: minFleet, requestedMax: maxFleet, completedFleets: runs.filter((r) => r.status === "COMPLETE").map((r) => r.fleet), eligibleFleets: Array.from({ length: total }, (_, i) => i + minFleet).filter((n) => n >= context.eligibleMinFleet), ineligibleFleets: runs.filter((r) => r.status === "INELIGIBLE").map((r) => r.fleet), incompleteFleet: runs.find((r) => r.status === "INTERRUPTED")?.fleet ?? null },
      minimumFleet: complete ? best : null, bestTestedPassingFleet: best,
      minimumScope: complete && best !== null ? runs.some((r) => r.status === "INELIGIBLE") || minFleet > 1 ? "eligible-tested-range" : "tested-range" : "not-established",
    };
  };

  // The same production arrival/task generator, with work disabled, supplies an independent full trace.
  // One robot is sufficient: no dispatch or robot step can consume RNG in this generation-only pass.
  const generatorInput = structuredClone(context.fixedInput); generatorInput.robots.count = 1;
  const generator = createSim(generatorInput);
  if (generator.precheck !== "ok") throw new Error(`Нагрузка не поддерживается: ${generator.precheck}`);
  while (!isDone(generator)) {
    const reason = stop(); if (reason) return finish(reason);
    for (let i = 0; i < 60 && !isDone(generator); i++) stepSim(generator, 1, undefined, () => false, () => false);
    await yieldIfNeeded();
  }
  const expected = taskTrace(generator.tasks), expectedText = JSON.stringify(expected);
  context.workload = { tasks: expected, traceKey: fingerprint(expected), complete: true, finalRng: generator.rng.a };
  context.workloadCount = expected.length; context.workloadTraceKey = context.workload.traceKey;
  emit({ phase: "prepared", contextSummary: summaryOf(context), nextFleet: minFleet });

  for (let fleet = minFleet; fleet <= maxFleet; fleet++) {
    const reason = stop(); if (reason) return finish(reason);
    if (fleet < context.eligibleMinFleet) {
      const run: ComparisonRun = { fleet, status: "INELIGIBLE", reason: "scripted-targets-require-robots-0-to-3", elapsedMs: 0 };
      runs.push(run); emit({ phase: "candidate", run, nextFleet: fleet < maxFleet ? fleet + 1 : undefined }); continue;
    }
    const candidateStarted = performance.now(), state = createWarehouseTrafficState(fleetComparisonInput(context, fleet));
    emit({ phase: "progress", nextFleet: fleet });
    while (!isDone(state)) {
      const interrupted = stop();
      if (interrupted) {
        const run: ComparisonRun = { fleet, status: "INTERRUPTED", reason: interrupted, elapsedMs: performance.now() - candidateStarted, observedAtS: state.tS, endS: state.endS };
        runs.push(run); emit({ phase: "candidate", run }); return finish(interrupted);
      }
      for (let i = 0; i < 60 && !isDone(state); i++) stepWarehouseTraffic(state);
      if (performance.now() - lastProgress >= 200) { emit({ phase: "progress", nextFleet: fleet }); lastProgress = performance.now(); }
      await yieldIfNeeded();
    }
    const actual = taskTrace(state.tasks), actualText = JSON.stringify(actual);
    const workloadMatched = actualText === expectedText && state.rng.a === context.workload.finalRng;
    const { inputKey, ...metrics } = summarize(state, { scenarioKey: reference.summary.scenarioKey, assumedUtilPct: reference.summary.assumedUtilPct });
    const summary: ComparisonSummary = { ...metrics, incidentSummary: incidentSummary(state), simModelVersion: reference.simModelVersion, verdictScope: "intake-sla" };
    const run: ComparisonRun = { fleet, status: "COMPLETE", summary, assessment: assessWarehouse(state, summary), workloadTraceKey: fingerprint(actual), workloadMatched, inputFingerprint: fingerprint(inputKey), finalRng: state.rng.a, elapsedMs: performance.now() - candidateStarted, observedAtS: state.tS, endS: state.endS };
    if (!workloadMatched) {
      const index = Array.from({ length: Math.max(actual.length, expected.length) }, (_, i) => i).find((i) => JSON.stringify(actual[i]) !== JSON.stringify(expected[i])) ?? -1;
      run.reason = "workload-mismatch";
      run.firstWorkloadDifference = { index, expected: expected[index] ?? null, actual: actual[index] ?? null };
    }
    runs.push(run); emit({ phase: "candidate", run, nextFleet: fleet < maxFleet ? fleet + 1 : undefined });
    if (!workloadMatched) return finish("workload-mismatch");
  }
  return finish("complete");
}

/** Apply the completed row on its exact shared input; never recalculate a different N-specific site. */
export function applyFleetComparison(reference: DemoModel, result: FleetComparisonResult, fleet: number): DemoModel & { comparisonOrigin: { contextKey: string; fleet: number; faultMode: ComparisonFaultMode; workloadTraceKey: string } } {
  if (!result || result.schemaVersion !== "warehouse-comparison-1" || result.status === "INVALID" || !result.context.workload.complete) throw new Error("Нет пригодного результата сравнения");
  if (fingerprint({ id: reference.id, model: reference.simModelVersion, input: simInputIdentity(reference.input) }) !== result.context.referenceKey) throw new Error("Исходный сценарий изменён после сравнения");
  const run = result.runs.find((r) => r.fleet === fleet);
  if (!run || run.status !== "COMPLETE" || !run.workloadMatched || !run.summary || !run.assessment) throw new Error("Этот размер парка не проверен до конца на общей нагрузке");
  const input = fleetComparisonInput(result.context, fleet);
  const inputKey = simInputIdentity(input);
  if (fingerprint(inputKey) !== run.inputFingerprint) throw new Error("Условия сравнения изменены после прогона");
  return {
    ...structuredClone(reference), input, layout: input.siteLayout!, summary: { ...structuredClone(run.summary), inputKey }, assessment: structuredClone(run.assessment), finance: null,
    ...(reference.projectOrigin ? { projectOrigin: { ...structuredClone(reference.projectOrigin), executionInputKey: inputKey } } : {}),
    sources: [...reference.sources, `Сравнение ${result.context.contextKey}: общая инфраструктура, ${result.context.chargerCount} зарядок; режим отказов ${result.context.faultMode}.`],
    assumptions: [...reference.assumptions, `Размер парка ${fleet} проверен на общей карте и нагрузке ${result.context.workloadTraceKey}. Зарядки, граф и лимит выпуска ${result.context.admissionCap} фиксированы. Это проверенный вариант, а не глобальный оптимум; режим отказов ${result.context.faultMode}.`],
    comparisonOrigin: { contextKey: result.context.contextKey, fleet, faultMode: result.context.faultMode, workloadTraceKey: result.context.workloadTraceKey },
  };
}
