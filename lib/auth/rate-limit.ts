import { prisma } from "@/lib/db/client";

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

/**
 * DB-backed fixed-window rate limiter. Works on a single Docker instance AND serverless/
 * multi-instance (the counter lives in Postgres). `key` identifies the bucket (e.g.
 * "signup:ip:1.2.3.4" or "login:foo@bar:1.2.3.4"). Returns ok=false once `limit` is exceeded
 * within `windowMs`, with retryAfterSec until the window resets.
 *
 * Fail-open: if the DB read/write errors, allow the request (never lock users out on infra
 * hiccups) — the limiter is defense-in-depth, not the primary auth control.
 *
 * Counting is a single atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`. This was a
 * read-then-write, which the previous comment described as over-counting "by up to N". Measured,
 * it was worse than that: every request in a burst read no row, all took the fresh-window branch,
 * and each wrote `count = 1`, clobbering rather than accumulating — 100 parallel attempts against
 * a limit of 10 were all allowed, and repeated bursts of 20 let 40 through before it clamped. The
 * overshoot scaled with the attacker's concurrency, so the effective limit was roughly twice
 * whatever parallelism they chose — weakest against credential stuffing, which is precisely the
 * parallel shape this exists to slow. Postgres takes a row lock for the conflicting update, so
 * concurrent callers now serialise and the returned count is authoritative.
 *
 * Remaining accepted limitations:
 *  - Counts every attempt (successes too), so a user re-logging in >limit times in a window is
 *    throttled; the caps are set generously (JWT sessions make frequent re-login rare).
 *  - Trust in the client IP is only as good as the proxy (see `clientIp`).
 */
export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const now = Date.now();
  const startedAt = new Date(now);
  // Any window that began at or before this instant has elapsed and must restart at 1.
  const expiredBefore = new Date(now - windowMs);
  try {
    // One statement: insert the bucket, or — under the row lock Postgres takes for the
    // conflicting update — either restart an elapsed window or increment a live one. The
    // returned count already includes this attempt, so `count > limit` is the block condition.
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, ${startedAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."windowStart" <= ${expiredBefore} THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimit"."windowStart" <= ${expiredBefore} THEN ${startedAt}
          ELSE "RateLimit"."windowStart"
        END
      RETURNING "count", "windowStart"
    `;

    const row = rows[0];
    if (!row) return { ok: true, retryAfterSec: 0 }; // shouldn't happen; fail open

    const count = Number(row.count);
    const windowStart =
      row.windowStart instanceof Date ? row.windowStart : new Date(row.windowStart);
    // A window this call just started has nothing to wait for, matching the previous contract.
    const retryAfterSec =
      count === 1 ? 0 : Math.ceil((windowMs - (now - windowStart.getTime())) / 1000);

    if (count > limit) return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
    return { ok: true, retryAfterSec };
  } catch {
    return { ok: true, retryAfterSec: 0 }; // fail-open
  }
}

/**
 * First hop of X-Forwarded-For (the client IP behind a proxy), falling back to "unknown".
 * SECURITY: only trustworthy if a proxy you control OVERWRITES the inbound XFF (Vercel and a
 * correctly-configured nginx/Cloudflare do). If the proxy merely appends, a client can spoof the
 * leftmost hop and rotate it to get unlimited fresh buckets — see DEPLOY.md.
 */
export function clientIp(headers: Headers): string {
  const firstHop = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (firstHop) return firstHop;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
