import { describe, it, expect } from "vitest";
import { parseWizardParams, buildWizardQuery, WIZARD_STEPS } from "./steps";

describe("parseWizardParams", () => {
  it("разбирает полный набор", () => {
    const s = parseWizardParams({
      industry: "retail", facility: "warehouse", area: "1000", ops: "500", staff: "10",
    });
    expect(s.industry).toBe("retail");
    expect(s.facility).toBe("warehouse");
    expect(s.params).toEqual({ areaM2: 1000, opsPerDay: 500, staffCount: 10 });
    expect(s.complete).toBe(true);
  });

  it("мусор в числах не роняет разбор и не проникает в расчёт", () => {
    const s = parseWizardParams({
      industry: "retail", facility: "warehouse", area: "не число", ops: "-5", staff: "",
    });
    // Все три поля конечны — движок не увидит NaN ни при каком вводе в адресной строке.
    expect(Number.isFinite(s.params.areaM2)).toBe(true);
    expect(Number.isFinite(s.params.opsPerDay)).toBe(true);
    expect(Number.isFinite(s.params.staffCount)).toBe(true);
    // Отрицательное — мусор, а не вывод: заменено значением по умолчанию, как и в форме.
    expect(s.params.opsPerDay).toBeGreaterThan(0);
    // И набор не считается собранным: пользователя вернут на шаг параметров.
    expect(s.complete).toBe(false);
  });

  it("неполный набор не считается завершённым", () => {
    expect(parseWizardParams({ industry: "retail" }).complete).toBe(false);
    expect(parseWizardParams({ industry: "retail", facility: "warehouse" }).complete).toBe(false);
  });

  it("массив в параметре (?industry=a&industry=b) берёт первое значение, а не падает", () => {
    expect(parseWizardParams({ industry: ["retail", "logistics"] }).industry).toBe("retail");
  });

  it("название объекта обрезается до 80 символов", () => {
    const long = "х".repeat(200);
    expect(parseWizardParams({ obj: long }).objectName!.length).toBe(80);
  });

  it("сборка и разбор — обратные операции", () => {
    const state = {
      industry: "retail",
      facility: "warehouse",
      params: { areaM2: 1000, opsPerDay: 500, staffCount: 10 },
    };
    const back = parseWizardParams(
      Object.fromEntries(new URLSearchParams(buildWizardQuery(state)))
    );
    expect(back.params).toEqual(state.params);
    expect(back.industry).toBe(state.industry);
    expect(back.facility).toBe(state.facility);
    expect(back.complete).toBe(true);
  });
});

describe("WIZARD_STEPS", () => {
  it("шаги перечислены по порядку и без дублей", () => {
    const keys = WIZARD_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("industry");
    expect(keys.at(-1)).toBe("calc");
  });
});
