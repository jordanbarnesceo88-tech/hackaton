import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { runCalculationWorker } from "./worker";
import { CalculationQueuePolicyError } from "./policy";
import { claimJob, reapExpiredJobs } from "./store";

vi.mock("./store", () => ({
  claimJob: vi.fn(), reapExpiredJobs: vi.fn().mockResolvedValue(0),
  completeJob: vi.fn(), failJob: vi.fn(), heartbeatJob: vi.fn(),
}));
vi.mock("./service", () => ({ computeFrozenCalculation: vi.fn(), publishFrozenCalculation: vi.fn() }));

afterEach(() => vi.clearAllMocks());

it("terminates on invalid policy instead of silently polling as if the database were unavailable", async () => {
  const error = new CalculationQueuePolicyError("QUEUE_POLICY_INVALID", "Invalid policy");
  vi.mocked(claimJob).mockRejectedValueOnce(error);
  await expect(runCalculationWorker({} as PrismaClient, new AbortController().signal)).rejects.toBe(error);
  expect(claimJob).toHaveBeenCalledTimes(1);
  expect(reapExpiredJobs).toHaveBeenCalledTimes(1);
});
