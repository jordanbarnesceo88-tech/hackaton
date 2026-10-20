import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveInputs } from "../projects/recalc";
import { enqueueCalculation } from "./service";
import { enqueueWithinTransaction, type EnqueuePrepared } from "./store";
import { stableJson } from "../tz/version";

const mocks = vi.hoisted(() => ({ load: vi.fn(), project: vi.fn() }));
vi.mock("../projects/recalc", () => ({ loadLiveInputs: mocks.load, resultsFromInputsAsync: vi.fn() }));
vi.mock("../projects/queries", async original => ({ ...await original<typeof import("../projects/queries")>(), getProject: mocks.project }));

const engine = `alfa-robot/sha256:${"a".repeat(64)}`;
const live = { products: [], paramDefs: [], norms: {}, paramDefsFrom: "db" } as unknown as LiveInputs;
const calculate = { operation: "CALCULATE" as const, facility: "warehouse" };
const recalculate = { operation: "RECALCULATE" as const, projectId: "project", expectedRevision: 7 };
const project = { id: "project", facility: "warehouse", revision: 7, isDemo: false, params: {}, scenarios: [], results: null };

function jobRow(requestHash = "request") {
  return { id: "job", runId: "run", operation: "CALCULATE", status: "QUEUED", stage: "queued", progress: 0, attempts: 0,
    requestHash, safeMessage: null, createdAt: new Date("2026-10-19T00:00:00Z"), startedAt: null, finishedAt: null, diagnosticCode: null,
    cancelRequestedAt: null, run: { projectId: null, reservedProjectId: null, publicationState: "NONE", publishedRevision: null, engineRelease: engine, purgedAt: null } };
}

function fixture() {
  let phase = "direct", admission = 0;
  const trace: string[] = [];
  const controls = { earlyExisting: false, lockedExisting: false, ownerExists: true,
    projectRows: [{ revision: 7, isDemo: false }] as { revision: number; isDemo: boolean }[],
    lockedOwnedActive: 0, failLocks: 0, existingRequestHash: "request" };
  const event = (name: string) => { trace.push(`${phase}:${name}`); };
  const tx = {
    $executeRaw: vi.fn(async () => { event("read-only"); return 0; }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("pg_advisory_xact_lock")) {
        event("lock"); if (controls.failLocks > 0) { controls.failLocks--; throw { code: "P2034" }; } return [];
      }
      if (sql.includes('FROM "User"')) { event("owner"); return controls.ownerExists ? [{ id: "owner" }] : []; }
      if (sql.includes('FROM "Project"')) { event("project"); return controls.projectRows; }
      throw new Error("Unexpected SQL in admission fixture");
    }),
    calculationSubmission: {
      findUnique: vi.fn(async () => { event("idempotency-key"); return null; }),
      create: vi.fn(async () => { event("submission-write"); return {}; }),
    },
    calculationJob: {
      findFirst: vi.fn(async () => { event("idempotency-job"); return (phase === "prepare" ? controls.earlyExisting : controls.lockedExisting) ? jobRow(controls.existingRequestHash) : null; }),
      count: vi.fn(async (query: { where: { ownerId?: string } }) => { event(query.where.ownerId ? "owned-active" : "global-active"); return phase !== "prepare" && query.where.ownerId ? controls.lockedOwnedActive : 0; }),
      create: vi.fn(async () => { event("job-write"); return jobRow(); }),
    },
    calculationRun: {
      count: vi.fn(async (query: { where: { ownerId?: string } }) => { event(query.where.ownerId ? "owned-history" : "global-history"); return 0; }),
      create: vi.fn(async () => { event("run-write"); return { id: "run" }; }),
    },
  };
  const transaction = vi.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: string }) => {
    phase = options.isolationLevel === "RepeatableRead" ? "prepare" : `admission${++admission}`;
    return work(tx as unknown as Prisma.TransactionClient);
  });
  return { tx, db: { $transaction: transaction } as unknown as PrismaClient, transaction, trace, controls };
}

function prepared(payload: unknown = { schemaVersion: 1 }) {
  return { ownerId: "owner", operation: "CALCULATE", idempotencyKey: "key", requestHash: "request", inputHash: "input", payload, engineRelease: engine } satisfies EnqueuePrepared;
}

beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue(live);
  mocks.project.mockReset().mockResolvedValue(project);
});

