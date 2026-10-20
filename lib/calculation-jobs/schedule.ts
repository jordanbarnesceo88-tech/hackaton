import { after } from "next/server";
import type { PrismaClient } from "@prisma/client";
import type { JobReceipt } from "./types";

/** Vercel keeps this bounded invocation alive after the response; PostgreSQL owns the job. */
export function scheduleOwnedCalculations(db: PrismaClient, ownerId: string, jobs: Pick<JobReceipt, "id" | "status">[]): void {
  if (process.env.VERCEL !== "1") return;
  const pending = jobs.filter(job => job.status === "QUEUED" || job.status === "RUNNING");
  if (!pending.length) return;
  after(async () => {
    try {
      const { dispatchOwnedCalculation } = await import("./serverless");
      const results = await Promise.allSettled(pending.map(job => dispatchOwnedCalculation(db, ownerId, job.id)));
      if (results.some(result => result.status === "rejected")) console.error("calculation_serverless_dispatch_unavailable");
    } catch {
      // A failed invocation must not rewrite the accepted intent or expose frozen inputs.
      console.error("calculation_serverless_dispatch_unavailable");
    }
  });
}
