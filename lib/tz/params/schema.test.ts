import { describe, it, expect } from "vitest";
import { applyDefaults, coerce, isBlank, isOutOfRange, normalizeUnit, sameParamValue, unitsCompatible } from "./schema";
import { spec, warehouseDefs } from "./test-fixtures";

describe("applyDefaults", () => {
  const defs = warehouseDefs();

  it("пустой ввод → все базовые значения организатора", () => {
    const v = applyDefaults(defs, {});
    expect(Object.keys(v)).toEqual(defs.map((d) => d.key));
    expect(v.totalAreaM2).toBe(20000);
    expect(v.payrollTaxMultiplier).toBe(1.302);
    expect(v.hasWms).toBe("Да");
    expect(v.palletDimsMm).toBe("1200×800×1600");
    expect(applyDefaults(defs, null)).toEqual(v);
  });

  it("заданные значения сохраняются, null/пустые/NaN заменяются базой, лишние ключи отбрасываются", () => {
    const v = applyDefaults(defs, {
      totalAreaM2: 30000,
      rackType: "Shuttle",
      shiftsPerDay: null,
      peakFactor: "  ",
      horizonYears: Number.NaN,
      somethingElse: 1,
    });
    expect(v.totalAreaM2).toBe(30000);
    expect(v.rackType).toBe("Shuttle");
    expect(v.shiftsPerDay).toBe(2);
    expect(v.peakFactor).toBe(1.5);
    expect(v.horizonYears).toBe(5);
    expect("somethingElse" in v).toBe(false);
  });

  it("базы нет → null", () => {
    expect(applyDefaults([spec({ key: "cleanersCount", kind: "integer" })], {})).toEqual({ cleanersCount: null });
  });
});

