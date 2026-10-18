import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paramSpecsFor } from "../data/organizer/params";
import { PROJECT_INPUT_MAX_BYTES } from "../projects/payload-limit";
import { CalculationRequestError } from "../calculation-jobs/service";
import { IdempotencyConflict, JobQueueFull } from "../calculation-jobs/types";

// Обработчики API v1 целиком, без Postgres: клиент БД, ограничитель частоты и сессия подменены,
// Проверяется транспорт, доступ и передача CREATE в общую durable-очередь.
// Числа, валидация замороженного входа и публикация проверяются DB-тестами service/store.

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  getSessionUser: vi.fn(),
  getAdminUser: vi.fn(),
  enqueue: vi.fn(),
  prisma: {} as Record<string, unknown>,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: () => "203.0.113.7" }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: mocks.getSessionUser, getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/calculation-jobs/service", async original => ({
  ...await original<typeof import("../calculation-jobs/service")>(), enqueueCalculation: mocks.enqueue,
}));

const norms = await import("@/app/api/v1/norms/route");
const importRoute = await import("@/app/api/v1/catalog/import/route");
const catalog = await import("@/app/api/v1/catalog/route");
const params = await import("@/app/api/v1/facility-types/[slug]/params/route");
const projects = await import("@/app/api/v1/projects/route");
const project = await import("@/app/api/v1/projects/[id]/route");
const openapiRoute = await import("@/app/api/v1/openapi.json/route");
const { OPENAPI } = await import("./openapi");
const { exampleImportSeed } = await import("./openapi");

const TOKEN = "t35-routes-token-0123456789";
const JSON_HEADERS = { "content-type": "application/json" };

function jsonReq(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { ...JSON_HEADERS, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.rateLimit.mockReset().mockResolvedValue({ ok: true, retryAfterSec: 0 });
  mocks.getSessionUser.mockReset().mockResolvedValue(null);
  mocks.getAdminUser.mockReset().mockResolvedValue(null);
  mocks.enqueue.mockReset();
  for (const k of Object.keys(mocks.prisma)) delete mocks.prisma[k];
});
afterEach(() => vi.unstubAllEnvs());

describe("нормативы", () => {
  it("GET: пустая таблица — нормативы из кода", async () => {
    mocks.prisma.norm = { findMany: vi.fn(async () => []) };
    const res = await norms.GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { source: string }).source).toBe("code");
  });

  it("PUT: гость — 401, пользователь — 403, неверное тело — 422, токен — запись в транзакции", async () => {
    const body = { values: { utilization: 0.8 } };
    expect((await norms.PUT(jsonReq("/api/v1/norms", "PUT", body))).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ userId: "u1", email: null, role: "USER" });
    expect((await norms.PUT(jsonReq("/api/v1/norms", "PUT", body))).status).toBe(403);

    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await norms.PUT(jsonReq("/api/v1/norms", "PUT", { values: { nope: 1 } }, auth))).status).toBe(422);

    const writes: string[] = [];
    const tx = {
      norm: {
        findUnique: vi.fn(async () => ({ key: "utilization", value: 0.775 })),
        update: vi.fn(async () => writes.push("norm.update")),
      },
      changeLog: { create: vi.fn(async () => writes.push("changeLog.create")) },
    };
    mocks.prisma.$transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    mocks.prisma.norm = { findMany: vi.fn(async () => []) };
    const res = await norms.PUT(jsonReq("/api/v1/norms", "PUT", body, auth));
    expect(res.status).toBe(200);
    expect(writes).toEqual(["norm.update", "changeLog.create"]);
    expect(await res.json()).toMatchObject({ updated: 1, unchanged: 0, changes: [{ key: "utilization", newValue: 0.8, status: "updated" }] });
  });
});

