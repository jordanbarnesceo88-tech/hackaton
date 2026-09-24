import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import type { ParamSpec } from "../types";
import { parseCsv } from "../../files/csv";
import { parseParamsFile, UNSUPPORTED_FILE_MESSAGE, type ParsedParamsFile } from "./import";
import { paramsTemplateCsv, TEMPLATE_HEADERS } from "./template";
import { readWorkbook, writeParamsTemplateXlsx } from "./xlsx";
import { encodeCp1251, spec, WAREHOUSE_ROWS, warehouseDefs, type OrganizerRow } from "./test-fixtures";

const defs = warehouseDefs();
const baseValues = Object.fromEntries(defs.map((d) => [d.key, d.base]));

function ok(r: ParsedParamsFile): Extract<ParsedParamsFile, { ok: true }> {
  if (!r.ok) throw new Error(`ожидался успешный разбор, получено: ${r.message}`);
  return r;
}

const encode = (s: string) => new TextEncoder().encode(s);

/**
 * Книга в раскладке датасета организатора: строка 1 — объединённый заголовок, строка 2 —
 * «Параметр | Ед. изм. | Базовое значение | Диапазон (min) | Диапазон (max) | Примечание…»,
 * затем разделы «▌ …» (объединённые ячейки) и строки параметров. Заголовки столбцов — как в
 * Датасеты_хакатон.xlsx.
 */
