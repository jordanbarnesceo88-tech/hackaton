import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimJob, reapExpiredJobs } from "./store";
import { executeClaim } from "./worker";
import { dispatchOwnedCalculation, SERVERLESS_CALCULATION_DEADLINE_MS } from "./serverless";
import type { ClaimedJob } from "./types";

vi.mock("./store", () => ({ claimJob: vi.fn(), reapExpiredJobs: vi.fn() }));
vi.mock("./worker", () => ({ executeClaim: vi.fn() }));
const db = {} as PrismaClient;
const claim = { job: { id: "job" }, run: { ownerId: "owner" }, token: "lease" } as ClaimedJob;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(reapExpiredJobs).mockResolvedValue(0);
  vi.mocked(claimJob).mockResolvedValue(claim);
  vi.mocked(executeClaim).mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

describe("bounded serverless durable executor", () => {
  it("deduplicates concurrent callbacks for the same authorized target and never drains another job", async () => {
    let release!: () => void;
    vi.mocked(executeClaim).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = dispatchOwnedCalculation(db, "owner", "job");
    const second = dispatchOwnedCalculation(db, "owner", "job");
    expect(second).toBe(first);
    await vi.waitFor(() => expect(executeClaim).toHaveBeenCalledTimes(1));
    expect(reapExpiredJobs).toHaveBeenCalledExactlyOnceWith(db, { ownerId: "owner", jobId: "job" });
    expect(claimJob).toHaveBeenCalledExactlyOnceWith(db, { target: { ownerId: "owner", jobId: "job" } });
    release(); await Promise.all([first, second]);
    expect(claimJob).toHaveBeenCalledTimes(1);
  });
  it("returns when the DB cap or another lease prevents claiming, without an in-memory retry loop", async () => {
    vi.mocked(claimJob).mockResolvedValueOnce(null);
    await dispatchOwnedCalculation(db, "owner", "full");
    expect(claimJob).toHaveBeenCalledTimes(1); expect(executeClaim).not.toHaveBeenCalled();
  });
  it("lets a subsequent authorized poll recover the same expired job using the existing reaper and delay", async () => {
    vi.mocked(reapExpiredJobs).mockResolvedValueOnce(1);
    vi.mocked(claimJob).mockResolvedValueOnce(null);
    await dispatchOwnedCalculation(db, "owner", "recovery");
    await dispatchOwnedCalculation(db, "owner", "recovery");
    expect(reapExpiredJobs).toHaveBeenCalledTimes(2); expect(executeClaim).toHaveBeenCalledTimes(1);
    expect(claimJob).toHaveBeenLastCalledWith(db, { target: { ownerId: "owner", jobId: "recovery" } });
  });
  it("aborts at the bounded deadline, then permits a later recovery callback", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.mocked(executeClaim).mockImplementationOnce(async (_db, _claim, incoming) => {
      signal = incoming;
      await new Promise<void>(resolve => incoming!.addEventListener("abort", () => resolve(), { once: true }));
    });
    const pending = dispatchOwnedCalculation(db, "owner", "deadline");
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(SERVERLESS_CALCULATION_DEADLINE_MS);
    await pending; expect(signal?.aborted).toBe(true);
    await dispatchOwnedCalculation(db, "owner", "deadline");
    expect(claimJob).toHaveBeenCalledTimes(2);
  });
  it("cleans the in-flight entry on a DB failure instead of permanently suppressing recovery", async () => {
    vi.mocked(reapExpiredJobs).mockRejectedValueOnce(new Error("database unavailable"));
    await expect(dispatchOwnedCalculation(db, "owner", "retry")).rejects.toThrow("database unavailable");
    await dispatchOwnedCalculation(db, "owner", "retry");
    expect(claimJob).toHaveBeenCalledTimes(1); expect(executeClaim).toHaveBeenCalledTimes(1);
  });
  it("does not share authorization between different owners targeting the same identifier", async () => {
    await Promise.all([dispatchOwnedCalculation(db, "owner", "same"), dispatchOwnedCalculation(db, "other", "same")]);
    expect(claimJob).toHaveBeenCalledWith(db, { target: { ownerId: "owner", jobId: "same" } });
    expect(claimJob).toHaveBeenCalledWith(db, { target: { ownerId: "other", jobId: "same" } });
  });
});
