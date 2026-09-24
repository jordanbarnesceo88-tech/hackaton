import { describe, expect, it } from "vitest";
import { H1500_ROBOT, warehouseBaseInput } from "./fixtures";
import {
  detectBottleneck,
  endQueueLimit,
  percentile95,
  simWasRun,
  toStored,
  verdict,
  type BottleneckInputs,
} from "./metrics";
import { runSimSync } from "./runner";

const TH = { servedShareMin: 0.97, p95WaitMaxMin: 10, oversizedIdleShare: 0.4 };
const OK = { servedShare: 1, queueEnd: 0, waitP95Min: 1, requiredPerH: 129.55, idlePct: 20, socFloorHit: false };

describe("endQueueLimit", () => {
  it("max(3; 5 % часового пикового потока)", () => {
    expect(endQueueLimit(129.55)).toBeCloseTo(6.4775, 10);
    expect(endQueueLimit(40)).toBe(3);
    expect(endQueueLimit(0)).toBe(3);
    expect(endQueueLimit(Number.NaN)).toBe(3);
  });
});

describe("verdict", () => {
  it("подтверждён при выполнении всех порогов, включая равенство на границе", () => {
    expect(verdict(OK, TH)).toEqual({ verdict: "CONFIRMED", oversized: false });
    expect(verdict({ ...OK, servedShare: 0.97, waitP95Min: 10, queueEnd: 6 }, TH).verdict).toBe("CONFIRMED");
  });

  it("каждый порог по отдельности делает вердикт «не подтверждён»", () => {
    expect(verdict({ ...OK, servedShare: 0.969 }, TH).verdict).toBe("NOT_CONFIRMED");
    expect(verdict({ ...OK, queueEnd: 7 }, TH).verdict).toBe("NOT_CONFIRMED");
    expect(verdict({ ...OK, waitP95Min: 10.01 }, TH).verdict).toBe("NOT_CONFIRMED");
    expect(verdict({ ...OK, socFloorHit: true }, TH).verdict).toBe("NOT_CONFIRMED");
  });

  it("очередь в конце при малом потоке допускается до 3", () => {
    expect(verdict({ ...OK, requiredPerH: 20, queueEnd: 3 }, TH).verdict).toBe("CONFIRMED");
    expect(verdict({ ...OK, requiredPerH: 20, queueEnd: 4 }, TH).verdict).toBe("NOT_CONFIRMED");
  });

  it("парк избыточен только при подтверждении и простое ≥ порога", () => {
    expect(verdict({ ...OK, idlePct: 40 }, TH).oversized).toBe(true);
    expect(verdict({ ...OK, idlePct: 39.9 }, TH).oversized).toBe(false);
    expect(verdict({ ...OK, idlePct: 60, servedShare: 0.5 }, TH)).toEqual({ verdict: "NOT_CONFIRMED", oversized: false });
  });
});

describe("detectBottleneck", () => {
  const calm: BottleneckInputs = {
    productivePct: 70,
    chargingPct: 5,
    chargerWaitPct: 0,
    waitAtPointsPct: 1,
    maxDockUtilPct: 30,
    socFloorHit: false,
    queueGrew: false,
  };

  it("спокойный прогон — нет узкого места", () => {
    expect(detectBottleneck(calm)).toBe("none");
  });

  it("парк: занятость с зарядкой ≥ 95 % и очередь растёт", () => {
    expect(detectBottleneck({ ...calm, productivePct: 90, chargingPct: 5, queueGrew: true })).toBe("fleet");
    expect(detectBottleneck({ ...calm, productivePct: 90, chargingPct: 4.9, queueGrew: true })).toBe("none");
    expect(detectBottleneck({ ...calm, productivePct: 99, queueGrew: false })).toBe("none");
  });

  it("точки: загрузка ворот ≥ 90 % и ожидание у ворот ≥ 5 %", () => {
    expect(detectBottleneck({ ...calm, maxDockUtilPct: 90, waitAtPointsPct: 5 })).toBe("points");
    expect(detectBottleneck({ ...calm, maxDockUtilPct: 89, waitAtPointsPct: 30 })).toBe("none");
    expect(detectBottleneck({ ...calm, maxDockUtilPct: 99, waitAtPointsPct: 4 })).toBe("none");
  });

  it("зарядка: ожидание станции ≥ 5 % или разряд до нуля; проверяется первой", () => {
    expect(detectBottleneck({ ...calm, chargerWaitPct: 5 })).toBe("charging");
    expect(detectBottleneck({ ...calm, socFloorHit: true })).toBe("charging");
    expect(
      detectBottleneck({ ...calm, chargerWaitPct: 6, maxDockUtilPct: 95, waitAtPointsPct: 10, productivePct: 95, queueGrew: true }),
    ).toBe("charging");
  });
});

