import { describe, expect, it, vi } from "vitest";
import { drainOwnReceipt, serialTestCommands } from "./test-support/durable-driver";

describe("durable project test driver", () => {
  it("keeps polling its QUEUED receipt after a null claim instead of treating the whole queue as drained", async () => {
    let status = "QUEUED";
    const claim = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("own");
    const recover = vi.fn(), wait = vi.fn(), empty = vi.fn();
    const result = await drainOwnReceipt({
      inspect: async () => ({ status, value: "stored result" }), recover, claim,
      execute: async () => { status = "SUCCEEDED"; }, diagnostics: async () => ({ own: status, older: "ENGINE_VERSION_UNAVAILABLE" }),
      onEmptyClaim: empty, wait,
    });
    expect(result).toBe("stored result");
    expect(claim).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(empty).toHaveBeenCalledWith({ own: "QUEUED", older: "ENGINE_VERSION_UNAVAILABLE" });
  });

  it("waits through active lease/backoff and stops only at its own completion, not another job's", async () => {
    let time = 0, status = "RUNNING";
    const claim = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("foreign").mockResolvedValueOnce("own");
    const executed: string[] = [];
    await drainOwnReceipt<string, string>({ inspect: async () => ({ status, value: "own" }), recover: async () => undefined, claim,
      execute: async c => { executed.push(c); if (c === "own") status = "SUCCEEDED"; },
      diagnostics: async () => ({ leaseUntil: 2 }), wait: async () => { time++; }, now: () => time, timeoutMs: 10 });
    expect(executed).toEqual(["foreign", "own"]);
  });

  it("reports its terminal engine diagnostic and owner/job identity without returning an empty result", async () => {
    await expect(drainOwnReceipt({ inspect: async () => ({ status: "FAILED", diagnosticCode: "ENGINE_VERSION_UNAVAILABLE", value: null }),
      recover: vi.fn(), claim: vi.fn(), execute: vi.fn(), diagnostics: async () => ({ jobId: "own", ownerId: "user", status: "FAILED" }),
    })).rejects.toThrow(/FAILED: ENGINE_VERSION_UNAVAILABLE; durable state=.*"jobId":"own".*"ownerId":"user"/);
  });

  it("bounds repeated null claims and preserves the actual queue diagnostics", async () => {
    let time = 0;
    await expect(drainOwnReceipt({ inspect: async () => ({ status: "QUEUED", value: null }), recover: vi.fn(), claim: async () => null,
      execute: vi.fn(), diagnostics: async () => ({ active: 2, nextAttemptAt: 50 }),
      now: () => time, timeoutMs: 2, wait: async () => { time++; },
    })).rejects.toThrow(/Timed out.*"active":2.*"nextAttemptAt":50/);
  });

  it("does not let one failed command reject all subsequent serial commands", async () => {
    const serial = serialTestCommands(), events: string[] = [];
    const failed = serial(async () => { events.push("failed"); throw new Error("actual compute failure"); });
    const next = serial(async () => { events.push("next"); return "result"; });
    await expect(failed).rejects.toThrow("actual compute failure");
    await expect(next).resolves.toBe("result");
    expect(events).toEqual(["failed", "next"]);
  });
});
