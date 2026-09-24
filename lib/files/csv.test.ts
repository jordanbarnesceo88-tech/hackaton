import { describe, it, expect } from "vitest";
import {
  decodeText,
  detectCsvSeparator,
  formatCsvNumber,
  guardFormula,
  parseCsv,
  parseRuNumber,
  stripFormulaGuard,
  toCsv,
} from "./csv";

describe("parseRuNumber", () => {
  it("разбирает цену каталога организатора «2 700 000,00»", () => {
    expect(parseRuNumber("2 700 000,00")).toBe(2700000);
  });

  it("понимает неразрывный, узкий и тонкий пробелы как разделители групп", () => {
    expect(parseRuNumber("2 700 000")).toBe(2700000);
    expect(parseRuNumber("2 700 000,5")).toBe(2700000.5);
    expect(parseRuNumber("1 302,5")).toBe(1302.5);
  });

  it("одна запятая или одна точка — десятичный знак", () => {
    expect(parseRuNumber("1,302")).toBe(1.302);
    expect(parseRuNumber("1.302")).toBe(1.302);
    expect(parseRuNumber("3,5")).toBe(3.5);
    expect(parseRuNumber(",5")).toBe(0.5);
  });

  it("запятая и точка вместе: последний знак — десятичный", () => {
    expect(parseRuNumber("2.700.000,00")).toBe(2700000);
    expect(parseRuNumber("2,700,000.25")).toBe(2700000.25);
    expect(parseRuNumber("2.70.000,00")).toBeNull();
  });

  it("несколько точек — только группы по три цифры", () => {
    expect(parseRuNumber("2.700.000")).toBe(2700000);
    expect(parseRuNumber("1.2.3")).toBeNull();
  });

  it("минус: обычный и типографский", () => {
    expect(parseRuNumber("-25")).toBe(-25);
    expect(parseRuNumber("−25")).toBe(-25);
    expect(parseRuNumber("+5")).toBe(5);
  });

  it("не число → null", () => {
    for (const s of ["", "   ", "abc", "12,5,3", "1e3", "10%", "12 м", ",", "-", "2,700,000"]) {
      expect(parseRuNumber(s), s).toBeNull();
    }
    expect(parseRuNumber(null)).toBeNull();
    expect(parseRuNumber(undefined)).toBeNull();
    expect(parseRuNumber({})).toBeNull();
    expect(parseRuNumber(Number.NaN)).toBeNull();
    expect(parseRuNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("число проходит как есть, −0 становится 0", () => {
    expect(parseRuNumber(1.302)).toBe(1.302);
    expect(Object.is(parseRuNumber(-0), 0)).toBe(true);
    expect(Object.is(parseRuNumber("-0"), 0)).toBe(true);
  });
});

describe("toCsv", () => {
  it("BOM, «;», CRLF и десятичная запятая", () => {
    const csv = toCsv([
      ["Ключ", "Значение"],
      ["payrollTaxMultiplier", 1.302],
      ["totalAreaM2", 20000],
    ]);
    expect(csv).toBe("﻿Ключ;Значение\r\npayrollTaxMultiplier;1,302\r\ntotalAreaM2;20000");
  });

  it("кавычки при «;», кавычке и переводе строки, внутренние кавычки удваиваются", () => {
    const csv = toCsv([["a;b", 'ООО "Р2Б"', "две\nстроки", "a,b"]]);
    expect(csv).toBe('﻿"a;b";"ООО ""Р2Б""";"две\nстроки";a,b');
  });

  it("с разделителем «,» число с десятичной запятой берётся в кавычки", () => {
    expect(toCsv([["x", 1.5]], { separator: "," })).toBe('﻿x,"1,5"');
    expect(toCsv([["x", 1.5]], { separator: ",", decimalComma: false })).toBe("﻿x,1.5");
  });

  it("защита от формул: текст с = + - @ получает апостроф, отрицательные числа — нет", () => {
    const csv = toCsv([["=SUM(A1)", "+7", "-5", "@x", " =1", -5, "−5"]]);
    expect(csv).toBe("﻿'=SUM(A1);'+7;'-5;'@x;' =1;-5;−5");
  });

  it("null, undefined, NaN и ±∞ — пустые ячейки; −0 — «0»", () => {
    expect(toCsv([[null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0]])).toBe("﻿;;;;0");
  });

  it("числа без экспоненты и без разделителей групп", () => {
    expect(formatCsvNumber(1e-7)).toBe("0,0000001");
    expect(formatCsvNumber(1e21, false)).toBe("1000000000000000000000");
    expect(formatCsvNumber(46872000)).toBe("46872000");
  });
});

describe("guardFormula / stripFormulaGuard", () => {
  it("'=SUM(A1)' получает апостроф и снимается обратно", () => {
    expect(guardFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(stripFormulaGuard("'=SUM(A1)")).toBe("=SUM(A1)");
  });

  it("табуляция и CR в начале тоже экранируются", () => {
    expect(guardFormula("\t=1")).toBe("'\t=1");
    expect(guardFormula("\rx")).toBe("'\rx");
  });

  it("обычный текст и апостроф перед обычным текстом не трогаются", () => {
    expect(guardFormula("Склад")).toBe("Склад");
    expect(stripFormulaGuard("'Склад")).toBe("'Склад");
  });
});

describe("parseCsv", () => {
  it("срезает BOM и определяет «;»", () => {
    expect(parseCsv("﻿a;b\r\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("определяет «,», если запятых больше", () => {
    expect(detectCsvSeparator("a,b,c\n1,2,3")).toBe(",");
    expect(parseCsv('a,b\n"1,5",2')).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });

  it("при равенстве и в пустом файле — «;», при одних табуляциях — табуляция", () => {
    expect(detectCsvSeparator("a;b,c")).toBe(";");
    expect(detectCsvSeparator("")).toBe(";");
    expect(detectCsvSeparator("a\tb\n1\t2")).toBe("\t");
  });

  it("поля в кавычках: разделители, удвоенные кавычки, переводы строк", () => {
    expect(parseCsv('"a;b";"ООО ""Р2Б""";"две\r\nстроки";x')).toEqual([["a;b", 'ООО "Р2Б"', "две\r\nстроки", "x"]]);
  });

  it("LF, CR и CRLF; перевод строки в конце не даёт лишней записи; пустая строка — [\"\"]", () => {
    expect(parseCsv("a;b\n1;2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\rb")).toEqual([["a"], ["b"]]);
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv('""')).toEqual([[""]]);
  });

  it("пустые поля сохраняются", () => {
    expect(parseCsv(";a;;")).toEqual([["", "a", "", ""]]);
  });
});

describe("CSV: туда и обратно", () => {
  it("toCsv → parseCsv возвращает те же ячейки (числа — с десятичной запятой)", () => {
    const rows = [
      ["Ключ", "Раздел", "Значение", "Примечание"],
      ["payrollTaxMultiplier", "Персонал; ФОТ", 1.302, 'ОПФ 22 %, "ОМС" 5,1 %'],
      ["formula", "x", "=SUM(A1)", "две\nстроки"],
      ["neg", "y", -25, null],
    ];
    const back = parseCsv(toCsv(rows));
    expect(back).toEqual([
      ["Ключ", "Раздел", "Значение", "Примечание"],
      ["payrollTaxMultiplier", "Персонал; ФОТ", "1,302", 'ОПФ 22 %, "ОМС" 5,1 %'],
      ["formula", "x", "'=SUM(A1)", "две\nстроки"],
      ["neg", "y", "-25", ""],
    ]);
    expect(stripFormulaGuard(back[2]?.[2] ?? "")).toBe("=SUM(A1)");
    expect(parseRuNumber(back[1]?.[2])).toBe(1.302);
  });
});

describe("decodeText", () => {
  const text = "Параметр;Базовое значение\r\nОбщая площадь склада;20000";

  it("UTF-8 с BOM и без", () => {
    const bytes = new TextEncoder().encode(`﻿${text}`);
    expect(decodeText(bytes)).toBe(text);
    expect(decodeText(new TextEncoder().encode(text))).toBe(text);
  });

  it("Windows-1251 из русского Excel", () => {
    // «Склад» в cp1251: D1 EA EB E0 E4.
    const bytes = new Uint8Array([0xd1, 0xea, 0xeb, 0xe0, 0xe4, 0x3b, 0x31]);
    expect(decodeText(bytes)).toBe("Склад;1");
  });

  it("UTF-16 LE с BOM («Текст Юникод»)", () => {
    const units = [0xfeff, ...Array.from("Склад\t1", (c) => c.charCodeAt(0))];
    const bytes = new Uint8Array(units.length * 2);
    units.forEach((u, i) => {
      bytes[i * 2] = u & 0xff;
      bytes[i * 2 + 1] = u >> 8;
    });
    expect(decodeText(bytes)).toBe("Склад\t1");
    expect(parseCsv(decodeText(bytes))).toEqual([["Склад", "1"]]);
  });
});
