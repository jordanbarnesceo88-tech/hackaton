"use client";

import { useEffect, useRef, useState } from "react";
import { cancelCalculation, forgetSubmission, readCalculationResult, submitCalculation, waitForCalculation } from "@/lib/calculation-jobs/client";
import type { CalculationRequest } from "@/lib/calculation-jobs/service";
import type { JobReceipt } from "@/lib/calculation-jobs/types";

/** Closing the view stops polling. Only the explicit cancel button stops publication. */
export function useDurableCalculation() {
  const [job, setJob] = useState<JobReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const watcher = useRef<AbortController | null>(null);
  const running = useRef(false);
  useEffect(() => () => { watcher.current?.abort(); }, []);

  async function run(request: CalculationRequest, scope: string) {
    if (running.current) return null;
    running.current = true;
    const controller = new AbortController();
    watcher.current = controller;
    setBusy(true);
    try {
      const accepted = await submitCalculation(request, scope);
      if (controller.signal.aborted) return null;
      setJob(accepted);
      const terminal = await waitForCalculation(accepted.id, setJob, controller.signal);
      if (controller.signal.aborted) return null;
      if (terminal.status !== "SUCCEEDED") {
        forgetSubmission(scope);
        if (terminal.status === "CANCELLED") return null;
        throw new Error(terminal.safeMessage);
      }
      const result = await readCalculationResult(accepted.id, controller.signal);
      if (controller.signal.aborted) return null;
      forgetSubmission(scope);
      return result;
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      running.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function cancel() {
    if (!job || cancelling) return;
    setCancelling(true);
    try { setJob(await cancelCalculation(job.id)); }
    finally { setCancelling(false); }
  }

  return { job, busy, cancelling, run, cancel };
}
