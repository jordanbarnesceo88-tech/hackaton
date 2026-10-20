import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  engineRelease, IdempotencyConflict, JobQueueFull, JobHistoryFull, JobStillActive, JobHistoryRemoved, JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS, type ClaimedJob, type JobReceipt, type JobReceiptRow,
  type PublishCalculation, type PublicationState, type JobStatus,
} from "./types";
import { CLAIM_LOCK, ENQUEUE_LOCK, readQueuePolicy } from "./policy";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
class LeaseLost extends Error {}
const RECEIPT_RUN_SELECT = {
  projectId: true, reservedProjectId: true, publicationState: true,
  publishedRevision: true, engineRelease: true, purgedAt: true,
} as const;

export function toJobReceipt(row: JobReceiptRow): JobReceipt {
  return {
    id: row.id, jobId: row.id, runId: row.runId, operation: row.operation, projectId: row.run.projectId,
    reservedProjectId: row.run.reservedProjectId, status: row.status as JobStatus,
    stage: row.stage, progress: row.progress, attempts: row.attempts, safeMessage: row.safeMessage,
    publicationState: row.run.publicationState as PublicationState,
    publishedRevision: row.run.publishedRevision, createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null,
    diagnosticCode: row.diagnosticCode, cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    engineRelease: row.run.engineRelease, resultUrl: `/api/v1/calculation-jobs/${row.id}/result`,
  };
}

