import type { PilotAcceptanceCheck, PilotAcceptanceMetric, PilotAcceptanceResult, PilotAcceptanceThresholds, PilotObservation, PilotPlanInput } from "./types";

export type PilotAcceptanceContext = { metric: PilotAcceptanceMetric; productSlug: string; fleet?: number };
const METRICS: readonly string[] = ["accepted-area-m2-day", "completed-operations-hour"];

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Приёмка пилота: требуется JSON-объект");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !keys.includes(key))) throw new Error("Приёмка пилота: неизвестное поле (готовый вердикт не принимается)");
  return data;
}
function text(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Приёмка пилота: неверное поле «${label}»`);
  return value;
}
function quantity(value: unknown, label: string, min: number, max: number, integer = false): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Приёмка пилота: неверное значение «${label}»`);
  return value;
}
function date(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`Приёмка пилота: неверная дата «${label}»`);
  return value;
}
function metric(value: unknown): PilotAcceptanceMetric {
  if (typeof value !== "string" || !METRICS.includes(value)) throw new Error("Приёмка пилота: неизвестная единица результата");
  return value as PilotAcceptanceMetric;
}

export function parsePilotAcceptanceThresholds(value: unknown): PilotAcceptanceThresholds {
  const d = record(value, ["schemaVersion", "scope", "metric", "source", "date", "minAcceptedPerUnit", "minPlanCompletionPct", "maxManualReworkPct", "maxDowntimePct", "maxIncidents", "maxInterventionsPerShift", "minCustomerScore", "minDurationDays"]);
  if (d.schemaVersion !== "pilot-acceptance-1") throw new Error("Неизвестная версия критериев пилота");
  return { schemaVersion: "pilot-acceptance-1", scope: text(d.scope, "участок"), metric: metric(d.metric), source: text(d.source, "источник критериев", 2000), date: date(d.date, "согласование критериев"),
    minAcceptedPerUnit: quantity(d.minAcceptedPerUnit, "целевая выработка", Number.MIN_VALUE, 1_000_000), minPlanCompletionPct: quantity(d.minPlanCompletionPct, "выполнение плана", 0, 100),
    maxManualReworkPct: quantity(d.maxManualReworkPct, "доля ручной доработки", 0, 100), maxDowntimePct: quantity(d.maxDowntimePct, "простой", 0, 100),
    maxIncidents: quantity(d.maxIncidents, "инциденты", 0, 1_000_000, true), maxInterventionsPerShift: quantity(d.maxInterventionsPerShift, "вмешательства за смену", 0, 10000),
    minCustomerScore: quantity(d.minCustomerScore, "оценка заказчика", 0, 5), minDurationDays: quantity(d.minDurationDays, "длительность", 1, 365, true) };
}

export function parsePilotObservation(value: unknown): PilotObservation {
  const d = record(value, ["schemaVersion", "scope", "metric", "productSlug", "fleet", "periodStart", "periodEnd", "observedDays", "dayBasis", "acceptedQuantity", "plannedQuantity", "manualReworkQuantity", "scheduledHours", "downtimeHours", "incidents", "interventions", "shifts", "customerScore", "source", "date"]);
  if (d.schemaVersion !== "pilot-observation-1" || !["working", "calendar"].includes(String(d.dayBasis))) throw new Error("Неизвестная версия или базис дней наблюдений пилота");
  const result: PilotObservation = { schemaVersion: "pilot-observation-1", scope: text(d.scope, "участок"), metric: metric(d.metric), productSlug: text(d.productSlug, "модель робота", 200), fleet: quantity(d.fleet, "фактический парк", 1, 500, true),
    periodStart: date(d.periodStart, "начало периода"), periodEnd: date(d.periodEnd, "конец периода"), observedDays: quantity(d.observedDays, "дни наблюдения", 1, 365, true), dayBasis: d.dayBasis as PilotObservation["dayBasis"],
    acceptedQuantity: quantity(d.acceptedQuantity, "принятый объём", 0, 1_000_000_000), plannedQuantity: quantity(d.plannedQuantity, "плановый объём", Number.MIN_VALUE, 1_000_000_000), manualReworkQuantity: quantity(d.manualReworkQuantity, "ручная повторная работа", 0, 1_000_000_000),
    scheduledHours: quantity(d.scheduledHours, "часы окна наблюдения", Number.MIN_VALUE, 8760), downtimeHours: quantity(d.downtimeHours, "часы простоя", 0, 8760),
    incidents: quantity(d.incidents, "инциденты", 0, 1_000_000, true), interventions: quantity(d.interventions, "вмешательства", 0, 1_000_000, true), shifts: quantity(d.shifts, "наблюдавшиеся смены", 1, 10000, true),
    customerScore: quantity(d.customerScore, "оценка заказчика", 0, 5), source: text(d.source, "источник наблюдений", 2000), date: date(d.date, "дата фиксации результатов") };
  if (result.periodStart && result.periodEnd) {
    const days = (Date.parse(result.periodEnd) - Date.parse(result.periodStart)) / 86400000 + 1;
    if (days < 1 || days > 365) throw new Error("Пилот: период должен составлять от 1 до 365 календарных дней");
    if (result.observedDays !== null && (result.observedDays > days || (result.dayBasis === "calendar" && result.observedDays !== days))) throw new Error("Пилот: число дней не соответствует периоду и выбранному базису");
  }
  if (result.periodEnd && result.date && result.date < result.periodEnd) throw new Error("Пилот: дата фиксации раньше окончания наблюдения");
  if (result.observedDays !== null && result.scheduledHours !== null && result.scheduledHours > result.observedDays * 24) throw new Error("Пилот: окно наблюдения превышает 24 часа на день");
  if (result.downtimeHours !== null && result.scheduledHours !== null && result.downtimeHours > result.scheduledHours) throw new Error("Пилот: простой превышает окно наблюдения");
  if (result.manualReworkQuantity !== null && result.acceptedQuantity !== null && result.manualReworkQuantity > result.acceptedQuantity) throw new Error("Пилот: объём ручной доработки не может превышать принятый объём");
  return result;
}

