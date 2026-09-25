import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Набор unit: охранные функции (сессия и роль из БД) подменены — проверяется логика доступа
// API: токен администратора, выключенный токен, гость, пользователь без роли, администратор.
const guards = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAdminUser: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => guards);

const { ADMIN_TOKEN_MIN_LENGTH, API_AUTH_MESSAGES, adminTokenFromEnv, apiAdmin, apiUser, bearerToken, checkApiAdmin, tokenMatches } =
  await import("./auth");

const TOKEN = "t35-admin-token-0123456789abcdef";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/norms", { method: "PUT", headers });
}

beforeEach(() => {
  guards.getSessionUser.mockReset();
  guards.getAdminUser.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bearerToken", () => {
  it("достаёт токен из «Bearer <токен>» без учёта регистра схемы", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`  BEARER   ${TOKEN}  `)).toBe(TOKEN);
  });
  it("другая схема, пустой токен или токен с пробелом — null", () => {
    expect(bearerToken(`Basic ${TOKEN}`)).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("adminTokenFromEnv", () => {
  it("нет переменной — вход по токену выключен", () => {
    expect(adminTokenFromEnv({})).toBeNull();
  });
  it("пустая или короткая переменная — выключен", () => {
    expect(adminTokenFromEnv({ ADMIN_API_TOKEN: "" })).toBeNull();
    expect(adminTokenFromEnv({ ADMIN_API_TOKEN: "   " })).toBeNull();
    expect(adminTokenFromEnv({ ADMIN_API_TOKEN: "x".repeat(ADMIN_TOKEN_MIN_LENGTH - 1) })).toBeNull();
  });
  it("достаточно длинная — токен без пробелов по краям", () => {
    expect(adminTokenFromEnv({ ADMIN_API_TOKEN: ` ${TOKEN} ` })).toBe(TOKEN);
    expect(adminTokenFromEnv({ ADMIN_API_TOKEN: "x".repeat(ADMIN_TOKEN_MIN_LENGTH) })).toBe("x".repeat(ADMIN_TOKEN_MIN_LENGTH));
  });
});

describe("tokenMatches", () => {
  it("совпадает только тот же токен", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.toUpperCase(), TOKEN)).toBe(false);
    expect(tokenMatches("", TOKEN)).toBe(false);
  });
});

describe("checkApiAdmin", () => {
  it("верный токен — администратор по токену, сессия не читается", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
    const res = await checkApiAdmin(req({ Authorization: `Bearer ${TOKEN}` }));
    expect(res).toEqual({ ok: true, admin: { via: "bearer", userId: null, email: null } });
    expect(guards.getSessionUser).not.toHaveBeenCalled();
    expect(guards.getAdminUser).not.toHaveBeenCalled();
  });

  it("неверный токен — 401, без запасного пути через сессию администратора", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
    guards.getSessionUser.mockResolvedValue({ userId: "a1", email: "admin@demo.local", role: "ADMIN" });
    guards.getAdminUser.mockResolvedValue({ userId: "a1", email: "admin@demo.local", role: "ADMIN" });
    const res = await checkApiAdmin(req({ Authorization: "Bearer wrong-token-0123456789" }));
    expect(res).toEqual({ ok: false, status: 401, error: API_AUTH_MESSAGES.badToken });
    expect(guards.getAdminUser).not.toHaveBeenCalled();
  });

  it("переменная не задана — токен не принимается ни в каком виде", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "");
    const res = await checkApiAdmin(req({ Authorization: "Bearer " }));
    expect(res.ok).toBe(false);
    const res2 = await checkApiAdmin(req({ Authorization: `Bearer ${TOKEN}` }));
    expect(res2).toEqual({ ok: false, status: 401, error: API_AUTH_MESSAGES.bearerDisabled });
  });

  it("слишком короткий токен в окружении выключает вход даже при точном совпадении", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "short");
    const res = await checkApiAdmin(req({ Authorization: "Bearer short" }));
    expect(res).toEqual({ ok: false, status: 401, error: API_AUTH_MESSAGES.bearerDisabled });
  });

  it("заголовок другой схемы — 401 с подсказкой формата", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", TOKEN);
    const res = await checkApiAdmin(req({ Authorization: `Basic ${TOKEN}` }));
    expect(res).toEqual({ ok: false, status: 401, error: API_AUTH_MESSAGES.badHeader });
  });

  it("без заголовка: гость — 401, пользователь — 403, администратор по базе — доступ", async () => {
    guards.getSessionUser.mockResolvedValue(null);
    expect(await checkApiAdmin(req())).toEqual({ ok: false, status: 401, error: API_AUTH_MESSAGES.adminRequired });

    guards.getSessionUser.mockResolvedValue({ userId: "u1", email: "demo@demo.local", role: "USER" });
    guards.getAdminUser.mockResolvedValue(null);
    expect(await checkApiAdmin(req())).toEqual({ ok: false, status: 403, error: API_AUTH_MESSAGES.notAdmin });

    guards.getSessionUser.mockResolvedValue({ userId: "a1", email: "admin@demo.local", role: "ADMIN" });
    guards.getAdminUser.mockResolvedValue({ userId: "a1", email: "admin@demo.local", role: "ADMIN" });
    expect(await checkApiAdmin(req())).toEqual({
      ok: true,
      admin: { via: "session", userId: "a1", email: "admin@demo.local" },
    });
    expect(await apiAdmin(req())).toEqual({ via: "session", userId: "a1", email: "admin@demo.local" });
  });

  it("ADMIN только в токене сессии, а в базе — нет: 403", async () => {
    guards.getSessionUser.mockResolvedValue({ userId: "a1", email: "x@y.z", role: "ADMIN" });
    guards.getAdminUser.mockResolvedValue(null);
    expect(await apiAdmin(req())).toBeNull();
  });

  it("ошибка базы при проверке роли не превращается в отказ — её видит обработчик (503)", async () => {
    guards.getSessionUser.mockResolvedValue({ userId: "a1", email: null, role: "ADMIN" });
    guards.getAdminUser.mockRejectedValue(new Error("db down"));
    await expect(checkApiAdmin(req())).rejects.toThrow("db down");
  });
});

describe("apiUser", () => {
  it("id вошедшего пользователя или null", async () => {
    guards.getSessionUser.mockResolvedValue(null);
    expect(await apiUser()).toBeNull();
    guards.getSessionUser.mockResolvedValue({ userId: "u1", email: null, role: "USER" });
    expect(await apiUser()).toBe("u1");
  });
});
