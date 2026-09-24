import { describe, expect, it } from "vitest";
import { H1500_ROBOT, warehouseBaseInput } from "./fixtures";
import { runSim, runSimSync } from "./runner";

/** Фальшивые часы: каждый вызов продвигает время на `stepMs`. */
function fakeClock(stepMs: number): () => number {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
  };
}

describe("runSim", () => {
  it("по частям даёт ту же сводку, что runSimSync (кроме длительности)", async () => {
    const input = warehouseBaseInput(9);
    const sliced = await runSim(input, { now: fakeClock(1), sliceMs: 5 });
    const sync = runSimSync(input);
    expect({ ...sliced, durationMs: 0 }).toEqual(sync);
    expect(sliced.durationMs).toBeGreaterThan(0);
  });

  it("прогресс растёт и заканчивается на 100 %", async () => {
    const progress: number[] = [];
    await runSim(warehouseBaseInput(9), { now: fakeClock(1), sliceMs: 5, onProgress: (p) => progress.push(p) });
    expect(progress.length).toBeGreaterThan(3);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    expect(progress.at(-1)).toBe(100);
  });

  it("прогон, отклонённый проверкой грузоподъёмности, сразу сообщает 100 %", async () => {
    const progress: number[] = [];
    const s = await runSim(warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, payloadKg: 100 } }), {
      now: fakeClock(1),
      onProgress: (p) => progress.push(p),
    });
    expect(progress).toEqual([100]);
    expect(s.bottleneck).toBe("payload");
  });

  it("отмена: уже отменённый сигнал и отмена посреди прогона — ошибка AbortError", async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(runSim(warehouseBaseInput(9), { now: fakeClock(1), signal: pre.signal })).rejects.toMatchObject({
      name: "AbortError",
    });

    const mid = new AbortController();
    await expect(
      runSim(warehouseBaseInput(9), {
        now: fakeClock(1),
        sliceMs: 5,
        signal: mid.signal,
        onProgress: (p) => {
          if (p > 30) mid.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("бюджет времени: при превышении — ошибка SimBudgetExceeded с подсказкой по-русски", async () => {
    await expect(
      runSim(warehouseBaseInput(9), { now: fakeClock(1000), budgetMs: 5000, sliceMs: 10 }),
    ).rejects.toMatchObject({ name: "SimBudgetExceeded", message: expect.stringContaining("не уложилась") });
  });

  it("уступает управление между частями через yieldFn", async () => {
    let yields = 0;
    await runSim(warehouseBaseInput(9), {
      now: fakeClock(1),
      sliceMs: 5,
      yieldFn: () => {
        yields++;
        return Promise.resolve();
      },
    });
    expect(yields).toBeGreaterThan(3);
  });
});

describe("производительность (ТЗ §4.3.3: запуск модели ≤ 60 с)", () => {
  it("60 роботов × 3 ч модельного времени — меньше 1 с", () => {
    const input = warehouseBaseInput(60, {
      layout: { ...warehouseBaseInput(1).layout, chargers: 6 },
      demand: { avgPerH: 800, peakPerH: 1000, warmupMin: 0, peakMin: 180 },
    });
    // Часы разрешены в тестах: правило no-restricted-globals защищает только код движка.
    // eslint-disable-next-line no-restricted-globals
    const t0 = performance.now();
    const s = runSimSync(input);
    // eslint-disable-next-line no-restricted-globals
    const ms = performance.now() - t0;
    expect(s.fleet).toBe(60);
    expect(s.peakWindowMin).toBe(180);
    expect(ms).toBeLessThan(1000);
  });
});
