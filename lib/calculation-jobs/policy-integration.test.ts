import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../db/client";
import { createPrismaClient } from "../db/factory";
import { claimJob, completeJob, enqueueWithinTransaction, lockEnqueueAdmission, type EnqueuePrepared } from "./store";
import { engineRelease } from "./types";
import { CalculationQueueBusy, CalculationQueuePolicyError, readQueuePolicy, setQueueCap } from "./policy";

// Real, independent PostgreSQL clients; synthetic jobs isolate admission from CPU/model timing.
const clients = [createPrismaClient(2), createPrismaClient(2)];
const prefix = `queue-policy-${randomUUID()}-`;
let owner = "";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeAll(async () => {
  expect(await prisma.calculationJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })).toBe(0);
  expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 2 });
  owner = (await prisma.user.create({ data: { email: `${prefix}owner@test.local`, passwordHash: "not-a-login" } })).id;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await prisma.calculationRun.deleteMany({ where: { ownerId: owner } });
  // Restore only this suite's policy edits, including its explicit missing-row negative case.
  await prisma.$executeRaw`INSERT INTO "CalculationQueuePolicy" (id, "maxActive") VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET "maxActive" = 2`;
});

afterAll(async () => {
  if (owner) await prisma.user.delete({ where: { id: owner } });
  await Promise.all(clients.map(client => client.$disconnect()));
});

async function fixtures(count: number) {
  const ids = Array.from({ length: count }, () => randomUUID());
  await prisma.calculationRun.createMany({ data: ids.map(id => ({
    id, ownerId: owner, operation: "CALCULATE", input: { policyFixture: true }, inputHash: id, engineRelease: engineRelease(),
  })) });
  await prisma.calculationJob.createMany({ data: ids.map(id => ({
    runId: id, ownerId: owner, operation: "CALCULATE", idempotencyKey: id, requestHash: id,
  })) });
}

function admission(): EnqueuePrepared {
  const key = randomUUID();
  return { ownerId: owner, operation: "CALCULATE", idempotencyKey: key, requestHash: key, inputHash: key, payload: { policyFixture: true } };
}

