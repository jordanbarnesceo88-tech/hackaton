import { describe, expect, it } from "vitest";
import { DEFAULT_NORMS } from "../tz/norms";
import { cycleThroughputPerH, expectedLegsM } from "./analytic";
import { H1500_ROBOT, WAREHOUSE_BASE_LAYOUT, WAREHOUSE_BASE_PEAK_PER_H, warehouseBaseInput } from "./fixtures";
import { buildWarehouseLayout } from "./layout";
import { runSimSync } from "./runner";

/**
 * Демонстрационная пара: базовый склад организатора (активная зона 10 000 м², проезды
 * 3,5/2,8 м, ворота 4 + 4) и Ronavi H1500 (1,5 м/с, 6 ч / 18 мин, погрузка 20 с), пик
 * 129,55 паллет/ч, средний поток 86,36 паллет/ч.
 */
describe("демо: базовый склад + H1500", () => {
  const legs = expectedLegsM(buildWarehouseLayout(WAREHOUSE_BASE_LAYOUT));
  const cycle = cycleThroughputPerH({
    ...legs,
    speedMps: H1500_ROBOT.speedMps,
    loadedSpeedFactor: H1500_ROBOT.loadedSpeedFactor,
    handlingSec: H1500_ROBOT.handlingSec,
  })!;
  // Парк по формуле ТЗ §3.5.2 с нормативами организатора: пик / (цикл × загрузка) × (1 + резерв).
  const fleet = Math.ceil(
    (WAREHOUSE_BASE_PEAK_PER_H / (cycle * DEFAULT_NORMS.utilization * DEFAULT_NORMS.availability)) *
      (1 + DEFAULT_NORMS.reservePct) -
      1e-9,
  );

  it("пиковый поток 129,55 паллет/ч, цикл ≈ 19,2 паллет/ч, расчётный парк 11", () => {
    expect(WAREHOUSE_BASE_PEAK_PER_H).toBeCloseTo(129.55, 2);
    expect(cycle).toBeCloseTo(19.2257, 3);
    expect(fleet).toBe(11);
  });

  it("расчётный парк подтверждается имитацией", () => {
    const s = runSimSync(warehouseBaseInput(fleet));
    expect(s.verdict).toBe("CONFIRMED");
    expect(s.bottleneck).toBe("none");
    expect(s.servedShare).toBeGreaterThanOrEqual(0.97);
    expect(s.achievedPerH / s.requiredPerH).toBeGreaterThan(0.95);
  });

  it("парк по паспортной норме (3 робота) не подтверждается: узкое место — парк", () => {
    const s = runSimSync(warehouseBaseInput(3));
    expect(s.verdict).toBe("NOT_CONFIRMED");
    expect(s.bottleneck).toBe("fleet");
    expect(s.achievedPerH).toBeLessThan(0.5 * s.requiredPerH);
    expect(s.queueEnd).toBeGreaterThan(s.queueAtPeakStart);
  });
});
