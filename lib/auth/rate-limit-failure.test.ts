import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/client", () => ({ prisma: { $queryRaw: query } }));
import { rateLimit } from "./rate-limit";

beforeEach(() => vi.clearAllMocks());

describe("rate limiter availability contract", () => {
  it("keeps auth fail-open while telling cost-bearing callers that the database failed", async () => {
    query.mockRejectedValueOnce(new Error("synthetic database outage"));
    expect(await rateLimit("test", { limit: 1, windowMs: 60000 })).toEqual({ ok: true, retryAfterSec: 0, unavailable: true });
  });

  it("does not treat a missing authoritative counter as a healthy allowance", async () => {
    query.mockResolvedValueOnce([]);
    expect(await rateLimit("test", { limit: 1, windowMs: 60000 })).toEqual({ ok: true, retryAfterSec: 0, unavailable: true });
  });

  it("preserves successful and exhausted quota responses", async () => {
    query.mockResolvedValueOnce([{ count: 1, windowStart: new Date() }]);
    expect(await rateLimit("test", { limit: 1, windowMs: 60000 })).toEqual({ ok: true, retryAfterSec: 0 });
    query.mockResolvedValueOnce([{ count: 2, windowStart: new Date() }]);
    expect(await rateLimit("test", { limit: 1, windowMs: 60000 })).toMatchObject({ ok: false, retryAfterSec: expect.any(Number) });
  });
});