describe("POST /api/v1/catalog/import", () => {
  it("гость — 401; токен и неверное тело — 422 с ошибками по позициям; пробный прогон — отчёт без записи", async () => {
    const seed = exampleImportSeed();
    expect((await importRoute.POST(jsonReq("/api/v1/catalog/import", "POST", [seed]))).status).toBe(401);

    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
    const auth = { authorization: `Bearer ${TOKEN}` };
    const bad = await importRoute.POST(jsonReq("/api/v1/catalog/import", "POST", [{ slug: "X" }], auth));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { details: { issues: unknown[] } }).details.issues).toHaveLength(1);

    const create = vi.fn();
    mocks.prisma.solutionType = { findMany: vi.fn(async () => [{ id: "st", slug: seed.solutionType }]) };
    mocks.prisma.process = { findMany: vi.fn(async () => seed.processes.map((slug) => ({ id: `p-${slug}`, slug }))) };
    mocks.prisma.catalogProduct = { findMany: vi.fn(async () => []), create };
    const dry = await importRoute.POST(jsonReq("/api/v1/catalog/import?dryRun=1", "POST", [seed], auth));
    expect(dry.status).toBe(200);
    expect(await dry.json()).toMatchObject({ dryRun: true, valid: 1, via: "bearer", items: [{ slug: seed.slug, status: "valid", action: "create" }] });
    expect(create).not.toHaveBeenCalled();
    expect((await importRoute.POST(jsonReq("/api/v1/catalog/import?dryRun=yes", "POST", [seed], auth))).status).toBe(422);
  });
});

describe("каталог, параметры, проекты, описание", () => {
  it("GET /api/v1/catalog: опечатка — 422; список — страница и выпуск данных", async () => {
    expect((await catalog.GET(new Request("http://localhost/api/v1/catalog?facilty=warehouse"))).status).toBe(422);
    mocks.prisma.catalogProduct = { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) };
    mocks.prisma.dataRelease = { findFirst: vi.fn(async () => null) };
    const res = await catalog.GET(new Request("http://localhost/api/v1/catalog?facility=warehouse&page=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 50, pageCount: 0, dataRelease: null });
  });

  it("GET /api/v1/facility-types/{slug}/params: неизвестный тип — 404; пустая таблица — описания из кода", async () => {
    const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
    expect((await params.GET(new Request("http://localhost/x"), ctx("factory"))).status).toBe(404);
    mocks.prisma.paramDefinition = { findMany: vi.fn(async () => []) };
    const res = await params.GET(new Request("http://localhost/x"), ctx("warehouse"));
    const json = (await res.json()) as { source: string; params: { key: string }[] };
    expect(json.source).toBe("code");
    expect(json.params.map((p) => p.key)).toEqual(paramSpecsFor("warehouse").map((p) => p.key));
  });

  it("проекты без входа — 401", async () => {
    const created = await projects.POST(jsonReq("/api/v1/projects", "POST", { name: "Склад", facility: "warehouse" }));
    expect(created.status).toBe(401);
    const got = await project.GET(new Request("http://localhost/api/v1/projects/x"), { params: Promise.resolve({ id: "x" }) });
    expect(got.status).toBe(401);
  });

  it("GET /api/v1/openapi.json — тот же документ", async () => {
    const res = await openapiRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(OPENAPI)));
  });
});

