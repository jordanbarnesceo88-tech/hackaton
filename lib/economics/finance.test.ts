import { describe, it, expect } from "vitest";
import { npv, discountedPaybackYears, projectFinance } from "./finance";
import { makeAssumptions } from "./fixtures";

describe("npv", () => {
  it("sums undiscounted at rate 0", () => {
    expect(npv(0, [-100, 50, 50, 50])).toBeCloseTo(50, 6);
  });
  it("discounts future flows", () => {
    // -100 + 110/1.1 = 0
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 6);
  });
  it("handles a multi-year annuity", () => {
    // -100 + 60/1.1 + 60/1.21 = -100 + 54.5454 + 49.5868 = 4.1322
    expect(npv(0.1, [-100, 60, 60])).toBeCloseTo(4.1322, 3);
  });
});

describe("discountedPaybackYears", () => {
  it("interpolates the crossing year at rate 0", () => {
    // cum: y1 -40, y2 +20 -> 1 + 40/60
    expect(discountedPaybackYears(0, [-100, 60, 60])).toBeCloseTo(1 + 40 / 60, 6);
  });
  it("accounts for discounting (payback comes later)", () => {
    // y1 disc 54.5454 -> cum -45.4545; y2 disc 49.5868 -> cum 4.132; 1 + 45.4545/49.5868
    expect(discountedPaybackYears(0.1, [-100, 60, 60])).toBeCloseTo(1 + 45.4545 / 49.5868, 3);
  });
  it("returns null when the series never recovers within the horizon", () => {
    expect(discountedPaybackYears(0, [-100, 10, 10])).toBeNull();
  });
  it("returns 0 when there is no upfront cost", () => {
    expect(discountedPaybackYears(0.1, [0, 10])).toBe(0);
  });
});

/**
 * Ч-2: докупка — крупный отрицательный поток ПОСЛЕ пересечения нуля, и первое пересечение
 * перестаёт быть ответом на вопрос «когда это окупилось».
 */
describe("Ч-2: окупаемость не переживает докупку, которая загнала поток обратно в минус", () => {
  // Ровно измеренный аудитом сценарий: горизонт 15, срок службы 7, ставка 0,05,
  // capex $5 000 000, экономия $1 000 000/год. Докупки на t=7 и t=14.
  const capex = 5_000_000;
  const savings = 1_000_000;
  const horizon = 15;
  const life = 7;
  const rate = 0.05;
  const cashflows = [-capex];
  for (let t = 1; t <= horizon; t++) {
    cashflows.push(savings - (t % life === 0 && t < horizon ? capex : 0));
  }

  it("не печатает срок для проекта с отрицательным NPV", () => {
    // Было: 5,898 года рядом с NPV −$699 088 — «окупается за 5,9 года» у проекта, который
    // теряет деньги. `isViable()` его отвергал, а панель результатов срок всё равно печатала.
    expect(npv(rate, cashflows)).toBeCloseTo(-699_088, 0);
    expect(discountedPaybackYears(rate, cashflows)).toBeNull();
  });

  it("возвращает ПОСЛЕДНЕЕ пересечение, когда поток всё-таки возвращается в плюс", () => {
    // capex 500 000, экономия 300 000, горизонт 4, срок службы 3 -> докупка на t=3.
    // Накопленный поток: −500k, −200k, +100k (пересечение 1,667), −100k, +200k.
    // Первое пересечение 1,667 к концу горизонта уже неверно: деньги вернулись только к 3,333.
    const cfs = [-500_000, 300_000, 300_000, 300_000 - 500_000, 300_000];
    expect(npv(0, cfs)).toBeCloseTo(200_000, 6);
    expect(discountedPaybackYears(0, cfs)).toBeCloseTo(3 + 1 / 3, 6);
  });

  it("никогда не отдаёт срок там, где накопленный приведённый поток ушёл в минус", () => {
    // Тот же перебор, которым находка измерена, только меньшей сеткой: инвариант, а не пример.
    for (const H of [3, 5, 7, 10, 12, 15])
      for (const L of [1, 2, 3, 4, 5, 7, 10])
        for (const R of [0, 0.05, 0.1, 0.12, 0.2])
          for (const C of [50_000, 500_000, 1_000_000, 5_000_000])
            for (const S of [100_000, 500_000, 1_000_000]) {
              const cfs = [-C];
              for (let t = 1; t <= H; t++) cfs.push(S - (t % L === 0 && t < H ? C : 0));
              // Обе стороны инварианта. Знак NPV и наличие срока — теперь одно утверждение:
              // накопленный приведённый поток на конце горизонта и есть NPV.
              if (npv(R, cfs) < 0) expect(discountedPaybackYears(R, cfs)).toBeNull();
              else expect(discountedPaybackYears(R, cfs)).not.toBeNull();
            }
  });
});

