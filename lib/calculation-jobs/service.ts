import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { CalculationRun, Prisma, PrismaClient } from "@prisma/client";
import { checkCalcInput, facilityOf } from "../api/calc";
import { isPlainObject, unknownFields } from "../api/http";
import { applyDefaults } from "../tz/params/schema";
import { hasErrors, validateParamValues } from "../tz/params/validate";
import { processesForFacility } from "../tz/processes";
import { stableJson } from "../tz/version";
import type { PendingChange, ScenarioSpec } from "../tz/types";
import { getProject, persistNewProject, persistProjectCalculation, ProjectRevisionConflict, type ParamsSource } from "../projects/queries";
import { loadLiveInputs, resultsFromInputsAsync, type ComputedProject, type ComputeProjectInput, type LiveInputs } from "../projects/recalc";
import { projectInputSizeIssue } from "../projects/payload-limit";
import { sanitizeProjectName, validProjectRevision, validatePendingChanges, validateScenarioSpecs } from "../projects/validate";
import { assertQueueCapacity, enqueueWithinTransaction, findIdempotent, lockEnqueueAdmission } from "./store";
import { engineRelease, type JobReceipt } from "./types";

export type CalculationRequest =
  | { operation: "CREATE"; name: string; objectName?: string | null; facility: string; params?: unknown; scenarios?: unknown; paramsSource?: ParamsSource }
  | { operation: "CALCULATE"; facility: string; params?: unknown; scenarios?: unknown }
  | { operation: "SAVE"; projectId: string; expectedRevision: number; name?: string; params: unknown; scenarios: unknown; changes?: unknown }
  | { operation: "RECALCULATE"; projectId: string; expectedRevision: number };

export type FrozenCalculationInput = {
  schemaVersion: 1;
  operation: CalculationRequest["operation"];
  input: Omit<ComputeProjectInput, "signal" | "now">;
  live: LiveInputs;
  publication?: {
    projectId?: string;
    reservedProjectId?: string;
    expectedRevision?: number;
    name?: string;
    objectName?: string | null;
    paramsSource?: ParamsSource;
    changes?: PendingChange[];
  };
};

export class CalculationRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "CalculationRequestError";
  }
}

const FIELDS = {
  CREATE: new Set(["operation", "name", "objectName", "facility", "params", "scenarios", "paramsSource"]),
  CALCULATE: new Set(["operation", "facility", "params", "scenarios"]),
  SAVE: new Set(["operation", "projectId", "expectedRevision", "name", "params", "scenarios", "changes"]),
  RECALCULATE: new Set(["operation", "projectId", "expectedRevision"]),
};

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function intentOf(raw: unknown): CalculationRequest {
  if (!isPlainObject(raw) || typeof raw.operation !== "string" || !Object.hasOwn(FIELDS, raw.operation)) {
    throw new CalculationRequestError(422, "operation — CREATE, SAVE, RECALCULATE или CALCULATE");
  }
  const fields = FIELDS[raw.operation as keyof typeof FIELDS];
  const extra = unknownFields(raw, fields);
  if (extra.length) throw new CalculationRequestError(422, `Неизвестные поля: ${extra.join(", ")}`);
  return raw as unknown as CalculationRequest;
}

function paramsSourceOf(raw: unknown): ParamsSource {
  if (raw === undefined) return { kind: "api" };
  if (!isPlainObject(raw) || unknownFields(raw, new Set(["kind", "fileName"])).length ||
    !["manual", "upload", "api", "demo"].includes(String(raw.kind)) ||
    (raw.fileName !== undefined && (typeof raw.fileName !== "string" || raw.fileName.length > 255))) {
    throw new CalculationRequestError(422, "paramsSource — источник manual, upload, api или demo; имя файла не длиннее 255 символов");
  }
  return { kind: raw.kind as ParamsSource["kind"], ...(typeof raw.fileName === "string" ? { fileName: raw.fileName } : {}) };
}

