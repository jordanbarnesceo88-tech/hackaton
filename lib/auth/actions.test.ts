import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";

// signUpAction was at 0% coverage despite owning the rate limit, the email/password rules and
// the duplicate-account race. Only its two boundaries are faked — next/headers for the client
// IP, and signIn, which throws a redirect on success and so cannot run in a unit test. The
// rate limiter and the database are real.
const mockHeaders = vi.hoisted(() => vi.fn());
const mockSignIn = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));
vi.mock("@/auth", () => ({ signIn: mockSignIn, signOut: vi.fn() }));

const { signUpAction } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const run = (fields: Record<string, string>) => signUpAction({ error: null }, form(fields));

let ip = "";
beforeEach(() => {
  // A distinct IP per test so the shared fixed-window limiter cannot bleed across cases.
  ip = `unit-${Date.now()}-${Math.random()}`;
  mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": ip }));
  mockSignIn.mockResolvedValue(undefined);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "unit-signup+" } } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: "unit-" } } });
});

describe("signUpAction validation", () => {
  it("rejects a malformed email", async () => {
    expect((await run({ email: "not-an-email", password: "password12345" })).error).toMatch(/email/i);
  });

  it("rejects a password under 8 characters", async () => {
    expect((await run({ email: `unit-signup+${Date.now()}@x.io`, password: "short" })).error)
      .toMatch(/не короче 8/);
  });

  it("rejects a password over bcrypt's 72-byte limit", async () => {
    // 40 Cyrillic characters is 80 bytes: it looks like a fine passphrase and would have been
    // silently truncated to 36 characters before this check existed.
    const res = await run({ email: `unit-signup+${Date.now()}@x.io`, password: "п".repeat(40) });
    expect(res.error).toMatch(/слишком длинный/);
  });

  it("creates the account, lowercased and trimmed, then signs in", async () => {
    const email = `unit-signup+${Date.now()}@x.io`;
    const res = await run({ email: `  ${email.toUpperCase()}  `, password: "password12345", name: "Tester" });
    expect(res.error).toBeNull();
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.name).toBe("Tester");
    // never stored in the clear
    expect(user?.passwordHash).not.toBe("password12345");
    expect(user?.passwordHash.startsWith("$2")).toBe(true);
    expect(mockSignIn).toHaveBeenCalled();
  });

  it("reports an existing account without leaking anything else", async () => {
    const email = `unit-signup+dupe${Date.now()}@x.io`;
    await run({ email, password: "password12345" });
    expect((await run({ email, password: "different12345" })).error).toMatch(/уже существует/);
  });

  it("throttles once the per-IP signup limit is exhausted", async () => {
    const fixedIp = `unit-burst-${Date.now()}`;
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": fixedIp }));
    const attempt = (n: number) => run({ email: `unit-signup+rl${n}${Date.now()}@x.io`, password: "password12345" });
    for (let i = 0; i < 5; i++) await attempt(i); // exhaust the 5-per-IP window
    expect((await attempt(99)).error).toMatch(/Слишком много попыток/);
  });
});
