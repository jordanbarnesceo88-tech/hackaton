import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { findIdempotent, getOwnedJob, getOwnedJobResult, listOwnedJobs } from "./store";

function fixture() {
  const job = { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) };
  const submission = { findUnique: vi.fn().mockResolvedValue(null) };
  const db = { calculationJob: job, calculationSubmission: submission } as unknown as PrismaClient;
  return { db, job };
}

function expectCompactRunProjection(query: unknown) {
  const run = (query as { include: { run: unknown } }).include.run;
  expect(run).not.toBe(true);
  const select = (run as { select: Record<string, boolean> }).select;
  expect(select).toBeDefined();
  expect(select.input).not.toBe(true);
  expect(select.results).not.toBe(true);
  expect(select.projectId).toBe(true);
  expect(select.publicationState).toBe(true);
}

describe("compact calculation status database reads", () => {
  it("does not fetch immutable input/results for each polling request", async () => {
    const { db, job } = fixture();
    expect(await getOwnedJob(db, "owner", "job")).toBeNull();
    expectCompactRunProjection(job.findFirst.mock.calls[0]![0]);
  });

  it("does not fetch up to 50 large snapshots for the history list", async () => {
    const { db, job } = fixture();
    expect(await listOwnedJobs(db, "owner", { limit: 50 })).toEqual([]);
    expectCompactRunProjection(job.findMany.mock.calls[0]![0]);
  });

  it("does not reload completed input/results on idempotent submission lookup", async () => {
    const { db, job } = fixture();
    expect(await findIdempotent(db as unknown as Prisma.TransactionClient, "owner", "key", "hash")).toBeNull();
    expectCompactRunProjection(job.findFirst.mock.calls[0]![0]);
  });

  it("retains full snapshot access only through the explicit owner-gated result operation", async () => {
    const { db, job } = fixture();
    expect(await getOwnedJobResult(db, "owner", "job")).toBeNull();
    expect(job.findFirst.mock.calls[0]![0]).toMatchObject({ where: { id: "job", ownerId: "owner", run: { ownerId: "owner" } }, include: { run: true } });
  });
});
