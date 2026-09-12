import { describe, it, expect } from "vitest";
import {
  EMPLOYER_CONTRIBUTION_MULTIPLIER,
  REGION_PRESETS,
  regionLaborCostUsd,
  WORK_HOURS_PER_MONTH,
} from "./regions";
import { DEFAULT_ASSUMPTIONS } from "./assumptions";

describe("REGION_PRESETS", () => {
  it("has ≥4 presets with unique ids", () => {
    expect(REGION_PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = REGION_PRESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))("%s is well-formed", (_n, r) => {
    expect(r.id.trim().length).toBeGreaterThan(0);
    expect(r.name.trim().length).toBeGreaterThan(0);
    expect(r.laborCostRubPerHour).toBeGreaterThan(0);
    expect(r.monthlyWageRub).toBeGreaterThan(0);
    expect(r.energyCostFactor).toBeGreaterThanOrEqual(0.5);
    expect(r.energyCostFactor).toBeLessThanOrEqual(1.5);
  });

  it("includes a Москва reference at energy factor 1.0", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow");
    expect(msk).toBeDefined();
    expect(msk!.energyCostFactor).toBeCloseTo(1.0, 6);
  });
});

// Д-1. Эти четыре теста существуют, чтобы ставка труда больше никогда не разошлась с
// docs/data-provenance.md молча. Пресет занижался на 31 % ровно потому, что вывод жил в
// документе, а число — в коде, и проверять их соответствие было нечем.
describe("вывод ставки труда — тот же, что в docs/data-provenance.md", () => {
  it("делит на hoursPerYear / 12 (166,67), а не на 168", () => {
    // Одна величина — один делитель. 168 давал бы 2016 ч/год, а движок пересчитывает ставку в
    // год по hoursPerYear = 2000 (calculate.ts). Расхождение 0,8 % на каждом числе продукта.
    expect(WORK_HOURS_PER_MONTH).toBe(DEFAULT_ASSUMPTIONS.hoursPerYear / 12);
    expect(WORK_HOURS_PER_MONTH).toBeCloseTo(166.67, 2);
    expect(WORK_HOURS_PER_MONTH).not.toBe(168);
  });

  it("применяет 30 % взносов (п. 3 ст. 425 НК РФ)", () => {
    expect(EMPLOYER_CONTRIBUTION_MULTIPLIER).toBe(1.3);
  });

  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))(
    "%s: ₽/час равны цитируемому окладу × 1,30 ÷ 166,67",
    (_n, r) => {
      expect(r.laborCostRubPerHour).toBe(
        Math.round((r.monthlyWageRub * EMPLOYER_CONTRIBUTION_MULTIPLIER) / WORK_HOURS_PER_MONTH)
      );
    }
  );

  it.each([
    ["moscow", 180860, 1411],
    ["spb", 121475, 948],
    ["rf-avg", 100360, 783],
    ["low-cost", 46281, 361],
  ] as const)("%s пришпилен: %i ₽/мес → %i ₽/час", (id, wage, rubPerHour) => {
    // Числа названы явно, а не только формулой: формула, вычисленная из изменившегося
    // hoursPerYear, осталась бы «зелёной», молча сдвинув каждый пресет.
    const r = REGION_PRESETS.find((p) => p.id === id)!;
    expect(r.monthlyWageRub).toBe(wage);
    expect(r.laborCostRubPerHour).toBe(rubPerHour);
  });

  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))(
    "%s: годовая стоимость работодателю сходится с окладом × 12",
    (_n, r) => {
      // Замыкание круга: часовая ставка, умноженная на годовой фонд движка, обязана дать ту же
      // сумму, что цитируемый оклад с взносами за двенадцать месяцев. Именно это равенство и
      // ломал делитель 168 — на нём годовая стоимость не сходилась с собственной цитатой.
      const fromCitation = r.monthlyWageRub * EMPLOYER_CONTRIBUTION_MULTIPLIER * 12;
      const fromRate = r.laborCostRubPerHour * DEFAULT_ASSUMPTIONS.hoursPerYear;
      expect(Math.abs(fromRate - fromCitation) / fromCitation).toBeLessThan(0.001);
    }
  );

  it.each(REGION_PRESETS.map((r) => [r.name, r] as const))(
    "%s: это стоимость работодателя, а не оклад — на 31 % выше прежнего",
    (_n, r) => {
      // Прежняя формула (оклад ÷ 168) писала в поле «стоимость труда» голый оклад. Отношение
      // 1,30 × 168 ÷ 166,67 = 1,3104 — тот самый разрыв, который измерил аудит.
      const oldWagePerHour = r.monthlyWageRub / 168;
      expect(r.laborCostRubPerHour / oldWagePerHour).toBeGreaterThan(1.3);
      expect(r.laborCostRubPerHour / oldWagePerHour).toBeLessThan(1.32);
    }
  );
});

