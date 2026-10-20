import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), config: vi.fn(), project: vi.fn(), latest: vi.fn(), save: vi.fn(), generate: vi.fn(), rate: vi.fn(), current: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: mocks.session }));
vi.mock("@/lib/ai/config", () => ({ readAiConfig: mocks.config }));
vi.mock("@/lib/projects/queries", () => ({ getProject: mocks.project }));
vi.mock("@/lib/ai/advice/facts", () => ({ buildAdviceFacts: () => ({ object: "Склад", alternatives: [] }) }));
vi.mock("@/lib/ai/advice/hash", () => ({ adviceFactsHash: () => "facts-hash" }));
vi.mock("@/lib/ai/advice/store", () => ({ latestAdvice: mocks.latest, saveAdvice: mocks.save }));
vi.mock("@/lib/ai/advice/generate", () => ({ generateAdvice: mocks.generate }));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: mocks.rate }));
vi.mock("@/lib/db/client", () => ({ prisma: { project: { findFirst: mocks.current } } }));
const { POST } = await import("@/app/(app)/projects/[projectId]/ai-advice/route");
const context = { params: Promise.resolve({ projectId: "owned-project" }) };
const advice = { summary: "Тестовая рекомендация" };
function request(body: unknown = { expectedRevision: 2 }, origin = "http://localhost") {
  return new Request("http://localhost/projects/owned-project/ai-advice", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "owner" });
  mocks.config.mockReturnValue({ url: "https://ai.example", key: "synthetic-test-key", model: "test-model" });
  mocks.project.mockResolvedValue({ revision: 2, results: {} });
  mocks.latest.mockResolvedValue(null);
  mocks.current.mockResolvedValue({ revision: 2 });
  mocks.rate.mockResolvedValue({ ok: true, retryAfterSec: 0 });
  mocks.generate.mockResolvedValue({ content: advice });
  mocks.save.mockResolvedValue("saved");
});

describe("AI project advice revision boundary", () => {
  it("authenticates and rejects foreign origins before accessing the project or provider", async () => {
    expect((await POST(request({}, "https://foreign.example"), context)).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("requires the displayed revision and rejects unknown or oversized commands", async () => {
    expect((await POST(request({}), context)).status).toBe(428);
    for (const expectedRevision of [-1, 1.5, "2", null]) expect((await POST(request({ expectedRevision }), context)).status).toBe(422);
    expect((await POST(request({ expectedRevision: 2, facts: {} }), context)).status).toBe(422);
    expect((await POST(request({ expectedRevision: 2, extra: "x".repeat(4096) }), context)).status).toBe(413);
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("refuses another tab's newer revision before charging rate quota or invoking AI", async () => {
    mocks.project.mockResolvedValue({ revision: 3, results: {} });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.project).toHaveBeenCalledWith(expect.anything(), "owned-project", "owner");
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not expose absent/foreign projects", async () => {
    mocks.project.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rechecks cached advice against the current owned revision before returning it", async () => {
    mocks.latest.mockResolvedValue({ factsHash: "facts-hash", content: advice, model: "test-model", createdAt: new Date() });
    mocks.current.mockResolvedValue({ revision: 3 });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.current).toHaveBeenCalledWith({ where: { id: "owned-project", userId: "owner" }, select: { revision: true } });
  });

  it("returns fresh cached advice without invoking AI when the revision still matches", async () => {
    mocks.latest.mockResolvedValue({ factsHash: "facts-hash", content: advice, model: "test-model", createdAt: new Date() });
    const result = await POST(request(), context);
    expect(result.status).toBe(200);
    expect((await result.json()).advice.stale).toBe(false);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("refuses a completed old answer when durable publication advanced the project during AI generation", async () => {
    mocks.generate.mockImplementationOnce(async () => {
      mocks.current.mockResolvedValue({ revision: 3 });
      mocks.save.mockResolvedValue("conflict");
      return { content: advice };
    });
    const result = await POST(request(), context);
    expect(result.status).toBe(409);
    expect(await result.json()).not.toHaveProperty("advice");
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), "owned-project", "owner", 2, expect.objectContaining({ factsHash: "facts-hash", content: advice }));
  });

  it("returns 404 if the project disappeared while AI was generating", async () => {
    mocks.save.mockResolvedValue("not_found");
    expect((await POST(request(), context)).status).toBe(404);
  });

  it("saves the completed answer against exactly the accepted revision", async () => {
    const result = await POST(request(), context);
    expect(result.status).toBe(200);
    expect((await result.json()).advice).toMatchObject({ content: advice, stale: false });
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), "owned-project", "owner", 2, expect.objectContaining({ model: "test-model" }));
  });
});