export async function lockEnqueueAdmission(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ENQUEUE_LOCK})::text AS locked`;
}

export async function findIdempotent(tx: Tx, ownerId: string, key: string, requestHash: string): Promise<JobReceipt | null> {
  const submission = await tx.calculationSubmission.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } } });
  if (submission && submission.requestHash !== requestHash) throw new IdempotencyConflict();
  const existing = await tx.calculationJob.findFirst({ where: {
    ...(submission ? { id: submission.jobId } : { idempotencyKey: key }), ownerId, run: { ownerId },
  }, include: { run: { select: RECEIPT_RUN_SELECT } } });
  if (!existing) {
    if (submission) throw new JobHistoryRemoved();
    return null;
  }
  if (existing.requestHash !== requestHash) throw new IdempotencyConflict();
  if (existing.run.purgedAt) throw new JobHistoryRemoved();
  return toJobReceipt(existing);
}

export type EnqueuePrepared = {
  ownerId: string; operation: string; idempotencyKey: string; requestHash: string;
  inputHash: string; payload: unknown; projectId?: string | null; baseRevision?: number | null;
  reservedProjectId?: string | null; engineRelease?: string;
};

/** Call after the idempotent lookup, before loading/validating large input snapshots. */
export async function assertQueueCapacity(tx: Tx, ownerId: string): Promise<void> {
  const active = { status: { in: ["QUEUED", "RUNNING"] } };
  const [owned, total] = await Promise.all([
    tx.calculationJob.count({ where: { ...active, ownerId } }),
    tx.calculationJob.count({ where: active }),
  ]);
  if (owned >= 2 || total >= 100) throw new JobQueueFull();
  const [ownedHistory, totalHistory] = await Promise.all([
    tx.calculationRun.count({ where: { ownerId, purgedAt: null } }),
    tx.calculationRun.count({ where: { purgedAt: null } }),
  ]);
  if (ownedHistory >= 200 || totalHistory >= 2000) throw new JobHistoryFull();
}

/** One locked admission pass; publication checks run under the same fence before any write. */
export async function enqueueWithinTransaction(tx: Tx, input: EnqueuePrepared, validateBeforeInsert?: () => Promise<void>): Promise<JobReceipt> {
  await lockEnqueueAdmission(tx);
  const existing = await findIdempotent(tx, input.ownerId, input.idempotencyKey, input.requestHash);
  if (existing) return existing;
  await assertQueueCapacity(tx, input.ownerId);
  await validateBeforeInsert?.();
  const run = await tx.calculationRun.create({ data: {
    ownerId: input.ownerId, operation: input.operation, projectId: input.projectId,
    reservedProjectId: input.reservedProjectId, baseRevision: input.baseRevision,
    input: json(input.payload), inputHash: input.inputHash, engineRelease: input.engineRelease ?? engineRelease(),
  }, select: { id: true } });
  const job = await tx.calculationJob.create({ data: {
    ownerId: input.ownerId, operation: input.operation, idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash, runId: run.id, maxAttempts: JOB_MAX_ATTEMPTS,
  }, include: { run: { select: RECEIPT_RUN_SELECT } } });
  await tx.calculationSubmission.create({ data: { ownerId: input.ownerId, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, jobId: job.id } });
  return toJobReceipt(job);
}

export async function getOwnedJob(db: Db, ownerId: string, id: string): Promise<JobReceipt | null> {
  const row = await db.calculationJob.findFirst({ where: { id, ownerId, run: { ownerId, purgedAt: null } }, include: { run: { select: RECEIPT_RUN_SELECT } } });
  return row ? toJobReceipt(row) : null;
}

export async function listOwnedJobs(db: Db, ownerId: string, options: { projectId?: string; limit?: number } = {}): Promise<JobReceipt[]> {
  const rows = await db.calculationJob.findMany({
    where: { ownerId, run: { ownerId, purgedAt: null, ...(options.projectId ? { OR: [{ projectId: options.projectId }, { reservedProjectId: options.projectId }] } : {}) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(50, options.limit ?? 20)), include: { run: { select: RECEIPT_RUN_SELECT } },
  });
  return rows.map(toJobReceipt);
}

/** Recovery must select pending jobs before limiting; terminal history cannot hide them. */
export async function listOwnedPendingJobs(db: Db, ownerId: string): Promise<Pick<JobReceipt, "id" | "status">[]> {
  const rows = await db.calculationJob.findMany({
    where: { ownerId, status: { in: ["QUEUED", "RUNNING"] }, run: { ownerId, purgedAt: null } },
    select: { id: true, status: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50,
  });
  return rows.map(row => ({ id: row.id, status: row.status as JobStatus }));
}

export async function getOwnedJobResult(db: Db, ownerId: string, id: string) {
  const row = await db.calculationJob.findFirst({ where: { id, ownerId, run: { ownerId, purgedAt: null } }, include: { run: true } });
  if (!row) return null;
  return { job: toJobReceipt(row), run: row.run };
}

export type OwnedJobTarget = { ownerId: string; jobId: string };
function ownedTargetClause(target?: OwnedJobTarget): Prisma.Sql {
  return target ? Prisma.sql`AND id = ${target.jobId} AND "ownerId" = ${target.ownerId} AND EXISTS (SELECT 1 FROM "CalculationRun" r WHERE r.id = "CalculationJob"."runId" AND r."ownerId" = ${target.ownerId} AND r."purgedAt" IS NULL)` : Prisma.empty;
}

export async function claimJob(db: Db, options: { workerId?: string; leaseMs?: number; target?: OwnedJobTarget } = {}): Promise<ClaimedJob | null> {
  const token = randomUUID();
  const leaseMs = options.leaseMs ?? JOB_LEASE_MS;
  return db.$transaction(async tx => {
    // A DB-level limit covers all worker processes; it limits valid leases, not zombie CPU.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK})::text AS locked`;
    const policy = await readQueuePolicy(tx);
    const active = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "CalculationJob" WHERE status = 'RUNNING' AND "leaseUntil" > clock_timestamp()`;
    if (Number(active[0]?.count ?? 0) >= policy.maxActive) return null;
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "CalculationJob" WHERE status = 'QUEUED' AND "nextAttemptAt" <= clock_timestamp() AND "cancelRequestedAt" IS NULL ${ownedTargetClause(options.target)} ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!rows[0]) return null;
    const current = await tx.calculationJob.findUniqueOrThrow({ where: { id: rows[0].id }, include: { run: true } });
    if (current.run.engineRelease !== engineRelease()) {
      await tx.calculationJob.update({ where: { id: current.id }, data: { status: "FAILED", stage: "failed", diagnosticCode: "ENGINE_VERSION_UNAVAILABLE", safeMessage: "Для сохранённого запуска недоступна совместимая версия движка. Создайте новый расчёт", finishedAt: new Date() } });
      return null;
    }
    await tx.$executeRaw`UPDATE "CalculationJob" SET status = 'RUNNING', attempts = attempts + 1, "leaseToken" = ${token}, "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond', "heartbeatAt" = clock_timestamp(), "startedAt" = clock_timestamp(), "finishedAt" = NULL, stage = 'preparing', progress = NULL, "safeMessage" = 'Подготовка расчёта', "diagnosticCode" = NULL WHERE id = ${current.id}`;
    const job = await tx.calculationJob.findUniqueOrThrow({ where: { id: current.id } });
    return { job, run: current.run, token };
  });
}