describe("database-wide compute capacity policy", () => {
  it.each([1, 2, 12])("limits independent concurrent clients to cap %s and releases a completed slot", async cap => {
    expect(await setQueueCap(prisma, cap)).toEqual({ previousCap: 2, maxActive: cap });
    await fixtures(20);
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => claimJob(clients[index % clients.length]!, { workerId: `policy-${index}` })));
    const accepted = claims.filter(claim => claim !== null);
    expect(accepted).toHaveLength(cap);
    expect(new Set(accepted.map(claim => claim.job.id)).size).toBe(cap);
    expect(await prisma.calculationJob.count({ where: { status: "RUNNING", attempts: 1 } })).toBe(cap);
    expect(await completeJob(prisma, accepted[0]!, { results: { checked: true } }, async () => ({ projectId: null, revision: null, state: "NONE" }))).toBe(true);
    expect(await claimJob(clients[1]!)).not.toBeNull();
    expect(await prisma.calculationJob.count({ where: { status: "RUNNING" } })).toBe(cap);
  }, 20_000);

  it("ignores conflicting local ENV and forged obsolete per-call caps across clients", async () => {
    vi.stubEnv("CALCULATION_MAX_ACTIVE", "100");
    vi.stubEnv("JOB_MAX_ACTIVE", "100");
    await fixtures(20);
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => claimJob(clients[index % clients.length]!, {
      workerId: `mixed-${index}`, maxActive: index % 2 ? 100 : 1,
    } as Parameters<typeof claimJob>[1])));
    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 2 });
  });

  it("observes an idle policy change in already connected clients without restarting or caching", async () => {
    expect(await claimJob(clients[0]!)).toBeNull();
    await setQueueCap(clients[1]!, 12);
    await fixtures(15);
    const claims = await Promise.all(Array.from({ length: 15 }, (_, index) => claimJob(clients[index % clients.length]!)));
    expect(claims.filter(Boolean)).toHaveLength(12);
  });

  it("fails closed on a missing policy without claiming or incrementing attempts", async () => {
    await fixtures(1);
    await prisma.$executeRaw`DELETE FROM "CalculationQueuePolicy" WHERE id = 1`;
    await expect(claimJob(clients[0]!)).rejects.toBeInstanceOf(CalculationQueuePolicyError);
    await expect(setQueueCap(clients[1]!, 12)).rejects.toMatchObject({ code: "QUEUE_POLICY_MISSING" });
    expect(await prisma.calculationJob.count({ where: { ownerId: owner, status: "QUEUED", attempts: 0 } })).toBe(1);
  });

  it("enforces singleton and cap constraints in actual PostgreSQL", async () => {
    await expect(prisma.$executeRaw`INSERT INTO "CalculationQueuePolicy" (id, "maxActive") VALUES (2, 2)`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "CalculationQueuePolicy" SET "maxActive" = 0 WHERE id = 1`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "CalculationQueuePolicy" SET "maxActive" = 101 WHERE id = 1`).rejects.toThrow();
    expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 2 });
  });

  it("rejects cap changes for queued, running and expired-running work", async () => {
    await fixtures(1);
    await expect(setQueueCap(prisma, 12)).rejects.toBeInstanceOf(CalculationQueueBusy);
    const claim = await claimJob(clients[0]!);
    expect(claim).not.toBeNull();
    await expect(setQueueCap(prisma, 12)).rejects.toMatchObject({ code: "QUEUE_NOT_IDLE" });
    await prisma.calculationJob.update({ where: { id: claim!.job.id }, data: { leaseUntil: new Date(0) } });
    await expect(setQueueCap(prisma, 1)).rejects.toMatchObject({ code: "QUEUE_NOT_IDLE" });
    expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 2 });
  });

  it("refuses a cap change that races behind accepted admission", async () => {
    const held = gate(), release = gate();
    const accepted = prisma.$transaction(async tx => {
      await lockEnqueueAdmission(tx);
      held.resolve();
      await release.promise;
      return enqueueWithinTransaction(tx, admission());
    });
    await held.promise;
    const change = setQueueCap(clients[0]!, 12).then(value => ({ value }), error => ({ error }));
    release.resolve();
    await accepted;
    expect(await change).toMatchObject({ error: { code: "QUEUE_NOT_IDLE" } });
    expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 2 });
  });

  it("serializes admission after a policy change that already holds both locks", async () => {
    const held = gate(), release = gate();
    const paused = { $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }) =>
      clients[0]!.$transaction(tx => work(new Proxy(tx, { get(target, key) {
        if (key === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const result = await target.$queryRaw(strings, ...values);
          if (strings.join("").includes("WHERE status IN ('QUEUED', 'RUNNING')")) {
            held.resolve();
            await release.promise;
          }
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } })), options),
    } as unknown as PrismaClient;
    const changed = setQueueCap(paused, 12);
    try {
      await held.promise;
      const accepted = clients[1]!.$transaction(tx => enqueueWithinTransaction(tx, admission()));
      release.resolve();
      expect(await changed).toEqual({ previousCap: 2, maxActive: 12 });
      expect((await accepted).status).toBe("QUEUED");
      expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 12 });
      expect(await claimJob(clients[0]!)).not.toBeNull();
    } finally {
      release.resolve();
      await changed;
    }
  });

  it("never changes policy while claim races with a queued job", async () => {
    await fixtures(1);
    const [change, claim] = await Promise.allSettled([setQueueCap(clients[0]!, 12), claimJob(clients[1]!)]);
    expect(change).toMatchObject({ status: "rejected", reason: { code: "QUEUE_NOT_IDLE" } });
    expect(claim.status).toBe("fulfilled");
    if (claim.status === "fulfilled") expect(claim.value).not.toBeNull();
    expect(await readQueuePolicy(prisma)).toEqual({ maxActive: 2 });
  });
});
