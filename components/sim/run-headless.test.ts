import { describe, expect, it } from "vitest";
import { isDone } from "@/lib/sim/engine";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { toStored } from "@/lib/sim/metrics";
import { runSimSync } from "@/lib/sim/runner";
import { isAbortError, runHeadless } from "./run-headless";

/** Часы, которые идут на 1 мс за каждый опрос: прогон детерминирован и не зависит от машины. */
function tickingClock() {
  let t = 0;
  return () => (t += 1);
}

const immediate = () => Promise.resolve();

describe("runHeadless", () => {
  it("gives the same summary as the server's runSimSync, bit for bit except wall-clock time", async () => {
    const input = warehouseBaseInput(11);
    const res = await runHeadless(input, { now: tickingClock(), yieldFn: immediate, scenarioKey: "buy" });
    const server = runSimSync(input, { scenarioKey: "buy" });
    expect({ ...toStored(res.summary), durationMs: 0 }).toEqual({ ...toStored(server), durationMs: 0 });
    expect(res.summary.buckets5min).toEqual(server.buckets5min);
    expect(res.summary.shares).toEqual(server.shares);
  });

  it("returns the final state for the last frame", async () => {
    const res = await runHeadless(warehouseBaseInput(11), { now: tickingClock(), yieldFn: immediate });
    expect(isDone(res.state)).toBe(true);
    expect(res.state.tS).toBe(res.state.endS);
    expect(res.state.robots).toHaveLength(11);
  });

  it("reports progress in slices, rising to 100 %, and only after yielding first", async () => {
    const seen: number[] = [];
    let yielded = 0;
    await runHeadless(warehouseBaseInput(11), {
      now: tickingClock(),
      sliceMs: 50,
      yieldFn: () => {
        yielded++;
        return Promise.resolve();
      },
      onProgress: (p) => {
        expect(yielded).toBeGreaterThan(0);
        seen.push(p);
      },
    });
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)).toBe(100);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it("reports 100 % for a run refused by the pre-check", async () => {
    const seen: number[] = [];
    const res = await runHeadless(warehouseBaseInput(11, { loadMassKg: 5000 }), {
      now: tickingClock(),
      yieldFn: immediate,
      onProgress: (p) => seen.push(p),
    });
    expect(res.summary.bottleneck).toBe("payload");
    expect(seen).toEqual([100]);
  });

  it("stops with AbortError when cancelled", async () => {
    const ac = new AbortController();
    const run = runHeadless(warehouseBaseInput(11), {
      now: tickingClock(),
      sliceMs: 5,
      signal: ac.signal,
      yieldFn: immediate,
      onProgress: () => ac.abort(),
    });
    await expect(run).rejects.toSatisfy(isAbortError);
  });

  it("stops with SimBudgetExceeded when the budget runs out", async () => {
    const run = runHeadless(warehouseBaseInput(11), { now: tickingClock(), sliceMs: 5, budgetMs: 20, yieldFn: immediate });
    await expect(run).rejects.toMatchObject({ name: "SimBudgetExceeded" });
  });
});
