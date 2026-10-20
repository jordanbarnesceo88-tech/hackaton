import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { claimJob, reapExpiredJobs, retryBusyJob } from "./store";
import { engineRelease, type ClaimedJob } from "./types";

function queryText(query: unknown): string {
  return Array.isArray(query) ? query.join("?") : (query as { sql: string }).sql;
}
function fixture(active = 0) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (query: unknown) => {
      const sql = queryText(query);
      if (sql.includes('FROM "CalculationQueuePolicy"')) return [{ id: 1, maxActive: 2 }];
      if (sql.includes("COUNT(*)")) return [{ count: BigInt(active) }];
      if (sql.includes('SELECT id FROM "CalculationJob"')) return [{ id: "target" }];
      return [];
    }),
    $executeRaw: vi.fn().mockResolvedValue(1),
    calculationJob: {
      findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ id: "target", run: { engineRelease: engineRelease() } }).mockResolvedValueOnce({ id: "target", status: "RUNNING" }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
  return { db, tx };
}

describe("owner-targeted durable claim and recovery", () => {
  it("retains the global cap/lock and binds job and both owner identities before row lock", async () => {
    const { db, tx } = fixture();
    expect((await claimJob(db, { target: { ownerId: "owner", jobId: "target" } }))?.job.id).toBe("target");
    expect(queryText(tx.$queryRaw.mock.calls[0]![0])).toContain("pg_advisory_xact_lock");
    expect(queryText(tx.$queryRaw.mock.calls[2]![0])).toContain('"leaseUntil" > clock_timestamp()');
    const query = tx.$queryRaw.mock.calls[3]![0] as { sql: string; values: unknown[] };
    expect(query.sql).toContain('AND id = ? AND "ownerId" = ?');
    expect(query.sql).toContain('r."ownerId" = ? AND r."purgedAt" IS NULL');
    expect(query.sql).toContain("FOR UPDATE SKIP LOCKED LIMIT 1");
    expect(query.values).toEqual(["target", "owner", "owner"]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it("does not bypass the shared cap for a targeted serverless invocation", async () => {
    const { db, tx } = fixture(2);
    expect(await claimJob(db, { target: { ownerId: "owner", jobId: "target" } })).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3); expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("keeps ordinary worker claims unfiltered", async () => {
    const { db, tx } = fixture(); await claimJob(db);
    const query = tx.$queryRaw.mock.calls[3]![0] as { sql: string; values: unknown[] };
    expect(query.sql).not.toContain('r."ownerId"'); expect(query.values).toEqual([]);
  });
  it("fails an owned incompatible target with the existing actionable diagnostic before granting a lease", async () => {
    const { db, tx } = fixture();
    tx.calculationJob.findUniqueOrThrow.mockReset().mockResolvedValueOnce({ id: "target", run: { engineRelease: "old-engine" } });
    expect(await claimJob(db, { target: { ownerId: "owner", jobId: "target" } })).toBeNull();
    expect(tx.calculationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", diagnosticCode: "ENGINE_VERSION_UNAVAILABLE" }) }));
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("restricts the reaper to the requested owner and target while retaining lease/max-attempt recovery", async () => {
    const { db, tx } = fixture();
    await reapExpiredJobs(db, { ownerId: "owner", jobId: "target" });
    const query = tx.$executeRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(query.values).toEqual(["target", "owner", "owner"]);
    expect(query.sql).toContain('"leaseUntil" <= clock_timestamp()'); expect(query.sql).toContain('attempts >= "maxAttempts"');
    expect(query.sql).toContain('r."ownerId" = ?');
  });
  it("releases local busy admission only under the valid lease and preserves cancellation", async () => {
    const { db, tx } = fixture();
    expect(await retryBusyJob(db, { job: { id: "target" }, token: "token" } as ClaimedJob)).toBe(true);
    const query = tx.$executeRaw.mock.calls[0]![0]; const sql = queryText(query);
    expect(sql).toContain("attempts = GREATEST(attempts - 1, 0)");
    expect(sql).toContain("THEN 'CANCELLED' ELSE 'QUEUED'");
    expect(sql).toContain('"leaseToken" = ? AND "leaseUntil" > clock_timestamp()');
    tx.$executeRaw.mockResolvedValueOnce(0);
    expect(await retryBusyJob(db, { job: { id: "target" }, token: "stale-token" } as ClaimedJob)).toBe(false);
  });
});
