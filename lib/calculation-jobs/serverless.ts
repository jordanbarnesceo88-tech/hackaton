import type { PrismaClient } from "@prisma/client";
import { claimJob, reapExpiredJobs } from "./store";
import { executeClaim } from "./worker";

export const SERVERLESS_CALCULATION_DEADLINE_MS = 280_000;
const inFlight = new Map<string, Promise<void>>();

/** One owner-authorized job per callback. Database locks/leases, not this map, grant execution. */
export function dispatchOwnedCalculation(db: PrismaClient, ownerId: string, jobId: string): Promise<void> {
  const key = JSON.stringify([ownerId, jobId]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), SERVERLESS_CALCULATION_DEADLINE_MS);
    try {
      const target = { ownerId, jobId };
      await reapExpiredJobs(db, target);
      if (controller.signal.aborted) return;
      const claim = await claimJob(db, { target });
      if (claim) await executeClaim(db, claim, controller.signal);
    } finally { clearTimeout(deadline); }
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, pending);
  return pending;
}