describe("проекты по сессии", () => {
  const USER = { userId: "u1", email: "demo@demo.local", role: "USER" };

  it("CREATE bounds JSON at 4 MiB and refuses malformed transport before enqueue", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", { facility: "warehouse", padding: "x".repeat(2_433_182) }))).status).toBe(422);
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", { params: { padding: "x".repeat(PROJECT_INPUT_MAX_BYTES) } }))).status).toBe(413);
    expect((await projects.POST(new Request("http://localhost/api/v1/projects", { method: "POST", body: "{}" }))).status).toBe(415);
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", "{"))).status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("CREATE preserves semantic errors and durable queue/conflict status codes", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const detail = { issues: [{ key: "invalid", code: "unknown_key" }] };
    mocks.enqueue.mockRejectedValue(new CalculationRequestError(422, "Неверные параметры", detail));
    const rejected = await projects.POST(jsonReq("/api/v1/projects", "POST", { facility: "warehouse", params: { invalid: 1 } }));
    expect(rejected.status).toBe(422); expect((await rejected.json()).details).toEqual(detail);
    mocks.enqueue.mockRejectedValue(new IdempotencyConflict());
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", {}))).status).toBe(409);
    mocks.enqueue.mockRejectedValue(new JobQueueFull());
    const full = await projects.POST(jsonReq("/api/v1/projects", "POST", {}));
    expect(full.status).toBe(429); expect(full.headers.get("retry-after")).toBe("5");
  });

  it("CREATE rate limit responds before reading or retaining a body", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterSec: 30 });
    const response = await projects.POST(jsonReq("/api/v1/projects", "POST", "not json"));
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("30");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("POST /api/v1/projects: 202 queues CREATE with an owner, API source and retry key", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.enqueue.mockResolvedValue({ id: "job-create", operation: "CREATE", status: "QUEUED" });
    const body = { name: "РЦ Подольск", facility: "warehouse", objectName: "Распределительный центр" };
    const res = await projects.POST(jsonReq("/api/v1/projects", "POST", body, { "idempotency-key": "create-key" }));
    expect(res.status).toBe(202);
    expect(res.headers.get("location")).toBe("/api/v1/calculation-jobs/job-create");
    expect(res.headers.get("retry-after")).toBe("1");
    expect(mocks.enqueue).toHaveBeenCalledWith(mocks.prisma, "u1", { ...body, operation: "CREATE", paramsSource: { kind: "api" } }, "create-key");
    expect(await res.json()).toEqual({ job: { id: "job-create", operation: "CREATE", status: "QUEUED" } });
  });

  it("CREATE rejects transport injection before enqueue and propagates durable preconditions", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", { name: "Склад", facility: "warehouse", operation: "SAVE" }))).status).toBe(422);
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", {}, { origin: "https://attacker.test" }))).status).toBe(403);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    const { CalculationRequestError } = await import("../calculation-jobs/service");
    mocks.enqueue.mockRejectedValue(new CalculationRequestError(422, "Передайте Idempotency-Key"));
    expect((await projects.POST(jsonReq("/api/v1/projects", "POST", { name: "Склад", facility: "warehouse" }))).status).toBe(422);
    expect(mocks.enqueue).toHaveBeenCalledWith(mocks.prisma, "u1", expect.objectContaining({ operation: "CREATE" }), "");
  });

  it("disconnecting CREATE does not turn an accepted durable command into cancellation", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.enqueue.mockResolvedValue({ id: "queued", operation: "CREATE", status: "QUEUED" });
    const controller = new AbortController(); controller.abort();
    const req = new Request("http://localhost/api/v1/projects", { method: "POST", signal: controller.signal,
      headers: { ...JSON_HEADERS, "idempotency-key": "disconnected-create" }, body: JSON.stringify({ name: "Склад", facility: "warehouse" }) });
    expect((await projects.POST(req)).status).toBe(202);
    expect(mocks.enqueue.mock.calls[0]?.[2]).not.toHaveProperty("signal");
  });

  it("GET /api/v1/projects/{id}: чужой проект — 404, запрос ограничен владельцем", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const findFirst = vi.fn(async () => null);
    mocks.prisma.project = { findFirst };
    const res = await project.GET(new Request("http://localhost/api/v1/projects/p9"), { params: Promise.resolve({ id: "p9" }) });
    expect(res.status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p9", userId: "u1" } }));
  });

  it("GET /api/v1/projects/{id}: проект без расчёта — версии null, без сравнения с живыми данными", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const at = new Date("2026-09-25T00:00:00Z");
    mocks.prisma.project = {
      findFirst: vi.fn(async () => ({
        id: "p1",
        userId: "u1",
        name: "Склад",
        objectName: null,
        facilityTypeSlug: "warehouse",
        params: {},
        paramsSource: { kind: "api" },
        results: null,
        modelVersion: null,
        dataVersion: null,
        calculatedAt: null,
        copiedFromId: null,
        isDemo: false,
        createdAt: at,
        updatedAt: at,
        scenarios: [],
      })),
    };
    const res = await project.GET(new Request("http://localhost/api/v1/projects/p1"), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "p1",
      url: "/projects/p1",
      facility: "warehouse",
      paramsSource: { kind: "api" },
      results: null,
      liveDataVersion: null,
      dataChanged: null,
      modelChanged: null,
      createdAt: at.toISOString(),
    });
  });
});
