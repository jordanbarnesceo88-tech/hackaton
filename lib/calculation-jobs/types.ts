import type { CalculationJob, CalculationRun, Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TZ_MODEL_VERSION, SIM_MODEL_VERSION } from "../tz/version";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";

export const JOB_LEASE_MS = 20_000;
export const JOB_HEARTBEAT_MS = 5_000;
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_ENGINE_CONTRACT = "durable-calculation-1";

/** Both deployment artifacts consume the same source fingerprint, never merely a label. */
export function engineRelease(): string {
  let fingerprint = process.env.CALCULATION_ENGINE_FINGERPRINT;
  if (fingerprint && !/^alfa-robot\/sha256:[a-f0-9]{64}$/.test(fingerprint)) throw new Error("Некорректный fingerprint сборки движка");
  if (!fingerprint && process.env.NODE_ENV === "production") {
    throw new Error("Нет встроенного fingerprint движка. Выполните production build web и worker из одного выпуска");
  }
  if (!fingerprint) {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "dist-worker", "engine-release.json"), "utf8"));
    if (!/^alfa-robot\/sha256:[a-f0-9]{64}$/.test(manifest.engineRelease)) throw new Error("Invalid engine fingerprint");
    fingerprint = manifest.engineRelease;
  } catch {
    fingerprint = `${JOB_ENGINE_CONTRACT}/${TZ_MODEL_VERSION}/${SIM_MODEL_VERSION}/${SPATIAL_MODEL_VERSION}/development`;
  }
  }
  if (!fingerprint) throw new Error("Fingerprint движка не определён");
  const label = process.env.CALCULATION_ENGINE_RELEASE?.trim();
  return label ? `${fingerprint}/${label}` : fingerprint;
}

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type PublicationState = "NONE" | "PUBLISHED" | "STALE";
export type JobReceiptRun = Pick<CalculationRun, "projectId" | "reservedProjectId" | "publicationState" | "publishedRevision" | "engineRelease" | "purgedAt">;
export type JobReceiptRow = CalculationJob & { run: JobReceiptRun };
export type ClaimedJob = { job: CalculationJob; run: CalculationRun; token: string };
export type JobReceipt = {
  id: string;
  jobId: string;
  runId: string;
  operation: string;
  projectId: string | null;
  reservedProjectId: string | null;
  status: JobStatus;
  stage: string;
  progress: number | null;
  attempts: number;
  safeMessage: string;
  publicationState: PublicationState;
  publishedRevision: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  diagnosticCode: string | null;
  cancelRequestedAt: string | null;
  engineRelease: string;
  resultUrl: string;
};
export type Publication = { projectId: string | null; revision: number | null; state: PublicationState };
export type PublishCalculation<T> = (tx: Prisma.TransactionClient, run: CalculationRun, computed: T) => Promise<Publication>;

export class IdempotencyConflict extends Error {
  readonly status = 409;
  constructor() { super("Этот ключ отправки уже использован с другими данными. Повторите изменённый расчёт с новым ключом"); this.name = "IdempotencyConflict"; }
}
export class JobQueueFull extends Error {
  readonly status = 429;
  readonly retryAfterSec = 5;
  constructor() { super("Очередь расчётов заполнена. Дождитесь завершения активного расчёта; ваши правки не потеряны"); this.name = "JobQueueFull"; }
}

export class JobHistoryFull extends Error {
  readonly status = 429;
  readonly code = "HISTORY_FULL";
  constructor() { super("Достигнут лимит истории расчётов: 200 на пользователя или 2000 на платформу. Удалите ненужные завершённые запуски; сохранённые проекты останутся"); this.name = "JobHistoryFull"; }
}

export class JobStillActive extends Error {
  readonly status = 409;
  readonly code = "JOB_ACTIVE";
  constructor() { super("Сначала отмените активный расчёт и дождитесь завершения отмены"); this.name = "JobStillActive"; }
}

export class JobHistoryRemoved extends Error {
  readonly status = 410;
  readonly code = "HISTORY_REMOVED";
  constructor() { super("Технический результат этого запуска удалён. Старый ключ отправки не запускает расчёт повторно; для нового расчёта используйте новый ключ"); this.name = "JobHistoryRemoved"; }
}