/** No clock, live catalogue, simulation or client verdict: only the saved agreement and observations. */
export function evaluatePilotAcceptance(plan: PilotPlanInput, expected: PilotAcceptanceContext): PilotAcceptanceResult {
  const t = plan.acceptanceThresholds ? parsePilotAcceptanceThresholds(plan.acceptanceThresholds) : null;
  const o = plan.actualResult ? parsePilotObservation(plan.actualResult) : null;
  const checks: PilotAcceptanceCheck[] = [];
  const missing: string[] = [];
  const incomplete = (key: string, label: string, reason: string) => { missing.push(reason); checks.push({ key, label, status: "INCOMPLETE", actual: null, target: null, unit: "", reason }); };
  if (!t) incomplete("criteria", "Критерии приёмки", "Критерии приёмки не заданы");
  if (!o) incomplete("observations", "Наблюдения", "Фактические результаты пилота не заданы");
  if (t && o) {
    const metadata: string[] = [];
    if (!t.scope.trim() || !o.scope.trim() || t.scope.trim() !== o.scope.trim()) metadata.push("Участок наблюдений должен совпадать с участком критериев");
    if (t.metric !== expected.metric || o.metric !== expected.metric) metadata.push("Единицы наблюдений, критериев и процесса не совпадают");
    if (!expected.productSlug || o.productSlug !== expected.productSlug || o.fleet !== (expected.fleet ?? plan.fleet)) metadata.push("Модель робота или фактический парк не соответствует составу пилота");
    if (o.dayBasis !== plan.dayBasis) metadata.push("Базис дней наблюдений отличается от плана пилота");
    if (!t.source.trim() || !t.date) metadata.push("Не указан источник или дата согласования критериев");
    if (!o.source.trim() || !o.date || !o.periodStart || !o.periodEnd) metadata.push("Не указан источник, дата фиксации или период наблюдений");
    if (metadata.length) metadata.forEach((reason, i) => incomplete(`identity-${i}`, "Границы доказательства", reason));
    else checks.push({ key: "identity", label: "Участок, состав и источник", status: "PASS", actual: null, target: null, unit: "", reason: "Границы наблюдений соответствуют плану; достоверность источника проверяется участниками пилота" });
    const compare = (key: string, label: string, actual: number | null, target: number | null, direction: "min" | "max", unit: string) => {
      if (actual === null || target === null) { incomplete(key, label, `${label}: не заданы ${actual === null ? "наблюдения" : "согласованный порог"}`); return; }
      const pass = direction === "min" ? actual >= target : actual <= target;
      checks.push({ key, label, actual, target, unit, status: pass ? "PASS" : "FAIL", reason: `${actual} ${unit}; требуется ${direction === "min" ? "не менее" : "не более"} ${target} ${unit}` });
    };
    const acceptedRate = o.acceptedQuantity === null ? null : expected.metric === "accepted-area-m2-day" ? o.observedDays === null ? null : o.acceptedQuantity / o.observedDays : o.scheduledHours === null ? null : o.acceptedQuantity / o.scheduledHours;
    compare("accepted", "Принятая выработка", acceptedRate, t.minAcceptedPerUnit, "min", expected.metric === "accepted-area-m2-day" ? "м²/день" : "операций/ч окна");
    compare("plan", "Выполнение плана", o.acceptedQuantity === null || o.plannedQuantity === null ? null : 100 * o.acceptedQuantity / o.plannedQuantity, t.minPlanCompletionPct, "min", "%");
    compare("rework", "Ручная повторная работа", o.manualReworkQuantity === null || o.acceptedQuantity === null ? null : o.acceptedQuantity === 0 ? 0 : 100 * o.manualReworkQuantity / o.acceptedQuantity, t.maxManualReworkPct, "max", "% принятого объёма");
    compare("downtime", "Доля простоя", o.downtimeHours === null || o.scheduledHours === null ? null : 100 * o.downtimeHours / o.scheduledHours, t.maxDowntimePct, "max", "% окна");
    compare("incidents", "Инциденты", o.incidents, t.maxIncidents, "max", "за период");
    compare("interventions", "Вмешательства", o.interventions === null || o.shifts === null ? null : o.interventions / o.shifts, t.maxInterventionsPerShift, "max", "за смену");
    compare("score", "Оценка заказчика", o.customerScore, t.minCustomerScore, "min", "из 5");
    compare("duration", "Длительность наблюдений", o.observedDays, t.minDurationDays, "min", plan.dayBasis === "working" ? "рабочих дней" : "календарных дней");
  }
  return { status: checks.some(c => c.status === "INCOMPLETE") ? "INCOMPLETE" : checks.some(c => c.status === "FAIL") ? "FAIL" : "PASS", checks, missing, reasons: checks.filter(c => c.status !== "PASS").map(c => c.reason) };
}
