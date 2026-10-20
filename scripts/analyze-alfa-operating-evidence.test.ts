import { describe, expect, it } from "vitest";
import { analyzeAlfaReports, analyzePuduTimeSemantics, cleaningModelFromTitle, puduOperatingEvidenceDraft } from "./analyze-alfa-operating-evidence";

const report = (area: number, duration: number, task_count: number) => ({ monthly: { summary: { area, duration, task_count }, chart: [{ task_time: "2026-09-20", area, duration, task_count }] } });
function fixture() {
  return {
    vendor: "pudu" as const, from: "2026-09-20", through: "2026-10-19", mode: 1 as const,
    family: report(600, 3, 4),
    robots: [
      { robot: { sn: "PRIVATE-SERIAL-ONE", nickname: "PRIVATE-PERSON", site: "PRIVATE-CUSTOMER" }, records: [{ mode: 0, data: report(9999, 99, 99) }, { mode: 1, data: report(600, 2, 3) }] },
      { robot: { sn: "PRIVATE-SERIAL-TWO" }, records: [{ mode: 1, data: report(0, 1, 1) }] },
    ], sourceFiles: [{ file: "synthetic.json", sha256: "a".repeat(64) }],
  };
}

describe("Alfa export aggregation", () => {
  it("builds an explicitly unconfirmed existing-format draft from paired cleaning and elapsed times", () => {
    const raw = { data: { list: [{ sn: "SYNTHETIC", mode: 1, clean_time: 600, clean_area: 100, start_time: 1792396800, end_time: 1792398000, status: 4 }] } };
    const models = { robots: [{ sn: "SYNTHETIC", title: "PUDU CC1 synthetic" }] };
    expect(analyzePuduTimeSemantics(raw)).toMatchObject({ sampledRecords: 1, shorterThanElapsed: 1, sampleCleaningSeconds: 600, sampleElapsedSeconds: 1200 });
    const draft = puduOperatingEvidenceDraft(raw, models, "Synthetic source");
    expect(draft).toMatchObject({ confirmed: false, output: 100, operatingMinutes: 10, elapsedMinutes: 20, mode: "scrubbing", basis: "operating-hour" });
    expect(draft.sourceRef).toContain("целевой тип");
    expect(JSON.stringify(draft)).not.toContain("SYNTHETIC");
    expect(() => puduOperatingEvidenceDraft(raw, { robots: [] }, "Synthetic source")).toThrow(/mapped/);
    expect(() => puduOperatingEvidenceDraft({ data: { list: [{ ...raw.data.list[0], mode: 2 }] } }, models, "Synthetic source")).toThrow(/scrubbing/);
  });
  it("uses the requested mode, keeps zero-output tasks and weights by actual recorded hours", () => {
    const aggregate = analyzeAlfaReports(fixture());
    expect(aggregate).toMatchObject({ mode: "scrubbing", basis: "reported-task-hour", tasks: 4, robotsSelected: 2, robotsWithTasks: 2, zeroOutputRobotsWithTasks: 1, reportedAreaM2: 600, recordedTaskHours: 3, m2PerRecordedTaskHour: 200, recordedRobotDays: 2 });
    expect(JSON.stringify(aggregate)).not.toMatch(/PRIVATE|sn|nickname|site|customer|sourceUrl/);
    expect(aggregate.productSlug).toBeNull();
  });

  it("does not add all-mode records to scrubbing and never infers active or shift hours", () => {
    const input = fixture(), before = structuredClone(input);
    expect(analyzeAlfaReports(input).m2PerRecordedTaskHour).toBe(200);
    expect(input).toEqual(before);
    expect(analyzeAlfaReports(input)).not.toHaveProperty("activeHours");
  });

  it("rejects summary/day and family/robot disagreement instead of silently normalizing it", () => {
    const dailyMismatch = fixture(); dailyMismatch.family.monthly.chart[0]!.area = 599;
    expect(() => analyzeAlfaReports(dailyMismatch)).toThrow(/daily/);
    const robotMismatch = fixture(); robotMismatch.family = report(601, 3, 4);
    expect(() => analyzeAlfaReports(robotMismatch)).toThrow(/robot/);
  });

  it("rejects invalid numeric units, duplicated modes and provenance paths", () => {
    const badTime = fixture(); badTime.family.monthly.summary.duration = -1;
    expect(() => analyzeAlfaReports(badTime)).toThrow();
    const duplicate = fixture(); duplicate.robots[0]!.records.push(duplicate.robots[0]!.records[1]!);
    expect(() => analyzeAlfaReports(duplicate)).toThrow(/duplicate/);
    const badSource = fixture(); badSource.sourceFiles[0]!.file = "../private.json";
    expect(() => analyzeAlfaReports(badSource)).toThrow(/provenance/);
    expect(() => analyzeAlfaReports({ ...fixture(), vendor: "viggo" })).toThrow(/mode/);
    const duplicateRobot = fixture(); duplicateRobot.robots[1]!.robot.sn = duplicateRobot.robots[0]!.robot.sn;
    expect(() => analyzeAlfaReports(duplicateRobot)).toThrow(/identity/);
    const outsideDay = fixture(); outsideDay.robots[0]!.records[1]!.data.monthly.chart[0]!.task_time = "2026-10-20";
    expect(() => analyzeAlfaReports(outsideDay)).toThrow(/period/);
  });

  it.each([
    ["Робот PUDU CC1 test", "pudu-cc1"], ["Робот AGIBOT C5 test", "agibot-c5"], ["Робот Viggo SC80 test", "viggo-sc80"],
    ["Viggo SC50", null], ["Viggo SC80Pro", null], ["Viggo SC80 Pro", null], ["АК-SC80", null], ["Viggo АК-SC80", null], ["PUDU MT1", null], ["PUDU CC1 Pro", null], ["C5 test", null],
  ])("only maps explicit supported title %s", (title, expected) => expect(cleaningModelFromTitle(title)).toBe(expected));
});
