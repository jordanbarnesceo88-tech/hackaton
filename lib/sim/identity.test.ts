import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "./fixtures";
import { simInputIdentity, simSummaryMatchesInput } from "./identity";
import { runSimSync } from "./runner";
import { toStored } from "./metrics";
import { SPATIAL_MODEL_VERSION } from "./spatial-version";

describe("полная идентичность входа имитации", () => {
  const input = warehouseBaseInput(11);
  const summary = toStored(runSimSync(input));

  it("requires the physical model version for a closed workflow, rejecting single-leg receipts", () => {
    const closed = { ...input, transportWorkflow: "closed-pod-1" as const };
    const canonical = { ...summary, inputKey: simInputIdentity(closed) };
    expect(simSummaryMatchesInput(canonical, closed)).toBe(false);
    expect(simSummaryMatchesInput({ ...canonical, simModelVersion: SPATIAL_MODEL_VERSION }, closed)).toBe(true);
    expect(() => runSimSync(closed)).toThrow("Однорейсовая");
  });

  it("сохраняется в JSON и не зависит от порядка ключей", () => {
    expect(simSummaryMatchesInput(JSON.parse(JSON.stringify(summary)), input)).toBe(true);
    expect(simInputIdentity({ ...input, charge: { stopSoc: input.charge.stopSoc, startSoc: input.charge.startSoc } })).toBe(summary.inputKey);
  });

  it("снимает подтверждение при изменении физики, геометрии, окна или порогов с теми же N и потоком", () => {
    const changed = [
      { ...input, robots: { ...input.robots, autonomyH: 0.2, chargeMin: 240 } },
      { ...input, layout: { ...input.layout, activeAreaM2: 1000 } },
      { ...input, thresholds: { ...input.thresholds, p95WaitMaxMin: 1 } },
      { ...input, demand: { ...input.demand, peakMin: 30 } },
    ];
    for (const other of changed) expect(simSummaryMatchesInput(summary, other)).toBe(false);
    expect(simSummaryMatchesInput({ ...summary, inputKey: undefined }, input)).toBe(false);
  });

  it("не смешивает нечисловой отклонённый вход и отсутствие значения", () => {
    expect(simInputIdentity({ ...input, robots: { ...input.robots, autonomyH: Number.NaN } })).not.toBe(
      simInputIdentity({ ...input, robots: { ...input.robots, autonomyH: null } }),
    );
  });
});