describe("single locked calculation admission", () => {
  it("performs exactly one locked idempotency/quota pass while retaining the coherent preparation snapshot", async () => {
    const f = fixture();
    expect((await enqueueCalculation(f.db, "owner", calculate, "key")).id).toBe("job");
    expect(f.trace.filter(item => item.startsWith("admission1:"))).toEqual([
      "admission1:lock", "admission1:idempotency-key", "admission1:idempotency-job",
      "admission1:owned-active", "admission1:global-active", "admission1:owned-history", "admission1:global-history",
      "admission1:owner", "admission1:run-write", "admission1:job-write", "admission1:submission-write",
    ]);
    expect(f.transaction.mock.calls.map(([, options]) => options)).toEqual([
      { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 15_000 },
      { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 },
    ]);
    expect(f.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(f.tx.calculationJob.count).toHaveBeenCalledTimes(4);
    expect(f.tx.calculationRun.count).toHaveBeenCalledTimes(4);
  });

  it("checks owner then locked project revision before the first write", async () => {
    const f = fixture();
    await enqueueCalculation(f.db, "owner", recalculate, "key");
    const order = f.trace.filter(item => item.startsWith("admission1:"));
    expect(order.indexOf("admission1:owner")).toBeGreaterThan(order.indexOf("admission1:global-history"));
    expect(order.indexOf("admission1:project")).toBe(order.indexOf("admission1:owner") + 1);
    expect(order.indexOf("admission1:run-write")).toBe(order.indexOf("admission1:project") + 1);
    const ownerSql = f.tx.$queryRaw.mock.calls.find(([sql]) => sql.join("").includes('FROM "User"'))![0].join("");
    const projectSql = f.tx.$queryRaw.mock.calls.find(([sql]) => sql.join("").includes('FROM "Project"'))![0].join("");
    expect(ownerSql).toContain("FOR KEY SHARE"); expect(projectSql).toContain("FOR SHARE");
  });

  it.each([
    { reason: "deleted owner", owner: false, rows: [{ revision: 7, isDemo: false }], status: 401 },
    { reason: "deleted project", owner: true, rows: [], status: 404 },
    { reason: "demo replacement", owner: true, rows: [{ revision: 7, isDemo: true }], status: 422 },
    { reason: "concurrent revision", owner: true, rows: [{ revision: 8, isDemo: false }], status: 409 },
  ])("rejects $reason under the admission fence without writes", async ({ owner, rows, status }) => {
    const f = fixture(); f.controls.ownerExists = owner; f.controls.projectRows = rows;
    await expect(enqueueCalculation(f.db, "owner", recalculate, "key")).rejects.toMatchObject({ status });
    expect(f.tx.calculationRun.create).not.toHaveBeenCalled();
    expect(f.tx.calculationJob.create).not.toHaveBeenCalled();
    expect(f.tx.calculationSubmission.create).not.toHaveBeenCalled();
  });

  it("rechecks quotas under lock after a successful preparation and before owner/publication checks", async () => {
    const f = fixture(); f.controls.lockedOwnedActive = 2;
    await expect(enqueueCalculation(f.db, "owner", recalculate, "key")).rejects.toMatchObject({ name: "JobQueueFull" });
    expect(f.trace).not.toContain("admission1:owner");
    expect(f.tx.calculationRun.create).not.toHaveBeenCalled();
  });

  it("returns an already committed receipt before catalogue or revision validation", async () => {
    const f = fixture(); f.controls.earlyExisting = true;
    f.controls.existingRequestHash = createHash("sha256").update(stableJson(recalculate)).digest("hex");
    expect((await enqueueCalculation(f.db, "owner", recalculate, "key")).id).toBe("job");
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.project).not.toHaveBeenCalled();
    expect(f.transaction).toHaveBeenCalledOnce(); expect(f.trace).toEqual(["prepare:read-only", "prepare:idempotency-key", "prepare:idempotency-job"]);
  });

  it("retries a valid CREATE with its original intent hash before reading a changed catalogue", async () => {
    const f = fixture();
    const request = { operation: "CREATE" as const, name: "  Склад  ", objectName: "  Объект  ", facility: "warehouse",
      paramsSource: { kind: "demo" as const } };
    f.controls.earlyExisting = true;
    f.controls.existingRequestHash = createHash("sha256").update(stableJson(request)).digest("hex");
    mocks.load.mockRejectedValue(new Error("Catalogue changed or is unavailable"));
    expect((await enqueueCalculation(f.db, "owner", request, "key")).id).toBe("job");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(f.tx.calculationRun.create).not.toHaveBeenCalled();
    expect(f.transaction).toHaveBeenCalledOnce();
  });

  it("freezes normalized CREATE metadata without changing the submitted intent", async () => {
    const f = fixture();
    const request = { operation: "CREATE" as const, name: "  Склад  ", objectName: "  Объект  ", facility: "warehouse",
      paramsSource: { kind: "upload" as const, fileName: "warehouse.csv" } };
    const before = structuredClone(request);
    await enqueueCalculation(f.db, "owner", request, "key");
    expect(f.tx.calculationRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ input: expect.objectContaining({ publication: {
        reservedProjectId: expect.any(String), name: "Склад", objectName: "Объект",
        paramsSource: { kind: "upload", fileName: "warehouse.csv" },
      } }) }),
    }));
    expect(request).toEqual(before);
    expect(f.tx.calculationJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestHash: createHash("sha256").update(stableJson(before)).digest("hex") }),
    }));
  });

  it("returns a racing committed receipt before quota and publication checks", async () => {
    const f = fixture(); f.controls.lockedExisting = true; f.controls.ownerExists = false; f.controls.lockedOwnedActive = 2;
    f.controls.existingRequestHash = createHash("sha256").update(stableJson(recalculate)).digest("hex");
    expect((await enqueueCalculation(f.db, "owner", recalculate, "key")).id).toBe("job");
    expect(f.trace.filter(item => item.startsWith("admission1:"))).toEqual(["admission1:lock", "admission1:idempotency-key", "admission1:idempotency-job"]);
    expect(f.tx.calculationRun.create).not.toHaveBeenCalled();
  });

  it("returns a racing receipt before resolving a new execution engine", async () => {
    const f = fixture(); f.controls.lockedExisting = true;
    f.controls.existingRequestHash = createHash("sha256").update(stableJson(calculate)).digest("hex");
    vi.stubEnv("CALCULATION_ENGINE_FINGERPRINT", "invalid-new-engine");
    try { expect((await enqueueCalculation(f.db, "owner", calculate, "key")).id).toBe("job"); }
    finally { vi.unstubAllEnvs(); }
    expect(f.tx.calculationRun.create).not.toHaveBeenCalled();
  });

  it("retries only short admission with the same prepared snapshot", async () => {
    const f = fixture(); f.controls.failLocks = 1;
    expect((await enqueueCalculation(f.db, "owner", calculate, "key")).id).toBe("job");
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(f.transaction).toHaveBeenCalledTimes(3);
    expect(f.trace.filter(item => item.startsWith("admission1:"))).toEqual(["admission1:lock"]);
    expect(f.tx.calculationRun.create).toHaveBeenCalledOnce();
  });

  it("keeps direct store callers protected and awaits their validator before writes", async () => {
    const f = fixture(), validator = vi.fn(async () => { f.trace.push("validated"); });
    await enqueueWithinTransaction(f.tx as unknown as Prisma.TransactionClient, prepared(), validator);
    expect(f.trace.indexOf("validated")).toBeGreaterThan(f.trace.indexOf("direct:global-history"));
    expect(f.trace.indexOf("direct:run-write")).toBe(f.trace.indexOf("validated") + 1);
    expect(validator).toHaveBeenCalledOnce();
  });

  it("cannot write when the awaited publication validator rejects", async () => {
    const f = fixture(), error = new Error("publication changed");
    await expect(enqueueWithinTransaction(f.tx as unknown as Prisma.TransactionClient, prepared(), async () => { throw error; })).rejects.toBe(error);
    expect(f.tx.calculationRun.create).not.toHaveBeenCalled(); expect(f.tx.calculationJob.create).not.toHaveBeenCalled();
  });

  it.each(["undefined", "bigint", "cyclic", "throwing-getter"])("returns idempotent receipt before touching %s payload or calling the publication validator", async kind => {
    const f = fixture(); f.controls.lockedExisting = true;
    const input = prepared();
    if (kind === "undefined") input.payload = undefined;
    if (kind === "bigint") input.payload = BigInt(1);
    if (kind === "cyclic") { const cycle: { self?: unknown } = {}; cycle.self = cycle; input.payload = cycle; }
    if (kind === "throwing-getter") Object.defineProperty(input, "payload", { get() { throw new Error("Must not read payload"); } });
    const validator = vi.fn(async () => { throw new Error("Must not validate a committed duplicate"); });
    expect((await enqueueWithinTransaction(f.tx as unknown as Prisma.TransactionClient, input, validator)).id).toBe("job");
    expect(validator).not.toHaveBeenCalled(); expect(f.tx.calculationJob.count).not.toHaveBeenCalled(); expect(f.tx.calculationRun.create).not.toHaveBeenCalled();
  });
});
