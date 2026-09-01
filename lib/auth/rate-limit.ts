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
 * Known, accepted limitations (defense-in-depth, not a hard gate):
 *  - Non-atomic read-then-write: N concurrent requests in one window can over-count past `limit`
 *    by up to N. Fine for brute-force slowing; an atomic `INSERT … ON CONFLICT … RETURNING`
 *    would tighten it if ever needed.
 *  - Counts every attempt (successes too), so a user re-logging in >limit times in a window is
 *    throttled; the caps are set generously (JWT sessions make frequent re-login rare).
 *  - Trust in the client IP is only as good as the proxy (see `clientIp`).
 */
export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const now = Date.now();
  try {
    const row = await prisma.rateLimit.findUnique({ where: { key } });

    if (!row || now - row.windowStart.getTime() >= windowMs) {
      // No bucket, or the window elapsed → start a fresh window.
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowStart: new Date(now) },
        update: { count: 1, windowStart: new Date(now) },
      });
      return { ok: true, retryAfterSec: 0 };
    }

    const retryAfterSec = Math.ceil((windowMs - (now - row.windowStart.getTime())) / 1000);
    if (row.count >= limit) {
      return { ok: false, retryAfterSec };
    }

    await prisma.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
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
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
