import { describe, expect, it } from "vitest";

import {
  SLUG_RE,
  cutDescription,
  formatExample,
  parseNumericText,
  parseRuNumber,
  parseTempRange,
  slugify,
  typicalOf,
} from "./parse";

describe("parseRuNumber", () => {
  it("читает цены каталога и русскую запись чисел", () => {
    expect(parseRuNumber("2 700 000,00")).toBe(2700000);
    expect(parseRuNumber("2 700 000")).toBe(2700000);
    expect(parseRuNumber("1,302")).toBe(1.302);
    expect(parseRuNumber("1.5")).toBe(1.5);
    expect(parseRuNumber("−25")).toBe(-25);
  });

  it("не принимает текст и несколько чисел", () => {
    expect(parseRuNumber("по запросу")).toBeNull();
    expect(parseRuNumber("1044×654×380")).toBeNull();
    expect(parseRuNumber("")).toBeNull();
  });
});

describe("parseNumericText", () => {
  it("число с единицей и пояснением в скобках", () => {
    expect(parseNumericText("1500")).toBe(1500);
    expect(parseNumericText("0,75 (750 мм)")).toBe(0.75);
    expect(parseNumericText("±10")).toBe(10);
    expect(parseNumericText("5 лет")).toBe(5);
    expect(parseNumericText("120 (в источнике — «2 часа»; на kiit.ru уточнено: 10–80% за ≤2 ч)")).toBe(120);
    expect(parseNumericText(4.17)).toBe(4.17);
  });

  it("«до X» и «от X» сохраняют оговорку, «≈» — приблизительное значение", () => {
    expect(parseNumericText("до 10")).toEqual({ max: 10, typical: 10, qualifier: "до" });
    expect(parseNumericText("до 10 (с 80% до 20% заряда)")).toEqual({ max: 10, typical: 10, qualifier: "до" });
    expect(parseNumericText("от 100 000")).toEqual({ min: 100000, typical: 100000, qualifier: "от" });
    expect(parseNumericText("≈300 000 (≈10% стоимости робота в год)")).toEqual({ typical: 300000, qualifier: "≈" });
  });

  it("диапазоны «A–B» и «A / B» → середина как типичное значение", () => {
    expect(parseNumericText("1.4–7")).toEqual({ min: 1.4, max: 7, typical: 4.2 });
    expect(parseNumericText("6–8")).toEqual({ min: 6, max: 8, typical: 7 });
    expect(parseNumericText("20 (при средних нагрузках) / 10 (при максимальных нагрузках)")).toEqual({
      min: 10,
      max: 20,
      typical: 15,
    });
  });

  it("текст, который не сводится к одному числу, остаётся текстом (null)", () => {
    expect(parseNumericText("60 (быстрый режим), 120 (стандартный режим)")).toBeNull();
    expect(parseNumericText("24/7 с автоматической подзарядкой")).toBeNull();
    expect(parseNumericText("Пусконаладка от 100 000 ₽")).toBeNull();
    expect(parseNumericText("1044×654×380")).toBeNull();
    expect(parseNumericText(null)).toBeNull();
  });

  it("typicalOf отдаёт типичное значение числа и диапазона", () => {
    expect(typicalOf(5)).toBe(5);
    expect(typicalOf({ min: 80, max: 100, typical: 90 })).toBe(90);
  });
});

describe("parseTempRange", () => {
  it("находит диапазон температур в тексте условий эксплуатации", () => {
    expect(parseTempRange("+5…+25 °C, ровный промышленный пол")).toEqual({ min: 5, max: 25 });
    expect(parseTempRange("Рабочая температура: от +5°C до +40°C; IP54")).toEqual({ min: 5, max: 40 });
    expect(parseTempRange("от –10 ˚С до +40 ˚С, влажность не более 95%")).toEqual({ min: -10, max: 40 });
    expect(parseTempRange("работа 24/7 при температуре примерно −40…+50 °C")).toEqual({ min: -40, max: 50 });
  });

  it("одна граница — не диапазон", () => {
    expect(parseTempRange("Работа в морозильных камерах до −35 °C")).toBeNull();
    expect(parseTempRange("твёрдые полы помещений")).toBeNull();
  });
});

describe("slugify и cutDescription", () => {
  it("транслитерирует название до скобки в kebab-case", () => {
    expect(slugify("Ronavi H1500 (грузоподъемность до 1 500 кг)")).toBe("ronavi-h1500");
    expect(slugify("Робот-штабелёр RoboCV")).toBe("robot-shtabeler-robocv");
    expect(slugify("Беспилотный «Львёнок-Москва»")).toMatch(SLUG_RE);
    expect(slugify("(((")).toBe("");
  });

  it("обрезает описание по границе слова не длиннее 200 символов", () => {
    const long = "слово ".repeat(80);
    const cut = cutDescription(long);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith("…")).toBe(true);
    expect(cutDescription("  коротко \n и ясно ")).toBe("коротко и ясно");
  });
});

describe("formatExample", () => {
  it("пример для поля: разряды через пробел, дробная часть через запятую", () => {
    expect(formatExample(1000)).toBe("например, 1 000");
    expect(formatExample(20000)).toBe("например, 20 000");
    expect(formatExample(1.302)).toBe("например, 1,302");
    expect(formatExample(-25)).toBe("например, −25");
    expect(formatExample("1200×800×1600")).toBe("например, 1200×800×1600");
  });
});
