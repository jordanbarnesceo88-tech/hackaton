import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioOk } from "../../tz/types";
import { fixtureChanges, fixtureDefs, fixtureResults } from "./test-fixtures";
import { XLSX_SHEET_NAMES, buildProjectXlsx } from "./xlsx";

/**
 * Книга XLSX проверяется чтением обратно через exceljs: листы, живые формулы с кешированными
 * результатами и независимая проверка формулы NPV по ячейкам листа.
 */

const results = fixtureResults();
let wb: ExcelJS.Workbook;

function ok(key: string): ScenarioOk {
  const r = results.results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан`);
  return r;
}

function sheet(name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`нет листа ${name}`);
  return ws;
}

/** Номер строки, у которой в столбце A текст `text`, начиная со строки `from`. */
function findRow(ws: ExcelJS.Worksheet, text: string | RegExp, from = 1): number {
  for (let r = from; r <= ws.rowCount; r++) {
    const v = ws.getCell(r, 1).value;
    if (typeof v === "string" && (typeof text === "string" ? v === text : text.test(v))) return r;
  }
  throw new Error(`не найдена строка «${String(text)}»`);
}

/** Число ячейки: значение, результат формулы (0 exceljs при чтении не возвращает) или 0. */
function numAt(ws: ExcelJS.Worksheet, addr: string): number {
  const v = ws.getCell(addr).value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "formula" in v) return typeof v.result === "number" ? v.result : 0;
  if (v === null || v === undefined) return 0;
  throw new Error(`в ${addr} не число: ${JSON.stringify(v)}`);
}

function formulaAt(ws: ExcelJS.Worksheet, row: number, col = 2): { formula: string; result: unknown } {
  const v = ws.getCell(row, col).value;
  if (!v || typeof v !== "object" || !("formula" in v)) throw new Error(`в строке ${row} нет формулы: ${JSON.stringify(v)}`);
  return { formula: v.formula ?? "", result: v.result };
}

beforeAll(async () => {
  const bytes = await buildProjectXlsx({
    projectName: "=cmd",
    results,
    defs: fixtureDefs(),
    changes: fixtureChanges(),
  });
  expect(bytes).toBeInstanceOf(Uint8Array);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab);
});

describe("книга XLSX проекта", () => {
  it("13 листов в заданном порядке", () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual([...XLSX_SHEET_NAMES]);
    expect(XLSX_SHEET_NAMES).toHaveLength(13);
  });

  it("имя проекта «=cmd» записано текстом, а не формулой; оговорка на сводке", () => {
    const ws = sheet("Сводка");
    expect(ws.getCell("B2").value).toBe("=cmd");
    const last = ws.getCell(ws.rowCount, 1).value;
    expect(last).toBe("Результат является предварительной оценкой и требует верификации при обследовании объекта.");
  });

  it("NPV покупки — формула «год 0 + NPV(ставка; годы 1…H)» с результатом расчёта", () => {
    const ws = sheet("Денежный поток");
    const block = findRow(ws, "Сценарий: Покупка — Ronavi H1500");
    const row = findRow(ws, /^NPV за /, block);
    const { formula, result } = formulaAt(ws, row);
    const m = /^G(\d+)\+NPV\(B(\d+),G(\d+):G(\d+)\)$/.exec(formula);
    expect(m, formula).not.toBeNull();
    const npv = ok("p1").npvRub ?? NaN;
    expect(Math.abs((result as number) - npv)).toBeLessThanOrEqual(1);
    expect(ws.getCell(row, 2).numFmt).toBe('#,##0 "₽"');

    // Независимо от кеша: пересчёт формулы по ячейкам листа даёт NPV движка.
    const [, r0, rateRow, r1, rH] = (m ?? []).map(Number);
    const rate = numAt(ws, `B${rateRow}`);
    let value = numAt(ws, `G${r0}`);
    for (let r = r1 ?? 0, t = 1; r <= (rH ?? 0); r++, t++) value += numAt(ws, `G${r}`) / (1 + rate) ** t;
    expect(rate).toBe(0.12);
    expect((rH ?? 0) - (r1 ?? 0) + 1).toBe(5);
    expect(Math.abs(value - npv)).toBeLessThanOrEqual(1);
  });

  it("окупаемость, ROI и TCO — формулы с результатами расчёта", () => {
    const ws = sheet("Денежный поток");
    const block = findRow(ws, "Сценарий: Покупка — Ronavi H1500");
    const p = ok("p1");
    const pb = formulaAt(ws, findRow(ws, "Простой срок окупаемости, лет", block));
    expect(pb.formula).toMatch(/^IF\(B\d+>0,B\d+\/B\d+,"не окупается"\)$/);
    expect(pb.result).toBeCloseTo(p.paybackYears ?? NaN, 9);
    const roi = formulaAt(ws, findRow(ws, /^ROI по ТЗ/, block));
    expect(roi.formula).toMatch(/^IF\(B\d+>0,SUM\(G\d+:G\d+\)\/B\d+\*100,"—"\)$/);
    expect(roi.result).toBeCloseTo(p.roiTzPct ?? NaN, 9);
    const tco = formulaAt(ws, findRow(ws, /^TCO за 5 лет/, block));
    expect(tco.formula).toMatch(/^B\d+\+SUM\(C\d+:C\d+\)\+SUM\(E\d+:E\d+\)$/);
    expect(Math.abs((tco.result as number) - p.tcoRub)).toBeLessThanOrEqual(1);
    const delta = formulaAt(ws, findRow(ws, "Изменение TCO к «Как есть», ₽", block));
    expect(Math.abs((delta.result as number) - p.tcoDeltaVsAsIsRub)).toBeLessThanOrEqual(1);
  });

  it("отказ в денежном потоке — сообщением, без чисел", () => {
    const ws = sheet("Денежный поток");
    const block = findRow(ws, "Сценарий: Услуга (RaaS) — DMR Carrier P");
    expect(ws.getCell(block + 1, 1).value).toBe("Не рассчитан");
    expect(String(ws.getCell(block + 1, 2).value)).toMatch(/^Нет ставки RaaS/);
  });

  it("итоги CAPEX — SUM по статьям; сценарий с ручным решением помечен ⚠", () => {
    const ws = sheet("CAPEX");
    const p = ok("p1");
    let found = false;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (ws.getCell(r, 1).value === "Покупка — Ronavi H1500" && ws.getCell(r, 2).value === "Итого CAPEX") {
        const { formula, result } = formulaAt(ws, r, 3);
        expect(formula).toMatch(/^SUM\(C\d+:C\d+\)$/);
        expect(Math.abs((result as number) - p.capexRub)).toBeLessThanOrEqual(1);
        found = true;
      }
    }
    expect(found).toBe(true);
    const titles = new Set<string>();
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getCell(r, 1).value;
      if (typeof v === "string") titles.add(v);
    }
    expect(titles.has("Покупка — DMR Carrier P ⚠")).toBe(true);
    expect(titles.has("Покупка — DMR Carrier P")).toBe(false);
  });

  it("закреплённая строка заголовков на табличных листах", () => {
    for (const name of ["Параметры объекта", "CAPEX", "Источники", "Журнал корректировок"]) {
      const view = sheet(name).views[0];
      expect(view?.state, name).toBe("frozen");
      expect(view && "ySplit" in view ? view.ySplit : 0, name).toBe(1);
    }
  });

  it("имитация, журнал и параметры заполнены", () => {
    const sim = sheet("Имитация");
    expect(sim.getCell("A1").value).toBe("Показатель");
    expect(sim.getCell("B1").value).toBe("Покупка — Ronavi H1500");
    expect(sim.getCell("C1").value).toBe("Покупка — DMR Carrier P ⚠");
    const log = sheet("Журнал корректировок");
    expect(log.getCell("D2").value).toBe("Перемещение паллет: приёмка → хранение → отгрузка: количество роботов");
    const params = sheet("Параметры объекта");
    expect(params.getCell("A1").value).toBe("Раздел");
    expect(params.rowCount).toBeGreaterThan(40);
  });
});
