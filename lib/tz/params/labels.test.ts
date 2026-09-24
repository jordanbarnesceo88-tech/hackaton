import { describe, it, expect } from "vitest";
import { coreLabel, matchLabelsToDefs, normalizeLabel } from "./labels";
import { spec, WAREHOUSE_ROWS, warehouseDefs } from "./test-fixtures";

describe("normalizeLabel / coreLabel", () => {
  it("регистр, «ё», знаки препинания", () => {
    expect(normalizeLabel("Объём приёмки (поддоны/сутки)")).toBe("объем приемки поддоны сутки");
    expect(normalizeLabel("  Наличие ERP/1С ")).toBe("наличие erp 1с");
  });

  it("суть: без скобок и «Из них:»", () => {
    expect(coreLabel("Из них: отборщики (комплектовщики)")).toBe("отборщики");
    expect(coreLabel("Коэффициент начислений на ФОТ (страховые взносы)")).toBe("коэффициент начислений на фот");
  });
});

describe("matchLabelsToDefs", () => {
  it("все 42 строки листа «Склад» организатора находят свои параметры по коротким подписям", () => {
    const defs = warehouseDefs();
    const rows = WAREHOUSE_ROWS.map(([, label, unit]) => ({ label, unit }));
    const matched = matchLabelsToDefs(rows, defs);
    expect(matched.map((d) => d?.key ?? null)).toEqual(defs.map((d) => d.key));
  });

  it("два «Объёма отбора» различаются по уточнению в скобках и единице", () => {
    const defs = [
      spec({ key: "pickLinesPerDay", label: "Объём отбора (строк/сутки)", unit: "строк/сут" }),
      spec({ key: "pickUnitsPerDay", label: "Объём отбора (штук/сутки)", unit: "шт./сут" }),
    ];
    const m = matchLabelsToDefs(
      [
        { label: "Объём отбора (штук/сутки, всего)", unit: "шт./сут" },
        { label: "Объём отбора (строк/сутки, всего)", unit: "строк/сут" },
      ],
      defs,
    );
    expect(m.map((d) => d?.key)).toEqual(["pickUnitsPerDay", "pickLinesPerDay"]);
  });

  it("точный повтор названия сопоставляется с тем же параметром (для duplicate_key)", () => {
    const defs = [spec({ key: "a", label: "Общая площадь склада" })];
    const m = matchLabelsToDefs([{ label: "Общая площадь склада" }, { label: "общая  площадь склада" }], defs);
    expect(m.map((d) => d?.key)).toEqual(["a", "a"]);
  });

  it("ключ вместо названия тоже узнаётся", () => {
    const defs = [spec({ key: "totalAreaM2", label: "Общая площадь склада" })];
    expect(matchLabelsToDefs([{ label: "totalAreaM2" }], defs)[0]?.key).toBe("totalAreaM2");
  });

  it("одно общее слово — не сопоставление", () => {
    const defs = [spec({ key: "hasWms", label: "Наличие WMS" })];
    expect(matchLabelsToDefs([{ label: "Наличие ERP/1С" }], defs)).toEqual([null]);
  });

  it("единственный кандидат с чужой единицей сопоставляется — проверка сообщит unit_mismatch", () => {
    const defs = [
      spec({ key: "hasWms", label: "Наличие WMS" }),
      spec({ key: "area", label: "Общая площадь склада", unit: "м²" }),
      spec({ key: "inbound", label: "Объём приёмки", unit: "поддон/сут" }),
    ];
    const m = matchLabelsToDefs(
      [
        // Проход 3 (общие основы слов).
        { label: "Общая площадь склада, тыс.", unit: "тыс. м²" },
        // Проход 2 (суть без скобок).
        { label: "Объём приёмки (поддоны/час)", unit: "поддон/ч" },
      ],
      defs,
    );
    expect(m.map((d) => d?.key ?? null)).toEqual(["area", "inbound"]);
  });

  it("ничья между кандидатами — не сопоставление", () => {
    const defs = [
      spec({ key: "a", label: "Средняя масса паллеты" }),
      spec({ key: "b", label: "Средняя масса коробки" }),
    ];
    expect(matchLabelsToDefs([{ label: "Средняя масса" }], defs)).toEqual([null]);
  });

  it("ничью разбивает совместимая единица", () => {
    const defs = [
      spec({ key: "a", label: "Средняя масса паллеты", unit: "кг" }),
      spec({ key: "b", label: "Средняя масса коробки", unit: "г" }),
    ];
    expect(matchLabelsToDefs([{ label: "Средняя масса", unit: "кг" }], defs)[0]?.key).toBe("a");
  });

  it("название с «?» вместо «×» и «²» (CSV из русского Excel) совпадает точно", () => {
    const defs = [
      spec({ key: "palletDimsMm", label: "Средние габариты паллеты (Д×Ш×В)", kind: "dims", unit: "мм" }),
      spec({ key: "hall", label: "Площадь зала (м²)", unit: "м²" }),
    ];
    const m = matchLabelsToDefs(
      [
        { label: "Средние габариты паллеты (Д?Ш?В)", unit: "мм" },
        { label: "Площадь зала (м?)", unit: "м?" },
      ],
      defs,
    );
    expect(m.map((d) => d?.key ?? null)).toEqual(["palletDimsMm", "hall"]);
  });
});