export async function heartbeatJob(db: Db, claim: ClaimedJob, options: { leaseMs?: number; stage?: string; progress?: number | null } = {}): Promise<boolean> {
  const progress = options.progress;
  if (progress !== undefined && progress !== null && (!Number.isFinite(progress) || progress < 0 || progress >= 100)) throw new Error("Некорректный прогресс расчёта");
  const stage = options.stage ?? claim.job.stage;
  const leaseMs = options.leaseMs ?? JOB_LEASE_MS;
  const count = await db.$executeRaw`UPDATE "CalculationJob" SET "heartbeatAt" = clock_timestamp(), "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond', stage = ${stage}, progress = CASE WHEN ${progress === undefined} THEN progress ELSE ${progress ?? null}::double precision END WHERE id = ${claim.job.id} AND status = 'RUNNING' AND "leaseToken" = ${claim.token} AND "leaseUntil" > clock_timestamp() AND "cancelRequestedAt" IS NULL AND (${progress == null} OR progress IS NULL OR progress <= ${progress ?? null}::double precision)`;
  return count === 1;
}

export async function cancelJob(db: Db, ownerId: string, id: string): Promise<JobReceipt | null> {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT j.id FROM "CalculationJob" j JOIN "CalculationRun" r ON r.id = j."runId" WHERE j.id = ${id} AND j."ownerId" = ${ownerId} AND r."ownerId" = ${ownerId} AND r."purgedAt" IS NULL FOR UPDATE OF j`;
    if (!rows[0]) return null;
    const job = await tx.calculationJob.findUniqueOrThrow({ where: { id } });
    if (job.status === "QUEUED") await tx.calculationJob.update({ where: { id }, data: { status: "CANCELLED", stage: "cancelled", cancelRequestedAt: new Date(), finishedAt: new Date(), safeMessage: "Расчёт отменён; проект не изменён" } });
    else if (job.status === "RUNNING") await tx.calculationJob.update({ where: { id }, data: { cancelRequestedAt: new Date(), safeMessage: "Отмена принята; результат не будет опубликован" } });
    const row = await tx.calculationJob.findUniqueOrThrow({ where: { id }, include: { run: { select: RECEIPT_RUN_SELECT } } });
    return toJobReceipt(row);
  });
}

/** Explicitly erase large technical snapshots, retaining a small non-replayable key tombstone. */
export async function deleteOwnedTerminalJob(db: Db, ownerId: string, id: string): Promise<boolean> {
  return db.$transaction(async tx => {
    const known = await tx.calculationJob.findFirst({ where: { id, ownerId, run: { ownerId } }, include: { run: { select: RECEIPT_RUN_SELECT } } });
    if (!known) return false;
    if (known.status === "QUEUED" || known.status === "RUNNING") throw new JobStillActive();
    // Same order as publication and FK cascades: owner -> project -> run -> job.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR KEY SHARE`;
    if (known.run.projectId) await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${known.run.projectId} AND "userId" = ${ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CalculationRun" WHERE id = ${known.runId} AND "ownerId" = ${ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CalculationJob" WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const job = await tx.calculationJob.findUnique({ where: { id }, include: { run: { select: RECEIPT_RUN_SELECT } } });
    if (!job) return false;
    if (job.status === "QUEUED" || job.status === "RUNNING") throw new JobStillActive();
    if (!job.run.purgedAt) await tx.calculationRun.update({ where: { id: job.runId }, data: { input: {}, results: Prisma.DbNull, purgedAt: new Date() } });
    return true;
  });
}

