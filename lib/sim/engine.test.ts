import { describe, expect, it } from "vitest";
import { cycleThroughputPerH, expectedLegsM } from "./analytic";
import { SIM_LIMITS, chargeThresholdsValid, createSim, isDone, requestedFleet, stepSim } from "./engine";
import { H1500_ROBOT, warehouseBaseInput } from "./fixtures";
import { buildWarehouseLayout } from "./layout";
import { summarize } from "./metrics";
import { runSimSync } from "./runner";
import { queueLength, type SimEngineState } from "./state";
import type { SimInput } from "./types";

/** Прогон до конца с проверкой инварианта на каждом шаге. */
function runChecked(input: SimInput, check: (s: SimEngineState) => void): SimEngineState {
  const s = createSim(input);
  while (!isDone(s)) {
    stepSim(s);
    check(s);
  }
  return s;
}

describe("детерминизм", () => {
  it("два прогона одного входа совпадают целиком — и сводка, и конечное состояние", () => {
    const input = warehouseBaseInput(9);
    const a = createSim(input);
    const b = createSim(input);
    while (!isDone(a)) stepSim(a);
    while (!isDone(b)) stepSim(b);
    expect(b).toEqual(a);
    expect(summarize(b)).toEqual(summarize(a));
    expect(runSimSync(input)).toEqual(runSimSync(input));
  });

  it("другое зерно даёт другой поток заданий", () => {
    const a = runSimSync(warehouseBaseInput(9));
    const b = runSimSync(warehouseBaseInput(9, { seed: 2 }));
    expect(b.arrivedPeak === a.arrivedPeak && b.achievedPerH === a.achievedPerH).toBe(false);
  });
});

describe("сохранение заданий", () => {
  it("на каждом шаге: поступило = завершено + в очереди + в работе", () => {
    let violations = 0;
    let steps = 0;
    const s = runChecked(warehouseBaseInput(7), (st) => {
      steps++;
      const inProgress = st.robots.filter((r) => r.task !== null).length;
      if (st.tasks.length !== st.doneCount + queueLength(st) + inProgress) violations++;
    });
    expect(steps).toBe(s.endS);
    expect(violations).toBe(0);
    expect(s.tasks.length).toBeGreaterThan(200);
  });

  it("точка обслуживает не больше одного робота, держатель стоит у неё", () => {
    const docks = { ...warehouseBaseInput(1).layout, receivingDocksCount: 1, shippingDocksCount: 1 };
    let violations = 0;
    let held = 0;
    runChecked(warehouseBaseInput(12, { layout: docks }), (s) => {
      for (const [idx, p] of s.points.entries()) {
        if (p.holder === null) continue;
        held++;
        const working = s.robots.filter(
          (r) => r.pointIdx === idx && (r.phase === "loading" || r.phase === "unloading" || r.phase === "charging"),
        );
        const h = s.robots[p.holder]!;
        if (working.length > 1 || Math.abs(h.x - p.x) > 1e-9 || Math.abs(h.y - p.y) > 1e-9) violations++;
      }
    });
    expect(held).toBeGreaterThan(0);
    expect(violations).toBe(0);
  });
});

describe("разложение времени", () => {
  it("доли в сумме дают 100 % (±0,01)", () => {
    for (const fleet of [3, 9, 14]) {
      const s = runSimSync(warehouseBaseInput(fleet));
      const sum =
        s.shares.loadedPct +
        s.shares.emptyPct +
        s.shares.handlingPct +
        s.shares.waitAtPointsPct +
        s.shares.chargingPct +
        s.shares.idlePct;
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.01);
      expect(s.fleetUtilPct).toBeCloseTo(s.shares.loadedPct + s.shares.emptyPct + s.shares.handlingPct, 9);
    }
  });

  it("нулевой спрос — простой 100 %, ничего не поступило, вердикт подтверждён (парк избыточен)", () => {
    const s = runSimSync(
      warehouseBaseInput(5, {
        robots: { ...H1500_ROBOT, count: 5, autonomyH: null, chargeMin: null },
        demand: { avgPerH: 0, peakPerH: 0, warmupMin: 15, peakMin: 120 },
      }),
    );
    expect(s.shares.idlePct).toBe(100);
    expect(s.arrivedPeak).toBe(0);
    expect(s.achievedPerH).toBe(0);
    expect(s.verdict).toBe("CONFIRMED");
    expect(s.oversized).toBe(true);
  });
});

describe("согласие с аналитикой (ТЗ §3.6.2)", () => {
  it("один робот, автономность 1000 ч, насыщенный спрос 20 ч: достигнутое в пределах ±5 % от cycleThroughputPerH", () => {
    const input = warehouseBaseInput(1, {
      robots: { ...H1500_ROBOT, count: 1, autonomyH: 1000 },
      demand: { avgPerH: 60, peakPerH: 60, warmupMin: 15, peakMin: 20 * 60 },
    });
    const legs = expectedLegsM(buildWarehouseLayout(input.layout));
    const thr = cycleThroughputPerH({
      ...legs,
      speedMps: input.robots.speedMps,
      loadedSpeedFactor: input.robots.loadedSpeedFactor,
      handlingSec: input.robots.handlingSec,
    })!;
    const s = runSimSync(input);
    expect(s.chargingPct).toBe(0);
    expect(s.shares.idlePct).toBe(0);
    expect(Math.abs(s.achievedPerH / thr - 1)).toBeLessThanOrEqual(0.05);
  });
});

