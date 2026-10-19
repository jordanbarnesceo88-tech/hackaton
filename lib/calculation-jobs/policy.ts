import type { Prisma, PrismaClient } from "@prisma/client";

export const ENQUEUE_LOCK = 1_746_021_301;
export const CLAIM_LOCK = 1_746_021_302;

export class CalculationQueuePolicyError extends Error {
  constructor(readonly code: "QUEUE_POLICY_MISSING" | "QUEUE_POLICY_INVALID", message: string) {
    super(message);
    this.name = "CalculationQueuePolicyError";
  }
}

export class CalculationQueueBusy extends Error {
  readonly code = "QUEUE_NOT_IDLE";
  constructor() {
    super("Лимит можно изменить только при отсутствии QUEUED и RUNNING заданий. Закройте приём и дождитесь завершения очереди");
    this.name = "CalculationQueueBusy";
  }
}

export function parseQueueCap(value: string): number {
  if (value !== value.trim() || !/^(?:[1-9]\d?|100)$/.test(value)) throw new Error("Лимит очереди должен быть целым числом от 1 до 100");
  return Number(value);
}

/** The database is authoritative; no process-local override or cached admission limit. */
export async function readQueuePolicy(db: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<{ maxActive: number }> {
  const rows = await db.$queryRaw<{ id: number; maxActive: number }[]>`SELECT id, "maxActive" FROM "CalculationQueuePolicy"`;
  if (rows.length === 0) throw new CalculationQueuePolicyError("QUEUE_POLICY_MISSING", "Не задана политика очереди. Проверьте миграции; worker не принимает задания");
  const policy = rows[0];
  if (rows.length !== 1 || policy?.id !== 1 || !Number.isInteger(policy.maxActive) || policy.maxActive < 1 || policy.maxActive > 100) {
    throw new CalculationQueuePolicyError("QUEUE_POLICY_INVALID", "Некорректная политика очереди; worker не принимает задания");
  }
  return { maxActive: policy.maxActive };
}

export async function setQueueCap(db: PrismaClient, maxActive: number): Promise<{ previousCap: number; maxActive: number }> {
  if (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > 100) throw new Error("Лимит очереди должен быть целым числом от 1 до 100");
  return db.$transaction(async tx => {
    // Admission never takes CLAIM_LOCK; claim/reaping never take ENQUEUE_LOCK.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ENQUEUE_LOCK})::text AS locked`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK})::text AS locked`;
    const previous = await readQueuePolicy(tx);
    const active = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "CalculationJob" WHERE status IN ('QUEUED', 'RUNNING')`;
    // Expired RUNNING leases also block a policy change until recovery has finished.
    if (Number(active[0]?.count ?? 0) !== 0) throw new CalculationQueueBusy();
    await tx.$executeRaw`UPDATE "CalculationQueuePolicy" SET "maxActive" = ${maxActive} WHERE id = 1`;
    return { previousCap: previous.maxActive, maxActive };
  }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
}
