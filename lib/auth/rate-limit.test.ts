import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { rateLimit, clientIp } from "./rate-limit";
import { prisma } from "@/lib/db/client";

const KEY = "test:ratelimit:key";

describe("rateLimit (DB-backed fixed window)", () => {
  beforeEach(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: KEY } });
  });
  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key: KEY } });
  });

  it("allows up to the limit, then blocks", async () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect((await rateLimit(KEY, opts)).ok).toBe(true); // 1
    expect((await rateLimit(KEY, opts)).ok).toBe(true); // 2
    expect((await rateLimit(KEY, opts)).ok).toBe(true); // 3
    const blocked = await rateLimit(KEY, opts); // 4 → over limit
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets once the window has elapsed", async () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await rateLimit(KEY, opts)).ok).toBe(true);
    expect((await rateLimit(KEY, opts)).ok).toBe(false); // blocked in-window
    // Backdate the window so it looks elapsed.
    await prisma.rateLimit.update({
      where: { key: KEY },
      data: { windowStart: new Date(Date.now() - 61_000) },
    });
    expect((await rateLimit(KEY, opts)).ok).toBe(true); // fresh window
  });
});

describe("clientIp", () => {
  it("takes the first X-Forwarded-For hop", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientIp(h)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("concurrency (the shape a credential-stuffing attack actually takes)", () => {
  it("does not let a parallel burst walk past the limit", async () => {
    const key = `race:${Date.now()}:${Math.random()}`;
    const opts = { limit: 5, windowMs: 60_000 };
    // 40 simultaneous attempts against a limit of 5. Under the old read-then-write every
    // request saw no row, took the fresh-window branch, and wrote count = 1 — so all 40 were
    // allowed and the counter ended at 1.
    const results = await Promise.all([...Array(40)].map(() => rateLimit(key, opts)));
    const allowed = results.filter((r) => r.ok).length;
    expect(allowed).toBeLessThanOrEqual(opts.limit);
  });

  it("keeps blocking after the burst instead of resetting the window", async () => {
    const key = `race2:${Date.now()}:${Math.random()}`;
    const opts = { limit: 5, windowMs: 60_000 };
    await Promise.all([...Array(20)].map(() => rateLimit(key, opts)));
    const after = await Promise.all([...Array(20)].map(() => rateLimit(key, opts)));
    expect(after.filter((r) => r.ok).length).toBe(0);
  });
});
