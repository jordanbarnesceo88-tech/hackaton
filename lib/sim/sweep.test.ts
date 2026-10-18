import { describe, expect, it } from "vitest";
import { SIM_LIMITS } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import { runSimSync } from "./runner";
import { firstTrue, minStableFleet, seedRange } from "./sweep";
import type { SimInput } from "./types";

/** Эталон для сравнения: линейный перебор снизу вверх — наименьший подтверждённый парк. */
function linearMinStableFleet(input: SimInput, min: number, max: number): number | null {
  for (let n = min; n <= max; n++) {
    if (runSimSync({ ...input, robots: { ...input.robots, count: n } }).verdict === "CONFIRMED") return n;
  }
  return null;
}

/** Фальшивые часы: каждый вызов продвигает время на `stepMs`. */
function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
  };
}

describe("перебор парка", () => {
  it("на эталонном складе увеличение парка не ухудшает вердикт", () => {
    for (const seed of [1, 2, 3]) {
      const verdicts = Array.from({ length: 16 }, (_, i) => runSimSync(warehouseBaseInput(i + 1, { seed })).verdict);
      const first = verdicts.indexOf("CONFIRMED");
      expect(first).toBeGreaterThan(0);
      expect(verdicts.slice(first).every((v) => v === "CONFIRMED")).toBe(true);
    }
  });

  it("достигнутый поток не убывает с ростом парка, пока парк не насыщает спрос", () => {
    const achieved = Array.from({ length: 8 }, (_, i) => runSimSync(warehouseBaseInput(i + 1)).achievedPerH);
    for (let i = 1; i < achieved.length; i++) expect(achieved[i]!).toBeGreaterThanOrEqual(achieved[i - 1]!);
  });

  it("minStableFleet — наименьший подтверждённый парк в диапазоне, иначе null", () => {
    const input = warehouseBaseInput(11);
    const m = minStableFleet(input, { min: 1, max: 22 });
    expect(m).not.toBeNull();
    expect(runSimSync(warehouseBaseInput(m!)).verdict).toBe("CONFIRMED");
    expect(runSimSync(warehouseBaseInput(m! - 1)).verdict).toBe("NOT_CONFIRMED");
    expect(minStableFleet(input, { min: 1, max: m! - 1 })).toBeNull();
    expect(minStableFleet(input, { min: m! + 2, max: 22 })).toBe(m! + 2);
    expect(minStableFleet(input, { min: 5, max: 4 })).toBeNull();
    expect(minStableFleet(input, { min: Number.NaN, max: 22 })).toBeNull();
  });

  it("даёт тот же парк, что независимый линейный перебор, на базовом складе (зёрна 1–5)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const input = warehouseBaseInput(11, { seed });
      const binary = minStableFleet(input, { min: 1, max: 22 });
      expect(binary).not.toBeNull();
      expect(binary).toBe(linearMinStableFleet(input, 1, 22));
    }
  });

  it("находит 3 даже когда 5 и более роботов разряжаются в очереди к одной станции", () => {
    const base = warehouseBaseInput(1);
    const input = { ...base,
      robots: { ...base.robots, autonomyH: 1, chargeMin: 15 },
      demand: { avgPerH: 20, peakPerH: 20, warmupMin: 10, peakMin: 60 },
    };
    expect(runSimSync({ ...input, robots: { ...input.robots, count: 3 } }).verdict).toBe("CONFIRMED");
    expect(runSimSync({ ...input, robots: { ...input.robots, count: 5 } }).verdict).toBe("NOT_CONFIRMED");
    expect(minStableFleet(input, { min: 1, max: 16 })).toBe(3);
  });

  it("верхняя граница не выше защитного предела SIM_LIMITS.maxRobots", () => {
    // No observed work cannot establish a minimum; the defensive cap still bounds the scan.
    const idle = warehouseBaseInput(1, { demand: { avgPerH: 0, peakPerH: 0, warmupMin: 0, peakMin: 1 } });
    expect(minStableFleet(idle, { min: 1, max: 1e9 })).toBeNull();
    expect(minStableFleet(idle, { min: SIM_LIMITS.maxRobots + 1, max: 1e9 })).toBeNull();
  });

  it("бюджет и отмена: ошибка SimBudgetExceeded с подсказкой по-русски и AbortError", () => {
    const input = warehouseBaseInput(11);
    expect(() => minStableFleet(input, { min: 1, max: 22 }, { now: fakeClock(1000), budgetMs: 1500 })).toThrow(
      expect.objectContaining({ name: "SimBudgetExceeded", message: expect.stringContaining("не уложил") }),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => minStableFleet(input, { min: 1, max: 22 }, { signal: ctrl.signal })).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
    // Щедрый бюджет не мешает: результат тот же, что без часов.
    expect(minStableFleet(input, { min: 1, max: 22 }, { now: fakeClock(1), budgetMs: 60_000 })).toBe(
      minStableFleet(input, { min: 1, max: 22 }),
    );
  });
});

describe("firstTrue", () => {
  it("проверяет все меньшие значения до первого успешного", () => {
    for (const threshold of [1, 2, 577, 1153, 1154]) {
      let calls = 0;
      const r = firstTrue(1, 1154, (n) => {
        calls++;
        return n >= threshold;
      });
      expect(r).toBe(threshold);
      expect(calls).toBe(threshold);
    }
  });

  it("нет истинных — null; пустой или нечисловой диапазон — null без вызовов", () => {
    let calls = 0;
    const never = (): boolean => {
      calls++;
      return false;
    };
    expect(firstTrue(1, 100, never)).toBeNull();
    expect(calls).toBe(100);
    calls = 0;
    expect(firstTrue(5, 4, never)).toBeNull();
    expect(firstTrue(Number.NaN, 4, never)).toBeNull();
    expect(firstTrue(1, Number.POSITIVE_INFINITY, never)).toBeNull();
    expect(calls).toBe(0);
    expect(firstTrue(7, 7, () => true)).toBe(7);
  });

  it("немонотонный предикат: результат всё равно проверенный порог — pred(r) истинно, pred(r − 1) ложно", () => {
    const truth = new Set([3, 4, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    const seen = new Map<number, boolean>();
    const pred = (n: number): boolean => {
      const v = truth.has(n);
      seen.set(n, v);
      return v;
    };
    const r = firstTrue(1, 30, pred);
    expect(r).toBe(3);
    expect(seen.get(r!)).toBe(true);
    expect(seen.get(r! - 1)).toBe(false);
  });
});

describe("seedRange", () => {
  it("диапазон по зёрнам и число подтверждений", () => {
    const r = seedRange(warehouseBaseInput(11), [1, 2, 3, 4, 5]);
    expect(r.summaries).toHaveLength(5);
    expect(r.achievedPerH.min).toBeLessThanOrEqual(r.achievedPerH.max);
    expect(r.confirmed).toBe(5);
    expect(r.summaries.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5]);
  });

  it("пустой список зёрен — нули", () => {
    const r = seedRange(warehouseBaseInput(11), []);
    expect(r).toMatchObject({ achievedPerH: { min: 0, max: 0 }, waitP95Min: { min: 0, max: 0 }, confirmed: 0 });
  });
});