describe("coerce", () => {
  const area = spec({ key: "totalAreaM2", label: "Общая площадь склада", unit: "м²", min: 10000, max: 100000 });
  const floors = spec({ key: "floorsCount", label: "Количество этажей", kind: "integer", unit: "шт." });
  const pct = spec({ key: "piecePickSharePct", label: "Доля", kind: "percent", unit: "%" });
  const temp = spec({ key: "apronWinterMinTempC", label: "Мин. температура", unit: "°C", min: -40, max: 0 });
  const rack = spec({ key: "rackType", kind: "enum", options: ["Фронтальные паллетные", "Shuttle"] });
  const wms = spec({ key: "hasWms", kind: "enum", options: ["Да", "Нет"] });
  const dims = spec({ key: "palletDimsMm", kind: "dims", unit: "мм", base: "1200×800×1600" });
  const text = spec({ key: "erpSystem", kind: "text" });

  it("числа: русская запись, дописанная единица, число как есть", () => {
    expect(coerce(area, "20 000")).toEqual({ ok: true, value: 20000 });
    expect(coerce(area, "20 000 м²")).toEqual({ ok: true, value: 20000 });
    expect(coerce(area, "20000,5")).toEqual({ ok: true, value: 20000.5 });
    expect(coerce(area, 15000)).toEqual({ ok: true, value: 15000 });
    expect(coerce(pct, "30 %")).toEqual({ ok: true, value: 30 });
  });

  it("не число → wrong_type, похоже на число → bad_number_format", () => {
    const a = coerce(area, "много");
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.issue.code).toBe("wrong_type");
      expect(a.issue.message).toBe("Общая площадь склада: «много» — не число. Введите число, дробную часть через запятую");
    }
    const b = coerce(area, "12,5,3", 7);
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.issue.code).toBe("bad_number_format");
      expect(b.issue.row).toBe(7);
    }
    const c = coerce(area, { x: 1 });
    expect(!c.ok && c.issue.code).toBe("wrong_type");
    const d = coerce(area, true);
    expect(!d.ok && d.issue.code).toBe("wrong_type");
  });

  it("отрицательное — ошибка, если диапазон организатора не уходит ниже нуля", () => {
    const a = coerce(area, "-5");
    expect(!a.ok && a.issue.code).toBe("negative");
    expect(!a.ok && a.issue.message).toMatch(/не может быть отрицательным\. Введите число не меньше 0$/);
    expect(coerce(temp, "−25")).toEqual({ ok: true, value: -25 });
  });

  it("целое: дробное → not_integer, «2,0» → 2", () => {
    const a = coerce(floors, "2,5");
    expect(!a.ok && a.issue.code).toBe("not_integer");
    expect(!a.ok && a.issue.message).toMatch(/нужно целое число\. Введите число без дробной части/);
    expect(coerce(floors, "2,0")).toEqual({ ok: true, value: 2 });
  });

  it("перечисление: без регистра и лишних пробелов, в написании варианта; «Да » организатора", () => {
    expect(coerce(rack, "  shuttle ")).toEqual({ ok: true, value: "Shuttle" });
    expect(coerce(wms, "Да ")).toEqual({ ok: true, value: "Да" });
    expect(coerce(wms, true)).toEqual({ ok: true, value: "Да" });
    const bad = coerce(rack, "Мезонин");
    expect(!bad.ok && bad.issue.code).toBe("bad_option");
    expect(!bad.ok && bad.issue.message).toContain("Выберите один из: «Фронтальные паллетные», «Shuttle»");
  });

  it("перечисление без вариантов ведёт себя как текст", () => {
    expect(coerce(spec({ key: "x", kind: "enum" }), " любое ")).toEqual({ ok: true, value: "любое" });
  });

  it("габариты: «×», «x», «х», «*» → «1200×800×1600»", () => {
    for (const s of ["1200×800×1600", "1200x800x1600", "1200 х 800 х 1600", "1200*800*1600", "1200×800×1600 мм"]) {
      expect(coerce(dims, s), s).toEqual({ ok: true, value: "1200×800×1600" });
    }
    expect(coerce(dims, "1200×800")).toEqual({ ok: true, value: "1200×800" });
    expect(coerce(dims, "0,6×0,4")).toEqual({ ok: true, value: "0,6×0,4" });
    const bad = coerce(dims, "1200");
    expect(!bad.ok && bad.issue.code).toBe("wrong_type");
    expect(!bad.ok && bad.issue.message).toContain("через «×», например 1200×800×1600");
    expect(coerce(dims, "1200×-5×10").ok).toBe(false);
  });

  it("текст: обрезка пробелов, число как строка, длиннее 500 символов — ошибка", () => {
    expect(coerce(text, " 1С:ERP ")).toEqual({ ok: true, value: "1С:ERP" });
    expect(coerce(text, 8)).toEqual({ ok: true, value: "8" });
    const long = coerce(text, "x".repeat(501));
    expect(!long.ok && long.issue.message).toContain("сократите до 500 символов");
  });

  it("пустое значение → null без проблемы (решает validate)", () => {
    expect(coerce(area, "")).toEqual({ ok: true, value: null });
    expect(coerce(area, null)).toEqual({ ok: true, value: null });
    expect(coerce(area, "-")).toEqual({ ok: true, value: null });
    expect(coerce(text, "-")).toEqual({ ok: true, value: "-" });
  });

  it("апостроф защиты от формул снимается", () => {
    expect(coerce(temp, "'-25")).toEqual({ ok: true, value: -25 });
  });

  it("дописанная единица-синоним срезается: «м2», «кв. м», «шт» для «шт.»", () => {
    expect(coerce(area, "20 000 м2")).toEqual({ ok: true, value: 20000 });
    expect(coerce(area, "20000кв. м")).toEqual({ ok: true, value: 20000 });
    expect(coerce(area, "20 000 м?")).toEqual({ ok: true, value: 20000 });
    expect(coerce(floors, "2 шт")).toEqual({ ok: true, value: 2 });
    expect(coerce(pct, "7%")).toEqual({ ok: true, value: 7 });
    const money = spec({ key: "salary", unit: "руб./мес." });
    expect(coerce(money, "2 700 000,00 руб.")).toEqual({ ok: false, issue: expect.objectContaining({ code: "unit_mismatch" }) });
    expect(coerce(money, "130 000 ₽/мес")).toEqual({ ok: true, value: 130000 });
  });

  it("дописанная чужая единица → unit_mismatch с подсказкой, а не «не число»", () => {
    const a = coerce(area, "2 га", 5);
    expect(a).toEqual({
      ok: false,
      issue: {
        key: "totalAreaM2",
        label: "Общая площадь склада",
        code: "unit_mismatch",
        severity: "error",
        message: "Общая площадь склада: единица «га» не совпадает с «м²» — пересчитайте значение в м²",
        row: 5,
      },
    });
    const b = coerce(area, "7%");
    expect(!b.ok && b.issue.code).toBe("unit_mismatch");
    const d = coerce(dims, "120×80×160 см");
    expect(!d.ok && d.issue.code).toBe("unit_mismatch");
  });

  it("хвост, который не единица, — ошибка формата, как раньше", () => {
    const factor = spec({ key: "peakFactor", label: "Пиковый коэффициент", min: 1.2, max: 2.5 });
    for (const [def, raw] of [
      [factor, "1,5 раза"],
      [factor, "150%"],
      [area, "1200x800"],
      [area, "1E+05"],
      [area, "12,5,3 м²"],
    ] as const) {
      const r = coerce(def, raw);
      expect(!r.ok && r.issue.code, raw).toBe("bad_number_format");
    }
  });

  it("CSV из русского Excel (Windows-1251): «?» вместо «×» в габаритах и вместо «−» в варианте", () => {
    expect(coerce(dims, "1200?800?1600")).toEqual({ ok: true, value: "1200×800×1600" });
    expect(coerce(dims, "300\uFFFD200\uFFFD150")).toEqual({ ok: true, value: "300×200×150" });
    const regime = spec({
      key: "storageTempRegime",
      kind: "enum",
      options: ["Нормальный (+5…+25 °C)", "Охлаждаемый (0…+5 °C)", "Морозильный (ниже −18 °C)"],
    });
    expect(coerce(regime, "Морозильный (ниже ?18 °C)")).toEqual({ ok: true, value: "Морозильный (ниже −18 °C)" });
    const ambiguous = spec({ key: "cls", kind: "enum", options: ["Класс A1", "Класс A2"] });
    expect(!coerce(ambiguous, "Класс A?").ok).toBe(true);
    expect(!coerce(regime, "Морозильный (ниже ?20 °C)").ok).toBe(true);
  });
});

