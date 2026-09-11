import { describe, it, expect } from "vitest";
import {
  sanitizeName,
  validateParams,
  validateAssumptions,
  isPlainObject,
  NAME_MAX_LEN,
} from "./validate";
import { DEFAULT_ASSUMPTIONS } from "@/lib/economics/assumptions";

describe("sanitizeName", () => {
  it("trims and accepts a normal name", () => {
    expect(sanitizeName("  Расчёт 1  ")).toBe("Расчёт 1");
  });
  it("caps length at NAME_MAX_LEN", () => {
    expect(sanitizeName("x".repeat(500))).toHaveLength(NAME_MAX_LEN);
  });
  it("rejects empty / non-string", () => {
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName(null)).toBeNull();
  });
});

describe("validateParams", () => {
  it("accepts the three required finite numbers", () => {
    expect(validateParams({ areaM2: 1000, opsPerDay: 500, staffCount: 10 })).toEqual({
      areaM2: 1000,
      opsPerDay: 500,
      staffCount: 10,
    });
  });
  it("preserves an optional finite peakConcurrent", () => {
    const r = validateParams({ areaM2: 1, opsPerDay: 1, staffCount: 1, peakConcurrent: 20 });
    expect(r).toEqual({ areaM2: 1, opsPerDay: 1, staffCount: 1, peakConcurrent: 20 });
  });
  it("rejects missing / non-finite / wrong-type / non-object", () => {
    expect(validateParams({ areaM2: 1, opsPerDay: 1 })).toBeNull();
    expect(validateParams({ areaM2: 1, opsPerDay: 1, staffCount: Infinity })).toBeNull();
    expect(validateParams({ areaM2: 1, opsPerDay: 1, staffCount: "3" })).toBeNull();
    expect(validateParams({ areaM2: 1, opsPerDay: 1, staffCount: 1, peakConcurrent: NaN })).toBeNull();
    expect(validateParams([1, 2, 3])).toBeNull();
    expect(validateParams(null)).toBeNull();
  });
});

describe("validateAssumptions", () => {
  it("accepts a full, finite assumptions bag", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS })).toEqual(DEFAULT_ASSUMPTIONS);
  });
  it("rejects a bag missing a key or with a non-finite value", () => {
    const { roiHorizonYears, ...missing } = DEFAULT_ASSUMPTIONS;
    void roiHorizonYears;
    expect(validateAssumptions(missing)).toBeNull();
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, turnoverPerDay: Infinity })).toBeNull();
  });
});

describe("isPlainObject", () => {
  it("distinguishes objects from arrays/null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});

describe("validateAssumptions range checks", () => {
  it("accepts the shipped defaults", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS })).not.toBeNull();
  });
  it("rejects a fraction above 1 (the crafted-payload path the panel now clamps)", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, laborReplacementPct: 5 })).toBeNull();
  });
  it("rejects a negative supervision share", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, residualSupervisionPct: -3 })).toBeNull();
  });
  it("rejects a negative discount rate the engine alone would accept", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, discountRate: -0.99 })).toBeNull();
  });
  it("rejects more than 24 operating hours in a day", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, operatingHoursPerDay: 25 })).toBeNull();
  });
  it("still accepts boundary values", () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, laborReplacementPct: 1 })).not.toBeNull();
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, laborReplacementPct: 0 })).not.toBeNull();
  });
});

describe("переопределения на пути сохранения", () => {
  const base = { areaM2: 1000, opsPerDay: 500, staffCount: 10 };

  it("переносит количество и цену в сохраняемые параметры", () => {
    // Свидетель настоящего бага: функция собирала объект из перечисленных полей и молча
    // отбрасывала остальное, поэтому отчёт показывал введённые руками числа как вычисленные.
    const r = validateParams({ ...base, quantityOverride: 6, capexPerUnitUsdOverride: 123000 });
    expect(r).not.toBeNull();
    expect(r!.quantityOverride).toBe(6);
    expect(r!.capexPerUnitUsdOverride).toBe(123000);
  });

  it("отсутствие переопределений — это не ноль, а отсутствие", () => {
    const r = validateParams(base);
    expect(r!.quantityOverride).toBeUndefined();
    expect(r!.capexPerUnitUsdOverride).toBeUndefined();
  });

  it("переносит занятость по задачам в сохраняемые параметры", () => {
    // Тот же класс бага, что с переопределениями: занятость — вход расчёта, и если она не
    // доедет до сохранённых параметров, отчёт покажет числа, посчитанные по нормативу, выдав
    // их за посчитанные по ответу человека.
    const r = validateParams({ ...base, taskStaffing: { "class-palletizer": 6, "class-cleaning": 0 } });
    expect(r).not.toBeNull();
    expect(r!.taskStaffing).toEqual({ "class-palletizer": 6, "class-cleaning": 0 });
  });

  it("отсутствие занятости — это не пустая карта, а отсутствие", () => {
    // Отсутствие ключа значит «считай по нормативу», пустая карта значила бы то же самое,
    // но пережила бы сериализацию как объект и начала отличаться от «ещё не спрашивали».
    expect(validateParams(base)!.taskStaffing).toBeUndefined();
  });

  it("негодная занятость отклоняет сохранение, а не отбрасывается молча", () => {
    for (const bad of [{ a: -1 }, { a: NaN }, { a: "шесть" }, { a: null }, [1, 2], "6"]) {
      expect(validateParams({ ...base, taskStaffing: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("негодное переопределение отклоняет платёж, а не отбрасывается молча", () => {
    expect(validateParams({ ...base, quantityOverride: 2.5 })).toBeNull();
    expect(validateParams({ ...base, quantityOverride: 0 })).toBeNull();
    expect(validateParams({ ...base, capexPerUnitUsdOverride: -1 })).toBeNull();
    expect(validateParams({ ...base, capexPerUnitUsdOverride: "дорого" })).toBeNull();
  });
});
