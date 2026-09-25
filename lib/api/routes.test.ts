import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { CATALOG } from "../data/organizer/catalog";
import { paramSpecsFor } from "../data/organizer/params";
import type { LiveInputs } from "../projects/recalc";
import { resolveNorms } from "../tz/norms";
import { applyDefaults } from "../tz/params/schema";
import { processDef } from "../tz/processes";
import type { ScenarioOk } from "../tz/types";

// Обработчики API v1 целиком, без Postgres: клиент БД, ограничитель частоты и сессия подменены,
// живые входы расчёта — данные организатора из кода (как `print-demo-numbers --offline`).
// Проверяется склейка: доступ, коды ответов, форма ошибок и то, что расчёт через API даёт те же
// числа, что прямой вызов той же функции, которой пользуется «Новый проект».

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  getSessionUser: vi.fn(),
  getAdminUser: vi.fn(),
  prisma: {} as Record<string, unknown>,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: mocks.rateLimit, clientIp: () => "203.0.113.7" }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: mocks.getSessionUser, getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/projects/recalc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../projects/recalc")>();
  return { ...actual, loadLiveInputs: vi.fn(async (_db: unknown, facility: string) => offlineInputs(facility)) };
});

/** Живые входы без БД: данные организатора из кода и нормативы по умолчанию. */
function offlineInputs(facility: string): LiveInputs {
  const products = CATALOG.filter((p) => p.level !== "identification")
    .filter((p) => p.processes.some((s) => processDef(s)?.facilityTypes.includes(facility)))
    .map(productForCalcFromSeed)
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || (a.slug < b.slug ? -1 : 1));
  return { paramDefs: paramSpecsFor(facility), products, norms: resolveNorms(), paramDefsFrom: "code" };
}

const calculate = await import("@/app/api/v1/calculate/route");
const norms = await import("@/app/api/v1/norms/route");
const importRoute = await import("@/app/api/v1/catalog/import/route");
const catalog = await import("@/app/api/v1/catalog/route");
const params = await import("@/app/api/v1/facility-types/[slug]/params/route");
const projects = await import("@/app/api/v1/projects/route");
const project = await import("@/app/api/v1/projects/[id]/route");
const openapiRoute = await import("@/app/api/v1/openapi.json/route");
const { resultsFromInputs } = await import("../projects/recalc");
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
  for (const k of Object.keys(mocks.prisma)) delete mocks.prisma[k];
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/v1/calculate", () => {
  it("склад на демо-данных: те же числа, что у «Нового проекта» на тех же входах", async () => {
    const res = await calculate.POST(jsonReq("/api/v1/calculate", "POST", { facility: "warehouse" }));
    expect(res.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith("api:calc:ip:203.0.113.7", { limit: 60, windowMs: 900_000 });
    const json = (await res.json()) as {
      versions: { modelVersion: string; dataVersion: string };
      summary: { key: string; kind: string; npvRub: number | null; recommended: boolean }[];
      results: { results: ScenarioOk[]; dataVersion: string };
      conclusion: { disclaimer: string };
    };
    const live = offlineInputs("warehouse");
    const direct = resultsFromInputs(live, { facility: "warehouse", params: applyDefaults(live.paramDefs, {}) }).results;
    expect(json.versions.dataVersion).toBe(direct.dataVersion);
    expect(json.summary.map((s) => s.key)).toEqual(direct.results.map((r) => r.key));
    for (const r of direct.results) {
      const s = json.summary.find((x) => x.key === r.key);
      expect(s?.npvRub, r.key).toBe(r.status === "ok" ? r.npvRub : null);
    }
    expect(json.summary.some((s) => s.kind === "purchase")).toBe(true);
    expect(json.summary.filter((s) => s.recommended).length).toBeLessThanOrEqual(1);
    expect(json.conclusion.disclaimer).toMatch(/предварительной оценкой/);
  });

  it("лимит частоты — 429 с Retry-After до разбора тела", async () => {
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterSec: 30 });
    const res = await calculate.POST(jsonReq("/api/v1/calculate", "POST", "not json"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("проверка входа: тип объекта, лишнее поле, ключ параметра, сценарии, Content-Type", async () => {
    const r1 = await calculate.POST(jsonReq("/api/v1/calculate", "POST", { facility: "factory" }));
    expect(r1.status).toBe(422);
    const r2 = await calculate.POST(jsonReq("/api/v1/calculate", "POST", { facility: "warehouse", extra: 1 }));
    expect(((await r2.json()) as { error: string }).error).toMatch(/Неизвестные поля extra/);
    const r3 = await calculate.POST(jsonReq("/api/v1/calculate", "POST", { facility: "warehouse", params: { noSuchKey: 1 } }));
    expect(r3.status).toBe(422);
    const b3 = (await r3.json()) as { details: { issues: { code: string }[] } };
    expect(b3.details.issues.map((i) => i.code)).toContain("unknown_key");
    const r4 = await calculate.POST(jsonReq("/api/v1/calculate", "POST", { facility: "warehouse", scenarios: [] }));
    expect(r4.status).toBe(422);
    expect(((await r4.json()) as { details: { errors: string[] } }).details.errors.join(" ")).toMatch(/от 3 до 10 сценариев/);
    const r5 = await calculate.POST(new Request("http://localhost/api/v1/calculate", { method: "POST", body: "{}" }));
    expect(r5.status).toBe(415);
  });
});

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

  it("POST /api/v1/projects: 201, Location, запись с источником api и те же числа, что прямой расчёт", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const create = vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(async () => ({ id: "p1" }));
    mocks.prisma.project = { create };
    const res = await projects.POST(
      jsonReq("/api/v1/projects", "POST", { name: "  РЦ   Подольск ", facility: "warehouse", objectName: "Распределительный центр" }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/api/v1/projects/p1");
    expect(mocks.rateLimit).toHaveBeenCalledWith("api:projects:user:u1", { limit: 30, windowMs: 900_000 });
    const data = create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      userId: "u1",
      name: "РЦ Подольск",
      objectName: "Распределительный центр",
      facilityTypeSlug: "warehouse",
      paramsSource: { kind: "api" },
    });
    const json = (await res.json()) as { id: string; url: string; summary: { key: string; npvRub: number | null }[] };
    expect(json.id).toBe("p1");
    expect(json.url).toBe("/projects/p1");
    const live = offlineInputs("warehouse");
    const direct = resultsFromInputs(live, { facility: "warehouse", params: applyDefaults(live.paramDefs, {}) }).results;
    expect(json.summary.map((s) => [s.key, s.npvRub])).toEqual(
      direct.results.map((r) => [r.key, r.status === "ok" ? r.npvRub : null]),
    );
  });

  it("POST /api/v1/projects: пустое название — 422; пользователя нет в базе (P2003) — 401", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const noName = await projects.POST(jsonReq("/api/v1/projects", "POST", { name: "   ", facility: "warehouse" }));
    expect(noName.status).toBe(422);
    expect(((await noName.json()) as { error: string }).error).toMatch(/^name/);

    mocks.prisma.project = { create: vi.fn(async () => Promise.reject(Object.assign(new Error("fk"), { code: "P2003" }))) };
    const stale = await projects.POST(jsonReq("/api/v1/projects", "POST", { name: "Склад", facility: "warehouse" }));
    expect(stale.status).toBe(401);
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
