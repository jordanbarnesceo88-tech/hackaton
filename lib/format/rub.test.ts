import { describe, it, expect } from "vitest";
import { formatMRub, formatNum, formatPct, formatRub } from "./rub";

/**
 * ICU ставит неразрывный пробел (U+00A0) между группами разрядов; такие строки сравниваем после
 * замены на обычный пробел, чтобы тест не зависел от версии ICU. Пробел перед единицей —
 * обычный (U+0020) по контракту, его проверяют буквальные сравнения ниже.
 */
const norm = (s: string) => s.replace(/\s/g, " ");

/** В строке нет неразрывных и узких пробелов (записаны escape-последовательностями, чтобы их было видно). */
const NON_ASCII_SPACE = /[\u00a0\u202f\u2009]/;

describe("formatRub", () => {
  it("рубли без копеек с разделителем разрядов и знаком ₽", () => {
    expect(norm(formatRub(2_700_000))).toBe("2 700 000 ₽");
    expect(norm(formatRub(35_420_000))).toBe("35 420 000 ₽");
    expect(norm(formatRub(0))).toBe("0 ₽");
  });

  it("округляет до рубля и не показывает «-0»", () => {
    expect(norm(formatRub(1_874_880.4))).toBe("1 874 880 ₽");
    expect(norm(formatRub(-0.3))).toBe("0 ₽");
    expect(norm(formatRub(-0))).toBe("0 ₽");
  });

  it("отрицательные суммы — со знаком минус", () => {
    expect(norm(formatRub(-640_375))).toMatch(/^-\s?640 375 ₽$|^−640 375 ₽$/);
  });

  it("перед ₽ обычный пробел U+0020, разряды разделяет ICU", () => {
    expect(formatRub(100)).toBe("100 ₽");
    expect(formatRub(100)).not.toMatch(NON_ASCII_SPACE);
    expect(formatRub(2_700_000)).toMatch(/^2\s700\s000\u0020₽$/);
  });

  it("нечисловой вход — прочерк", () => {
    expect(formatRub(NaN)).toBe("—");
    expect(formatRub(Infinity)).toBe("—");
    expect(formatRub(null)).toBe("—");
    expect(formatRub(undefined)).toBe("—");
  });
});

describe("formatMRub", () => {
  it("контракт T0.1 выполняется буквально, без нормализации пробелов", () => {
    expect(formatMRub(35_420_000)).toBe("35,4 млн ₽");
    expect(formatMRub(35_420_000)).not.toMatch(NON_ASCII_SPACE);
    expect(formatMRub(234_360_000)).toBe("234,4 млн ₽");
  });

  it("от 10 млн — в миллионах с одним знаком", () => {
    expect(norm(formatMRub(10_000_000))).toBe("10,0 млн ₽");
    expect(norm(formatMRub(1_234_000_000))).toBe("1 234,0 млн ₽");
    expect(norm(formatMRub(-46_872_000))).toMatch(/46,9 млн ₽$/);
  });

  it("меньше 10 млн — полностью, как formatRub", () => {
    expect(norm(formatMRub(9_804_506))).toBe("9 804 506 ₽");
    expect(norm(formatMRub(640_375))).toBe("640 375 ₽");
  });

  it("нечисловой вход — прочерк", () => {
    expect(formatMRub(NaN)).toBe("—");
    expect(formatMRub(-Infinity)).toBe("—");
  });
});

describe("formatNum", () => {
  it("по умолчанию без дробной части, с разделителем разрядов", () => {
    expect(norm(formatNum(129.545))).toBe("130");
    expect(norm(formatNum(8030))).toBe("8 030");
  });

  it("заданное число знаков и десятичная запятая", () => {
    expect(formatNum(2.9, 1)).toBe("2,9");
    expect(formatNum(9.8204, 2)).toBe("9,82");
    expect(formatNum(3, 1)).toBe("3,0");
  });

  it("не показывает «-0» после округления", () => {
    expect(formatNum(-0.0004, 2)).toBe("0,00");
  });

  it("нечисловой вход — прочерк", () => {
    expect(formatNum(NaN, 2)).toBe("—");
  });
});

describe("formatPct", () => {
  it("значение уже в процентах: 140,31 → «140 %»; перед % обычный пробел", () => {
    expect(formatPct(140.31)).toBe("140 %");
    expect(formatPct(140.31)).not.toMatch(NON_ASCII_SPACE);
    expect(formatPct(77.5, 1)).toBe("77,5 %");
  });

  it("нечисловой вход — прочерк", () => {
    expect(formatPct(Infinity)).toBe("—");
    expect(formatPct(null)).toBe("—");
  });
});
