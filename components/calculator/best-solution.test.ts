import { describe, it, expect } from "vitest";
import { computeEconomics } from "@/lib/economics/calculate";
import { makeAssumptions, makeCapacity, makeParams } from "@/lib/economics/fixtures";
import { isViable } from "@/lib/economics/types";
import { detectUnitMismatch } from "@/lib/economics/commensurability";

/**
 * Отбор «лучшего» — правило, а не разметка, и проверяется как правило.
 *
 * Сам компонент здесь не рендерится: в проекте нет ни jsdom, ни react-testing-library, и
 * заводить их ради одного блока дороже, чем проверить решающий предикат. Проверяется именно
 * он — какие кандидаты вообще допускаются к сравнению.
 */
const a = makeAssumptions();
// Те же параметры, на которых стоит золотой снимок: сценарий, про который известно, что он
// считается и окупается. Первая версия этого теста брала склад на 5000 операций, и там при
// ставке 6,7 не окупается вообще ничего — тест падал, потому что был неправ он, а не отбор.
const params = makeParams();

/** Тот же фильтр, что применяет BestSolution: сравнимые и прошедшие isViable. */
const eligible = (cands: { name: string; unitMismatch: boolean; result: ReturnType<typeof computeEconomics> }[]) =>
  cands.filter((c) => !c.unitMismatch).filter((c) => isViable(c.result));

function candidate(name: string, cap: Parameters<typeof computeEconomics>[0]) {
  const result = computeEconomics(cap, params, a);
  const quantity = "quantity" in result ? result.quantity : 0;
  return { name, result, unitMismatch: detectUnitMismatch(cap, params, a, quantity) !== null };
}

describe("к «лучшему» допускаются только сравнимые решения (Е-1)", () => {
  it("решение с несопоставимой меркой не может стать лучшим, даже с высшим NPV", () => {
    // Инспекция: 41 000 деталей/час против 5000 операций в сутки. NPV у неё высокий ровно
    // потому, что единица крупнее, — она оказалась бы первой по построению, а не по существу.
    // Цена по нижней границе класса: так она действительно обгоняет обычное решение по NPV,
    // и проверяется именно отбор, а не то, что дорогая машина проигрывает дешёвой.
    const inspection = candidate(
      "ИИ-инспекция",
      makeCapacity({ capacityPerUnit: 41000, capacityBasis: "PER_HOUR_FLOW", priceUsd: 30000 })
    );
    const ordinary = candidate("Обычное решение", makeCapacity());

    expect(inspection.unitMismatch).toBe(true);
    expect(ordinary.unitMismatch).toBe(false);
    // Она действительно выигрывала бы по NPV, если бы её допустили.
    if (inspection.result.economical && ordinary.result.economical) {
      expect(inspection.result.npvUsd).toBeGreaterThan(ordinary.result.npvUsd);
    }

    const picked = eligible([inspection, ordinary]);
    expect(picked.map((c) => c.name)).toEqual(["Обычное решение"]);
  });

  it("сравнимое решение отбирается как обычно", () => {
    const ordinary = candidate("Обычное решение", makeCapacity());
    expect(eligible([ordinary]).map((c) => c.name)).toEqual(["Обычное решение"]);
  });

  it("несравнимое остаётся в списке кандидатов — из таблицы его не убирают", () => {
    // Различие принципиальное: не рекомендовать — это не то же, что спрятать. Убрать строку
    // значило бы скрыть данные; не называть её лучшей — не делать вывода, которого мы сделать
    // не можем.
    const inspection = candidate(
      "ИИ-инспекция",
      makeCapacity({ capacityPerUnit: 41000, capacityBasis: "PER_HOUR_FLOW", priceUsd: 30000 })
    );
    const all = [inspection, candidate("Обычное решение", makeCapacity())];
    expect(all).toHaveLength(2);
    expect(eligible(all)).toHaveLength(1);
  });
});
