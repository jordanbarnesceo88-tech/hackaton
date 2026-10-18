import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { getSolutionApplicability, getSolutionForCalc, getTaskCategories } from "@/lib/db/queries";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";
import { computeEconomics } from "@/lib/economics/calculate";
import { toSolutionCapacity } from "@/lib/economics/normalize";
import { ANALYSIS_INPUT_MAX_BYTES } from "./validate";

// saveAnalysisAction is the app's write boundary: it decides what a client may persist, and it
// derives facilityTypeSlug from the database rather than trusting the payload. It sat at 0%
// coverage. auth() is the only thing that has to be faked — everything else runs against the
// real database, so the assertions are about behaviour rather than about the mocks.
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const { saveAnalysisAction } = await import("./actions");

const TEST_EMAIL = "action-test@example.com";
let userId = "";
let solutionId = "";
let realSlug = "";

beforeEach(async () => {
  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: {},
    create: { email: TEST_EMAIL, passwordHash: "x" },
  });
  userId = user.id;
  const sol = await prisma.solution.findFirstOrThrow();
  solutionId = sol.id;
  // A solution no longer has ONE facility type — it has a set, via its category. The first
  // applicable slug stands in for "a facility type this solution is legitimately used in".
  realSlug = (await getSolutionApplicability(sol.id))[0]!;
  mockAuth.mockResolvedValue({ user: { id: userId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
});

const payload = (over: Record<string, unknown> = {}) => ({
  name: "test analysis",
  // Was "whatever-the-client-claims" back when the server ignored this field and derived the
  // slug instead. The server now validates it against the solution's applicable set, so the
  // default has to be a real one; the rejection is asserted explicitly below.
  facilityTypeSlug: realSlug,
  solutionId,
  params: { areaM2: 1000, opsPerDay: 500, staffCount: 10 },
  assumptions: { ...DEFAULT_ASSUMPTIONS },
  ...over,
});

describe("saveAnalysisAction", () => {
  it("persists a valid payload", async () => {
    const res = await saveAnalysisAction(payload());
    expect(res.ok).toBe(true);
  });

  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await saveAnalysisAction(payload())).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  // The guarantee under test is unchanged — a client cannot get an arbitrary facility type
  // stored against an analysis. Only the mechanism changed: the server used to derive the slug
  // and ignore the claim; now it rejects a claim outside the solution's applicable set,
  // because a category serves many facility types and there is no single one to derive.
  it("rejects a facility type the solution does not apply to", async () => {
    const res = await saveAnalysisAction(payload({ facilityTypeSlug: "attacker-supplied" }));
    expect(res.ok).toBe(false);
  });

  it("stores an applicable facility type exactly as claimed", async () => {
    const applicable = await getSolutionApplicability(solutionId);
    expect(applicable.length).toBeGreaterThan(0);
    const res = await saveAnalysisAction(payload({ facilityTypeSlug: applicable[0]! }));
    if (!res.ok) throw new Error("expected the save to succeed");
    const saved = await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: res.id } });
    expect(saved.facilityTypeSlug).toBe(applicable[0]);
  });

  it("rejects a taskStaffing key that does not apply to the claimed facility (Р-4)", async () => {
    // Экран занятости посторонние ключи отбрасывает, но экран — не граница: сюда приходит
    // payload. Занятость по задаче, которой на этом объекте нет, — это данные, которые потом
    // прочитают как истину в отчёте, отдаваемом клиенту.
    const res = await saveAnalysisAction(
      payload({ params: { areaM2: 1000, opsPerDay: 500, staffCount: 10, taskStaffing: { "не-та-задача": 3 } } })
    );
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts taskStaffing whose keys do apply", async () => {
    const applicableTasks = await getTaskCategories(realSlug);
    expect(applicableTasks.length).toBeGreaterThan(0);
    const res = await saveAnalysisAction(
      payload({
        params: {
          areaM2: 1000,
          opsPerDay: 500,
          staffCount: 10,
          taskStaffing: { [applicableTasks[0]!.slug]: 3 },
        },
      })
    );
    expect(res.ok).toBe(true);
  });

  it("stores the analysis against the session user, not any id in the payload", async () => {
    const res = await saveAnalysisAction({ ...payload(), userId: "someone-else" } as never);
    if (!res.ok) throw new Error("expected the save to succeed");
    const saved = await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: res.id } });
    expect(saved.userId).toBe(userId);
  });

  it("rejects a solutionId that does not exist", async () => {
    expect(await saveAnalysisAction(payload({ solutionId: "no-such-solution" }))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an empty name and caps a long one", async () => {
    expect(await saveAnalysisAction(payload({ name: "   " }))).toEqual({ ok: false, reason: "invalid" });
    const res = await saveAnalysisAction(payload({ name: "x".repeat(500) }));
    if (!res.ok) throw new Error("expected the save to succeed");
    const saved = await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: res.id } });
    expect(saved.name).toHaveLength(120);
  });

  it("rejects malformed params and out-of-range assumptions", async () => {
    expect(await saveAnalysisAction(payload({ params: { areaM2: 1 } }))).toEqual({ ok: false, reason: "invalid" });
    expect(
      await saveAnalysisAction(payload({ assumptions: { ...DEFAULT_ASSUMPTIONS, laborReplacementPct: 5 } }))
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("ignores forged client economics and stores the server result while preserving all user overrides", async () => {
    const solution = await getSolutionForCalc(solutionId);
    if (!solution) throw new Error("Missing server solution");
    const params = { areaM2: 1000, opsPerDay: 500, staffCount: 10, quantityOverride: 4,
      capexPerUnitUsdOverride: 123000, taskStaffing: { [solution.solutionCategory.slug]: 3 } };
    const assumptions = { ...DEFAULT_ASSUMPTIONS, discountRate: 0.125 };
    const canonical = computeEconomics(toSolutionCapacity({ ...solution, workloadStream: solution.solutionCategory.workloadStream,
      categorySlug: solution.solutionCategory.slug, workerOutputPerYear: solution.solutionCategory.workerOutputPerYear }), params, assumptions);
    const forged = { economical: true, npvUsd: 999999999, capexUsd: 0, secretPadding: "do not persist client fields" };
    const res = await saveAnalysisAction(payload({ params, assumptions, results: forged }));
    if (!res.ok) throw new Error("Canonical save should succeed");
    const saved = await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: res.id } });
    expect(saved.params).toEqual(params); expect(saved.assumptions).toEqual(assumptions);
    expect(saved.results).toEqual(canonical); expect(saved.results).not.toEqual(forged);
    expect(saved.results).not.toHaveProperty("secretPadding");
    expect(saved.userId).toBe(userId);
  });

  it("rejects oversized UTF-8 commands before a DB transaction and leaves existing analyses intact", async () => {
    const existing = await saveAnalysisAction(payload());
    if (!existing.ok) throw new Error("Expected existing saved analysis");
    const before = await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: existing.id } });
    const count = await prisma.savedAnalysis.count({ where: { userId } });
    const transaction = vi.spyOn(prisma, "$transaction");
    try {
      // Characters are below 64KiB; encoded bytes exceed it. Even ignored client output
      // and unknown padding count toward the request bound.
      expect(await saveAnalysisAction(payload({ results: { padding: "я".repeat(ANALYSIS_INPUT_MAX_BYTES / 2) } }))).toEqual({ ok: false, reason: "invalid" });
      expect(transaction).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); }
    expect(await prisma.savedAnalysis.count({ where: { userId } })).toBe(count);
    expect(await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(before);
  });

  it("rejects malformed root commands instead of dereferencing them", async () => {
    for (const input of [null, undefined, [], "invalid", 1]) {
      expect(await saveAnalysisAction(input)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});
