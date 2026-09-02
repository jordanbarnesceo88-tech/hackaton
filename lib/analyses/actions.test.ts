import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";

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
  const sol = await prisma.solution.findFirstOrThrow({
    include: { solutionCategory: { include: { facilityType: true } } },
  });
  solutionId = sol.id;
  realSlug = sol.solutionCategory.facilityType.slug;
  mockAuth.mockResolvedValue({ user: { id: userId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
});

const payload = (over: Record<string, unknown> = {}) => ({
  name: "test analysis",
  facilityTypeSlug: "whatever-the-client-claims",
  solutionId,
  params: { areaM2: 1000, opsPerDay: 500, staffCount: 10 },
  assumptions: { ...DEFAULT_ASSUMPTIONS },
  results: { economical: false, reason: "no_savings" },
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

  it("derives facilityTypeSlug from the solution, ignoring the client's claim", async () => {
    const res = await saveAnalysisAction(payload({ facilityTypeSlug: "attacker-supplied" }));
    if (!res.ok) throw new Error("expected the save to succeed");
    const saved = await prisma.savedAnalysis.findUniqueOrThrow({ where: { id: res.id } });
    expect(saved.facilityTypeSlug).toBe(realSlug);
    expect(saved.facilityTypeSlug).not.toBe("attacker-supplied");
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

  it("rejects a non-object results blob", async () => {
    expect(await saveAnalysisAction(payload({ results: "not an object" }))).toEqual({ ok: false, reason: "invalid" });
  });
});
