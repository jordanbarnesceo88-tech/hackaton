import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { stableJson } from "../tz/version";
import { computeFrozenCalculation, publishFrozenCalculation } from "./service";
import { claimJob, completeJob, failJob, heartbeatJob, reapExpiredJobs } from "./store";
import { JOB_HEARTBEAT_MS, type ClaimedJob } from "./types";
import { CalculationQueuePolicyError } from "./policy";

/** A lost lease stops execution and can never publish. No transaction spans compute. */
export async function executeClaim(db: PrismaClient, claim: ClaimedJob, signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) controller.abort();
  let pulseInFlight: Promise<void> | null = null;
  let stage = "calculating";
  const pulse = (): Promise<void> => {
    if (pulseInFlight) return pulseInFlight;
    pulseInFlight = (async () => {
      try {
        if (!await heartbeatJob(db, claim, { stage })) controller.abort();
      } catch {
        // Unavailable DB means the worker cannot prove ownership; fail closed.
        controller.abort();
      }
    })().finally(() => { pulseInFlight = null; });
    return pulseInFlight;
  };
  const timer = setInterval(() => { void pulse(); }, JOB_HEARTBEAT_MS);
  try {
    const hash = createHash("sha256").update(stableJson(claim.run.input)).digest("hex");
    if (hash !== claim.run.inputHash) {
      await failJob(db, claim, "INPUT_INTEGRITY_FAILED", "Сохранённый вход расчёта повреждён; результат не опубликован");
      return;
    }
    await pulse();
    const computed = await computeFrozenCalculation(claim.run.input, controller.signal, current => {
      stage = current;
      void pulse();
    });
    clearInterval(timer);
    await pulseInFlight;
    if (controller.signal.aborted) {
      if (!signal?.aborted) await failJob(db, claim, "COMPUTATION_ABORTED", "Расчёт остановлен; проект не изменён");
      return;
    }
    stage = "publishing";
    if (!await heartbeatJob(db, claim, { stage })) return;
    const completed = await completeJob(db, claim, computed, publishFrozenCalculation);
    if (!completed) await failJob(db, claim, "PUBLICATION_NOT_ACCEPTED", "Публикация расчёта не принята; проект не изменён");
  } catch (error) {
    // A deployment stop intentionally leaves a lease for bounded recovery by a new worker.
    if (signal?.aborted) return;
    const name = error instanceof Error ? error.name : "Error";
    const code = name === "SimBudgetExceeded" ? "COMPUTE_BUDGET_EXCEEDED" : name === "AbortError" ? "COMPUTATION_ABORTED" : "COMPUTATION_FAILED";
    const message = code === "COMPUTE_BUDGET_EXCEEDED"
      ? "Исчерпан бюджет расчёта. Уменьшите объём проверки; проект не изменён"
      : "Расчёт не завершён; проект не изменён. Проверьте исходные данные или создайте новый запуск";
    await failJob(db, claim, code, message).catch(() => { /* Recovery is bounded by the DB lease. */ });
    console.error(`calculation_job_failed job=${claim.job.id} code=${code}`);
  } finally {
    clearInterval(timer);
    await pulseInFlight;
    signal?.removeEventListener("abort", stop);
  }
}

function waitForWork(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, delayMs);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** One CPU job per process. Multiple processes share the PostgreSQL valid-lease cap. */
export async function runCalculationWorker(db: PrismaClient, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await reapExpiredJobs(db);
      const claim = await claimJob(db);
      if (claim) { await executeClaim(db, claim, signal); continue; }
    } catch (error) {
      if (error instanceof CalculationQueuePolicyError) throw error;
      console.error("calculation_worker_database_unavailable");
    }
    await waitForWork(signal, 1000);
  }
}