/**
 * Ч-1: «инвестиция» на экране означала два разных числа — ROI делил на полную сумму с
 * докупками, окупаемость на одну первую покупку, и меньшее из двух было тем, что красивее.
 */
describe("Ч-1: окупаемость и ROI меряются одной инвестицией", () => {
  const capex = 57_500;
  const savings = 159_000;

  it("простая окупаемость считается от полной инвестиции, включая докупки", () => {
    // Срок службы 2 при горизонте 5 -> докупки на t=2 и t=4 -> инвестиция 3 × $57 500.
    // Было 57 500/159 000 = 0,362 года; стало 172 500/159 000 = 1,085 — втрое дольше.
    const a = makeAssumptions({ assetLifeYears: 2, roiHorizonYears: 5 });
    const fin = projectFinance(savings, capex, a);
    expect(fin.simplePaybackYears).toBeCloseTo((capex * 3) / savings, 9);
    expect(fin.simplePaybackYears).toBeCloseTo(1.0849, 4);
  });

  it("два простых показателя выводятся друг из друга и разойтись больше не могут", () => {
    // ROI% = (горизонт / срок окупаемости − 1) × 100 выполняется ТОЛЬКО при общей базе.
    for (const life of [1, 2, 3, 4, 5, 7]) {
      const a = makeAssumptions({ assetLifeYears: life, roiHorizonYears: 5 });
      const fin = projectFinance(savings, capex, a);
      expect(fin.simpleRoiPct).toBeCloseTo((5 / fin.simplePaybackYears - 1) * 100, 6);
    }
  });

  it("без докупок число не меняется ни на знак", () => {
    // Срок службы 7 >= горизонт 5 -> инвестиция равна capex, прежняя формула сохраняется.
    const a = makeAssumptions({ assetLifeYears: 7, roiHorizonYears: 5 });
    expect(projectFinance(savings, capex, a).simplePaybackYears).toBeCloseTo(
      capex / savings,
      9
    );
  });
});

/**
 * Ч-3: дробный горизонт и срок службы floor-ились, и человек получал ответ для числа,
 * отстоящего от введённого почти на целый год.
 */
describe("Ч-3: дробные годы округляются к ближайшему целому, а не вниз", () => {
  const capex = 57_500;
  const savings = 99_000;

  it("горизонт 4,99 считается как 5, а не как 4", () => {
    const at = (roiHorizonYears: number) =>
      projectFinance(savings, capex, makeAssumptions({ roiHorizonYears })).npvUsd;
    expect(at(4.99)).toBeCloseTo(at(5), 6);
    expect(at(4.99)).not.toBeCloseTo(at(4), 0);
  });

  it("срок службы 1,99 считается как 2, а не как докупка каждый год", () => {
    const at = (assetLifeYears: number) =>
      projectFinance(savings, capex, makeAssumptions({ assetLifeYears })).npvUsd;
    expect(at(1.99)).toBeCloseTo(at(2), 6);
    expect(at(1.99)).not.toBeCloseTo(at(1), 0);
  });

  it("целые значения не сдвинулись: округление — no-op там, где ввод уже целый", () => {
    // Сверка с независимо собранной серией потоков, а не сама с собой: floor и round
    // совпадают на целых, и все прежние числа обязаны сохраниться до знака.
    for (const horizon of [1, 2, 3, 5, 7, 10, 30])
      for (const life of [1, 2, 3, 5, 7]) {
        const a = makeAssumptions({ roiHorizonYears: horizon, assetLifeYears: life });
        const cfs = [-capex];
        for (let t = 1; t <= horizon; t++)
          cfs.push(savings - (t % life === 0 && t < horizon ? capex : 0));
        expect(projectFinance(savings, capex, a).npvUsd).toBeCloseTo(npv(a.discountRate, cfs), 6);
      }
    // Штатные допущения (горизонт 5, срок службы 7, ставка 0,12) — то же число, что на экране.
    expect(projectFinance(savings, capex, makeAssumptions()).npvUsd).toBeCloseTo(299_373, 0);
  });
});
