import { validateProjectSiteLayout } from "./site-layout";
import type { SimProvenance } from "./adapter";
import { simInputIdentity } from "./identity";
import type { SimInput } from "./types";
import { validDemandMix } from "./demand-mix";

export { SPATIAL_MODEL_VERSION } from "./spatial-version";

export type SpatialProjectSnapshot = {
  schemaVersion: "spatial-project-1";
  requestId: string;
  scenarioKey: string;
  scenarioName: string;
  variantId: "calculated" | "minStable" | "byNorm";
  input: SimInput;
  inputKey: string;
  provenance?: SimProvenance[];
  assumedUtilPct?: number;
};

export type SpatialProjectResult = {
  type: "spatial-project-result";
  requestId: string;
  sourceInputKey: string;
  executionInputKey: string;
  assessment: { status: "RUNNING" | "OK" | "PARTIAL" | "FAIL" | "NOT_EVALUATED"; headline: string; terminal: boolean };
  summary: { fleet: number; requiredPerH: number; achievedPerH: number; queueEnd: number; waitP95Min: number };
  simModelVersion: string;
  modified: false;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Неверный формат пространственного снимка");
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 4000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Reject invalid JSON values before cloning; never repair or default a project's input. */
function jsonCopy(value: unknown): unknown {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Во входе есть нечисловое значение");
    if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") throw new Error("Вход должен содержать только JSON-данные");
    return item;
  });
  if (!json || json.length > 2_000_000) throw new Error("Пространственный снимок слишком большой");
  return JSON.parse(json) as unknown;
}

/** Shared by the product and offline viewer. An invalid snapshot never becomes a demo preset. */
export function parseSpatialProjectSnapshot(value: unknown): SpatialProjectSnapshot {
  const v = record(jsonCopy(value));
  if (v.schemaVersion !== "spatial-project-1" || !text(v.requestId, 100) || !/^[a-zA-Z0-9_-]+$/.test(v.requestId) ||
      !text(v.scenarioKey, 200) || !text(v.scenarioName, 1000) ||
      !["calculated", "minStable", "byNorm"].includes(String(v.variantId))) throw new Error("Неподдерживаемый пространственный снимок");
  const input = record(v.input), layout = record(input.layout), robots = record(input.robots), demand = record(input.demand);
  const sourceFields = new Set(["seed", "transportWorkflow", "layout", "siteLayout", "robots", "demand", "loadMassKg", "thresholds", "charge"]);
  if (Object.keys(input).some(field => !sourceFields.has(field))) throw new Error("Снимок должен содержать исходный вход проекта без исполнительных настроек просмотра");
  if (input.transportWorkflow !== undefined && !["closed-pod-1", "single-leg-pallet-1"].includes(String(input.transportWorkflow))) throw new Error("Неподдерживаемая версия транспортного процесса");
  const charge = record(input.charge), thresholds = record(input.thresholds);
  if (!Number.isSafeInteger(input.seed) || !Number.isSafeInteger(robots.count) || Number(robots.count) < 1 || Number(robots.count) > 500) throw new Error("Неверное зерно или число роботов");
  for (const field of ["activeAreaM2", "mainAisleWidthM", "rackAisleWidthM"]) if (!finite(layout[field]) || Number(layout[field]) <= 0) throw new Error("Неверная геометрия проекта");
  for (const field of ["receivingDocksCount", "shippingDocksCount", "chargers"]) if (!Number.isSafeInteger(layout[field]) || Number(layout[field]) < 0) throw new Error("Неверные точки обработки проекта");
  if (Number(layout.receivingDocksCount) < 1 || Number(layout.shippingDocksCount) < 1) throw new Error("В проекте нужны хотя бы одни ворота приёмки и отгрузки; точки не подставляются автоматически");
  for (const field of ["speedMps", "loadedSpeedFactor"]) if (!finite(robots[field]) || Number(robots[field]) <= 0) throw new Error("Неверные параметры робота");
  if (!finite(robots.handlingSec) || robots.handlingSec < 0) throw new Error("Неверное время обработки");
  for (const field of ["autonomyH", "chargeMin", "payloadKg"]) if (robots[field] !== null && (!finite(robots[field]) || Number(robots[field]) <= 0)) throw new Error("Неверные характеристики робота");
  for (const field of ["avgPerH", "peakPerH", "warmupMin", "peakMin"]) if (!finite(demand[field]) || Number(demand[field]) < 0) throw new Error("Неверное окно или нагрузка проекта");
  if (demand.mix !== undefined && !validDemandMix(demand.mix)) throw new Error("Доли приёмки, отгрузки и внутренних перемещений должны быть неотрицательными и давать сумму 1");
  if (demand.storageVacancyShare !== undefined && (!finite(demand.storageVacancyShare) || demand.storageVacancyShare < 0 || demand.storageVacancyShare > 0.9)) throw new Error("Начальная доля свободных мест должна быть от 0 до 0,9");
  if (input.loadMassKg !== null && (!finite(input.loadMassKg) || input.loadMassKg < 0)) throw new Error("Неверная масса груза");
  if (![charge.startSoc, charge.stopSoc].every(n => finite(n) && n >= 0 && n <= 1) || Number(charge.startSoc) >= Number(charge.stopSoc)) throw new Error("Неверные пороги зарядки");
  if (![thresholds.servedShareMin, thresholds.oversizedIdleShare].every(n => finite(n) && n >= 0 && n <= 1) || !finite(thresholds.p95WaitMaxMin) || thresholds.p95WaitMaxMin < 0) throw new Error("Неверные критерии проверки");
  if (input.siteLayout !== undefined) {
    const site = record(input.siteLayout);
    if (![site.widthM, site.heightM].every(n => finite(n) && n > 0) || ![site.receiving, site.shipping, site.chargers].every(Array.isArray)) throw new Error("Неверная явная планировка проекта");
    const problems = validateProjectSiteLayout(site as unknown as NonNullable<SimInput["siteLayout"]>, layout as unknown as SimInput["layout"]);
    if (problems.length) throw new Error(problems.join("; "));
  }
  if (v.inputKey !== simInputIdentity(input as SimInput)) throw new Error("Идентификатор не соответствует входу проекта");
  if (v.assumedUtilPct !== undefined && (!finite(v.assumedUtilPct) || v.assumedUtilPct < 0 || v.assumedUtilPct > 100)) throw new Error("Неверная расчётная загрузка");
  if (v.provenance !== undefined) {
    if (!Array.isArray(v.provenance) || v.provenance.length > 500) throw new Error("Неверные источники параметров");
    for (const item of v.provenance) {
      const p = record(item);
      if (!text(p.field) || !text(p.label) || !["organizer", "research", "estimate", "derived", "choice", "tz", "admin", "user"].includes(String(p.origin)) ||
          !(p.value === null || finite(p.value) || typeof p.value === "string") || !(p.unit === null || typeof p.unit === "string") ||
          !(p.note === undefined || typeof p.note === "string")) throw new Error("Неверная строка происхождения параметра");
    }
  }
  // Whitelist the handoff fields: no project name, user identity, financial data or credentials.
  return {
    schemaVersion: "spatial-project-1", requestId: v.requestId, scenarioKey: v.scenarioKey, scenarioName: v.scenarioName,
    variantId: v.variantId as SpatialProjectSnapshot["variantId"], input: input as SimInput, inputKey: v.inputKey as string,
    ...(v.provenance === undefined ? {} : { provenance: v.provenance as SimProvenance[] }),
    ...(v.assumedUtilPct === undefined ? {} : { assumedUtilPct: v.assumedUtilPct }),
  };
}

