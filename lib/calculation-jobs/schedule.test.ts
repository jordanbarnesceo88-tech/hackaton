import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
const mocks = vi.hoisted(() => ({ after: vi.fn(), dispatch: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./serverless", () => ({ dispatchOwnedCalculation: mocks.dispatch }));
import { scheduleOwnedCalculations } from "./schedule";
const db = {} as PrismaClient;
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("leaves dedicated deployments and terminal jobs untouched", () => {
  vi.stubEnv("VERCEL", undefined);
  scheduleOwnedCalculations(db, "owner", [{ id: "j1", status: "QUEUED" }]);
  expect(mocks.after).not.toHaveBeenCalled();
  vi.stubEnv("VERCEL", "1");
  scheduleOwnedCalculations(db, "owner", [{ id: "j2", status: "SUCCEEDED" }, { id: "j3", status: "CANCELLED" }]);
  expect(mocks.after).not.toHaveBeenCalled();
});

it("registers pending work after the response and preserves the owner and job identity", async () => {
  vi.stubEnv("VERCEL", "1");
  scheduleOwnedCalculations(db, "owner", [{ id: "j1", status: "QUEUED" }, { id: "j2", status: "RUNNING" }, { id: "j3", status: "FAILED" }]);
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledTimes(1);
  await mocks.after.mock.calls[0]![0]();
  expect(mocks.dispatch.mock.calls).toEqual([[db, "owner", "j1"], [db, "owner", "j2"]]);
});

it("keeps execution failures out of the response and logs no private inputs", async () => {
  vi.stubEnv("VERCEL", "1");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.dispatch.mockRejectedValue(new Error("private DSN/input"));
  scheduleOwnedCalculations(db, "owner", [{ id: "j1", status: "QUEUED" }]);
  await expect(mocks.after.mock.calls[0]![0]()).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith("calculation_serverless_dispatch_unavailable");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});

it("keeps the invocation alive for a second job when its sibling dispatch fails", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  let release!: () => void;
  const running = new Promise<void>(resolve => { release = resolve; });
  mocks.dispatch.mockRejectedValueOnce(new Error("unavailable")).mockReturnValueOnce(running);
  scheduleOwnedCalculations(db, "owner", [{ id: "j1", status: "QUEUED" }, { id: "j2", status: "QUEUED" }]);
  let finished = false;
  const invocation = mocks.after.mock.calls[0]![0]().then(() => { finished = true; });
  await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(2));
  expect(finished).toBe(false);
  release();
  await invocation;
  expect(finished).toBe(true);
});
