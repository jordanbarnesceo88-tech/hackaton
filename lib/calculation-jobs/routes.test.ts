import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobHistoryFull, JobHistoryRemoved, JobStillActive } from "./types";
import { foreignOrigin } from "./http";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), enqueue: vi.fn(), get: vi.fn(), list: vi.fn(), result: vi.fn(), cancel: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/lib/api/auth", () => ({ apiUser: mocks.user, API_AUTH_MESSAGES: { userRequired: "Войдите в систему" } }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/calculation-jobs/service", async original => ({ ...await original<typeof import("./service")>(), enqueueCalculation: mocks.enqueue }));
vi.mock("@/lib/calculation-jobs/store", () => ({
  getOwnedJob: mocks.get, listOwnedJobs: mocks.list, getOwnedJobResult: mocks.result, cancelJob: mocks.cancel, deleteOwnedTerminalJob: mocks.remove,
}));
const collection = await import("@/app/api/v1/calculation-jobs/route");
const detail = await import("@/app/api/v1/calculation-jobs/[id]/route");
const cancel = await import("@/app/api/v1/calculation-jobs/[id]/cancel/route");
const result = await import("@/app/api/v1/calculation-jobs/[id]/result/route");
const params = { params: Promise.resolve({ id: "job1" }) };
const request = (method = "POST", body: unknown = {}, headers: Record<string, string> = {}) => new Request("http://localhost/api/v1/calculation-jobs/job1", {
  method, headers: { "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue("owner1");
  mocks.get.mockResolvedValue(null); mocks.result.mockResolvedValue(null); mocks.list.mockResolvedValue([]);
});

describe("durable calculation HTTP boundary", () => {
  it("accepts the real destination Host behind a bind address while rejecting foreign/forwarded origins", () => {
    const req = (origin: string, host = "app:3000", forwarded = "attacker.test") => new Request("http://0.0.0.0:3000/api/v1/calculation-jobs", {
      headers: { host, origin, "x-forwarded-host": forwarded },
    });
    expect(foreignOrigin(req("http://app:3000"))).toBe(false);
    expect(foreignOrigin(req("http://attacker.test"))).toBe(true);
    expect(foreignOrigin(req("http://app:3000", "app:3000@attacker.test"))).toBe(true);
    expect(foreignOrigin(req("null"))).toBe(true);
    expect(foreignOrigin(req("https://app:3000"))).toBe(true);
  });
  it("requires identity before touching storage for every endpoint", async () => {
    mocks.user.mockResolvedValue(null);
    const responses = await Promise.all([collection.POST(request()), collection.GET(request("GET")), detail.GET(request("GET"), params), detail.DELETE(request("DELETE"), params), cancel.POST(request(), params), result.GET(request("GET"), params)]);
    expect(responses.map(r => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("refuses foreign origins and non-JSON writes, including cancel/delete", async () => {
    for (const write of [(r: Request) => collection.POST(r), (r: Request) => cancel.POST(r, params), (r: Request) => detail.DELETE(r, params)]) {
      expect((await write(request("POST", {}, { origin: "https://attacker.test" }))).status).toBe(403);
      expect((await write(request("POST", {}, { "content-type": "text/plain" }))).status).toBe(415);
    }
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("returns a compact accepted receipt and forwards the retry key and owner", async () => {
    mocks.enqueue.mockResolvedValue({ id: "job1", status: "QUEUED" });
    const response = await collection.POST(request("POST", { operation: "CALCULATE", facility: "warehouse" }, { "idempotency-key": "same-key" }));
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe("/api/v1/calculation-jobs/job1");
    expect(mocks.enqueue).toHaveBeenCalledWith({}, "owner1", { operation: "CALCULATE", facility: "warehouse" }, "same-key");
    expect(await response.json()).toEqual({ job: { id: "job1", status: "QUEUED" } });
  });

  it("bounds the actual input size before enqueue", async () => {
    const response = await collection.POST(request("POST", { data: "x".repeat(4 * 1024 * 1024) }));
    expect(response.status).toBe(413); expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("owner-scopes every read and hides missing/foreign resources", async () => {
    expect((await detail.GET(request("GET"), params)).status).toBe(404);
    expect((await result.GET(request("GET"), params)).status).toBe(404);
    await collection.GET(new Request("http://localhost/api/v1/calculation-jobs?projectId=p1"));
    expect(mocks.get).toHaveBeenCalledWith({}, "owner1", "job1");
    expect(mocks.result).toHaveBeenCalledWith({}, "owner1", "job1");
    expect(mocks.list).toHaveBeenCalledWith({}, "owner1", { projectId: "p1", limit: 30 });
  });

  it("returns only submitted owner fields, never frozen catalogue/input envelope", async () => {
    mocks.result.mockResolvedValue({ job: { status: "SUCCEEDED" }, run: {
      input: { operation: "SAVE", live: { secret: "catalogue" }, input: { params: { floor: 1 }, scenarios: [], internal: "hidden" }, publication: { expectedRevision: 2, name: "Склад", changes: [] } }, results: { modelVersion: "tz-test" }, inputHash: "private",
    } });
    const response = await result.GET(request("GET"), params);
    expect(await response.json()).toEqual({ job: { status: "SUCCEEDED" }, results: { modelVersion: "tz-test" }, submitted: { expectedRevision: 2, name: "Склад", params: { floor: 1 }, scenarios: [], changes: [] } });
  });

  it("cancel and purge require an explicit empty JSON body and handle terminal conflicts", async () => {
    expect((await cancel.POST(request("POST", { cancel: true }), params)).status).toBe(422);
    expect((await detail.DELETE(request("DELETE", []), params)).status).toBe(422);
    mocks.cancel.mockResolvedValue({ status: "SUCCEEDED" });
    expect((await cancel.POST(request(), params)).status).toBe(409);
    mocks.remove.mockRejectedValue(new JobStillActive());
    expect((await detail.DELETE(request("DELETE"), params)).status).toBe(409);
    mocks.remove.mockResolvedValue(true);
    expect((await detail.DELETE(request("DELETE"), params)).status).toBe(200);
  });

  it("exposes actionable history quota/removal errors without pretending work was accepted", async () => {
    for (const [error, status, code] of [[new JobHistoryFull(), 429, "HISTORY_FULL"], [new JobHistoryRemoved(), 410, "HISTORY_REMOVED"]] as const) {
      mocks.enqueue.mockRejectedValue(error);
      const response = await collection.POST(request());
      expect(response.status).toBe(status); expect((await response.json()).details.code).toBe(code);
    }
  });

  it("does not log or return Prisma inputs/secrets on an unknown failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.enqueue.mockRejectedValue(Object.assign(new Error("private payload/DSN"), { code: "P9999" }));
      const response = await collection.POST(request());
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
      expect(log).toHaveBeenCalledWith("calculation-jobs: operation failed", { name: "Error", code: "P9999" });
    } finally { log.mockRestore(); }
  });
});
