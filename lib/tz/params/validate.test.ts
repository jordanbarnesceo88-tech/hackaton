import { describe, it, expect } from "vitest";
import type { ParamIssue } from "../types";
import { spec, warehouseDefs } from "./test-fixtures";
import { hasErrors, validateParamValues } from "./validate";

const defs = warehouseDefs();

function only(issues: ParamIssue[], key: string): ParamIssue {
  const own = issues.filter((i) => i.key === key);
  expect(own, `проблемы по ${key}`).toHaveLength(1);
  return own[0] as ParamIssue;
}

describe("validateParamValues", () => {
  it("базовые значения организатора проходят без проблем", () => {
    const base = Object.fromEntries(defs.map((d) => [d.key, d.base]));
    const { values, issues } = validateParamValues(defs, base, { origin: "manual" });
    expect(issues).toEqual([]);
    expect(values).toEqual(base);
  });

  it("пустой ввод → полный набор значений по умолчанию без проблем", () => {
    const { values, issues } = validateParamValues(defs, {}, { origin: "upload" });
    expect(issues).toEqual([]);
    expect(Object.keys(values)).toEqual(defs.map((d) => d.key));
    expect(values.forkliftSalaryRubMonth).toBe(120000);
  });

  it("строки приводятся к типу: «2 700 000,00», «1,5», габариты", () => {
    const { values, issues } = validateParamValues(
      defs,
      { forkliftSalaryRubMonth: "130 000", peakFactor: "1,8", palletDimsMm: "1200 x 800 x 1500" },
      { origin: "manual" },
    );
    expect(issues).toEqual([]);
    expect(values.forkliftSalaryRubMonth).toBe(130000);
    expect(values.peakFactor).toBe(1.8);
    expect(values.palletDimsMm).toBe("1200×800×1500");
  });

  describe("коды проблем", () => {
    it("missing_required: нет значения и нет базы — ошибка с единицей и примером", () => {
      const d = [spec({ key: "cleanersCount", label: "Уборщики", kind: "integer", unit: "чел.", example: "например, 12" })];
      const { values, issues } = validateParamValues(d, {}, { origin: "upload" });
      const i = only(issues, "cleanersCount");
      expect(i).toMatchObject({ code: "missing_required", severity: "error" });
      expect(i.message).toBe("Не заполнено обязательное поле «Уборщики». Введите значение в чел., например, 12");
      expect(values.cleanersCount).toBeNull();
    });

    it("missing_required: обязательное поле стёрто, хотя база есть; пример из базы, если его нет", () => {
      const { values, issues } = validateParamValues(defs, { totalAreaM2: "  " }, { origin: "manual" });
      const i = only(issues, "totalAreaM2");
      expect(i.code).toBe("missing_required");
      expect(i.message).toBe(
        "Не заполнено обязательное поле «Общая площадь склада». Введите значение в м², например, 20000",
      );
      expect(values.totalAreaM2).toBe(20000);
      const noExample = [spec({ key: "a", label: "А", base: 7 })];
      expect(only(validateParamValues(noExample, { a: "" }, { origin: "manual" }).issues, "a").message).toBe(
        "Не заполнено обязательное поле «А». Введите значение, например 7",
      );
    });

    it("необязательное поле пусто → база без проблемы", () => {
      const { values, issues } = validateParamValues(defs, { capexBudgetMRub: "" }, { origin: "manual" });
      expect(issues).toEqual([]);
      expect(values.capexBudgetMRub).toBe(80);
    });

    it("wrong_type и bad_number_format — ошибка, значение остаётся базовым", () => {
      const { values, issues } = validateParamValues(
        defs,
        { totalAreaM2: "двадцать тысяч", activeAreaM2: "10.000,5,0" },
        { origin: "manual" },
      );
      expect(only(issues, "totalAreaM2")).toMatchObject({
        code: "wrong_type",
        severity: "error",
        message: "Общая площадь склада: «двадцать тысяч» — не число. Введите число, дробную часть через запятую",
      });
      expect(only(issues, "activeAreaM2").code).toBe("bad_number_format");
      expect(values.totalAreaM2).toBe(20000);
      expect(hasErrors(issues)).toBe(true);
    });

    it("negative — ошибка", () => {
      const i = only(validateParamValues(defs, { conveyorLengthM: -10 }, { origin: "api" }).issues, "conveyorLengthM");
      expect(i).toMatchObject({ code: "negative", severity: "error" });
    });

    it("not_integer — ошибка для целочисленного параметра", () => {
      const i = only(validateParamValues(defs, { shiftsPerDay: 2.5 }, { origin: "manual" }).issues, "shiftsPerDay");
      expect(i).toMatchObject({ code: "not_integer", severity: "error" });
    });

    it("bad_option — ошибка со списком вариантов", () => {
      const i = only(validateParamValues(defs, { floorType: "Паркет" }, { origin: "manual" }).issues, "floorType");
      expect(i.code).toBe("bad_option");
      expect(i.message).toBe(
        "Тип напольного покрытия: «Паркет» — нет такого варианта. Выберите один из: «Промышленный бетон», «Эпоксидное покрытие», «Асфальт»",
      );
    });

    it("out_of_range — предупреждение, значение принимается", () => {
      const { values, issues } = validateParamValues(defs, { forkliftSalaryRubMonth: 200000 }, { origin: "manual" });
      const i = only(issues, "forkliftSalaryRubMonth");
      expect(i.severity).toBe("warning");
      expect(i.code).toBe("out_of_range");
      expect(i.message.replace(/\s/g, " ")).toBe(
        "Средняя з/п оператора погрузчика (gross): 200 000 вне диапазона организатора 80 000–170 000 руб./мес. — проверьте значение",
      );
      expect(values.forkliftSalaryRubMonth).toBe(200000);
      expect(hasErrors(issues)).toBe(false);
    });

    it("locked_changed — предупреждение, значение принимается; без лишнего out_of_range", () => {
      const { values, issues } = validateParamValues(defs, { workDaysPerYear: 300 }, { origin: "manual" });
      const i = only(issues, "workDaysPerYear");
      expect(i).toMatchObject({ code: "locked_changed", severity: "warning" });
      expect(i.message).toBe(
        "Рабочих дней в году: значение зафиксировано организатором (365 дн.); изменение будет записано в журнал",
      );
      expect(values.workDaysPerYear).toBe(300);
      expect(validateParamValues(defs, { hasWms: "да" }, { origin: "manual" }).issues).toEqual([]);
    });

    it("unknown_key: ошибка для upload и api, в ручном вводе игнорируется", () => {
      for (const origin of ["upload", "api"] as const) {
        const i = only(validateParamValues(defs, { robotsCount: 5 }, { origin }).issues, "robotsCount");
        expect(i).toMatchObject({
          code: "unknown_key",
          severity: "error",
          message: "Неизвестный параметр «robotsCount» — уберите строку или сверьтесь с шаблоном",
        });
      }
      const manual = validateParamValues(defs, { robotsCount: 5 }, { origin: "manual" });
      expect(manual.issues).toEqual([]);
      expect("robotsCount" in manual.values).toBe(false);
    });

    it("duplicate_key: повтор в записях файла — ошибка, берётся первое значение", () => {
      const { values, issues } = validateParamValues(
        defs,
        [
          { key: "shiftsPerDay", value: "3", row: 5 },
          { key: "shiftsPerDay", value: "1", row: 9 },
        ],
        { origin: "upload" },
      );
      const i = only(issues, "shiftsPerDay");
      expect(i).toMatchObject({ code: "duplicate_key", severity: "error", row: 9 });
      expect(i.message).toBe(
        "Количество рабочих смен в сутки: параметр указан дважды (строки 5 и 9) — оставьте одну строку",
      );
      expect(values.shiftsPerDay).toBe(3);
    });

    it("unit_mismatch: единица в файле не та — ошибка «пересчитайте»", () => {
      const { values, issues } = validateParamValues(
        defs,
        [{ key: "forkliftSalaryRubMonth", value: "130", unit: "тыс. руб./мес.", row: 12 }],
        { origin: "upload" },
      );
      const i = only(issues, "forkliftSalaryRubMonth");
      expect(i).toMatchObject({ code: "unit_mismatch", severity: "error", row: 12 });
      expect(i.message).toBe(
        "Средняя з/п оператора погрузчика (gross): единица «тыс. руб./мес.» не совпадает с «руб./мес.» — пересчитайте значение в руб./мес.",
      );
      expect(values.forkliftSalaryRubMonth).toBe(120000);
    });

    it("совместимая единица («₽/мес» вместо «руб./мес.», «м/п») ошибкой не считается", () => {
      const { issues } = validateParamValues(
        defs,
        [
          { key: "forkliftSalaryRubMonth", value: "130000", unit: "₽/мес" },
          { key: "palletPositions", value: "20000", unit: "м/п" },
          { key: "peakFactor", value: "1,5", unit: "-" },
        ],
        { origin: "upload" },
      );
      expect(issues).toEqual([]);
    });
  });

  it("номер строки файла попадает в проблему", () => {
    const { issues } = validateParamValues(defs, [{ key: "totalAreaM2", value: "abc", row: 4 }], { origin: "upload" });
    expect(only(issues, "totalAreaM2").row).toBe(4);
  });

  it("каждое сообщение об ошибке говорит, как исправить", () => {
    const { issues } = validateParamValues(
      [...defs, spec({ key: "cleanersCount", label: "Уборщики", kind: "integer" })],
      [
        { key: "totalAreaM2", value: "abc" },
        { key: "activeAreaM2", value: "1,2,3" },
        { key: "conveyorLengthM", value: "-1" },
        { key: "shiftsPerDay", value: "1,5" },
        { key: "rackType", value: "?" },
        { key: "zzz", value: "1" },
        { key: "floorsCount", value: "1" },
        { key: "floorsCount", value: "2" },
        { key: "avgPalletMassKg", value: "0,8", unit: "т" },
        { key: "palletDimsMm", value: "большие" },
      ],
      { origin: "upload" },
    );
    const errors = issues.filter((i) => i.severity === "error");
    expect(new Set(errors.map((i) => i.code))).toEqual(
      new Set([
        "wrong_type",
        "bad_number_format",
        "negative",
        "not_integer",
        "bad_option",
        "unknown_key",
        "duplicate_key",
        "unit_mismatch",
        "missing_required",
      ]),
    );
    for (const e of errors) {
      expect(e.message, e.code).toMatch(/Введите|Выберите|уберите|оставьте|пересчитайте/);
    }
  });
});
