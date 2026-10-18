import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db/client";
import {
  cancelJob,
  claimJob,
  completeJob,
  deleteOwnedTerminalJob,
  failJob,
  getOwnedJob,
  getOwnedJobResult,
  heartbeatJob,
  reapExpiredJobs,
} from "./store";
import { engineRelease } from "./types";
import { computeFrozenCalculation, enqueueCalculation, publishFrozenCalculation } from "./service";

/** Independent real-PostgreSQL failure cases. The computation is replaced by a tiny value;
 * transaction locking, fencing, CAS and publication use the real store and real database.
 * Native worker kill/restart and engine parity require separate process-level acceptance. */
const prefix = `job-adversary-${randomUUID()}-`;
let owner = "";
let stranger = "";

beforeAll(async () => {
  owner = (await prisma.user.create({ data: { email: `${prefix}owner@test.local`, passwordHash: "not-a-login" } })).id;
  stranger = (await prisma.user.create({ data: { email: `${prefix}stranger@test.local`, passwordHash: "not-a-login" } })).id;
});

beforeEach(async () => {
  await prisma.calculationRun.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await prisma.project.deleteMany({ where: { userId: { in: [owner, stranger] } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
});

async function fixture(projectId?: string, requestKey = randomUUID()) {
  return prisma.calculationRun.create({ data: {
    ownerId: owner,
    ...(projectId ? { projectId, baseRevision: 0 } : {}),
    operation: projectId ? "SAVE" : "CALCULATE",
    input: { adversarialFixture: true },
    inputHash: `input-${requestKey}`,
    engineRelease: engineRelease(),
    job: { create: {
      ownerId: owner,
      operation: projectId ? "SAVE" : "CALCULATE",
      idempotencyKey: requestKey,
      requestHash: `request-${requestKey}`,
    } },
  }, include: { job: true } });
}

async function projectFixture() {
  return prisma.project.create({ data: {
    userId: owner, name: `${prefix}head`, facilityTypeSlug: "warehouse", params: { original: true }, paramsSource: { kind: "manual" }, results: { original: true },
  } });
}

const unpublished = async () => ({ projectId: null, revision: null, state: "NONE" as const });

/** Interleave actual SQL commits at the preparation boundary, without mocking DB results. */
function duringPreparation(interleave: (tx: Prisma.TransactionClient, prepare: () => Promise<unknown>) => Promise<unknown>): PrismaClient {
  return { $transaction: (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number },
  ) => prisma.$transaction(tx => options.isolationLevel === "RepeatableRead"
    ? interleave(tx, () => work(tx)) : work(tx), options) } as unknown as PrismaClient;
}

describe("independent durable-calculation failure boundaries", () => {
  it("two concurrent claims never acquire the same job twice", async () => {
    const run = await fixture();
    const claims = await Promise.all([claimJob(prisma, { workerId: "adversary-a" }), claimJob(prisma, { workerId: "adversary-b" })]);
    const accepted = claims.filter(claim => claim?.job.id === run.job!.id);
    expect(accepted).toHaveLength(1);
    expect((await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } })).attempts).toBe(1);
  });

  it("shared admission applies to independent concurrent claim calls", async () => {
    const runs = await Promise.all([fixture(), fixture(), fixture()]);
    const ids = new Set(runs.map(run => run.job!.id));
    const claims = await Promise.all(Array.from({ length: 4 }, (_, i) => claimJob(prisma, { workerId: `adversary-cap-${i}` })));
    expect(claims.filter(claim => claim && ids.has(claim.job.id))).toHaveLength(2);
    expect(new Set(claims.filter(claim => claim !== null).map(claim => claim!.job.id)).size).toBe(2);
  });

  it("an expired claim cannot heartbeat or enter the publication callback, even before reaping", async () => {
    const run = await fixture();
    const claim = await claimJob(prisma, { workerId: "adversary-expired" });
    expect(claim?.job.id).toBe(run.job!.id);
    if (!claim) throw new Error("Expected a claim");
    await prisma.calculationJob.update({ where: { id: claim.job.id }, data: { leaseUntil: new Date(0) } });
    expect(await heartbeatJob(prisma, claim, { progress: 25 })).toBe(false);
    let published = false;
    expect(await completeJob(prisma, claim, { results: { value: 1 } }, async () => {
      published = true;
      return unpublished();
    })).toBe(false);
    expect(published).toBe(false);
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).results).toBeNull();
  });

  it("reclaimed execution fences the old token and publishes once", async () => {
    const run = await fixture();
    const first = await claimJob(prisma, { workerId: "adversary-lost" });
    if (!first) throw new Error("Expected first claim");
    await prisma.calculationJob.update({ where: { id: first.job.id }, data: { leaseUntil: new Date(0) } });
    await reapExpiredJobs(prisma);
    // Backoff is a scheduling policy; bring this fixture's next attempt forward, without
    // changing status, token, attempts or the frozen input under test.
    await prisma.calculationJob.update({ where: { id: first.job.id }, data: { nextAttemptAt: new Date(0) } });
    const second = await claimJob(prisma, { workerId: "adversary-recovery" });
    expect(second?.job.id).toBe(first.job.id);
    if (!second) throw new Error("Expected recovered claim");
    expect(second.token).not.toBe(first.token);
    expect(second.job.attempts).toBe(2);
    expect(second.run.input).toEqual(first.run.input);
    expect(await heartbeatJob(prisma, first)).toBe(false);
    expect(await completeJob(prisma, first, { results: { obsolete: true } }, unpublished)).toBe(false);
    expect(await completeJob(prisma, second, { results: { recovered: true } }, unpublished)).toBe(true);
    expect(await completeJob(prisma, second, { results: { duplicate: true } }, unpublished)).toBe(false);
    const stored = await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.results).toEqual({ recovered: true });
  });

  it("recovery stops at the attempt bound instead of retrying forever", async () => {
    const run = await fixture();
    await prisma.calculationJob.update({ where: { id: run.job!.id }, data: { maxAttempts: 1 } });
    const claim = await claimJob(prisma, { workerId: "adversary-last-attempt" });
    if (!claim) throw new Error("Expected a claim");
    await prisma.calculationJob.update({ where: { id: claim.job.id }, data: { leaseUntil: new Date(0) } });
    await reapExpiredJobs(prisma);
    const final = await prisma.calculationJob.findUniqueOrThrow({ where: { id: claim.job.id } });
    expect(final.status).toBe("FAILED");
    expect(final.finishedAt).not.toBeNull();
    expect(await claimJob(prisma, { workerId: "adversary-no-fourth-attempt" })).toBeNull();
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).results).toBeNull();
  });

  it("queued inputs requiring an unavailable engine never execute under a new label", async () => {
    const run = await fixture();
    await prisma.calculationRun.update({ where: { id: run.id }, data: { engineRelease: "unavailable-historic-engine" } });
    expect(await claimJob(prisma, { workerId: "adversary-new-release" })).toBeNull();
    const final = await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } });
    expect(final.status).toBe("FAILED");
    expect(final.diagnosticCode).toBe("ENGINE_VERSION_UNAVAILABLE");
    expect(final.attempts).toBe(0);
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).results).toBeNull();
  });

  it("foreign owners cannot poll or cancel a guessed job ID", async () => {
    const run = await fixture();
    expect(await getOwnedJob(prisma, stranger, run.job!.id)).toBeNull();
    expect(await getOwnedJobResult(prisma, stranger, run.job!.id)).toBeNull();
    expect(await cancelJob(prisma, stranger, run.job!.id)).toBeNull();
    expect((await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } })).status).toBe("QUEUED");
  });

  it("accepted cancellation vetoes publication and cannot become measured zero or success", async () => {
    const run = await fixture();
    const claim = await claimJob(prisma, { workerId: "adversary-cancel" });
    if (!claim) throw new Error("Expected a claim");
    expect(await cancelJob(prisma, owner, run.job!.id)).not.toBeNull();
    let invoked = false;
    expect(await completeJob(prisma, claim, { results: { value: 0 } }, async () => {
      invoked = true;
      return unpublished();
    })).toBe(false);
    expect(invoked).toBe(false);
    expect((await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } })).cancelRequestedAt).not.toBeNull();
    expect(await failJob(prisma, claim, "CANCELLED", "Aborted test computation")).toBe(true);
    expect((await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } })).status).toBe("CANCELLED");
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).results).toBeNull();
  });

  it("a failed final publication rolls back project, result and terminal state together", async () => {
    const project = await projectFixture();
    const run = await fixture(project.id);
    const claim = await claimJob(prisma, { workerId: "adversary-rollback" });
    if (!claim) throw new Error("Expected a claim");
    await expect(completeJob(prisma, claim, { results: { changed: true } }, async tx => {
      await tx.project.update({ where: { id: project.id }, data: { name: "must roll back", revision: { increment: 1 }, results: { changed: true } } });
      await tx.changeLog.create({ data: { entity: "project", entityId: project.id, projectId: project.id, userId: owner, field: "adversary", newValue: true } });
      throw new Error("Failure after SQL mutation, before final commit");
    })).rejects.toThrow("Failure after SQL mutation");
    const head = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(head.name).toBe(project.name);
    expect(head.revision).toBe(0);
    expect(head.results).toEqual({ original: true });
    expect(await prisma.changeLog.count({ where: { projectId: project.id } })).toBe(0);
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).results).toBeNull();
    expect((await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } })).status).toBe("RUNNING");
  });

  it("a lease expiring during publication rolls back SQL changes made after the first fence", async () => {
    const project = await projectFixture();
    const run = await fixture(project.id);
    const claim = await claimJob(prisma, { workerId: "adversary-expire-during-publish", leaseMs: 500 });
    if (!claim) throw new Error("Expected a claim");
    let invoked = false;
    expect(await completeJob(prisma, claim, { results: { mustRollBack: true } }, async tx => {
      invoked = true;
      await tx.project.update({ where: { id: project.id }, data: { revision: { increment: 1 }, results: { mustRollBack: true } } });
      await tx.changeLog.create({ data: { entity: "project", entityId: project.id, projectId: project.id, userId: owner,
        field: "adversary-expired-publish", newValue: true } });
      await tx.$executeRaw`SELECT pg_sleep(0.8)`;
      return { projectId: project.id, revision: 1, state: "PUBLISHED" as const };
    })).toBe(false);
    expect(invoked).toBe(true);
    const head = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(head.revision).toBe(0);
    expect(head.results).toEqual({ original: true });
    expect(await prisma.changeLog.count({ where: { projectId: project.id } })).toBe(0);
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).results).toBeNull();
    expect((await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } })).status).toBe("RUNNING");
  });

  it("two completed runs of the same revision attach once and retain the other as stale", async () => {
    const project = await projectFixture();
    const runs = await Promise.all([fixture(project.id), fixture(project.id)]);
    const claims = await Promise.all([claimJob(prisma, { workerId: "adversary-tab-a" }), claimJob(prisma, { workerId: "adversary-tab-b" })]);
    expect(claims.filter(Boolean)).toHaveLength(2);
    const completions = await Promise.all(claims.map((claim, index) => {
      if (!claim) throw new Error("Expected both claims");
      return completeJob(prisma, claim, { results: { tab: index } }, async (tx, run) => {
        const updated = await tx.project.updateMany({ where: { id: project.id, userId: owner, revision: run.baseRevision! },
          data: { revision: { increment: 1 }, results: { tab: index } } });
        if (!updated.count) return { projectId: project.id, revision: null, state: "STALE" as const };
        await tx.changeLog.create({ data: { entity: "project", entityId: project.id, projectId: project.id, userId: owner,
          field: "adversary", newValue: index } });
        return { projectId: project.id, revision: 1, state: "PUBLISHED" as const };
      });
    }));
    expect(completions).toEqual([true, true]);
    const stored = await prisma.calculationRun.findMany({ where: { id: { in: runs.map(run => run.id) } } });
    expect(stored.map(run => run.publicationState).sort()).toEqual(["PUBLISHED", "STALE"]);
    expect(stored.every(run => run.results !== null)).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).revision).toBe(1);
    expect(await prisma.changeLog.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("a concurrent cancel and completion have one linear outcome, never cancelled plus published", async () => {
    for (let trial = 0; trial < 6; trial++) {
      const project = await projectFixture();
      const run = await fixture(project.id);
      const claim = await claimJob(prisma, { workerId: `adversary-cancel-race-${trial}` });
      if (!claim) throw new Error("Expected a claim");
      await Promise.all([
        completeJob(prisma, claim, { results: { race: trial } }, async tx => {
          await tx.project.update({ where: { id: project.id }, data: { revision: { increment: 1 }, results: { race: trial } } });
          return { projectId: project.id, revision: 1, state: "PUBLISHED" as const };
        }),
        cancelJob(prisma, owner, run.job!.id),
      ]);
      // A running worker acknowledges cancellation separately; publication has already
      // been fenced once cancelRequestedAt committed, even if its terminal acknowledgement lags.
      await failJob(prisma, claim, "CANCELLED", "Aborted race computation");
      const job = await prisma.calculationJob.findUniqueOrThrow({ where: { id: run.job!.id } });
      const stored = await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } });
      const head = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(["CANCELLED", "SUCCEEDED"]).toContain(job.status);
      if (job.status === "CANCELLED") {
        expect(head.revision).toBe(0);
        expect(head.results).toEqual({ original: true });
        expect(stored.results).toBeNull();
        expect(stored.publicationState).toBe("NONE");
      } else {
        expect(head.revision).toBe(1);
        expect(head.results).toEqual({ race: trial });
        expect(stored.results).toEqual({ race: trial });
        expect(stored.publicationState).toBe("PUBLISHED");
      }
    }
  });

  it("a project deleted during computation is never recreated by late completion", async () => {
    const project = await projectFixture();
    const run = await fixture(project.id);
    const claim = await claimJob(prisma, { workerId: "adversary-delete" });
    if (!claim) throw new Error("Expected a claim");
    await prisma.project.delete({ where: { id: project.id } });
    let invoked = false;
    expect(await completeJob(prisma, claim, { results: { late: true } }, async () => {
      invoked = true;
      return { projectId: project.id, revision: 1, state: "PUBLISHED" as const };
    })).toBe(false);
    expect(invoked).toBe(false);
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.calculationRun.findUnique({ where: { id: run.id } })).toBeNull();
  });

  it("technical history deletion refuses pending work and cannot be performed by another owner", async () => {
    const run = await fixture();
    expect(await deleteOwnedTerminalJob(prisma, stranger, run.job!.id)).toBe(false);
    await expect(deleteOwnedTerminalJob(prisma, owner, run.job!.id)).rejects.toMatchObject({ status: 409 });
    const claim = await claimJob(prisma, { workerId: "adversary-active-history" });
    if (!claim) throw new Error("Expected a claim");
    await expect(deleteOwnedTerminalJob(prisma, owner, run.job!.id)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } })).input).toEqual({ adversarialFixture: true });
  });

  it("purging terminal technical history preserves the published project head and its log", async () => {
    const project = await projectFixture();
    const run = await fixture(project.id);
    const claim = await claimJob(prisma, { workerId: "adversary-purge-published" });
    if (!claim) throw new Error("Expected a claim");
    await completeJob(prisma, claim, { results: { published: true } }, async tx => {
      await tx.project.update({ where: { id: project.id }, data: { revision: 1, results: { published: true } } });
      await tx.changeLog.create({ data: { entity: "project", entityId: project.id, projectId: project.id, userId: owner, field: "purge-proof", newValue: true } });
      return { projectId: project.id, revision: 1, state: "PUBLISHED" as const };
    });
    expect(await deleteOwnedTerminalJob(prisma, stranger, claim.job.id)).toBe(false);
    expect(await deleteOwnedTerminalJob(prisma, owner, claim.job.id)).toBe(true);
    const retainedHead = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(retainedHead.revision).toBe(1);
    expect(retainedHead.results).toEqual({ published: true });
    expect(await prisma.changeLog.count({ where: { projectId: project.id } })).toBe(1);
    const tombstone = await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(tombstone.purgedAt).not.toBeNull();
    expect(tombstone.input).toEqual({});
    expect(tombstone.results).toBeNull();
    expect(await getOwnedJob(prisma, owner, claim.job.id)).toBeNull();
    expect(await getOwnedJobResult(prisma, owner, claim.job.id)).toBeNull();
  });
});