async function organizerWorkbook(
  sheets: { name: string; rows: readonly OrganizerRow[] }[],
  withLegend = true,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow([`ДЕМО-ДАТАСЕТ: ${s.name.toUpperCase()} (объект для расчёта роботизации)`]);
    ws.mergeCells("A1:F1");
    ws.addRow(["Параметр", "Ед. изм.", "Базовое значение", "Диапазон (min)", "Диапазон (max)", "Примечание / источник допущения"]);
    let section = "";
    for (const [sec, label, unit, base, min, max] of s.rows) {
      if (sec !== section) {
        section = sec;
        const r = ws.addRow([`▌ ${sec}`]);
        ws.mergeCells(r.number, 1, r.number, 6);
      }
      ws.addRow([label, unit, base, min, max, "примечание"]);
    }
  }
  if (withLegend) {
    const legend = wb.addWorksheet("Легенда и использование");
    legend.addRow(["ЛЕГЕНДА И ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ ДАТАСЕТОВ"]);
    legend.addRow(["Базовое значение", "Типичный объект. Используется для демо-расчёта на хакатоне."]);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("шаблон параметров", () => {
  it("CSV: BOM и заголовок «Ключ;Раздел;…», значения по умолчанию в столбце «Значение»", () => {
    const csv = paramsTemplateCsv(defs);
    expect(csv.startsWith(`﻿${TEMPLATE_HEADERS.join(";")}\r\n`)).toBe(true);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(defs.length + 1);
    const payroll = rows.find((r) => r[0] === "payrollTaxMultiplier");
    expect(payroll?.[4]).toBe("1,302");
    expect(payroll?.[9]).toContain("Зафиксировано организатором");
    expect(rows.find((r) => r[0] === "totalAreaM2")?.[9]).toBe("Организатор: Датасеты_хакатон.xlsx › Склад");
  });

  it("CSV-шаблон → разбор (раскладка template) → значения равны базовым, отчёт «ок»", async () => {
    const r = ok(await parseParamsFile(encode(paramsTemplateCsv(defs)), "Шаблон.csv", defs));
    expect(r.layout).toBe("template");
    expect(r.sheetName).toBeNull();
    expect(r.values).toEqual(baseValues);
    expect(r.found).toBe(42);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
    expect(r.report.every((i) => i.code === "ok")).toBe(true);
  });

  it("XLSX-шаблон: лист «Параметры», закреплённая строка заголовков, ширины, выпадающие списки", async () => {
    const bytes = await writeParamsTemplateXlsx(defs);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.slice().buffer);
    const ws = wb.getWorksheet("Параметры");
    expect(ws).toBeDefined();
    if (!ws) return;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getRow(1).values).toEqual([undefined, ...TEMPLATE_HEADERS]);
    expect(ws.getColumn(3).width).toBeGreaterThan(30);
    const floorRow = ws.getColumn(1).values.findIndex((v) => v === "floorType");
    expect(ws.getCell(floorRow, 5).dataValidation).toMatchObject({ type: "list" });
    const areaRow = ws.getColumn(1).values.findIndex((v) => v === "totalAreaM2");
    expect(ws.getCell(areaRow, 5).value).toBe(20000);
    expect(wb.getWorksheet("Как заполнить")).toBeDefined();
  });

  it("XLSX-шаблон → разбор (раскладка template) → значения равны базовым", async () => {
    const r = ok(await parseParamsFile(await writeParamsTemplateXlsx(defs), "Шаблон параметров — Склад.xlsx", defs));
    expect(r.layout).toBe("template");
    expect(r.sheetName).toBe("Параметры");
    expect(r.values).toEqual(baseValues);
    expect(r.errors).toBe(0);
  });

  it("XLSX-шаблон: «7%», введённые в Excel (0,07 в формате «0%»), читаются как 7, а не 0,07", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await writeParamsTemplateXlsx(defs)).slice().buffer);
    const ws = wb.getWorksheet("Параметры");
    if (!ws) throw new Error("нет листа «Параметры»");
    const rowOf = (key: string) => ws.getColumn(1).values.findIndex((v) => v === key);
    const set = (key: string, value: number, numFmt: string) => {
      const c = ws.getCell(rowOf(key), 5);
      c.value = value;
      // Свой объект стиля: после загрузки exceljs делит один стиль между ячейками.
      c.style = { ...c.style, numFmt };
    };
    set("nonStandardCargoPct", 0.07, "0%");
    set("piecePickSharePct", 0.355, "0.0%");
    set("fastMoverSkuSharePct", 0.25, "General");
    set("totalAreaM2", 0.5, "0%");
    const r = ok(await parseParamsFile(new Uint8Array(await wb.xlsx.writeBuffer()), "p.xlsx", defs));
    expect(r.values.nonStandardCargoPct).toBe(7);
    expect(r.values.piecePickSharePct).toBe(35.5);
    // Без процентного формата число берётся как есть: 0,25 % — вне диапазона, предупреждение.
    expect(r.values.fastMoverSkuSharePct).toBe(0.25);
    expect(r.report.find((i) => i.key === "fastMoverSkuSharePct")).toMatchObject({ code: "out_of_range" });
    // Процент в поле площади — чужая единица.
    expect(r.report.find((i) => i.key === "totalAreaM2")).toMatchObject({ code: "unit_mismatch", severity: "error" });
    expect(r.errors).toBe(1);
  });

  it("правка значения и единицы в шаблоне: новое значение принято, чужая единица — ошибка", async () => {
    const rows = parseCsv(paramsTemplateCsv(defs));
    for (const row of rows) {
      if (row[0] === "forkliftSalaryRubMonth") row[4] = "135 000";
      if (row[0] === "totalAreaM2") row[3] = "га";
    }
    const text = rows.map((r) => r.map((c) => (/[;"\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\r\n");
    const r = ok(await parseParamsFile(encode(text), "p.csv", defs));
    expect(r.values.forkliftSalaryRubMonth).toBe(135000);
    const unit = r.report.find((i) => i.key === "totalAreaM2");
    expect(unit).toMatchObject({ code: "unit_mismatch", severity: "error" });
    expect(unit?.message).toContain("пересчитайте значение в м²");
    expect(r.errors).toBe(1);
  });

  it("удалённые строки → «по умолчанию» с источником; неизвестный ключ → ошибка", async () => {
    const csv = [
      "Ключ;Параметр;Значение",
      "totalAreaM2;Общая площадь склада;25000",
      "robotsCount;Роботов;5",
    ].join("\r\n");
    const r = ok(await parseParamsFile(encode(csv), "p.csv", defs));
    expect(r.values.totalAreaM2).toBe(25000);
    expect(r.values.activeAreaM2).toBe(10000);
    expect(r.found).toBe(1);
    const def = r.report.find((i) => i.key === "activeAreaM2");
    expect(def).toMatchObject({ code: "defaulted", severity: "info" });
    expect(def?.message.replace(/\s/g, " ")).toBe(
      "Нет в файле — взято значение по умолчанию: 10 000 м² (Организатор, Датасеты_хакатон.xlsx › Склад)",
    );
    expect(r.report.find((i) => i.key === "robotsCount")).toMatchObject({
      code: "unknown_key",
      severity: "error",
      row: 3,
    });
  });

  it("стёртый ключ: строка сопоставляется по названию", async () => {
    const csv = ["Ключ;Параметр;Значение", ";Общая площадь склада;25000"].join("\n");
    const r = ok(await parseParamsFile(encode(csv), "p.csv", defs));
    expect(r.values.totalAreaM2).toBe(25000);
  });

  it("обязательный параметр без базы, отсутствующий в файле, — ошибка «не заполнено»", async () => {
    const withCleaners: ParamSpec[] = [...defs, spec({ key: "cleanersCount", label: "Уборщики", kind: "integer", order: 99 })];
    const r = ok(await parseParamsFile(encode(paramsTemplateCsv(withCleaners)), "p.csv", withCleaners));
    expect(r.report.find((i) => i.key === "cleanersCount")).toMatchObject({ code: "missing_required", severity: "error" });
  });
});

describe("лист датасета организатора", () => {
  it("находит лист «Склад» среди других, заголовок по «Параметр» и «Баз…», ≥ 40 сопоставлений", async () => {
    const airport: OrganizerRow[] = [["ОБЩИЕ ПАРАМЕТРЫ ОБЪЕКТА", "Суммарная площадь терминала (ов)", "м²", 85000, 8000, 500000]];
    const bytes = await organizerWorkbook([
      { name: "Склад", rows: WAREHOUSE_ROWS },
      { name: "Аэропорт", rows: airport },
    ]);
    const r = ok(await parseParamsFile(bytes, "Датасеты_хакатон.xlsx", defs));
    expect(r.layout).toBe("organizer");
    expect(r.sheetName).toBe("Склад");
    expect(r.found).toBeGreaterThanOrEqual(40);
    expect(r.found).toBe(42);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
    expect(r.values).toEqual(baseValues);
  });

  it("изменённые пользователем значения подхватываются, вне диапазона — предупреждение", async () => {
    const rows = WAREHOUSE_ROWS.map((row): OrganizerRow => {
      if (row[1] === "Средняя з/п оператора погрузчика (gross)") return [row[0], row[1], row[2], 135000, row[4], row[5]];
      if (row[1] === "Пиковый коэффициент нагрузки") return [row[0], row[1], row[2], "3,1", row[4], row[5]];
      return row;
    });
    const r = ok(await parseParamsFile(await organizerWorkbook([{ name: "Склад", rows }]), "склад.xlsx", defs));
    expect(r.values.forkliftSalaryRubMonth).toBe(135000);
    expect(r.values.peakFactor).toBe(3.1);
    expect(r.report.find((i) => i.key === "peakFactor")).toMatchObject({ code: "out_of_range", severity: "warning" });
  });

  it("CSV, сохранённый русским Excel из листа организатора (cp1251, «;»)", async () => {
    const lines = [
      "ДЕМО-ДАТАСЕТ: СКЛАД (объект для расчёта роботизации);;;;;",
      "Параметр;Ед. изм.;Базовое значение;Диапазон (min);Диапазон (max);Примечание / источник допущения",
      "▌ ПЕРСОНАЛ;;;;;",
      "Средняя з/п оператора погрузчика (gross);руб./мес.;130000;80000;170000;",
      "Коэффициент начислений на ФОТ (страховые взносы);-;1,302;1,302;1,302;",
    ];
    const bytes = encodeCp1251(lines.join("\r\n"));
    const r = ok(await parseParamsFile(bytes, "склад.csv", defs));
    expect(r.layout).toBe("organizer");
    expect(r.found).toBe(2);
    expect(r.values.forkliftSalaryRubMonth).toBe(130000);
    expect(r.values.payrollTaxMultiplier).toBe(1.302);
    expect(r.errors).toBe(0);
  });

  it("весь лист «Склад» в CSV русского Excel (cp1251): «м?» и «1200?800?1600» без ошибок", async () => {
    const q = (v: number | string) => {
      const s = typeof v === "number" ? String(v).replace(".", ",") : v;
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      "ДЕМО-ДАТАСЕТ: СКЛАД (объект для расчёта роботизации);;;;;",
      "Параметр;Ед. изм.;Базовое значение;Диапазон (min);Диапазон (max);Примечание / источник допущения",
    ];
    let section = "";
    for (const [sec, label, unit, base, min, max] of WAREHOUSE_ROWS) {
      if (sec !== section) {
        section = sec;
        lines.push(`▌ ${sec};;;;;`);
      }
      lines.push([label, unit, base, min, max, ""].map(q).join(";"));
    }
    const text = lines.join("\r\n");
    expect(text).toContain("м²");
    expect(text).toContain("1200×800×1600");
    const bytes = encodeCp1251(text);
    // Проверка самой фикстуры: так байты и выглядят после «Сохранить как CSV» в русском Excel.
    const decoded = new TextDecoder("windows-1251").decode(bytes);
    expect(decoded).toContain(";м?;");
    expect(decoded).toContain(";1200?800?1600;");

    const r = ok(await parseParamsFile(bytes, "Склад.csv", defs));
    expect(r.layout).toBe("organizer");
    expect(r.found).toBe(42);
    expect(r.report.filter((i) => i.severity !== "info")).toEqual([]);
    expect(r.values).toEqual(baseValues);
  });

  it("наш CSV-шаблон, пересохранённый в cp1251, читается обратно без ошибок", async () => {
    const regime = spec({
      key: "storageTempRegime",
      label: "Температурный режим хранения",
      kind: "enum",
      options: ["Нормальный (+5…+25 °C)", "Охлаждаемый (0…+5 °C)", "Морозильный (ниже −18 °C)"],
      base: "Морозильный (ниже −18 °C)",
      order: 99,
    });
    const withRegime = [...defs, regime];
    const bytes = encodeCp1251(paramsTemplateCsv(withRegime).replace(/^﻿/, ""));
    const r = ok(await parseParamsFile(bytes, "Шаблон.csv", withRegime));
    expect(r.layout).toBe("template");
    expect(r.report.filter((i) => i.severity !== "info")).toEqual([]);
    expect(r.values).toEqual({ ...baseValues, storageTempRegime: "Морозильный (ниже −18 °C)" });
  });

  it("строка, найденная только по сути названия, с чужой единицей — ошибка unit_mismatch", async () => {
    const rows = WAREHOUSE_ROWS.map((row): OrganizerRow =>
      row[1] === "Объём приёмки (поддоны/сутки)" ? [row[0], "Объём приёмки (поддоны/час)", "поддон/ч", 60, 20, 200] : row,
    );
    const r = ok(await parseParamsFile(await organizerWorkbook([{ name: "Склад", rows }]), "x.xlsx", defs));
    expect(r.report.find((i) => i.key === "inboundPalletsPerDay")).toMatchObject({
      code: "unit_mismatch",
      severity: "error",
      message: "Объём приёмки: единица «поддон/ч» не совпадает с «поддон/сут» — пересчитайте значение в поддон/сут",
    });
    expect(r.report.some((i) => i.code === "unknown_key")).toBe(false);
    expect(r.values.inboundPalletsPerDay).toBe(1000);
  });

  it("строка с единицей «тыс. руб./мес.» — ошибка unit_mismatch", async () => {
    const rows = WAREHOUSE_ROWS.map((row): OrganizerRow =>
      row[1] === "Средняя з/п отборщика (gross)" ? [row[0], row[1], "тыс. руб./мес.", 100, row[4], row[5]] : row,
    );
    const r = ok(await parseParamsFile(await organizerWorkbook([{ name: "Склад", rows }]), "x.xlsx", defs));
    const i = r.report.find((x) => x.key === "pickerSalaryRubMonth");
    expect(i).toMatchObject({ code: "unit_mismatch", severity: "error" });
    expect(r.values.pickerSalaryRubMonth).toBe(100000);
  });

  it("строка, которую не удалось сопоставить, — предупреждение, остальное загружается", async () => {
    const rows: OrganizerRow[] = [...WAREHOUSE_ROWS, ["ИНФРАСТРУКТУРА И ОГРАНИЧЕНИЯ", "Число лифтов", "шт.", 2, 0, 10]];
    const r = ok(await parseParamsFile(await organizerWorkbook([{ name: "Склад", rows }]), "x.xlsx", defs));
    expect(r.found).toBe(42);
    const u = r.report.find((i) => i.code === "unknown_key");
    expect(u).toMatchObject({ severity: "warning", key: "Число лифтов" });
    expect(u?.message).toContain("не сопоставлена");
    expect(r.errors).toBe(0);
  });

  it("повтор строки — ошибка duplicate_key", async () => {
    const dup = WAREHOUSE_ROWS[0] as OrganizerRow;
    const rows: OrganizerRow[] = [...WAREHOUSE_ROWS, dup];
    const r = ok(await parseParamsFile(await organizerWorkbook([{ name: "Склад", rows }]), "x.xlsx", defs));
    expect(r.report.find((i) => i.key === "totalAreaM2")).toMatchObject({ code: "duplicate_key", severity: "error" });
  });

  it("единственный лист другого объекта — понятная ошибка", async () => {
    const airport: OrganizerRow[] = [["ОБЩИЕ ПАРАМЕТРЫ ОБЪЕКТА", "Количество терминалов", "шт.", 2, 1, 6]];
    const r = await parseParamsFile(await organizerWorkbook([{ name: "Аэропорт", rows: airport }], false), "a.xlsx", defs);
    expect(r).toEqual({
      ok: false,
      message: "Лист «Аэропорт» относится к другому типу объекта — загрузите лист «Склад» или смените тип объекта",
    });
  });

  it("несколько листов, но нет «Склада» — ошибка с подсказкой", async () => {
    const row: OrganizerRow = ["ОБЩИЕ", "Количество терминалов", "шт.", 2, 1, 6];
    const r = await parseParamsFile(
      await organizerWorkbook([
        { name: "Аэропорт", rows: [row] },
        { name: "Медучреждение", rows: [row] },
      ]),
      "a.xlsx",
      defs,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("нет листа «Склад»");
  });
});

describe("ошибки файла целиком", () => {
  it("неподдерживаемое расширение", async () => {
    expect(await parseParamsFile(encode("x"), "params.txt", defs)).toEqual({ ok: false, message: UNSUPPORTED_FILE_MESSAGE });
    expect(await parseParamsFile(encode("x"), "params", defs)).toEqual({ ok: false, message: UNSUPPORTED_FILE_MESSAGE });
    const xls = await parseParamsFile(encode("x"), "старый.XLS", defs);
    expect(!xls.ok && xls.message).toContain("сохраните в Excel как «Книга Excel (*.xlsx)»");
  });

  it("не XLSX под видом .xlsx и испорченный архив", async () => {
    const notZip = await parseParamsFile(encode("Параметр;Базовое значение"), "x.xlsx", defs);
    expect(!notZip.ok && notZip.message).toContain("не похож на книгу Excel");
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    const r = await parseParamsFile(broken, "x.xlsx", defs);
    expect(!r.ok && r.message).toContain("Не удалось прочитать файл .xlsx");
  });

  it("нет строки заголовков", async () => {
    const r = await parseParamsFile(encode("a;b\n1;2"), "x.csv", defs);
    expect(!r.ok && r.message).toContain("Не найдена строка заголовков");
  });

  it("ни одного параметра этого объекта", async () => {
    const r = await parseParamsFile(encode("Ключ;Значение\nfoo;1"), "x.csv", defs);
    expect(!r.ok && r.message).toContain("не найдено ни одного параметра");
  });
});

describe("readWorkbook", () => {
  it("числа — как в JS, формулы — результат, пустые строки сохраняют нумерацию", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Л");
    ws.getCell("A1").value = 1.302;
    ws.getCell("B1").value = { formula: "A1*2", result: 2.604 };
    ws.getCell("A3").value = { richText: [{ text: "Скл" }, { text: "ад" }] };
    ws.getCell("B3").value = true;
    ws.getCell("A4").value = 0.07;
    ws.getCell("A4").numFmt = "0%";
    ws.getCell("B4").value = { formula: "A4*2", result: 0.14 };
    ws.getCell("B4").numFmt = "0.0%";
    ws.getCell("C4").value = 0.5;
    ws.getCell("C4").numFmt = '0" %"';
    const sheets = await readWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(sheets).toEqual([
      { name: "Л", rows: [["1.302", "2.604"], [], ["Склад", "Да"], ["7%", "14%", "0.5"]] },
    ]);
  });
});
