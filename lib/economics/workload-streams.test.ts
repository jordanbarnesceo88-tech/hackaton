import { describe, it, expect } from "vitest";
import { computeEconomics } from "./calculate";
import { makeAssumptions, makeParams } from "./fixtures";
import type { SolutionCapacity } from "./types";

// Класс «робот-уборщик»: середина диапазона 700–4860 м²/час.
const cleaner: SolutionCapacity = {
  capacityPerUnit: 2780,
  capacityBasis: "PER_HOUR_FLOW",
  workloadStream: "FLOOR_AREA",
  priceUsd: 47500,
  maintenanceUsdYear: 3500,
  energyUsdYear: 900,
  licensingUsdYear: 1800,
};

describe("уборщик считается против площади, а не против потока заказов", () => {
  // Свидетель того, ради чего написана спека. До неё этот расчёт давал замещение сорока
  // человек и окупаемость 0,1 года: движок сравнивал 5000 отборов заказов в сутки с
  // 2780 м² уборки в час как одну и ту же величину, и один поломоечный робот за $47 500
  // «замещал» весь персонал склада.
  const params = makeParams({ areaM2: 10000, opsPerDay: 5000, staffCount: 40 });
  const r = computeEconomics(cleaner, params, makeAssumptions());

  it("замещает единицы человек, а не весь штат", () => {
    if (!("displacedFte" in r)) throw new Error("ожидался считаемый результат");
    expect(r.displacedFte).toBeLessThan(10);
    expect(r.displacedFte).toBeGreaterThan(1);
  });

  it("окупается за годы, а не за недели", () => {
    if (!("simplePaybackYears" in r)) throw new Error("ожидался экономичный результат");
    expect(r.simplePaybackYears).toBeGreaterThan(0.5);
  });
});

describe("решения потока операций не задеты", () => {
  it("замещение по-прежнему ограничено потоком операций", () => {
    const amr: SolutionCapacity = {
      capacityPerUnit: 95,
      capacityBasis: "PER_HOUR_FLOW",
      workloadStream: "OPERATION_FLOW",
      priceUsd: 87500,
      maintenanceUsdYear: 9000,
      energyUsdYear: 1500,
      licensingUsdYear: 4000,
    };
    const r = computeEconomics(amr, makeParams({ opsPerDay: 5000, staffCount: 40 }), makeAssumptions());
    if (!("displacedFte" in r)) throw new Error("ожидался считаемый результат");
    // 5000 × 250 / 12 500 = 100, ограничено штатом 40 — как и до этой спеки.
    expect(r.displacedFte).toBe(40);
  });
});
