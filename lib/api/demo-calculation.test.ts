import { beforeEach, describe, expect, it, vi } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { FIXTURE_H1500, fixtureSpecs } from "../tz/econ/fixtures";
import { resolveNorms } from "../tz/norms";
import { PROJECT_INPUT_MAX_BYTES } from "../projects/payload-limit";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), load: vi.fn(), calculate: vi.fn(), prisma: {} }));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: () => "203.0.113.7" }));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/projects/recalc", async original => ({ ...await original<typeof import("../projects/recalc")>(),
  loadLiveInputs: mocks.load, resultsFromInputsAsync: mocks.calculate }));
const { POST, maxDuration } = await import("@/app/api/v1/demo-calculation/route");
const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms(), paramDefsFrom: "code" as const };
const result = { scenarios: [{ key: "p1", spatialEvidence: { assessment: { status: "PARTIAL", terminal: true } } }], conclusion: { recommendedScenarioKey: null } };
const payload = () => ({ facility: "warehouse", params: {}, scenarios: fixtureSpecs() });
function request(body: unknown, options: { origin?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  return new Request("http://localhost/api/v1/demo-calculation", { method: "POST", signal: options.signal,
    headers: { "content-type": "application/json", ...(options.origin ? { origin: options.origin } : {}), ...options.headers },
    body: typeof body === "string" ? body : JSON.stringify(body) });
}
beforeEach(() => {
  mocks.rateLimit.mockReset().mockResolvedValue({ ok: true, retryAfterSec: 0 });
  mocks.load.mockReset().mockResolvedValue(structuredClone(live));
  mocks.calculate.mockReset().mockResolvedValue({ results: structuredClone(result) });
});

describe("public live demo calculation boundary", () => {
  it("returns fresh canonical PARTIAL unchanged, no-store, without project or owner access", async () => {
    const body = payload(), before = structuredClone(body);
    const response = await POST(request(body, { origin: "http://localhost" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ results: result, ms: expect.any(Number) });
    expect(body).toEqual(before); expect(mocks.load).toHaveBeenCalledWith(mocks.prisma, "warehouse");
    expect(mocks.calculate).toHaveBeenCalledOnce();
    const [, input, options] = mocks.calculate.mock.calls[0]!;
    expect(input.scenarios).toEqual(body.scenarios); expect(input.facility).toBe("warehouse");
    expect(input).not.toHaveProperty("snapshot"); expect(input).not.toHaveProperty("ownerId");
    expect(options.deadline - options.now()).toBeGreaterThan(59_000);
    expect(options.deadline - options.now()).toBeLessThanOrEqual(60_000);
    expect(maxDuration).toBe(75);
    expect(mocks.rateLimit).toHaveBeenCalledWith("api:demo-calculation:ip:203.0.113.7", { limit: 30, windowMs: 300_000 });
  });

  it("rejects foreign origin and exhausted rates before reading the body", async () => {
    const foreign = request(payload(), { origin: "https://attacker.example" });
    expect((await POST(foreign)).status).toBe(403); expect(foreign.bodyUsed).toBe(false);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterSec: 17 });
    const limited = request(payload()), response = await POST(limited);
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("17");
    expect(limited.bodyUsed).toBe(false); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it.each(["projectId", "ownerId", "userId", "snapshot", "results", "paramsSource"])("rejects private top-level metadata %s", async field => {
    expect((await POST(request({ ...payload(), [field]: "private" }))).status).toBe(422);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("uses actual validators for facility, parameter keys and nested scenario metadata", async () => {
    for (const body of [{ ...payload(), facility: "private" }, { ...payload(), params: { privateProjectId: "secret" } },
      { ...payload(), scenarios: fixtureSpecs().map(s => ({ ...s, ownerId: "foreign" })) }]) {
      expect((await POST(request(body))).status).toBe(422);
    }
    expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("bounds declared and actual streamed body bytes and requires valid JSON", async () => {
    expect((await POST(request(payload(), { headers: { "content-length": String(PROJECT_INPUT_MAX_BYTES + 1) } }))).status).toBe(413);
    expect((await POST(request(`{"padding":"${"x".repeat(PROJECT_INPUT_MAX_BYTES)}"}`))).status).toBe(413);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(payload(), { headers: { "content-type": "text/plain" } }))).status).toBe(415);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.calculate).not.toHaveBeenCalled();
  });

  it("passes request cancellation to the engine and preserves busy/deadline/abort statuses", async () => {
    const controller = new AbortController(), req = request(payload(), { signal: controller.signal });
    mocks.calculate.mockImplementation(async (_live, input, options) => {
      expect(input.signal).toBe(req.signal); expect(options.signal).toBe(req.signal);
      controller.abort(); const error = new Error("Расчёт отменён"); error.name = "AbortError"; throw error;
    });
    expect((await POST(req)).status).toBe(499);
    for (const name of ["CalculationBusy", "SimBudgetExceeded"]) {
      const error = new Error("Повторите расчёт"); error.name = name; mocks.calculate.mockRejectedValue(error);
      const response = await POST(request(payload()));
      expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const early = new AbortController(); early.abort(); mocks.load.mockClear();
    expect((await POST(request(payload(), { signal: early.signal }))).status).toBe(499);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("does not leak DB or engine details from unexpected failures", async () => {
    mocks.load.mockRejectedValue(new Error("postgres://private-password@internal/private-project"));
    const response = await POST(request(payload()));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