// З-1. Значение по умолчанию и пресеты обязаны означать одно и то же — полную стоимость часа
// работодателю. Проверяется здесь, потому что расходятся они всегда парой.
describe("значение по умолчанию", () => {
  it("равно центру собственного вывода проекта, а не западным 15", () => {
    expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBe(6.7);
  });

  it("лежит в задокументированном диапазоне 5,6–7,8 $/час", () => {
    // Границы — это 65 000 и 90 000 ₽/мес × 1,30 ÷ 166,67 ÷ 90 ₽/$ из data-provenance.md.
    const lo = (65000 * EMPLOYER_CONTRIBUTION_MULTIPLIER) / WORK_HOURS_PER_MONTH / 90;
    const hi = (90000 * EMPLOYER_CONTRIBUTION_MULTIPLIER) / WORK_HOURS_PER_MONTH / 90;
    expect(lo).toBeCloseTo(5.63, 2);
    expect(hi).toBeCloseTo(7.8, 2);
    expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBeGreaterThanOrEqual(lo);
    expect(DEFAULT_ASSUMPTIONS.laborCostPerHourUsd).toBeLessThanOrEqual(hi);
  });
});

describe("regionLaborCostUsd", () => {
  it("derives the hourly rate from the cited monthly wage", () => {
    for (const r of REGION_PRESETS) {
      expect(r.laborCostRubPerHour).toBe(
        Math.round((r.monthlyWageRub * EMPLOYER_CONTRIBUTION_MULTIPLIER) / WORK_HOURS_PER_MONTH)
      );
    }
  });

  it("rounds to the cent, because the result lands in a field the user reads", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow")!;
    // 1411 / 90 is 15.6777… — a wage, not a float dump.
    expect(regionLaborCostUsd(msk, 90)).toBe(15.68);
    expect(regionLaborCostUsd(msk, 110)).toBe(12.83);
  });

  it("converts at the live rate, so an edited usdToRub no longer breaks the citation", () => {
    // The bug: the USD figure was baked in at 90 ₽/$, so at 110 the «Москва» preset implied a
    // wage of 1 320 ₽/h against a cited 1 077 — a 23% overstatement of a sourced number.
    // Within half a ruble at every rate, which is the cent-rounding and nothing more.
    const msk = REGION_PRESETS.find((r) => r.id === "moscow")!;
    for (const rate of [80, 90, 110, 150]) {
      expect(Math.abs(regionLaborCostUsd(msk, rate) * rate - msk.laborCostRubPerHour)).toBeLessThan(1);
    }
  });

  it("falls back to the documented 90 for a nonsensical rate rather than dividing by zero", () => {
    const msk = REGION_PRESETS.find((r) => r.id === "moscow")!;
    expect(regionLaborCostUsd(msk, 0)).toBe(regionLaborCostUsd(msk, 90));
    expect(regionLaborCostUsd(msk, NaN)).toBe(regionLaborCostUsd(msk, 90));
  });
});
