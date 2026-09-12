import { describe, it, expect } from "vitest";
import { taskStaffingRows, staffingRemainder, staffingExceedsHeadcount } from "./task-staffing";
import type { TaskCategory } from "./task-staffing";
import { makeAssumptions, makeCapacity, makeParams } from "@/lib/economics/fixtures";
import { computeEconomics } from "@/lib/economics/calculate";

const a = makeAssumptions();

const cleaning: TaskCategory = {
  slug: "cleaning",
  taskLabel: "Уборка помещений",
  workloadStream: "FLOOR_AREA",
  workerOutputPerYear: 600000,
  workerOutputSourceUrl: "https://example.org/norm",
};
const palletising: TaskCategory = {
  slug: "palletising",
  taskLabel: "Паллетирование коробок",
  workloadStream: "OPERATION_FLOW",
  // Норматива по паллетированию найти не удалось — поле обязано остаться пустым.
  workerOutputPerYear: null,
  workerOutputSourceUrl: null,
};

describe("taskStaffingRows", () => {
  it("норматив превращается в предложенное число людей", () => {
    const rows = taskStaffingRows([cleaning], makeParams({ areaM2: 300000 }), a);
    // demand = 300000 м² × 1 уборка/сут × 250 дней = 75 000 000; 75 000 000 / 600 000 = 125,
    // но штат объекта 10 — потолок штата обязан сработать.
    expect(rows[0]!.suggested).toBe(10);
  });

  it("без норматива поле пустое, а не заполнено правдоподобным", () => {
    const rows = taskStaffingRows([palletising], makeParams(), a);
    expect(rows[0]!.suggested).toBeNull();
  });

  it("заявленное человеком видно отдельно от предложенного", () => {
    const params = makeParams({ taskStaffing: { cleaning: 3 } });
    const rows = taskStaffingRows([cleaning, palletising], params, a);
    expect(rows[0]!.declared).toBe(3);
    expect(rows[1]!.declared).toBeUndefined();
  });

  it("предложенное совпадает с тем, что посчитал бы движок сам — экран и расчёт не расходятся", () => {
    // Настоящая гарантия этого модуля. Если экран считает предзаполнение своей копией формулы,
    // поле показывает одно число, а расчёт ведётся по другому.
    const params = makeParams({ areaM2: 40000, staffCount: 40 });
    // Производительность уборщика, а не базовая 400/сут: против 10 млн м² в год базовая даёт
    // сто машин и честный убыток, и тест проверял бы не то.
    const cap = makeCapacity({
      workloadStream: "FLOOR_AREA",
      categorySlug: "cleaning",
      workerOutputPerYear: 600000,
      capacityPerUnit: 2780,
      capacityBasis: "PER_HOUR_FLOW",
    });

    const suggested = taskStaffingRows([cleaning], params, a)[0]!.suggested!;
    // Расчёт БЕЗ заявленной занятости — движок берёт норматив сам.
    const byNorm = computeEconomics(cap, params, a);
    // Расчёт С занятостью, равной предложенному, — человек согласился с подсказкой.
    const byAccepting = computeEconomics(
      cap,
      { ...params, taskStaffing: { cleaning: suggested } },
      a
    );

    expect(byNorm.economical).toBe(true);
    if (!byNorm.economical || !byAccepting.economical) return;
    expect(byAccepting.displacedFte).toBeCloseTo(byNorm.displacedFte, 9);
    expect(byAccepting.npvUsd).toBeCloseTo(byNorm.npvUsd, 6);
  });
});

describe("остаток штата", () => {
  it("остальные N человек — не роботизируем", () => {
    const params = makeParams({ staffCount: 40, taskStaffing: { cleaning: 6, palletising: 4 } });
    const rows = taskStaffingRows([cleaning, palletising], params, a);
    expect(staffingRemainder(rows, 40)).toBe(30);
  });

  it("считается по заявленному, а не по предложенному", () => {
    // Пока человек не подтвердил норматив, это наше предположение, а не его ответ.
    const params = makeParams({ areaM2: 300000, staffCount: 40 });
    const rows = taskStaffingRows([cleaning], params, a);
    expect(rows[0]!.suggested).toBeGreaterThan(0);
    expect(staffingRemainder(rows, 40)).toBe(40);
  });

  it("сумма больше штата — это ошибка ввода, а не отрицательный остаток (Г-2)", () => {
    const params = makeParams({ staffCount: 10, taskStaffing: { cleaning: 8, palletising: 5 } });
    const rows = taskStaffingRows([cleaning, palletising], params, a);
    expect(staffingRemainder(rows, 10)).toBe(-3);
    expect(staffingExceedsHeadcount(rows, 10)).toBe(true);
  });

  it("ровно по штату — не ошибка", () => {
    const params = makeParams({ staffCount: 10, taskStaffing: { cleaning: 6, palletising: 4 } });
    const rows = taskStaffingRows([cleaning, palletising], params, a);
    expect(staffingExceedsHeadcount(rows, 10)).toBe(false);
  });
});
