import { describe, expect, it } from "vitest";
import { cleaningOperatingReadiness, cleaningWorkingProfile } from "../data/cleaning-assumptions";

describe("received Alfa operating reports", () => {
  it("maps CC1 registry records and retains measured scrubbing totals separately from assumptions", () => {
    const result = cleaningOperatingReadiness("pudu-cc1");
    const latest = result.observations.find(row => row.from === "2026-09-20" && row.mode === "scrubbing")!;
    expect(latest).toMatchObject({ robotsSelected: 13, robotsWithTasks: 11, tasks: 5128, basis: "reported-task-hour" });
    expect(latest.m2PerRecordedTaskHour).toBeCloseTo(492.36274015765, 8);
    expect(latest.sourceFiles).toHaveLength(4);
    expect(latest.timeBasisCheck).toMatchObject({ sampledRecords: 20, shorterThanElapsed: 20, sampleCleaningSeconds: 14330, sampleElapsedSeconds: 19266 });
    expect(result.blockers.some(row => row.code === "EXACT_MODEL_UNRESOLVED")).toBe(false);
    expect(result.blockers.some(row => row.code === "TASK_TIME_NOT_ACTIVE_OR_SHIFT")).toBe(true);
    expect(result.applicable).toBe(false);
    expect(cleaningWorkingProfile("pudu-cc1")?.throughputM2PerH).toBe(550);
  });

  it("does not give SC80 the whole Viggo fleet, and does not delete a zero-output C5", () => {
    const sc80 = cleaningOperatingReadiness("viggo-sc80").observations.find(row => row.from === "2026-09-20")!;
    expect(sc80).toMatchObject({ robotsSelected: 1, tasks: 18, reportedAreaM2: 25296.530000000002 });
    expect(sc80.m2PerRecordedTaskHour).toBeCloseTo(1334.9092348285, 8);
    const c5 = cleaningOperatingReadiness("agibot-c5").observations.find(row => row.from === "2026-09-20")!;
    expect(c5).toMatchObject({ robotsSelected: 14, zeroOutputRobotsWithTasks: 1, tasks: 2578 });
    expect(c5.m2PerRecordedTaskHour).toBeCloseTo(541.16658679275, 8);
    expect(c5.sourceFiles).toHaveLength(4);
  });

  it("keeps overlapping windows separate rather than manufacturing independent extra samples", () => {
    const windows = cleaningOperatingReadiness("agibot-c5").observations.map(row => [row.from, row.through]);
    expect(windows).toEqual([["2026-08-01", "2026-08-31"], ["2026-09-01", "2026-09-30"], ["2026-09-20", "2026-10-19"]]);
    expect(cleaningOperatingReadiness("unrelated-product")).toMatchObject({ observations: [], applicable: false, blockers: [] });
  });
});