export function createSpatialProjectSnapshot(value: Omit<SpatialProjectSnapshot, "schemaVersion" | "inputKey">): SpatialProjectSnapshot {
  return parseSpatialProjectSnapshot({ ...value, schemaVersion: "spatial-project-1", inputKey: simInputIdentity(value.input) });
}

/** Every inbound message is bound to one same-origin window and one opaque launch ticket. */
export function spatialProjectMessageMatches(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  expected: { origin: string; source: MessageEventSource | null; requestId: string },
): boolean {
  return expected.origin !== "null" && expected.source !== null && event.origin === expected.origin && event.source === expected.source &&
    !!event.data && typeof event.data === "object" && event.data.requestId === expected.requestId;
}

export function parseSpatialProjectResult(value: unknown, snapshot: SpatialProjectSnapshot): SpatialProjectResult {
  const v = record(jsonCopy(value)), a = record(v.assessment), s = record(v.summary);
  if (v.type !== "spatial-project-result" || v.requestId !== snapshot.requestId || v.sourceInputKey !== snapshot.inputKey ||
      !text(v.executionInputKey, 1_900_000) || !text(v.simModelVersion, 200) || v.modified !== false ||
      !["OK", "PARTIAL", "FAIL", "NOT_EVALUATED"].includes(String(a.status)) || !text(a.headline) || a.terminal !== true) throw new Error("Ответ 3D не относится к завершённой проверке этого снимка");
  for (const field of ["fleet", "requiredPerH", "achievedPerH", "queueEnd", "waitP95Min"]) if (!finite(s[field]) || Number(s[field]) < 0) throw new Error("В ответе 3D некорректные показатели");
  if (s.fleet !== snapshot.input.robots.count || s.requiredPerH !== snapshot.input.demand.peakPerH) throw new Error("В ответе 3D изменены парк или нагрузка проекта");
  return {
    type: "spatial-project-result", requestId: snapshot.requestId, sourceInputKey: snapshot.inputKey,
    executionInputKey: v.executionInputKey, simModelVersion: v.simModelVersion, modified: false,
    assessment: { status: a.status as SpatialProjectResult["assessment"]["status"], headline: a.headline, terminal: true },
    summary: { fleet: s.fleet as number, requiredPerH: s.requiredPerH as number, achievedPerH: s.achievedPerH as number, queueEnd: s.queueEnd as number, waitP95Min: s.waitP95Min as number },
  };
}
