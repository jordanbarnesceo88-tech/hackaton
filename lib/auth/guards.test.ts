import { describe, it, expect, vi, beforeEach } from "vitest";

// Набор unit: база, next-auth и навигация Next подменены. redirect() и notFound() в Next
// бросают исключение и прерывают рендер; здесь они бросают узнаваемые ошибки-метки, чтобы
// проверить и сам факт прерывания, и то, что код после них не выполнился.
const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
}));
// Конфигурация, которую auth.ts передаёт в NextAuth(): её колбэки и authorize проверяются ниже.
const captured = vi.hoisted(() => ({ config: undefined as unknown }));
const mockRateLimit = vi.hoisted(() => vi.fn());
const mockVerifyPassword = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => nav);
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db/client", () => ({ prisma: { user: { findUnique: mockFindUnique } } }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: object) => ({ id: "credentials", ...options }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimit: mockRateLimit,
  clientIp: () => "203.0.113.7",
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: mockVerifyPassword,
  decoyHash: async () => "$2b$12$decoy",
  hashPassword: async () => "$2b$12$new",
  needsRehash: () => false,
  holdUntilFloor: async () => {},
}));

const { getSessionUser, requireUser, requireAdmin, getAdminUser, isAdminSession } =
  await import("./guards");

const session = (id: string, role?: "USER" | "ADMIN", email = "u@x.io") => ({
  user: { id, email, ...(role ? { role } : {}) },
  expires: "2099-01-01T00:00:00.000Z",
});
const dbRole = (role: "USER" | "ADMIN" | null) =>
  mockFindUnique.mockResolvedValue(role === null ? null : { role });

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
  nav.redirect.mockClear();
  nav.notFound.mockClear();
});

describe("getSessionUser / requireUser", () => {
  it("гость: getSessionUser возвращает null и не перенаправляет", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("гость: requireUser перенаправляет на /login", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT /login");
  });

  it("сессия без id считается гостем", async () => {
    mockAuth.mockResolvedValue({ user: { email: "u@x.io" }, expires: "2099-01-01" });
    await expect(requireUser()).rejects.toThrow("REDIRECT /login");
  });

  it("вошедший: requireUser отдаёт id, почту и роль из токена, не трогая базу", async () => {
    mockAuth.mockResolvedValue(session("u1", "ADMIN", "a@demo.local"));
    expect(await requireUser()).toEqual({ userId: "u1", email: "a@demo.local", role: "ADMIN" });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("токен без роли (выдан до появления ролей) — обычный пользователь", async () => {
    mockAuth.mockResolvedValue(session("u1"));
    expect((await getSessionUser())?.role).toBe("USER");
  });
});

describe("requireAdmin", () => {
  it("гость: перенаправление на /login без запроса к базе", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /login");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("USER: 404", async () => {
    mockAuth.mockResolvedValue(session("u1", "USER"));
    dbRole("USER");
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("ADMIN в базе, USER в токене (повысили после входа): пропускает", async () => {
    mockAuth.mockResolvedValue(session("a1", "USER", "admin@demo.local"));
    dbRole("ADMIN");
    expect(await requireAdmin()).toEqual({
      userId: "a1",
      email: "admin@demo.local",
      role: "ADMIN",
    });
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "a1" }, select: { role: true } });
  });

  it("ADMIN в токене, USER в базе (понизили после входа): 404", async () => {
    mockAuth.mockResolvedValue(session("a1", "ADMIN"));
    dbRole("USER");
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
  });

  it("ADMIN в токене, пользователя в базе нет (удалён, база пересоздана): 404", async () => {
    mockAuth.mockResolvedValue(session("gone", "ADMIN"));
    dbRole(null);
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
  });

  it("ошибка базы не превращается в допуск", async () => {
    mockAuth.mockResolvedValue(session("a1", "ADMIN"));
    mockFindUnique.mockRejectedValue(new Error("connection refused"));
    await expect(requireAdmin()).rejects.toThrow("connection refused");
  });
});