async function prepareFrozenInput(tx: Prisma.TransactionClient, ownerId: string, request: CalculationRequest): Promise<FrozenCalculationInput> {
  if (request.operation === "CREATE" || request.operation === "CALCULATE") {
    const facility = facilityOf(request.facility);
    if (!facility) throw new CalculationRequestError(422, "facility — warehouse, airport или medical");
    const live = await loadLiveInputs(tx, facility);
    const checked = checkCalcInput(live, facility, request.params, request.scenarios);
    if (!checked.ok) throw new CalculationRequestError(422, checked.error, checked.details);
    const frozen: FrozenCalculationInput = { schemaVersion: 1, operation: request.operation, live,
      input: { facility, params: checked.params, ...(checked.scenarios ? { scenarios: checked.scenarios } : {}) } };
    if (request.operation === "CREATE") {
      const name = sanitizeProjectName(request.name);
      if (!name) throw new CalculationRequestError(422, "Название проекта — от 1 до 120 символов");
      if (request.objectName !== undefined && request.objectName !== null &&
        (typeof request.objectName !== "string" || request.objectName.trim().length > 200)) {
        throw new CalculationRequestError(422, "Название объекта — строка не длиннее 200 символов");
      }
      frozen.publication = { reservedProjectId: randomUUID(), name,
        objectName: request.objectName?.trim() || null, paramsSource: paramsSourceOf(request.paramsSource) };
    }
    return frozen;
  }

  if (typeof request.projectId !== "string" || !request.projectId || request.projectId.length > 128) {
    throw new CalculationRequestError(404, "Проект не найден");
  }
  if (!validProjectRevision(request.expectedRevision)) throw new CalculationRequestError(428, "Для записи требуется expectedRevision проекта");
  const project = await getProject(tx, request.projectId, ownerId);
  if (!project) throw new CalculationRequestError(404, "Проект не найден");
  if (project.isDemo) throw new CalculationRequestError(422, "Демонстрационный проект доступен только для чтения — создайте копию");
  if (project.revision !== request.expectedRevision) throw new CalculationRequestError(409, new ProjectRevisionConflict().message);
  const live = await loadLiveInputs(tx, project.facility);
  const params = request.operation === "SAVE" ? request.params : project.params;
  if (!isPlainObject(params)) throw new CalculationRequestError(422, "Параметры объекта не переданы");
  const checked = validateParamValues(live.paramDefs, params, { origin: "manual" });
  if (hasErrors(checked.issues)) throw new CalculationRequestError(422, "Параметры объекта не прошли проверку", { issues: checked.issues });

  let scenarios: ScenarioSpec[] = project.scenarios;
  let changes: PendingChange[] = [];
  let name: string | undefined;
  if (request.operation === "SAVE") {
    const productSlugs = new Set(live.products.map(p => p.slug));
    for (const slug of Object.keys(project.results?.productSnapshots ?? {})) productSlugs.add(slug);
    const specs = validateScenarioSpecs(request.scenarios, project.facility, productSlugs,
      processesForFacility(project.facility).map(p => p.slug));
    if (!specs.ok) throw new CalculationRequestError(422, "Сценарии не прошли проверку", { errors: specs.errors });
    scenarios = specs.value;
    const pending = validatePendingChanges(request.changes ?? []);
    if (!pending.ok) throw new CalculationRequestError(422, "Журнал корректировок не принят", { errors: pending.errors });
    changes = pending.value;
    if (request.name !== undefined) {
      name = sanitizeProjectName(request.name) ?? undefined;
      if (!name) throw new CalculationRequestError(422, "Название проекта — от 1 до 120 символов");
    }
  }
  return { schemaVersion: 1, operation: request.operation, live,
    input: { facility: project.facility, params: applyDefaults(live.paramDefs, checked.values), scenarios,
      snapshot: request.operation === "SAVE" && project.results
        ? { productSnapshots: project.results.productSnapshots, normsUsed: project.results.normsUsed } : null },
    publication: { projectId: project.id, expectedRevision: request.expectedRevision, changes, ...(name ? { name } : {}) } };
}