describe("зарядка", () => {
  it("короткая автономность: зарядка > 0, заряд никогда не уходит ниже нуля и не выше 1", () => {
    const input = warehouseBaseInput(4, {
      robots: { ...H1500_ROBOT, count: 4, autonomyH: 0.5, chargeMin: 10 },
      layout: { ...warehouseBaseInput(1).layout, chargers: 2 },
    });
    let sawCharging = false;
    let outOfRange = 0;
    const s = runChecked(input, (st) => {
      for (const r of st.robots) {
        if (!(r.soc >= 0 && r.soc <= 1)) outOfRange++;
        if (r.phase === "charging") sawCharging = true;
      }
    });
    expect(outOfRange).toBe(0);
    expect(sawCharging).toBe(true);
    expect(summarize(s).chargingPct).toBeGreaterThan(0);
  });

  it("без автономности или времени зарядки зарядка не моделируется: заряд 1, доля зарядки 0", () => {
    const s = createSim(warehouseBaseInput(3, { robots: { ...H1500_ROBOT, count: 3, chargeMin: null } }));
    while (!isDone(s)) stepSim(s);
    expect(s.chargeModelled).toBe(false);
    expect(s.robots.every((r) => r.soc === 1)).toBe(true);
    expect(summarize(s).chargingPct).toBe(0);
  });

  it("одна станция на 20 роботов с короткой автономностью — узкое место «зарядка»", () => {
    const s = runSimSync(
      warehouseBaseInput(20, {
        robots: { ...H1500_ROBOT, count: 20, autonomyH: 1, chargeMin: 30 },
        layout: { ...warehouseBaseInput(1).layout, chargers: 1 },
        demand: { avgPerH: 200, peakPerH: 300, warmupMin: 15, peakMin: 120 },
      }),
    );
    expect(s.verdict).toBe("NOT_CONFIRMED");
    expect(s.bottleneck).toBe("charging");
    expect(s.chargerWaitPct).toBeGreaterThanOrEqual(5);
  });

  it("пороги зарядки вне 0 ≤ ухода < возврата ≤ 1 — NOT_SUPPORTED без прогона (заряд не может уйти за 1)", () => {
    expect(chargeThresholdsValid({ startSoc: 0.2, stopSoc: 0.9 })).toBe(true);
    expect(chargeThresholdsValid({ startSoc: 0, stopSoc: 1 })).toBe(true);
    for (const charge of [
      { startSoc: 0.2, stopSoc: 1.5 },
      { startSoc: 20, stopSoc: 90 },
      { startSoc: 0.9, stopSoc: 0.2 },
      { startSoc: 0.5, stopSoc: 0.5 },
      { startSoc: -0.1, stopSoc: 0.9 },
      { startSoc: Number.NaN, stopSoc: 0.9 },
      { startSoc: 0.2, stopSoc: Number.POSITIVE_INFINITY },
    ]) {
      expect(chargeThresholdsValid(charge)).toBe(false);
      const s = createSim(warehouseBaseInput(5, { charge }));
      expect(s.precheck).toBe("invalid");
      expect(isDone(s)).toBe(true);
      expect(summarize(s)).toMatchObject({ verdict: "NOT_SUPPORTED", fleet: 5 });
    }
  });

  it("без моделирования зарядки пороги не используются и прогон не отклоняют", () => {
    const s = createSim(
      warehouseBaseInput(3, { robots: { ...H1500_ROBOT, count: 3, autonomyH: null }, charge: { startSoc: 0.2, stopSoc: 1.5 } }),
    );
    expect(s.precheck).toBe("ok");
  });
});

describe("точки операций", () => {
  it("одни ворота приёмки и одни отгрузки при высоком спросе — узкое место «точки»", () => {
    const s = runSimSync(
      warehouseBaseInput(30, {
        robots: { ...H1500_ROBOT, count: 30, autonomyH: null, chargeMin: null },
        layout: { ...warehouseBaseInput(1).layout, receivingDocksCount: 1, shippingDocksCount: 1 },
        demand: { avgPerH: 300, peakPerH: 500, warmupMin: 15, peakMin: 120 },
      }),
    );
    expect(s.verdict).toBe("NOT_CONFIRMED");
    expect(s.bottleneck).toBe("points");
    const docks = s.pointUtilization.filter((p) => p.kind !== "charger");
    expect(Math.max(...docks.map((p) => p.utilPct))).toBeGreaterThanOrEqual(90);
    expect(s.waitAtPointsPct).toBeGreaterThanOrEqual(5);
  });
});