describe("isOutOfRange", () => {
  const d = spec({ key: "x", min: 1.5, max: 4.5 });

  it("границы включительно, с допуском на двоичную арифметику", () => {
    expect(isOutOfRange(d, 1.5)).toBe(false);
    expect(isOutOfRange(d, 4.5)).toBe(false);
    expect(isOutOfRange(d, 0.1 + 0.2 + 4.2)).toBe(false);
    expect(isOutOfRange(d, 1.4)).toBe(true);
    expect(isOutOfRange(d, 4.6)).toBe(true);
  });

  it("односторонний диапазон и не числа", () => {
    expect(isOutOfRange(spec({ key: "y", min: 0 }), 1e9)).toBe(false);
    expect(isOutOfRange(spec({ key: "y", max: 10 }), 11)).toBe(true);
    expect(isOutOfRange(d, "abc")).toBe(false);
    expect(isOutOfRange(d, null)).toBe(false);
  });
});

describe("единицы", () => {
  it("синонимы организатора и наших описаний совпадают", () => {
    expect(normalizeUnit("руб./мес.")).toBe(normalizeUnit("₽/мес"));
    expect(normalizeUnit("млн руб.")).toBe(normalizeUnit("млн ₽"));
    expect(normalizeUnit("м/п")).toBe(normalizeUnit("паллетомест"));
    expect(normalizeUnit("мм/2м")).toBe(normalizeUnit("мм/2 м"));
    expect(normalizeUnit("поддон/сут")).toBe(normalizeUnit("паллет/сутки"));
    expect(normalizeUnit("м2")).toBe("м²");
    expect(normalizeUnit("кв. м")).toBe("м²");
    expect(normalizeUnit("-")).toBe("");
  });

  it("совместимы, если одна не указана; «тыс. руб.» ≠ «руб.»", () => {
    expect(unitsCompatible("", "м²")).toBe(true);
    expect(unitsCompatible("-", "м²")).toBe(true);
    expect(unitsCompatible("м²", null)).toBe(true);
    expect(unitsCompatible("м", "м²")).toBe(false);
    expect(unitsCompatible("тыс. руб./мес.", "руб./мес.")).toBe(false);
  });

  it("знак, потерянный в Windows-1251 («?», U+FFFD), совпадает с любым одним символом", () => {
    expect(unitsCompatible("м?", "м²")).toBe(true);
    expect(unitsCompatible("м\uFFFD", "м²")).toBe(true);
    expect(unitsCompatible("м?", "м2")).toBe(true);
    expect(unitsCompatible("м?", "кв. м")).toBe(true);
    expect(unitsCompatible("?/мес", "руб./мес.")).toBe(true);
    expect(unitsCompatible("м?/ч", "м²/ч")).toBe(true);
    expect(unitsCompatible("м?", "м")).toBe(false);
    expect(unitsCompatible("м?", "кг")).toBe(false);
    expect(unitsCompatible("тыс. м?", "м²")).toBe(false);
  });
});

describe("служебные проверки", () => {
  it("isBlank: прочерк пуст только для чисел и габаритов", () => {
    expect(isBlank(spec({ key: "a" }), " — ")).toBe(true);
    expect(isBlank(spec({ key: "a", kind: "text" }), "-")).toBe(false);
    expect(isBlank(spec({ key: "a", kind: "text" }), "  ")).toBe(true);
    expect(isBlank(spec({ key: "a" }), 0)).toBe(false);
  });

  it("sameParamValue: числа с допуском, строки без регистра", () => {
    expect(sameParamValue(1.302, 1.302000000001)).toBe(true);
    expect(sameParamValue("да", "Да")).toBe(true);
    expect(sameParamValue(365, 366)).toBe(false);
    expect(sameParamValue(null, null)).toBe(true);
  });
});