describe("getAdminUser / isAdminSession", () => {
  it("гость: null и false, без запроса к базе", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await getAdminUser()).toBeNull();
    expect(await isAdminSession()).toBe(false);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("USER: null и false, без перенаправления и 404", async () => {
    mockAuth.mockResolvedValue(session("u1", "USER"));
    dbRole("USER");
    expect(await getAdminUser()).toBeNull();
    expect(await isAdminSession()).toBe(false);
    expect(nav.redirect).not.toHaveBeenCalled();
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it("решает база, а не токен", async () => {
    mockAuth.mockResolvedValue(session("a1", "ADMIN"));
    dbRole("USER");
    expect(await isAdminSession()).toBe(false);
    mockAuth.mockResolvedValue(session("a1", "USER"));
    dbRole("ADMIN");
    expect(await isAdminSession()).toBe(true);
    expect((await getAdminUser())?.role).toBe("ADMIN");
  });

  it("isAdminSession при ошибке базы отвечает false, не роняя страницу", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAuth.mockResolvedValue(session("a1", "ADMIN"));
    mockFindUnique.mockRejectedValue(new Error("connection refused"));
    expect(await isAdminSession()).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

// auth.ts целиком: next-auth подменён так, что NextAuth() только запоминает конфигурацию.
type Json = Record<string, unknown>;
type CapturedConfig = {
  providers: { authorize: (creds: Json, request: Request) => Promise<Json | null> }[];
  callbacks: {
    jwt: (p: { token: Json; user?: Json }) => Json;
    session: (p: { session: { user?: Json; expires: string }; token: Json }) => {
      user?: Json;
    };
  };
};
const loadAuthConfig = async (): Promise<CapturedConfig> => {
  await vi.importActual<typeof import("@/auth")>("@/auth");
  return captured.config as CapturedConfig;
};

describe("auth.ts: роль в токене и лимит входа для демо-аккаунтов", () => {
  const request = new Request("http://localhost/api/auth/callback/credentials");
  const dbUser = (email: string, role: "USER" | "ADMIN") => ({
    id: "id-" + role,
    email,
    name: null,
    passwordHash: "$2b$12$hash",
    role,
  });

  beforeEach(() => {
    mockRateLimit.mockReset();
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSec: 0 });
    mockVerifyPassword.mockReset();
    mockVerifyPassword.mockResolvedValue(true);
  });

  it("authorize возвращает роль из базы", async () => {
    const { providers } = await loadAuthConfig();
    mockFindUnique.mockResolvedValue(dbUser("admin@demo.local", "ADMIN"));
    const user = await providers[0]!.authorize(
      { email: "admin@demo.local", password: "demo-admin-2026" },
      request,
    );
    expect(user).toMatchObject({ id: "id-ADMIN", email: "admin@demo.local", role: "ADMIN" });
  });

  it("лимит на аккаунт: 100 для @demo.local, 10 для остальных; лимит на IP 50 для всех", async () => {
    const { providers } = await loadAuthConfig();
    const limits = async (email: string) => {
      mockRateLimit.mockClear();
      mockFindUnique.mockResolvedValue(dbUser(email, "USER"));
      await providers[0]!.authorize({ email, password: "password12345" }, request);
      return mockRateLimit.mock.calls.map(([key, opts]) => [key, (opts as { limit: number }).limit]);
    };
    expect(await limits("demo@demo.local")).toEqual([
      ["login:demo@demo.local:203.0.113.7", 100],
      ["login:ip:203.0.113.7", 50],
    ]);
    expect(await limits("someone@example.com")).toEqual([
      ["login:someone@example.com:203.0.113.7", 10],
      ["login:ip:203.0.113.7", 50],
    ]);
    // Похожий, но чужой домен лимит не поднимает.
    expect((await limits("demo@demo.local.evil.io"))[0]?.[1]).toBe(10);
  });

  it("колбэк jwt кладёт id и роль при входе и не трогает токен при продлении", async () => {
    const { callbacks } = await loadAuthConfig();
    expect(callbacks.jwt({ token: {}, user: { id: "a1", role: "ADMIN" } })).toMatchObject({
      id: "a1",
      role: "ADMIN",
    });
    expect(callbacks.jwt({ token: {}, user: { id: "u1" } })).toMatchObject({ id: "u1", role: "USER" });
    const renewed = { id: "a1", role: "ADMIN" };
    expect(callbacks.jwt({ token: renewed })).toEqual({ id: "a1", role: "ADMIN" });
  });

  it("колбэк session переносит роль; токен без роли — USER; чужое значение — USER", async () => {
    const { callbacks } = await loadAuthConfig();
    const run = (token: Json) =>
      callbacks.session({ session: { user: { email: "x@y.z" }, expires: "2099-01-01" }, token })
        .user;
    expect(run({ id: "a1", role: "ADMIN" })).toMatchObject({ id: "a1", role: "ADMIN" });
    expect(run({ id: "u1" })).toMatchObject({ id: "u1", role: "USER" });
    expect(run({ id: "u1", role: "SUPERUSER" })).toMatchObject({ role: "USER" });
  });
});