describe("percentile95", () => {
  it("метод ближайшего ранга", () => {
    expect(percentile95([])).toBe(0);
    expect(percentile95([7])).toBe(7);
    expect(percentile95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(percentile95(Array.from({ length: 20 }, (_, i) => 20 - i))).toBe(19);
  });
});

describe("summarize и toStored", () => {
  it("при «подтверждён» узкого места нет; при «не подтверждён» оно названо всегда", () => {
    const ok = runSimSync(warehouseBaseInput(11));
    expect(ok.verdict).toBe("CONFIRMED");
    expect(ok.bottleneck).toBe("none");
    for (const fleet of [3, 7, 8]) {
      const bad = runSimSync(warehouseBaseInput(fleet));
      expect(bad.verdict).toBe("NOT_CONFIRMED");
      expect(bad.bottleneck).not.toBe("none");
    }
  });

  it("simWasRun: прогона нет при NOT_SUPPORTED и «грузоподъёмности» — нули сводки значат «не применимо»", () => {
    const ran = runSimSync(warehouseBaseInput(9));
    expect(simWasRun(ran)).toBe(true);
    expect(simWasRun(toStored(runSimSync(warehouseBaseInput(3))))).toBe(true);
    const payload = runSimSync(warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, payloadKg: 100 } }));
    const invalid = runSimSync(warehouseBaseInput(5, { robots: { ...H1500_ROBOT, count: 5, speedMps: 0 } }));
    for (const s of [payload, invalid]) {
      expect(simWasRun(s)).toBe(false);
      expect(simWasRun(toStored(s))).toBe(false);
      expect(s.precheck).not.toBe("ok");
      expect(s.idlePct).toBe(0);
    }
  });

  it("мета прогона попадает в сводку; по умолчанию — загрузка норматива 77,5 %", () => {
    const def = runSimSync(warehouseBaseInput(9));
    expect(def.assumedUtilPct).toBeCloseTo(77.5, 10);
    expect(def.scenarioKey).toBe("");
    expect(def.durationMs).toBe(0);
    const withMeta = runSimSync(warehouseBaseInput(9), { scenarioKey: "p1", assumedUtilPct: 80 });
    expect(withMeta.scenarioKey).toBe("p1");
    expect(withMeta.assumedUtilPct).toBe(80);
  });

  it("toStored оставляет ровно поля SimSummaryStored", () => {
    const stored = toStored(runSimSync(warehouseBaseInput(9)));
    expect(Object.keys(stored).sort()).toEqual(
      [
        "simModelVersion",
        "seed",
        "scenarioKey",
        "fleet",
        "requiredPerH",
        "achievedPerH",
        "servedShare",
        "fleetUtilPct",
        "assumedUtilPct",
        "idlePct",
        "chargingPct",
        "waitAtPointsPct",
        "queueMax",
        "waitP95Min",
        "verdict",
        "bottleneck",
        "oversized",
        "minStableFleet",
        "fleetByNorm",
        "verdictByNorm",
        "durationMs",
      ].sort(),
    );
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });
});
