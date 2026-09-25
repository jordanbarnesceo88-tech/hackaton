import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { toStored } from "@/lib/sim/metrics";
import { runSimSync } from "@/lib/sim/runner";
import type { SimSummaryStored } from "@/lib/sim/types";
import {
  bottleneckText,
  canvasAriaLabel,
  kpiLines,
  queueText,
  sparklinePoints,
  statusText,
  storedCheck,
  throughputText,
  utilText,
  verdictBadge,
  withFinalVerdict,
} from "./kpi-text";

/** Пробелы ICU (неразрывные) → обычные, чтобы сравнивать строки буквально. */
const plain = (s: string) => s.replace(/\s/g, " ");

const demo = runSimSync(warehouseBaseInput(11));
const byNorm = runSimSync(warehouseBaseInput(3));

describe("KPI texts on the demo warehouse (H1500 × 11, seed 1)", () => {
  it("prints required and achieved peak flow with one decimal", () => {
    expect(plain(throughputText(demo))).toMatch(/^Рассчитано: 129,5 пал\.\/ч в пик · Достигнуто: \d+,\d пал\.\/ч$/);
  });

  it("compares the simulated fleet utilisation with the assumed one", () => {
    expect(plain(utilText({ ...demo, fleetUtilPct: 62.84, assumedUtilPct: 77.5 }))).toBe(
      "Загрузка парка: 62,8 % (в расчёте 77,5 %)",
    );
  });

  it("prints the queue and p95 wait", () => {
    expect(plain(queueText({ ...demo, queueMax: 4, waitP95Min: 0.77 }))).toBe(
      "Очередь заданий: макс. 4, ожидание p95 0,8 мин",
    );
  });

  it("lists the seven lines in screen order", () => {
    const lines = kpiLines(demo).map(plain);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatch(/^Рассчитано:/);
    expect(lines.slice(1).map((l) => l.split(":")[0])).toEqual([
      "Загрузка парка",
      "Простой",
      "Зарядка",
      "Ожидание у точек",
      "Очередь заданий",
      "Узкое место",
    ]);
  });
});

describe("verdictBadge", () => {
  it("confirms the demo fleet", () => {
    expect(demo.verdict).toBe("CONFIRMED");
    const b = verdictBadge({ ...demo, oversized: false });
    expect(b).toEqual({ tone: "confirmed", text: "Расчёт подтверждён имитацией" });
  });

  it("names the bottleneck and the minimal fleet when the norm-sized fleet fails", () => {
    expect(byNorm.verdict).toBe("NOT_CONFIRMED");
    const b = verdictBadge({ ...byNorm, minStableFleet: 9 });
    expect(b.tone).toBe("not-confirmed");
    expect(b.text).toBe("Не подтверждён: парк роботов — минимальный парк по имитации 9");
    expect(verdictBadge({ ...byNorm, minStableFleet: null }).text).toBe("Не подтверждён: парк роботов");
  });

  it("flags an oversized fleet with the smaller stable one", () => {
    const b = verdictBadge({ ...demo, oversized: true, fleet: 11, minStableFleet: 9 });
    expect(b).toEqual({ tone: "oversized", text: "Расчёт подтверждён имитацией · парк избыточен: минимальный по имитации 9" });
  });

  it("does not suggest more robots when the robot cannot lift the load", () => {
    const payload = runSimSync(warehouseBaseInput(11, { loadMassKg: 2000 }));
    expect(payload.bottleneck).toBe("payload");
    const b = verdictBadge({ ...payload, minStableFleet: 9 });
    expect(b.text).toBe("Не подтверждён: грузоподъёмность — робот не поднимает груз объекта");
    // Прогона не было: показатели — «прогон не выполнялся», а не «0 %».
    expect(plain(utilText(payload))).toBe("Загрузка парка: прогон не выполнялся (в расчёте 77,5 %)");
  });

  it("says plainly when the input is outside the model", () => {
    const invalid = runSimSync(warehouseBaseInput(0));
    expect(verdictBadge(invalid)).toEqual({ tone: "not-supported", text: "Имитация для этого класса не поддерживается" });
  });
});

