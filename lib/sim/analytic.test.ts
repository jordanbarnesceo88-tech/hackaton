import { describe, expect, it } from "vitest";
import { cycleThroughputPerH, expectedCycleS, expectedLegsM } from "./analytic";
import { H1500_ROBOT, WAREHOUSE_BASE_LAYOUT } from "./fixtures";
import { buildWarehouseLayout } from "./layout";
import { route, routeLengthM } from "./routing";
import type { SimLayout } from "./types";

/** Независимый пересчёт среднего через построение маршрутов (а не routeLengthBetween). */
function avgByRoutes(layout: SimLayout, from: { x: number; y: number }[], to: { x: number; y: number }[]): number {
  let sum = 0;
  for (const a of from) for (const b of to) sum += routeLengthM(route(layout, a, b));
  return sum / (from.length * to.length);
}

describe("expectedLegsM", () => {
  it("на планировке меньшего склада совпадает с независимым пересчётом по маршрутам", () => {
    const layout = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 3000, receivingDocksCount: 2, shippingDocksCount: 3 });
    const R = layout.receiving;
    const S = layout.shipping;
    const K = layout.slots;
    const loaded = 0.5 * avgByRoutes(layout, R, K) + 0.5 * avgByRoutes(layout, K, S);
    const empty =
      0.25 * (avgByRoutes(layout, K, R) + avgByRoutes(layout, K, K) + avgByRoutes(layout, S, R) + avgByRoutes(layout, S, K));
    const legs = expectedLegsM(layout);
    expect(legs.loadedM).toBeCloseTo(loaded, 9);
    expect(legs.emptyM).toBeCloseTo(empty, 9);
  });

  it("разложение по проходам верно и для нерегулярных мест (разные наборы Y в проходах)", () => {
    const base = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 2000 });
    const x0 = base.rackAislesX[0]!;
    const x1 = base.rackAislesX[1]!;
    const x2 = base.rackAislesX.at(-1)!;
    const layout: SimLayout = {
      ...base,
      slots: [
        { x: x0, y: 6 },
        { x: x0, y: 10 },
        { x: x1, y: 14 },
        { x: x1, y: 22 },
        { x: x1, y: 26 },
        { x: x2, y: 6 },
        { x: x2, y: 10 },
        { x: x0, y: 30 },
      ],
    };
    const K = layout.slots;
    const empty =
      0.25 *
      (avgByRoutes(layout, K, layout.receiving) +
        avgByRoutes(layout, K, K) +
        avgByRoutes(layout, layout.shipping, layout.receiving) +
        avgByRoutes(layout, layout.shipping, K));
    expect(expectedLegsM(layout).emptyM).toBeCloseTo(empty, 9);
  });

  it("на максимуме площади датасета (50 000 м², проходы 1,5 м) считается быстро", () => {
    const layout = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 50000, rackAisleWidthM: 1.5 });
    // Часы разрешены в тестах: правило no-restricted-globals защищает только код движка.
    // eslint-disable-next-line no-restricted-globals
    const t0 = performance.now();
    const legs = expectedLegsM(layout);
    // eslint-disable-next-line no-restricted-globals
    const ms = performance.now() - t0;
    expect(layout.slots.length).toBeGreaterThan(2500);
    expect(legs.loadedM).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });

  it("базовый склад организатора: закреплённые средние плечи (эталон для экономики и фрагмента T1.3)", () => {
    const legs = expectedLegsM(buildWarehouseLayout(WAREHOUSE_BASE_LAYOUT));
    expect(legs.loadedM).toBeCloseTo(93.8176, 3);
    expect(legs.emptyM).toBeCloseTo(103.6016, 3);
  });

  it("не зависит от числа зарядных станций (зарядка не входит в цикл задания)", () => {
    const a = expectedLegsM(buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, chargers: 1 }));
    const b = expectedLegsM(buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, chargers: 9 }));
    expect(b).toEqual(a);
  });

  it("растёт с площадью склада", () => {
    const small = expectedLegsM(buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 5000 }));
    const big = expectedLegsM(buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 20000 }));
    expect(big.loadedM).toBeGreaterThan(small.loadedM);
    expect(big.emptyM).toBeGreaterThan(small.emptyM);
  });
});

describe("cycleThroughputPerH", () => {
  it("3600 / (порожнее / v + с грузом / (v × f) + 2 × погрузка)", () => {
    const c = { loadedM: 90, emptyM: 100, speedMps: 1.5, loadedSpeedFactor: 0.8, handlingSec: 20 };
    const cycleS = 100 / 1.5 + 90 / (1.5 * 0.8) + 40;
    expect(expectedCycleS(c)).toBeCloseTo(cycleS, 12);
    expect(cycleThroughputPerH(c)).toBeCloseTo(3600 / cycleS, 12);
  });

  it("H1500 на базовом складе: ≈ 19,23 паллет/ч (эталон)", () => {
    const legs = expectedLegsM(buildWarehouseLayout(WAREHOUSE_BASE_LAYOUT));
    const thr = cycleThroughputPerH({
      ...legs,
      speedMps: H1500_ROBOT.speedMps,
      loadedSpeedFactor: H1500_ROBOT.loadedSpeedFactor,
      handlingSec: H1500_ROBOT.handlingSec,
    });
    expect(thr).toBeCloseTo(19.2257, 3);
  });

  it("неопределённый цикл — null, а не 0, NaN или ∞", () => {
    const base = { loadedM: 90, emptyM: 100, speedMps: 1.5, loadedSpeedFactor: 0.8, handlingSec: 20 };
    expect(cycleThroughputPerH({ ...base, speedMps: 0 })).toBeNull();
    expect(cycleThroughputPerH({ ...base, speedMps: -1 })).toBeNull();
    expect(cycleThroughputPerH({ ...base, loadedSpeedFactor: 0 })).toBeNull();
    expect(cycleThroughputPerH({ ...base, speedMps: Number.NaN })).toBeNull();
    expect(cycleThroughputPerH({ ...base, loadedM: -1 })).toBeNull();
    expect(cycleThroughputPerH({ loadedM: 0, emptyM: 0, speedMps: 1, loadedSpeedFactor: 1, handlingSec: 0 })).toBeNull();
  });
});
