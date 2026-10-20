import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), generate: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ readAiConfig: mocks.config }));
vi.mock("@/lib/ai/advice/generate", () => ({ generateAdvice: mocks.generate }));
vi.mock("@/lib/db/client", () => ({ prisma: { $queryRaw: mocks.query } }));
const { POST } = await import("@/app/demo/ai-advice/route");

const facts = {
  object: "Склад", recommended: null,
  alternatives: [{ name: "База", kind: "Как есть", metrics: {}, risks: [] }],
  platformConclusion: { headline: "Выбор не сделан", points: [] }, limitations: [],
};
function request(origin = "http://localhost") {
  return new Request("http://localhost/demo/ai-advice", {
    method: "POST", headers: { "content-type": "application/json", origin, "x-forwarded-for": "192.0.2.1" },
    body: JSON.stringify({ facts }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ url: "https://ai.example", key: "synthetic-key", model: "synthetic-model" });
  mocks.generate.mockResolvedValue({ content: { summary: "Тест" } });
  mocks.query.mockResolvedValue([{ count: 1, windowStart: new Date() }]);
});

describe("guest AI quota boundary with the real rate limiter", () => {
  it("does not invoke the provider during repeated quota database outages", async () => {
    mocks.query.mockRejectedValue(new Error("synthetic private database details"));
    for (let attempt = 0; attempt < 7; attempt++) {
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("synthetic private database details");
    }
    expect(mocks.query).toHaveBeenCalledTimes(7);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("allows six counted requests and rejects the seventh without generation", async () => {
    let count = 0;
    mocks.query.mockImplementation(async () => [{ count: ++count, windowStart: new Date() }]);
    for (let attempt = 0; attempt < 6; attempt++) expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
    expect(mocks.generate).toHaveBeenCalledTimes(6);
  });

  it("rejects a foreign origin before reading quota or invoking the provider", async () => {
    expect((await POST(request("https://foreign.example"))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