export async function completeJob<T extends { results: unknown }>(db: Db, claim: ClaimedJob, computed: T, publish: PublishCalculation<T>): Promise<boolean> {
  try { return await db.$transaction(async tx => {
    // Match parent deletion cascades, including a simultaneous account deletion.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${claim.run.ownerId} FOR KEY SHARE`;
    if (claim.run.projectId) await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${claim.run.projectId} AND "userId" = ${claim.run.ownerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CalculationRun" WHERE id = ${claim.run.id} AND "ownerId" = ${claim.run.ownerId} FOR UPDATE`;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CalculationJob" WHERE id = ${claim.job.id} AND status = 'RUNNING' AND "leaseToken" = ${claim.token} AND "leaseUntil" > clock_timestamp() AND "cancelRequestedAt" IS NULL FOR UPDATE`;
    if (!rows[0]) return false;
    const run = await tx.calculationRun.findUnique({ where: { id: claim.run.id } });
    if (!run || run.completedAt) return false;
    const publication = await publish(tx, run, computed);
    await tx.calculationRun.update({ where: { id: run.id }, data: {
      results: json(computed.results), publicationState: publication.state,
      projectId: publication.projectId, publishedRevision: publication.revision, completedAt: new Date(),
    } });
    const message = publication.state === "STALE" ? "Расчёт готов, но проект изменился. Результат сохранён отдельно" : publication.state === "PUBLISHED" ? "Расчёт завершён и сохранён в проекте" : "Расчёт завершён";
    // Publication queries may have consumed the remaining lease; roll the entire tx back.
    const completed = await tx.$executeRaw`UPDATE "CalculationJob" SET status = 'SUCCEEDED', stage = 'succeeded', progress = 100, "finishedAt" = clock_timestamp(), "leaseToken" = NULL, "leaseUntil" = NULL, "safeMessage" = ${message} WHERE id = ${claim.job.id} AND status = 'RUNNING' AND "leaseToken" = ${claim.token} AND "leaseUntil" > clock_timestamp() AND "cancelRequestedAt" IS NULL`;
    if (completed !== 1) throw new LeaseLost();
    return true;
  }); } catch (error) {
    if (error instanceof LeaseLost) return false;
    throw error;
  }
}

export async function failJob(db: Db, claim: ClaimedJob, code: string, message: string): Promise<boolean> {
  const count = await db.$executeRaw`UPDATE "CalculationJob" SET status = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'CANCELLED' ELSE 'FAILED' END, stage = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'cancelled' ELSE 'failed' END, "diagnosticCode" = ${code}, "safeMessage" = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'Расчёт отменён; проект не изменён' ELSE ${message.slice(0, 500)} END, "finishedAt" = clock_timestamp(), "leaseToken" = NULL, "leaseUntil" = NULL WHERE id = ${claim.job.id} AND status = 'RUNNING' AND "leaseToken" = ${claim.token} AND "leaseUntil" > clock_timestamp()`;
  return count === 1;
}

/** No computation was admitted: release its fenced lease without consuming a recovery attempt. */
export async function retryBusyJob(db: Db, claim: ClaimedJob): Promise<boolean> {
  const count = await db.$executeRaw`UPDATE "CalculationJob" SET status = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'CANCELLED' ELSE 'QUEUED' END, stage = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'cancelled' ELSE 'retry_pending' END, attempts = GREATEST(attempts - 1, 0), "nextAttemptAt" = clock_timestamp() + interval '2 seconds', "leaseToken" = NULL, "leaseUntil" = NULL, "diagnosticCode" = 'COMPUTATION_BUSY', "safeMessage" = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'Расчёт отменён; проект не изменён' ELSE 'Расчётный процесс занят; задание ожидает свободного исполнителя' END, "finishedAt" = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN clock_timestamp() ELSE NULL END WHERE id = ${claim.job.id} AND status = 'RUNNING' AND "leaseToken" = ${claim.token} AND "leaseUntil" > clock_timestamp()`;
  return count === 1;
}

/** Recovery is only for missing workers. Deterministic model errors are terminal. */
export async function reapExpiredJobs(db: Db, target?: OwnedJobTarget): Promise<number> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK})::text AS locked`;
    return tx.$executeRaw(Prisma.sql`UPDATE "CalculationJob" SET status = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'CANCELLED' WHEN attempts >= "maxAttempts" THEN 'FAILED' ELSE 'QUEUED' END, stage = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'cancelled' WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'retry_pending' END, "nextAttemptAt" = clock_timestamp() + interval '2 seconds', "leaseToken" = NULL, "leaseUntil" = NULL, "diagnosticCode" = 'WORKER_LOST', "safeMessage" = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'Расчёт отменён; проект не изменён' WHEN attempts >= "maxAttempts" THEN 'Worker недоступен; исчерпаны попытки восстановления' ELSE 'Предыдущий worker недоступен; расчёт будет повторён на тех же данных' END, "finishedAt" = CASE WHEN "cancelRequestedAt" IS NOT NULL OR attempts >= "maxAttempts" THEN clock_timestamp() ELSE NULL END WHERE status = 'RUNNING' AND "leaseUntil" <= clock_timestamp() ${ownedTargetClause(target)}`);
  });
}
