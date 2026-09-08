import { describe, it, expect } from "vitest";
import { computeEconomics } from "./calculate";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";

const cap = makeCapacity();
const a = makeAssumptions();
// Спрос заведомо больше одной единицы: при расчётном парке в одну штуку «половина парка»
// тоже равна одной, и тест про масштабирование покрытием проходил бы вхолостую.
// 2000 операций/сутки × 250 дней = 500 000 против 100 000 у единицы — парк из пяти.
const params = makeParams({ opsPerDay: 2000, staffCount: 40 });

function calc(over: Record<string, number> = {}) {
  const r = computeEconomics(cap, { ...params, ...over }, a);
  if (!("quantity" in r)) throw new Error("ожидался считаемый результат");
  return r;
}

describe("переопределение количества", () => {
  const base = calc();

  it("без переопределения ничего не меняется", () => {
    // Условие проверки всей спеки: покрытие при расчётном количестве равно единице, и
    // формула вырождается в прежнюю.
    expect(calc({}).annualSavingsUsd).toBe(base.annualSavingsUsd);
  });

  it("расчётный парк действительно больше одной единицы", () => {
    // Страховка от вакуумности следующих тестов: если фикстура снова даст парк в одну штуку,
    // «половина» совпадёт с целым и проверки перестанут что-либо проверять.
    expect(base.quantity).toBeGreaterThan(1);
  });

  it("половина парка экономит заметно меньше, а не столько же", () => {
    // Ради этого теста спека и писалась: без масштабирования покрытием переопределение
    // становится способом получить любой желаемый NPV.
    const half = Math.max(1, Math.floor(base.quantity / 2));
    const r = calc({ quantityOverride: half });
    expect(r.quantity).toBe(half);
    expect(r.annualSavingsUsd).toBeLessThan(base.annualSavingsUsd);
  });

  it("парк больше расчётного не увеличивает экономию, но увеличивает затраты", () => {
    // Покрытие ограничено единицей: лишние роботы не создают работу, но стоят денег.
    const more = base.quantity * 3;
    const r = calc({ quantityOverride: more });
    expect(r.quantity).toBe(more);
    expect(r.capexUsd).toBeGreaterThan(base.capexUsd);
    expect(r.annualSavingsUsd).toBeLessThan(base.annualSavingsUsd); // выше OPEX при том же эффекте
  });

  it("нецелое или нулевое количество игнорируется, а не округляется молча", () => {
    expect(calc({ quantityOverride: 2.5 }).quantity).toBe(base.quantity);
    expect(calc({ quantityOverride: 0 }).quantity).toBe(base.quantity);
    expect(calc({ quantityOverride: -3 }).quantity).toBe(base.quantity);
  });
});

describe("переопределение цены за единицу", () => {
  const base = calc();

  it("меняет CAPEX и не трогает экономию", () => {
    const r = calc({ capexPerUnitUsdOverride: cap.priceUsd * 2 });
    expect(r.capexUsd).toBeCloseTo(base.capexUsd * 2, 6);
    // Цена — утверждение о деньгах, а не о том, сколько работы делает машина.
    expect(r.annualSavingsUsd).toBe(base.annualSavingsUsd);
  });

  it("непозитивная цена игнорируется", () => {
    expect(calc({ capexPerUnitUsdOverride: 0 }).capexUsd).toBe(base.capexUsd);
    expect(calc({ capexPerUnitUsdOverride: -100 }).capexUsd).toBe(base.capexUsd);
  });
});