describe("withFinalVerdict", () => {
  it("keeps the partial-window KPIs but takes verdict, bottleneck and oversized from the full run", () => {
    const partial = { ...demo, verdict: "NOT_CONFIRMED" as const, bottleneck: "fleet" as const, oversized: true, achievedPerH: 122.3 };
    const out = withFinalVerdict(partial, { ...demo, oversized: false });
    expect(out.achievedPerH).toBe(122.3);
    expect(out.verdict).toBe("CONFIRMED");
    expect(bottleneckText(out)).toBe("Узкое место: нет");
    expect(out.oversized).toBe(false);
  });
});

describe("canvasAriaLabel", () => {
  it("describes the scene and the verdict, not the frame", () => {
    const label = plain(canvasAriaLabel({ ...demo, oversized: false }, 11));
    expect(label).toContain("11 роботов");
    expect(label).toContain("Расчёт подтверждён имитацией.");
    expect(label).toContain("Показатели приведены рядом текстом.");
  });

  it("says the run is in progress before there is a summary", () => {
    expect(canvasAriaLabel(null, 2)).toMatch(/2 робота\. Имитация выполняется\.$/);
  });
});

describe("statusText", () => {
  it("reports progress, then duration, seed and model version", () => {
    expect(plain(statusText({ kind: "running", pct: 42.4 }))).toBe("Имитация: выполняется… 42 %");
    expect(plain(statusText({ kind: "done", durationMs: 17.2, seed: 1, modelVersion: "sim-1.0.0" }))).toBe(
      "Имитация завершена за 17 мс · seed 1 · модель sim-1.0.0",
    );
    expect(statusText({ kind: "error", message: "бюджет" })).toBe("Имитация остановлена: бюджет");
  });
});

describe("storedCheck", () => {
  const stored: SimSummaryStored = { ...toStored(demo), durationMs: 999 };

  it("matches the stored result of the same fleet and seed (wall-clock time is ignored)", () => {
    expect(storedCheck(stored, { ...demo, durationMs: 3 })).toEqual({
      match: true,
      text: "Совпадает с результатом, сохранённым в проекте.",
    });
  });

  it("reports a difference and asks to recalculate", () => {
    const r = storedCheck({ ...stored, achievedPerH: stored.achievedPerH + 1 }, demo);
    expect(r?.match).toBe(false);
    expect(r?.text).toContain("Пересчитайте проект");
  });

  it("has nothing to compare for another fleet, seed or peak flow, or no stored result", () => {
    expect(storedCheck(null, demo)).toBeNull();
    expect(storedCheck({ ...stored, fleet: 9 }, demo)).toBeNull();
    expect(storedCheck({ ...stored, seed: 2 }, demo)).toBeNull();
    // Параметры изменены после сохранения: сверять прогон с другим потоком бессмысленно.
    expect(storedCheck({ ...stored, requiredPerH: stored.requiredPerH * 1.2 }, demo)).toBeNull();
  });

  it("reports another model version on the same input as a difference", () => {
    expect(storedCheck({ ...stored, simModelVersion: "sim-0.9.0" }, demo)?.match).toBe(false);
  });
});

describe("sparklinePoints", () => {
  it("scales both series into the box with 10 % headroom", () => {
    const p = sparklinePoints(
      [
        { t: 0, required: 100, achieved: 50 },
        { t: 5, required: 200, achieved: 150 },
      ],
      100,
      44,
    );
    expect(p.max).toBe(200);
    expect(p.required).toBe("0.0,24.0 100.0,4.0");
    expect(p.achieved).toBe("0.0,34.0 100.0,14.0");
  });

  it("stretches a single bucket across the width and returns nothing for an empty series", () => {
    expect(sparklinePoints([{ t: 0, required: 10, achieved: 10 }], 100, 20).achieved.split(" ")).toHaveLength(2);
    expect(sparklinePoints([], 100, 20)).toEqual({ required: "", achieved: "", max: 0 });
  });

  it("has one point per five-minute bucket of the demo peak window", () => {
    expect(demo.buckets5min).toHaveLength(24);
    expect(sparklinePoints(demo.buckets5min, 240, 48).achieved.split(" ")).toHaveLength(24);
  });
});
