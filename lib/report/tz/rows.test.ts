import { describe, expect, it } from "vitest";
import type { ScenarioOk } from "../../tz/types";
import {
  CASHFLOW_HEADER,
  MANUAL_MARK,
  RAAS_ROI_NOTE,
  SCENARIO_TABLE_ROWS,
  cashflowRows,
  changeFieldLabel,
  changeRows,
  formatCalcDate,
  paramsRows,
  scenarioColumns,
  scenarioFinance,
  scenarioTableRows,
  sourcesRows,
  type ReportResults,
} from "./rows";
import { equipmentRows, lineGroups, normsReportRows, selectionReportRows, simTable } from "./tables";
import { fixtureChanges, fixtureDefs, fixtureResults } from "./test-fixtures";

/** Пробелы ICU (неразрывные) → обычные, как предписывает контракт lib/format/rub. */
const sp = (s: string | undefined) => (s ?? "").replace(/\s/g, " ");

const results = fixtureResults();

function ok(key: string): ScenarioOk {
  const r = results.results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан`);
  return r;
}

function col(key: string): number {
  const i = results.results.findIndex((r) => r.key === key);
  if (i < 0) throw new Error(`нет сценария ${key}`);
  return i;
}

describe("таблица сценариев", () => {
  const rows = scenarioTableRows(results);
  const byKey = (k: string) => {
    const row = rows.find((r) => r.rowKey === k);
    if (!row) throw new Error(`нет строки ${k}`);
    return row;
  };

  it("строки в порядке экрана (T2.6) с русскими подписями", () => {
    expect(rows.map((r) => r.rowKey)).toEqual([
      "composition",
      "capex",
      "opex",
      "labour",
      "effect",
      "payback",
      "band",
      "roiTz",
      "roiNet",
      "npv",
      "dpb",
      "tco",
      "tcoDelta",
      "sim",
      "risks",
      "verdict",
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "Состав оборудования",
      "CAPEX",
      "OPEX в год",
      "ФОТ процесса",
      "Годовой эффект",
      "Окупаемость (простая)",
      "Интерпретация",
      "ROI по ТЗ",
      "ROI чистый",
      "NPV",
      "Дисконтированная окупаемость",
      "TCO за 5 лет",
      "Изменение TCO к «Как есть»",
      "Имитация",
      "Риски",
      "Вывод",
    ]);
    expect(SCENARIO_TABLE_ROWS).toHaveLength(16);
  });

  it("ячейка на каждый сценарий, числа — из результатов", () => {
    for (const r of rows) {
      expect(r.cells).toHaveLength(results.results.length);
      expect(r.values).toHaveLength(results.results.length);
    }
    const p = ok("p1");
    expect(byKey("capex").values[col("p1")]).toBe(p.capexRub);
    expect(sp(byKey("capex").cells[col("p1")])).toBe("35,4 млн ₽");
    expect(byKey("npv").values[col("p1")]).toBe(p.npvRub);
    expect(sp(byKey("payback").cells[col("p1")])).toBe("3,6 года");
    expect(byKey("band").cells[col("p1")]).toBe("средняя окупаемость (3–5 лет)");
    expect(sp(byKey("composition").cells[col("p1")])).toBe("10 роботов · 1 зарядка · 1 пост диспетчера");
  });

  it("«Как есть»: прочерки вместо эффекта, окупаемости и NPV", () => {
    const i = col("asis");
    expect(byKey("composition").cells[i]).toBe("текущий процесс, без роботов");
    for (const k of ["effect", "payback", "roiTz", "npv", "dpb", "tcoDelta"]) {
      expect(byKey(k).values[i]).toBeNull();
      expect(byKey(k).cells[i]).toBe("—");
    }
    expect(byKey("tco").values[i]).toBe(ok("asis").tcoRub);
  });

  it("у услуги (RaaS) ROI с примечанием о неинформативности", () => {
    expect(byKey("roiTz").cells[col("r1")]).toContain(RAAS_ROI_NOTE);
    expect(byKey("roiNet").cells[col("r1")]).toContain(RAAS_ROI_NOTE);
    expect(byKey("roiTz").cells[col("p1")]).not.toContain(RAAS_ROI_NOTE);
  });

  it("отказ: сообщение в составе, в числах — прочерк, а не ноль", () => {
    const i = col("r2");
    expect(byKey("composition").cells[i]).toMatch(/^Не рассчитан: Нет ставки RaaS/);
    for (const k of ["capex", "opex", "npv", "tco"]) {
      expect(byKey(k).values[i]).toBeNull();
      expect(byKey(k).cells[i]).toBe("—");
    }
    expect(byKey("verdict").cells[i]).toBe("Не рассчитан");
  });

  it("★ у рекомендуемого сценария, имитация и риски", () => {
    const rec = results.conclusion.recommendedScenarioKey;
    expect(rec).not.toBeNull();
    expect(byKey("verdict").cells[col(rec ?? "")]).toBe("★ Рекомендуется");
    expect(byKey("verdict").cells.filter((c) => c.includes("★"))).toHaveLength(1);
    expect(byKey("sim").cells[col("p1")]).toBe("✓ подтверждено");
    expect(byKey("sim").cells[col("p2")]).toBe("✗ не подтверждено: парк роботов");
    expect(byKey("sim").cells[col("r1")]).toBe("—");
    expect(byKey("risks").cells[col("p1")]).toMatch(/^\d+: /);
    expect(byKey("risks").cells[col("asis")]).toBe("нет");
  });

  it("сценарий с ручным решением помечен ⚠ в заголовке", () => {
    const cols = scenarioColumns(results);
    expect(cols.find((c) => c.key === "p2")?.title).toBe(`Покупка — DMR Carrier P ${MANUAL_MARK}`);
    expect(cols.filter((c) => c.manual).map((c) => c.key)).toEqual(["p2"]);
    expect(cols.find((c) => c.recommended)?.key).toBe(results.conclusion.recommendedScenarioKey);
  });
});

describe("денежный поток и финансы сценария", () => {
  it("годы 0…T из результата и текст ячеек", () => {
    const p = ok("p1");
    const rows = cashflowRows(p);
    expect(rows.map((r) => r.year)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows[0]?.cells).toHaveLength(CASHFLOW_HEADER.length);
    expect(sp(rows[0]?.cells[1])).toBe("35 420 000 ₽");
    expect(rows[4]?.batteryRub).toBe(2_700_000);
  });

  it("горизонт, ставка и OPEX «Как есть» восстанавливаются как у движка", () => {
    const f = scenarioFinance(results, ok("p1"));
    expect(f).toMatchObject({ H: 5, T: 5, rate: 0.12 });
    expect(f.opexAsisRub).toBeCloseTo(ok("asis").opexYearRub, 4);
  });

  it("испорченный горизонт не роняет выгрузку: H = null", () => {
    const broken: ReportResults = { ...results, paramsUsed: { ...results.paramsUsed, horizonYears: null } };
    expect(scenarioFinance(broken, ok("p1")).H).toBeNull();
  });
});

describe("параметры объекта", () => {
  const defs = fixtureDefs();

  it("в порядке описаний, с источником значения по умолчанию", () => {
    const rows = paramsRows(results, defs);
    const orders = defs.map((d) => d.key);
    expect(rows.slice(0, defs.length).map((r) => r.key)).toEqual(
      [...defs].sort((a, b) => a.order - b.order).map((d) => d.key),
    );
    expect(orders).toContain("forkliftSalaryRubMonth");
    const salary = rows.find((r) => r.key === "forkliftSalaryRubMonth");
    expect(salary?.changed).toBe(false);
    expect(salary?.source).toMatch(/^Организатор/);
  });

  it("изменённое значение — «Задано вами», вне диапазона — ⚠ в замечаниях", () => {
    const changed: ReportResults = {
      ...results,
      paramsUsed: { ...results.paramsUsed, forkliftSalaryRubMonth: 200_000 },
      paramIssues: [
        {
          key: "forkliftSalaryRubMonth",
          label: "Средняя з/п оператора погрузчика (gross)",
          code: "out_of_range",
          severity: "warning",
          message: "Значение вне диапазона организатора",
        },
      ],
    };
    const row = paramsRows(changed, defs).find((r) => r.key === "forkliftSalaryRubMonth");
    expect(row?.changed).toBe(true);
    expect(row?.outOfRange).toBe(true);
    expect(sp(row?.source)).toBe("Задано вами (по умолчанию 120 000)");
    expect(row?.notes[0]).toMatch(/^⚠ вне диапазона организатора/);
    expect(row?.notes).toContain("Значение вне диапазона организатора");
  });
});

describe("источники, журнал и прочие разделы", () => {
  it("источники — по продуктам снимка, ручной продукт с ⚠", () => {
    const rows = sourcesRows(results);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.productName === `DMR Carrier P ${MANUAL_MARK}`)).toBe(true);
    expect(rows.every((r) => r.cells.length === 8)).toBe(true);
  });

  it("журнал: подписи полей по-русски и даты по Москве", () => {
    const rows = changeRows(fixtureChanges());
    expect(rows[0]?.fieldLabel).toBe("Перемещение паллет: приёмка → хранение → отгрузка: количество роботов");
    expect(rows[0]?.at).toBe("25.09.2026 12:30 МСК");
    expect(rows[1]?.fieldLabel).toBe("Параметр «Средняя з/п оператора погрузчика (gross)»");
    expect(sp(rows[1]?.new)).toBe("130 000");
    expect(rows[2]?.fieldLabel).toBe("Норматив «Коэффициент загрузки робота»");
    expect(rows[2]?.new).toBe("0,8");
    const [first] = fixtureChanges();
    if (!first) throw new Error("нет записи журнала в фикстуре");
    const titled = changeRows([{ ...first, scenario: "p2" }], {
      scenarioTitles: { p2: `Покупка — DMR Carrier P ${MANUAL_MARK}` },
    });
    expect(titled[0]?.scenario).toBe(`Покупка — DMR Carrier P ${MANUAL_MARK}`);
    expect(changeFieldLabel("scenario:add")).toBe("Сценарий добавлен");
    expect(changeFieldLabel("param:x", { x: "Своя подпись" })).toBe("Параметр «Своя подпись»");
  });

  it("дата расчёта: МСК, без даты — «не сохранён»", () => {
    expect(formatCalcDate("2026-09-25T10:05:00.000Z")).toBe("25.09.2026 13:05 МСК");
    expect(formatCalcDate(null)).toMatch(/^не сохранён/);
    expect(formatCalcDate("не дата")).toBe("—");
  });

  it("состав оборудования, статьи, нормативы, имитация и подбор строятся без потерь", () => {
    expect(equipmentRows(results).filter((r) => r.item !== null)).toHaveLength(4);
    const capex = lineGroups(results, "capex");
    const p1 = capex.find((g) => g.scenarioKey === "p1");
    expect(p1?.totalRub).toBe(ok("p1").capexRub);
    expect(p1?.lines.reduce((a, l) => a + l.line.valueRub, 0)).toBeCloseTo(ok("p1").capexRub, 4);
    expect(capex.find((g) => g.scenarioKey === "r2")?.refusal).toMatch(/^Нет ставки RaaS/);
    expect(normsReportRows(results).find((n) => n.key === "discountRate")?.value).toBe(0.12);
    const sim = simTable(results);
    expect(sim.columns.map((c) => c.scenarioKey)).toEqual(["p1", "p2"]);
    expect(sim.labels[0]).toBe("Рассчитано, пал./ч");
    expect(selectionReportRows(results).some((s) => s.productName === `DMR Carrier P ${MANUAL_MARK}`)).toBe(true);
  });
});