describe("independent enqueue intent, quota and lost-receipt recovery", () => {
  const request = { operation: "CALCULATE", facility: "warehouse" } as const;

  it("admits a simultaneous 50-owner burst exactly once per key without serializable retry exhaustion", async () => {
    const actors = Array.from({ length: 50 }, (_, i) => ({ id: randomUUID(), email: `${prefix}burst-${i}@test.local`, passwordHash: "not-a-login" }));
    await prisma.user.createMany({ data: actors });
    const keys = actors.map(() => randomUUID());
    try {
      // No client retry, worker or fake compute: all fifty calls run the real freeze/admission path.
      const outcomes = await Promise.allSettled(actors.map((actor, i) => enqueueCalculation(prisma, actor.id, request, keys[i]!)));
      expect(outcomes.filter(outcome => outcome.status === "rejected").map(outcome => (outcome as PromiseRejectedResult).reason)).toEqual([]);
      const accepted = outcomes.map(outcome => (outcome as PromiseFulfilledResult<Awaited<ReturnType<typeof enqueueCalculation>>>).value);
      expect(new Set(accepted.map(job => job.id)).size).toBe(50);
      expect(await prisma.calculationRun.count({ where: { ownerId: { in: actors.map(actor => actor.id) } } })).toBe(50);
      const replayed = await Promise.all(actors.map((actor, i) => enqueueCalculation(prisma, actor.id, request, keys[i]!)));
      expect(replayed.map(job => job.id)).toEqual(accepted.map(job => job.id));
      expect(await prisma.calculationSubmission.count({ where: { ownerId: { in: actors.map(actor => actor.id) } } })).toBe(50);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: actors.map(actor => actor.id) } } });
    }
  }, 60_000);

  it("freezes catalogue and norms from one snapshot even when an admin commits between their reads", async () => {
    const norm = await prisma.norm.findUniqueOrThrow({ where: { key: "discountRate" } });
    const product = await prisma.catalogProduct.findFirstOrThrow({ where: {
      archived: false, level: { in: ["enriched", "examples"] },
      processes: { some: { process: { facilityTypes: { some: { facilityType: { slug: "warehouse" } } } } } },
    } });
    let changed!: () => void;
    const committed = new Promise<void>(resolve => { changed = resolve; });
    const db = duringPreparation(async (tx, prepare) => {
      const originalProducts = tx.catalogProduct.findMany.bind(tx.catalogProduct);
      const originalNorms = tx.norm.findMany.bind(tx.norm);
      tx.catalogProduct.findMany = (async (...args: Parameters<typeof originalProducts>) => {
        const rows = await originalProducts(...args);
        await prisma.$transaction([
          prisma.catalogProduct.update({ where: { id: product.id }, data: { name: `${product.name} updated` } }),
          prisma.norm.update({ where: { key: norm.key }, data: { value: norm.value === 0.2 ? 0.15 : 0.2 } }),
        ]);
        changed();
        return rows;
      }) as typeof tx.catalogProduct.findMany;
      tx.norm.findMany = (async (...args: Parameters<typeof originalNorms>) => {
        await committed;
        return originalNorms(...args);
      }) as typeof tx.norm.findMany;
      return prepare();
    });
    try {
      const accepted = await enqueueCalculation(db, owner, request, randomUUID());
      const run = await prisma.calculationRun.findUniqueOrThrow({ where: { id: accepted.runId } });
      const frozen = run.input as unknown as { live: { products: { slug: string; name: string }[]; norms: { discountRate: number } } };
      expect(frozen.live.products.find(item => item.slug === product.slug)?.name).toBe(product.name);
      expect(frozen.live.norms.discountRate).toBe(norm.value);
    } finally {
      await prisma.$transaction([
        prisma.catalogProduct.update({ where: { id: product.id }, data: { name: product.name } }),
        prisma.norm.update({ where: { key: norm.key }, data: { value: norm.value } }),
      ]);
    }
  }, 30_000);

  it.each(["revision", "owner", "demo", "deleted"] as const)("rechecks the current %s after preparation before admitting RECALCULATE", async change => {
    const project = await projectFixture();
    const db = duringPreparation(async (_tx, prepare) => {
      const frozen = await prepare();
      if (change === "deleted") await prisma.project.delete({ where: { id: project.id } });
      else await prisma.project.update({ where: { id: project.id }, data: change === "revision"
        ? { revision: { increment: 1 } } : change === "owner" ? { userId: stranger } : { isDemo: true } });
      return frozen;
    });
    await expect(enqueueCalculation(db, owner, { operation: "RECALCULATE", projectId: project.id, expectedRevision: 0 }, randomUUID()))
      .rejects.toMatchObject({ status: change === "revision" ? 409 : change === "demo" ? 422 : 404 });
    expect(await prisma.calculationRun.count({ where: { ownerId: owner } })).toBe(0);
  }, 30_000);

  it("concurrent duplicate requests commit exactly one durable operation", async () => {
    const key = randomUUID();
    const accepted = await Promise.all(Array.from({ length: 6 }, () => enqueueCalculation(prisma, owner, request, key)));
    expect(new Set(accepted.map(job => job.id)).size).toBe(1);
    expect(await prisma.calculationJob.count({ where: { ownerId: owner } })).toBe(1);
    expect(await prisma.calculationRun.count({ where: { ownerId: owner } })).toBe(1);
  }, 30_000);

  it("three different concurrent keys cannot bypass the two-job owner quota", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 3 }, () => enqueueCalculation(prisma, owner, request, randomUUID())));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(2);
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { status: 429 } });
    expect(await prisma.calculationJob.count({ where: { ownerId: owner, status: { in: ["QUEUED", "RUNNING"] } } })).toBe(2);
  }, 30_000);

  it("the global 100-job cap holds across different owners and concurrent enqueue transactions", async () => {
    const extra = await prisma.user.create({ data: { email: `${prefix}global-cap@test.local`, passwordHash: "not-a-login" } });
    try {
      // Direct fixtures isolate the global bound from the per-owner cap. They represent
      // existing queue occupancy; only the four racing requests use the enqueue service.
      const seeds = Array.from({ length: 98 }, () => ({ id: randomUUID(), key: randomUUID() }));
      await prisma.calculationRun.createMany({ data: seeds.map(seed => ({ id: seed.id, ownerId: stranger, operation: "CALCULATE",
        input: { globalCapFixture: true }, inputHash: seed.key, engineRelease: engineRelease() })) });
      await prisma.calculationJob.createMany({ data: seeds.map(seed => ({ runId: seed.id, ownerId: stranger, operation: "CALCULATE",
        idempotencyKey: seed.key, requestHash: seed.key })) });
      const outcomes = await Promise.allSettled([owner, extra.id, owner, extra.id]
        .map(actor => enqueueCalculation(prisma, actor, request, randomUUID())));
      expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(2);
      for (const outcome of outcomes.filter(outcome => outcome.status === "rejected")) {
        expect(outcome).toMatchObject({ reason: { status: 429 } });
      }
      expect(await prisma.calculationJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })).toBe(100);
    } finally {
      await prisma.user.delete({ where: { id: extra.id } });
    }
  }, 30_000);

  it("an accepted idempotent replay succeeds when the owner's queue is full", async () => {
    const key = randomUUID();
    const first = await enqueueCalculation(prisma, owner, request, key);
    await enqueueCalculation(prisma, owner, request, randomUUID());
    await expect(enqueueCalculation(prisma, owner, request, randomUUID())).rejects.toMatchObject({ status: 429 });
    const replay = await enqueueCalculation(prisma, owner, request, key);
    expect(replay.id).toBe(first.id);
    expect(await prisma.calculationJob.count({ where: { ownerId: owner } })).toBe(2);
  }, 30_000);

  it("same-owner changed intent conflicts, while another owner has an independent key namespace", async () => {
    const key = randomUUID();
    const original = await enqueueCalculation(prisma, owner, request, key);
    await expect(enqueueCalculation(prisma, owner, { ...request, facility: "medical" }, key)).rejects.toMatchObject({ status: 409 });
    const other = await enqueueCalculation(prisma, stranger, request, key);
    expect(other.id).not.toBe(original.id);
    expect(await getOwnedJob(prisma, owner, other.id)).toBeNull();
    expect(await getOwnedJobResult(prisma, stranger, original.id)).toBeNull();
  }, 30_000);

  it("a queued run keeps its exact catalogue snapshot and idempotent intent after a norm changes", async () => {
    const norm = await prisma.norm.findUniqueOrThrow({ where: { key: "discountRate" } });
    const changed = norm.value === 0.2 ? 0.15 : 0.2;
    const key = randomUUID();
    const original = await enqueueCalculation(prisma, owner, request, key);
    const before = await prisma.calculationRun.findUniqueOrThrow({ where: { id: original.runId } });
    const originalInput = before.input as unknown as { live: { norms: { discountRate: number } } };
    expect(originalInput.live.norms.discountRate).toBe(norm.value);
    try {
      await prisma.norm.update({ where: { key: norm.key }, data: { value: changed } });
      const replay = await enqueueCalculation(prisma, owner, request, key);
      expect(replay.id).toBe(original.id);
      const retained = await prisma.calculationRun.findUniqueOrThrow({ where: { id: original.runId } });
      expect(retained.input).toEqual(before.input);
      expect(retained.inputHash).toBe(before.inputHash);
      const fresh = await enqueueCalculation(prisma, owner, request, randomUUID());
      const newer = await prisma.calculationRun.findUniqueOrThrow({ where: { id: fresh.runId } });
      expect((newer.input as unknown as { live: { norms: { discountRate: number } } }).live.norms.discountRate).toBe(changed);
      expect(newer.inputHash).not.toBe(before.inputHash);
    } finally {
      await prisma.norm.update({ where: { key: norm.key }, data: { value: norm.value } });
    }
  }, 30_000);

  it("a purged terminal request key is a tombstone rather than permission to repeat the operation", async () => {
    const key = randomUUID();
    const accepted = await enqueueCalculation(prisma, owner, request, key);
    await cancelJob(prisma, owner, accepted.id);
    expect(await deleteOwnedTerminalJob(prisma, owner, accepted.id)).toBe(true);
    await expect(enqueueCalculation(prisma, owner, request, key)).rejects.toMatchObject({ status: 410 });
    expect(await prisma.calculationJob.count({ where: { ownerId: owner } })).toBe(1);
    const fresh = await enqueueCalculation(prisma, owner, request, randomUUID());
    expect(fresh.id).not.toBe(accepted.id);
  }, 30_000);

  it("retained-history quota counts terminal snapshots, frees purged payloads, and survives concurrent admission", async () => {
    const seeds = Array.from({ length: 199 }, () => ({ id: randomUUID(), key: randomUUID() }));
    await prisma.calculationRun.createMany({ data: seeds.map(seed => ({ id: seed.id, ownerId: owner, operation: "CALCULATE",
      input: { historyFixture: true }, inputHash: seed.key, engineRelease: engineRelease(), results: { historyFixture: true }, completedAt: new Date() })) });
    await prisma.calculationJob.createMany({ data: seeds.map(seed => ({ runId: seed.id, ownerId: owner, operation: "CALCULATE",
      idempotencyKey: seed.key, requestHash: seed.key, status: "SUCCEEDED", stage: "succeeded", progress: 100, finishedAt: new Date() })) });
    const outcomes = await Promise.allSettled([randomUUID(), randomUUID()].map(key => enqueueCalculation(prisma, owner, request, key)));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { status: 429, code: "HISTORY_FULL" } });
    expect(await prisma.calculationRun.count({ where: { ownerId: owner, purgedAt: null } })).toBe(200);
    const old = await prisma.calculationJob.findUniqueOrThrow({ where: { runId: seeds[0]!.id } });
    expect(await deleteOwnedTerminalJob(prisma, owner, old.id)).toBe(true);
    await enqueueCalculation(prisma, owner, request, randomUUID());
    expect(await prisma.calculationRun.count({ where: { ownerId: owner, purgedAt: null } })).toBe(200);
    expect(await prisma.calculationRun.count({ where: { ownerId: owner } })).toBe(201);
  }, 30_000);

  it("oversized UTF-8 input and forged results are rejected without retaining partial jobs", async () => {
    await expect(enqueueCalculation(prisma, owner, { ...request, params: { note: "Ж".repeat(2 * 1024 * 1024) } }, randomUUID()))
      .rejects.toMatchObject({ status: 413 });
    await expect(enqueueCalculation(prisma, owner, { ...request, results: { status: "OK", npvRub: 999999999 } }, randomUUID()))
      .rejects.toMatchObject({ status: 422 });
    expect(await prisma.calculationJob.count({ where: { ownerId: owner } })).toBe(0);
    expect(await prisma.calculationRun.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("post-commit CREATE replay returns its terminal job instead of creating a second project", async () => {
    const key = randomUUID();
    const intent = { operation: "CREATE", name: `${prefix}lost-create-receipt`, facility: "warehouse" } as const;
    const accepted = await enqueueCalculation(prisma, owner, intent, key);
    expect(await prisma.project.count({ where: { userId: owner } })).toBe(0);
    const claim = await claimJob(prisma, { workerId: "adversary-create" });
    if (!claim) throw new Error("Expected a create claim");
    const computed = await computeFrozenCalculation(claim.run.input);
    expect(await completeJob(prisma, claim, computed, publishFrozenCalculation)).toBe(true);
    // Simulate loss of the acknowledgement: do not consume the completion result; send
    // the exact original request as a newly started client would after a network failure.
    const recovered = await enqueueCalculation(prisma, owner, intent, key);
    expect(recovered.id).toBe(accepted.id);
    expect(recovered.status).toBe("SUCCEEDED");
    expect(recovered.publicationState).toBe("PUBLISHED");
    expect(recovered.projectId).not.toBeNull();
    expect(await prisma.project.count({ where: { userId: owner } })).toBe(1);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: recovered.projectId! } });
    expect(project.revision).toBe(0);
    expect(project.results).toEqual(JSON.parse(JSON.stringify(computed.results)));
  }, 60_000);

  it("deleting a created project does not turn its old submission key into a second CREATE", async () => {
    const key = randomUUID();
    const intent = { operation: "CREATE", name: `${prefix}deleted-create`, facility: "warehouse" } as const;
    const accepted = await enqueueCalculation(prisma, owner, intent, key);
    const claim = await claimJob(prisma, { workerId: "adversary-deleted-create-replay" });
    if (!claim) throw new Error("Expected a create claim");
    const computed = await computeFrozenCalculation(claim.run.input);
    await completeJob(prisma, claim, computed, publishFrozenCalculation);
    const completed = await getOwnedJob(prisma, owner, accepted.id);
    if (!completed?.projectId) throw new Error("Expected project publication");
    await prisma.project.delete({ where: { id: completed.projectId } });
    expect(await prisma.calculationJob.findUnique({ where: { id: accepted.id } })).toBeNull();
    await expect(enqueueCalculation(prisma, owner, intent, key)).rejects.toMatchObject({ status: 410 });
    await expect(enqueueCalculation(prisma, owner, { ...intent, name: `${intent.name} changed` }, key)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.project.count({ where: { userId: owner } })).toBe(0);
    expect(await prisma.calculationJob.count({ where: { ownerId: owner } })).toBe(0);
  }, 60_000);

  it("a lost SAVE receipt can be recovered after the successful commit changed the project revision", async () => {
    const create = await enqueueCalculation(prisma, owner, { operation: "CREATE", name: `${prefix}save-recovery`, facility: "warehouse" }, randomUUID());
    const firstClaim = await claimJob(prisma, { workerId: "adversary-create-for-save" });
    if (!firstClaim) throw new Error("Expected initial claim");
    const initial = await computeFrozenCalculation(firstClaim.run.input);
    await completeJob(prisma, firstClaim, initial, publishFrozenCalculation);
    const created = await getOwnedJob(prisma, owner, create.id);
    if (!created?.projectId) throw new Error("Expected published project");
    const key = randomUUID();
    const intent = { operation: "SAVE", projectId: created.projectId, expectedRevision: 0,
      params: { ...initial.results.paramsUsed, forkliftSalaryRubMonth: 130000 }, scenarios: initial.results.scenarios,
      changes: [{ field: "param:forkliftSalaryRubMonth", auto: 0, old: 120000, new: 130000, reason: "lost receipt test" }] } as const;
    const accepted = await enqueueCalculation(prisma, owner, intent, key);
    const before = await prisma.project.findUniqueOrThrow({ where: { id: created.projectId } });
    expect(before.revision).toBe(0);
    expect(before.results).toEqual(JSON.parse(JSON.stringify(initial.results)));
    const claim = await claimJob(prisma, { workerId: "adversary-save" });
    if (!claim) throw new Error("Expected save claim");
    const computed = await computeFrozenCalculation(claim.run.input);
    expect(await completeJob(prisma, claim, computed, publishFrozenCalculation)).toBe(true);
    const recovered = await enqueueCalculation(prisma, owner, intent, key);
    expect(recovered.id).toBe(accepted.id);
    expect(recovered.status).toBe("SUCCEEDED");
    expect(recovered.publishedRevision).toBe(1);
    const after = await prisma.project.findUniqueOrThrow({ where: { id: created.projectId } });
    expect(after.revision).toBe(1);
    expect((after.params as Record<string, unknown>).forkliftSalaryRubMonth).toBe(130000);
    expect(await prisma.changeLog.count({ where: { projectId: after.id } })).toBe(1);
    await expect(enqueueCalculation(prisma, owner, intent, randomUUID())).rejects.toMatchObject({ status: 409 });
  }, 60_000);
});
