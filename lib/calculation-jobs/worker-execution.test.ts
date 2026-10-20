import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
import { computeFrozenCalculation } from "./service";
import { completeJob, failJob, heartbeatJob, retryBusyJob } from "./store";
import { executeClaim } from "./worker";
import type { ClaimedJob } from "./types";
import { stableJson } from "../tz/version";
import { CalculationBusy } from "../sim/server-execution";

vi.mock("./service", () => ({ computeFrozenCalculation: vi.fn(), publishFrozenCalculation: vi.fn() }));
vi.mock("./store", () => ({ claimJob: vi.fn(), reapExpiredJobs: vi.fn(), completeJob: vi.fn(), failJob: vi.fn(), heartbeatJob: vi.fn(), retryBusyJob: vi.fn() }));
const db = {} as PrismaClient;
const input = { frozen: true };
const claim = { job: { id: "job" }, run: { input, inputHash: createHash("sha256").update(stableJson(input)).digest("hex") }, token: "lease" } as unknown as ClaimedJob;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(heartbeatJob).mockResolvedValue(true); vi.mocked(retryBusyJob).mockResolvedValue(true); });

it("defers local admission saturation without terminal failure or publication", async () => {
  vi.mocked(computeFrozenCalculation).mockRejectedValueOnce(new CalculationBusy());
  await executeClaim(db, claim);
  expect(retryBusyJob).toHaveBeenCalledExactlyOnceWith(db, claim);
  expect(failJob).not.toHaveBeenCalled(); expect(completeJob).not.toHaveBeenCalled();
});

it("keeps a deadline-aborted claim recoverable instead of terminally failing it", async () => {
  const controller = new AbortController();
  vi.mocked(computeFrozenCalculation).mockImplementationOnce(async () => { controller.abort(); throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
  await executeClaim(db, claim, controller.signal);
  expect(failJob).not.toHaveBeenCalled(); expect(completeJob).not.toHaveBeenCalled(); expect(retryBusyJob).not.toHaveBeenCalled();
});
