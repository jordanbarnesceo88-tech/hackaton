// Deployment smoke: real session -> durable CALCULATE -> stored result -> technical cleanup.
// Uses the existing public demo account; never prints credentials, cookies or response bodies.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

class SmokeFailure extends Error {}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function appOrigin(): string {
  try {
    const url = new URL(process.env.APP_URL || "http://localhost:3000");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new SmokeFailure("APP_URL must be an HTTP(S) origin without credentials or a path"); }
}

async function main() {
  const origin = appOrigin();
  const email = process.env.WORKER_CHECK_EMAIL || "demo@demo.local";
  const password = process.env.DEMO_USER_PASSWORD || "demo-user-2026";
  // All requests stay on one configured origin, so domain/path cookie routing is unnecessary.
  const cookies = new Map<string, string>();
  let jobId: string | null = null;
  let problem: SmokeFailure | null = null;

  async function request(path: string, stage: string, init: RequestInit = {}, timeoutMs = 10_000) {
    let response: Response;
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    headers.set("Cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    try {
      response = await fetch(new URL(path, origin), { ...init, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, timeoutMs)), headers });
    } catch { throw new SmokeFailure(`${stage}: network request failed`); }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!;
      const equals = pair.indexOf("=");
      if (equals < 1) continue;
      const key = pair.slice(0, equals), value = pair.slice(equals + 1);
      if (!value || /;\s*max-age=0(?:;|$)/i.test(cookie)) cookies.delete(key);
      else cookies.set(key, value);
    }
    return response;
  }

  async function json(response: Response, stage: string, statuses = [200]): Promise<JsonObject> {
    if (!statuses.includes(response.status)) throw new SmokeFailure(`${stage}: HTTP ${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new SmokeFailure(`${stage}: invalid JSON response`); }
    if (!object(body)) throw new SmokeFailure(`${stage}: invalid response shape`);
    return body;
  }

  async function status(timeoutMs = 10_000) {
    const body = await json(await request(`/api/v1/calculation-jobs/${encodeURIComponent(jobId!)}`, "poll", {}, timeoutMs), "poll");
    if (!object(body.job) || body.job.id !== jobId || body.job.operation !== "CALCULATE" || typeof body.job.status !== "string") {
      throw new SmokeFailure("poll: missing or mismatched job status");
    }
    return body.job;
  }

  try {
    const csrf = await json(await request("/api/auth/csrf", "csrf"), "csrf");
    if (typeof csrf.csrfToken !== "string" || !csrf.csrfToken) throw new SmokeFailure("csrf: token missing");
    const login = await json(await request("/api/auth/callback/credentials", "login", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
      body: new URLSearchParams({ email, password, csrfToken: csrf.csrfToken, callbackUrl: `${origin}/projects` }),
    }), "login");
    if (typeof login.url !== "string" || new URL(login.url, origin).searchParams.has("error")) throw new SmokeFailure("login: authentication rejected");
    const session = await json(await request("/api/auth/session", "session"), "session");
    if (!object(session.user) || session.user.email !== email.toLowerCase().trim()) throw new SmokeFailure("session: authenticated user missing");

    const accepted = await json(await request("/api/v1/calculation-jobs", "enqueue", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `worker-smoke:${randomUUID()}` },
      body: JSON.stringify({ operation: "CALCULATE", facility: "warehouse" }),
    }), "enqueue", [202]);
    if (!object(accepted.job) || typeof accepted.job.id !== "string" || !accepted.job.id) throw new SmokeFailure("enqueue: operation receipt missing");
    if (accepted.job.operation !== "CALCULATE" || accepted.job.status !== "QUEUED" || accepted.job.attempts !== 0 || accepted.job.publicationState !== "NONE") {
      throw new SmokeFailure("enqueue: a fresh queued operation was not acknowledged");
    }
    jobId = accepted.job.id;

    const deadline = Date.now() + 90_000;
    let final: JsonObject | null = null;
    while (Date.now() < deadline) {
      const job = await status(Math.min(10_000, deadline - Date.now()));
      if (job.status === "SUCCEEDED") { final = job; break; }
      if (job.status !== "QUEUED" && job.status !== "RUNNING") throw new SmokeFailure("worker: operation did not succeed");
      await delay(Math.max(0, Math.min(1000, deadline - Date.now())));
    }
    if (!final) throw new SmokeFailure("worker: no completed operation within 90 seconds");
    if (final.operation !== "CALCULATE" || final.publicationState !== "NONE" || typeof final.attempts !== "number" || final.attempts < 1) {
      throw new SmokeFailure("worker: invalid terminal receipt");
    }
    const result = await json(await request(`/api/v1/calculation-jobs/${encodeURIComponent(jobId)}/result`, "result"), "result");
    if (!object(result.job) || result.job.id !== jobId || result.job.status !== "SUCCEEDED" ||
      !object(result.results) || result.results.facility !== "warehouse" || typeof result.results.modelVersion !== "string" ||
      !Array.isArray(result.results.results) || !result.results.results.some(scenario => object(scenario) && scenario.status === "ok") ||
      !object(result.results.sim) || !Object.values(result.results.sim).some(summary => object(summary) &&
        typeof summary.inputKey === "string" && typeof summary.achievedPerH === "number" && Number.isFinite(summary.achievedPerH))) {
      throw new SmokeFailure("result: stored economics or canonical simulation missing");
    }
  } catch (error) {
    problem = error instanceof SmokeFailure ? error : new SmokeFailure("unexpected failure; response details withheld");
  } finally {
    if (jobId) {
      try {
        const current = await status();
        if (current.status === "QUEUED" || current.status === "RUNNING") {
          const cancelled = await request(`/api/v1/calculation-jobs/${encodeURIComponent(jobId)}/cancel`, "cleanup cancel", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
          });
          if (![200, 409].includes(cancelled.status)) throw new SmokeFailure("cleanup: cancellation not confirmed");
        }
        const until = Date.now() + 25_000;
        let terminal = false;
        while (Date.now() < until) {
          const job = await status();
          if (job.status !== "QUEUED" && job.status !== "RUNNING") { terminal = true; break; }
          await delay(1000);
        }
        if (!terminal) throw new SmokeFailure("cleanup: operation remains active");
        const removed = await request(`/api/v1/calculation-jobs/${encodeURIComponent(jobId)}`, "cleanup remove", {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        if (removed.status !== 200) throw new SmokeFailure("cleanup: technical result not removed");
        const inaccessible = await request(`/api/v1/calculation-jobs/${encodeURIComponent(jobId)}`, "cleanup verify");
        if (inaccessible.status !== 404) throw new SmokeFailure("cleanup: removed technical result is still accessible");
      } catch {
        console.error("worker smoke: cleanup failed");
        problem ??= new SmokeFailure("cleanup failed");
      }
    }
  }
  if (problem) throw problem;
  console.info("worker smoke: PASS — durable CALCULATE completed; stored economics and simulation verified; technical result removed");
}

void main().catch(error => {
  console.error(`worker smoke: FAIL — ${error instanceof SmokeFailure ? error.message : "check failed; details withheld"}`);
  process.exitCode = 1;
});