describe("предварительные проверки", () => {
  it("грузоподъёмность меньше массы паллеты — прогон не выполняется, «не подтверждён: грузоподъёмность»", () => {
    const input = warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, payloadKg: 600 } });
    const s = createSim(input);
    expect(s.precheck).toBe("payload");
    expect(isDone(s)).toBe(true);
    stepSim(s);
    expect(s.tS).toBe(0);
    const sum = summarize(s);
    expect(sum.verdict).toBe("NOT_CONFIRMED");
    expect(sum.bottleneck).toBe("payload");
    expect(sum.achievedPerH).toBe(0);
  });

  it("масса не задана или грузоподъёмность не опубликована — проверка не выполняется", () => {
    expect(createSim(warehouseBaseInput(5, { loadMassKg: null })).precheck).toBe("ok");
    expect(createSim(warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, payloadKg: null } })).precheck).toBe("ok");
  });

  it("нет роботов, скорость не положительна или вход за защитными пределами — NOT_SUPPORTED без прогона", () => {
    for (const input of [
      warehouseBaseInput(0),
      warehouseBaseInput(3, { robots: { ...H1500_ROBOT, count: 3, speedMps: 0 } }),
      warehouseBaseInput(3, { demand: { avgPerH: Number.NaN, peakPerH: 10, warmupMin: 15, peakMin: 120 } }),
      warehouseBaseInput(SIM_LIMITS.maxRobots + 1),
      warehouseBaseInput(3, { demand: { avgPerH: 10, peakPerH: 10, warmupMin: 15, peakMin: 0 } }),
      warehouseBaseInput(3, { demand: { avgPerH: 10, peakPerH: 1e7, warmupMin: 15, peakMin: 120 } }),
    ]) {
      const s = runSimSync(input);
      expect(s.verdict).toBe("NOT_SUPPORTED");
      expect(s.bottleneck).toBe("none");
    }
  });

  it("сводка без прогона показывает запрошенный парк, а не 0 роботов", () => {
    expect(runSimSync(warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, speedMps: 0 } })).fleet).toBe(5);
    expect(runSimSync(warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, payloadKg: 100 } })).fleet).toBe(5);
    expect(runSimSync(warehouseBaseInput(SIM_LIMITS.maxRobots + 1)).fleet).toBe(SIM_LIMITS.maxRobots + 1);
    expect(runSimSync(warehouseBaseInput(0)).fleet).toBe(0);
    expect(runSimSync(warehouseBaseInput(Number.NaN)).fleet).toBe(0);
    expect(requestedFleet(warehouseBaseInput(7.9))).toBe(7);
    expect(requestedFleet(warehouseBaseInput(-3))).toBe(0);
  });
});

describe("шаг и окно", () => {
  it("после конца прогона шаг ничего не меняет", () => {
    const s = createSim(warehouseBaseInput(3, { demand: { avgPerH: 50, peakPerH: 80, warmupMin: 1, peakMin: 30 } }));
    while (!isDone(s)) stepSim(s);
    const snapshot = structuredClone(s);
    stepSim(s);
    stepSim(s);
    expect(s).toEqual(snapshot);
    expect(s.tS).toBe(s.endS);
  });

  it("окно: прогрев 15 мин и пик 120 мин по нормативам; корзины по 5 минут", () => {
    const s = createSim(warehouseBaseInput(9));
    expect(s.warmupS).toBe(900);
    expect(s.endS).toBe(900 + 7200);
    while (!isDone(s)) stepSim(s);
    const sum = summarize(s);
    expect(sum.peakWindowMin).toBe(120);
    expect(sum.buckets5min).toHaveLength(24);
    expect(sum.buckets5min[0]!.t).toBe(0);
    expect(sum.buckets5min.at(-1)!.t).toBe(115);
    const arrivedFromBuckets = sum.buckets5min.reduce((a, b) => a + b.required / 12, 0);
    expect(arrivedFromBuckets).toBeCloseTo(sum.arrivedPeak, 9);
    expect(sum.arrivedPerH).toBeCloseTo(sum.arrivedPeak / 2, 9);
    const doneFromBuckets = sum.buckets5min.reduce((a, b) => a + b.achieved / 12, 0);
    expect(doneFromBuckets).toBeCloseTo(sum.donePeak, 9);
    expect(sum.achievedPerH).toBeCloseTo(sum.donePeak / 2, 9);
  });

  it("сводка посреди прогона считается по пройденной части окна", () => {
    const s = createSim(warehouseBaseInput(9));
    for (let i = 0; i < 900 + 1800; i++) stepSim(s);
    const mid = summarize(s);
    expect(mid.peakWindowMin).toBe(30);
    expect(mid.buckets5min).toHaveLength(6);
    expect(Number.isFinite(mid.achievedPerH)).toBe(true);
    const early = summarize(createSim(warehouseBaseInput(9)));
    expect(early.peakWindowMin).toBe(0);
    expect(early.achievedPerH).toBe(0);
  });
});
