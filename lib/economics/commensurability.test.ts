import { describe, it, expect } from "vitest";
import { detectUnitMismatch } from "./commensurability";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";
import { computeQuantity } from "./normalize";

const a = makeAssumptions();

describe("несоизмеримость единиц", () => {
  it("сервисный робот доставки на складе: парк в сотню машин", () => {
    // 27,5 доставок в сутки против 5000 операций склада — величины разной природы.
    const cap = makeCapacity({ capacityPerUnit: 27, capacityBasis: "PER_DAY_FLOW" });
    const params = makeParams({ opsPerDay: 5000 });
    const q = computeQuantity(cap, params, a)!;
    expect(q).toBeGreaterThan(100);
    expect(detectUnitMismatch(cap, params, a, q)).toEqual({ kind: "fleet", quantity: q });
  });

  it("ИИ-инспекция: одна станция «закрывает» объект многократно", () => {
    // 41 000 деталей в час — это 164 млн в год против 1,25 млн операций объекта.
    const cap = makeCapacity({ capacityPerUnit: 41000, capacityBasis: "PER_HOUR_FLOW" });
    const params = makeParams({ opsPerDay: 5000 });
    const q = computeQuantity(cap, params, a)!;
    expect(q).toBe(1);
    const m = detectUnitMismatch(cap, params, a, q);
    expect(m?.kind).toBe("coverage");
    expect(m && m.kind === "coverage" && m.ratio).toBeGreaterThan(100);
  });

  it("сопоставимая единица предупреждения не вызывает", () => {
    // Базовая фикстура: 400 операций в сутки против 400 — парк из одной машины, покрытие 1.
    const cap = makeCapacity();
    const params = makeParams();
    const q = computeQuantity(cap, params, a)!;
    expect(detectUnitMismatch(cap, params, a, q)).toBeNull();
  });

  it("поток площади не помечается: там м² сравниваются с м²", () => {
    const cap = makeCapacity({
      workloadStream: "FLOOR_AREA",
      capacityPerUnit: 2780,
      capacityBasis: "PER_HOUR_FLOW",
    });
    const params = makeParams({ areaM2: 1000 });
    const q = computeQuantity(cap, params, a)!;
    expect(detectUnitMismatch(cap, params, a, q)).toBeNull();
  });
});
