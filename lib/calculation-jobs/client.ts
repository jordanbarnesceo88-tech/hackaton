"use client";

import type { JobReceipt } from "./types";
import type { CalculationRequest } from "./service";
import type { ProjectResults } from "../tz/types";
import type { SaveProjectInput } from "../projects/action-types";
import { stableJson } from "../tz/version";

export type JobResult = { job: JobReceipt; results: ProjectResults | null; submitted: SaveProjectInput | null };
const memoryKeys = new Map<string, { fingerprint: string; key: string }>();

export class CalculationClientError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "CalculationClientError"; }
}

/** Retain the submission key before sending: a lost response must not create another job. */
async function submissionKey(scope: string, request: CalculationRequest): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.randomUUID !== "function") {
    throw new Error("Для надёжной отправки расчёта откройте платформу через HTTPS или localhost");
  }
  const bytes = new TextEncoder().encode(stableJson(request));
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  let saved = memoryKeys.get(scope);
  try {
    const raw = sessionStorage.getItem(`alfa-calculation:${scope}`);
    if (raw) saved = JSON.parse(raw);
  } catch { /* In-memory retry protection still works when browser storage is unavailable. */ }
  if (saved?.fingerprint === fingerprint && typeof saved.key === "string") return saved.key;
  const next = { fingerprint, key: crypto.randomUUID() };
  memoryKeys.set(scope, next);
  try { sessionStorage.setItem(`alfa-calculation:${scope}`, JSON.stringify(next)); } catch { /* See in-memory fallback above. */ }
  return next.key;
}

export function forgetSubmission(scope: string): void {
  memoryKeys.delete(scope);
  try { sessionStorage.removeItem(`alfa-calculation:${scope}`); } catch { /* Storage is optional. */ }
}

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new CalculationClientError(response.status, typeof body.error === "string" ? body.error : "Сервер не подтвердил операцию. Повторите отправку с теми же данными");
  return body;
}

export async function submitCalculation(request: CalculationRequest, scope: string): Promise<JobReceipt> {
  const key = await submissionKey(scope, request);
  try {
    const body = await responseJson(await fetch("/api/v1/calculation-jobs", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(request), signal: AbortSignal.timeout(30_000),
    }));
    return body.job;
  } catch (error) {
    if (error instanceof CalculationClientError && error.status === 410) forgetSubmission(scope);
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) {
      throw new Error("Подтверждение отправки не получено. Повторите с теми же данными — сервер найдёт прежнюю операцию и не создаст дубликат");
    }
    throw error;
  }
}

export async function readCalculation(id: string, signal?: AbortSignal): Promise<JobReceipt> {
  const body = await responseJson(await fetch(`/api/v1/calculation-jobs/${encodeURIComponent(id)}`, { cache: "no-store", signal: requestSignal(signal) }));
  return body.job;
}

export async function readCalculationResult(id: string, signal?: AbortSignal): Promise<JobResult> {
  return responseJson(await fetch(`/api/v1/calculation-jobs/${encodeURIComponent(id)}/result`, { cache: "no-store", signal: requestSignal(signal) }));
}

export async function cancelCalculation(id: string): Promise<JobReceipt> {
  const body = await responseJson(await fetch(`/api/v1/calculation-jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: requestSignal(),
  }));
  return body.job;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function removeCalculationResult(id: string): Promise<void> {
  await responseJson(await fetch(`/api/v1/calculation-jobs/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}", signal: requestSignal(),
  }));
}

export function isPendingJob(job: Pick<JobReceipt, "status">): boolean {
  return job.status === "QUEUED" || job.status === "RUNNING";
}

function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Просмотр закрыт", "AbortError")); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Просмотр закрыт", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, 1000);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Poll compact state only. Leaving the page stops watching, never the durable computation. */
export async function waitForCalculation(id: string, onProgress: (job: JobReceipt) => void, signal?: AbortSignal): Promise<JobReceipt> {
  let networkFailures = 0;
  for (;;) {
    try {
      const job = await readCalculation(id, signal);
      networkFailures = 0;
      onProgress(job);
      if (!isPendingJob(job)) return job;
    } catch (error) {
      if (signal?.aborted || ++networkFailures >= 5) throw error;
    }
    await pause(signal);
  }
}