/** The intent lookup precedes catalogue/revision checks so retry returns the committed receipt. */
export async function enqueueCalculation(db: PrismaClient, ownerId: string, raw: unknown, idempotencyKey: string): Promise<JobReceipt> {
  if (typeof ownerId !== "string" || !ownerId) throw new CalculationRequestError(401, "Войдите в аккаунт");
  const sizeIssue = projectInputSizeIssue(raw);
  if (sizeIssue) throw new CalculationRequestError(413, sizeIssue);
  if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    throw new CalculationRequestError(422, "Передайте Idempotency-Key: уникальный ключ операции до 128 символов");
  }
  const request = intentOf(raw);
  const requestHash = digest(request);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await lockEnqueueAdmission(tx);
        const existing = await findIdempotent(tx, ownerId, idempotencyKey, requestHash);
        if (existing) return existing;
        await assertQueueCapacity(tx, ownerId);
        const payload = await prepareFrozenInput(tx, ownerId, request);
        // Bound retained, server-expanded inputs too; never silently truncate a snapshot.
        if (Buffer.byteLength(stableJson(payload), "utf8") > 16 * 1024 * 1024) {
          throw new CalculationRequestError(413, "Полный снимок расчёта превышает 16 МиБ — сократите число сценариев или разделите проект");
        }
        return enqueueWithinTransaction(tx, { ownerId, operation: request.operation, idempotencyKey, requestHash,
          inputHash: digest(payload), payload: payload as unknown as Prisma.InputJsonValue,
          projectId: payload.publication?.projectId, baseRevision: payload.publication?.expectedRevision,
          reservedProjectId: payload.publication?.reservedProjectId, engineRelease: engineRelease() });
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 });
    } catch (error) {
      const code = isPlainObject(error) ? error.code : (error as { code?: unknown } | null)?.code;
      // Serializable also protects quota predicates when a waiter's snapshot predates the winner.
      if (attempt < 4 && (code === "P2034" || code === "P2002")) {
        await delay((attempt + 1) * 5);
        continue;
      }
      throw error;
    }
  }
}

function frozenInput(raw: unknown): FrozenCalculationInput {
  if (!isPlainObject(raw) || raw.schemaVersion !== 1 || !isPlainObject(raw.input) || !isPlainObject(raw.live) ||
    typeof raw.operation !== "string" || !Object.hasOwn(FIELDS, raw.operation)) {
    throw new Error("Unsupported calculation input snapshot");
  }
  return raw as unknown as FrozenCalculationInput;
}

/** Worker uses only the server-resolved immutable envelope; it never reloads live inputs. */
export async function computeFrozenCalculation(payload: unknown, signal?: AbortSignal, onStage?: (stage: string) => void): Promise<ComputedProject> {
  const frozen = frozenInput(payload);
  return resultsFromInputsAsync(frozen.live, { ...frozen.input, signal }, { onStage });
}

/** Called only after the worker's lease/cancellation lock, inside that same final transaction. */
export async function publishFrozenCalculation(tx: Prisma.TransactionClient, run: CalculationRun, computed: ComputedProject): Promise<{
  projectId: string | null; revision: number | null; state: "PUBLISHED" | "STALE" | "NONE";
}> {
  const frozen = frozenInput(run.input);
  if (frozen.operation !== run.operation) throw new Error("Calculation operation mismatch");
  if (frozen.operation === "CALCULATE") return { projectId: null, revision: null, state: "NONE" };
  const publication = frozen.publication;
  if (!publication) throw new Error("Calculation publication metadata missing");
  if (frozen.operation === "CREATE") {
    if (!publication.reservedProjectId || !publication.name) throw new Error("Calculation create metadata missing");
    const saved = await persistNewProject(tx, { userId: run.ownerId, id: publication.reservedProjectId,
      name: publication.name, objectName: publication.objectName ?? null, facility: frozen.input.facility,
      params: frozen.input.params, paramsSource: publication.paramsSource ?? { kind: "api" } }, computed.results);
    return { projectId: saved.id, revision: 0, state: "PUBLISHED" };
  }
  if (!publication.projectId || !validProjectRevision(publication.expectedRevision)) throw new Error("Calculation revision metadata missing");
  try {
    const saved = await persistProjectCalculation(tx, { projectId: publication.projectId, userId: run.ownerId,
      expectedRevision: publication.expectedRevision, facility: frozen.input.facility,
      params: frozen.input.params, scenarios: frozen.input.scenarios ?? [], changes: publication.changes ?? [],
      live: frozen.live, snapshot: null, name: publication.name }, computed);
    return { projectId: publication.projectId, revision: saved.revision, state: "PUBLISHED" };
  } catch (error) {
    if (!(error instanceof ProjectRevisionConflict)) throw error;
    return { projectId: publication.projectId, revision: null, state: "STALE" };
  }
}
