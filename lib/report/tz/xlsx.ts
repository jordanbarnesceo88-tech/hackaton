// только сервер: exceljs не попадает в клиентский бандл
import ExcelJS from "exceljs";
import { ORGANIZER_DATA_VERSION } from "../../data/organizer/version.generated";
import type { ParamSpec, ScenarioResult } from "../../tz/types";
import {
  CHANGES_HEADER,
  MANUAL_NOTE,
  PARAMS_HEADER,
  RAAS_ROI_NOTE,
  SOURCES_HEADER,
  changeRows,
  disclaimerOf,
  facilityLabelOf,
  formatCalcDate,
  paramsRows,
  scenarioColumns,
  scenarioFinance,
  scenarioTableRows,
  scenarioTitle,
  sourcesRows,
  yearsCount,
  type CellKind,
  type ReportChange,
  type ReportResults,
} from "./rows";
import {
  COMPARISON_HEADER,
  COMPARISON_NUMERIC_KEYS,
  EQUIPMENT_HEADER,
  LINES_HEADER,
  NORMS_HEADER,
  RISKS_HEADER,
  SELECTION_HEADER,
  SENSITIVITY_HEADER,
  comparisonReportRows,
  equipmentRows,
  formulaRows,
  lineGroups,
  modelLimitations,
  normOverrideRows,
  normsReportRows,
  riskRows,
  selectionReportRows,
  sensitivityGroups,
  simTable,
} from "./tables";

/**
 * Книга XLSX по проекту (ТЗ §3.7.3 — выгрузка таблиц в Excel; §3.5.8 — формулы и допущения
 * видны). Только сервер: exceljs — пакет Node (потоки, zip), он подключён через
 * `serverExternalPackages`, а строки для листов берутся из чистых модулей rows.ts и tables.ts.
 *
 * Итоговые показатели записаны живыми формулами Excel с кешированным результатом расчёта:
 * итоги CAPEX и OPEX — SUM по статьям; на листе «Денежный поток» эффект и поток каждого года,
 * окупаемость, ROI, NPV и TCO считаются от ячеек таблицы. Кешированный результат — число
 * платформы, поэтому файл читается и без пересчёта, а Excel при открытии пересчитает формулы
 * (fullCalcOnLoad) и покажет то же самое.
 *
 * Форматы чисел и формулы хранятся в файле в международной записи — так требует формат OOXML:
 * `#,##0 "₽"` и `0.0` русский Excel показывает как «# ##0 ₽» и «0,0», а разделитель аргументов
 * «,» в формулах — как «;».
 */

/** Листы книги в порядке показа (13 листов). */
export const XLSX_SHEET_NAMES = [
  "Сводка",
  "Параметры объекта",
  "Подбор",
  "Состав оборудования",
  "CAPEX",
  "OPEX",
  "Денежный поток",
  "Чувствительность",
  "Имитация",
  "Нормативы и допущения",
  "Источники",
  "Журнал корректировок",
  "О расчёте",
] as const;

export type ProjectXlsxInput = {
  projectName: string;
  results: ReportResults;
  /** Описания параметров объекта (подписи, единицы, диапазоны и источники значений по умолчанию). */
  defs: readonly ParamSpec[];
  /** Журнал корректировок проекта; для гостевого расчёта — пустой. */
  changes?: readonly ReportChange[];
};

/** Числовые форматы в записи OOXML (русский Excel показывает их с пробелами и запятой). */
const FMT = {
  rub: '#,##0 "₽"',
  int: "#,##0",
  dec1: "#,##0.0",
  dec2: "#,##0.00",
  years: "0.0",
  pctUnits: '0.0 "%"',
  rate: "0.0%",
} as const;

const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
const FILL_RECOMMENDED: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
const FILL_CAUTION: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const FILL_WARN: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };

type Value = ExcelJS.CellValue;

/** Число или прочерк: null, NaN и ±∞ в книгу не попадают. */
function numOr(v: number | null | undefined, dash = "—"): number | string {
  return typeof v === "number" && Number.isFinite(v) ? v : dash;
}

/** Ссылка https/http — гиперссылкой, остальное — текстом. */
function linkOr(url: string | null | undefined): Value {
  if (!url) return "—";
  return /^https?:\/\//i.test(url) ? { text: url, hyperlink: url } : url;
}

/** Формула с кешированным результатом (без ведущего «=»). */
function formula(expr: string, result: number | string): Value {
  return { formula: expr, result };
}

function sheet(wb: ExcelJS.Workbook, name: (typeof XLSX_SHEET_NAMES)[number], frozenHeader: boolean): ExcelJS.Worksheet {
  return wb.addWorksheet(name, frozenHeader ? { views: [{ state: "frozen", xSplit: 0, ySplit: 1 }] } : {});
}

function widths(ws: ExcelJS.Worksheet, list: readonly number[]): void {
  list.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

function headerRow(ws: ExcelJS.Worksheet, rowNum: number, headers: readonly string[]): void {
  const row = ws.getRow(rowNum);
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = FILL_HEADER;
    c.alignment = { vertical: "middle", wrapText: true };
  });
}

/** Строка значений; `fmts[i]` — числовой формат i-й ячейки. */
function putRow(ws: ExcelJS.Worksheet, rowNum: number, values: readonly Value[], fmts: readonly (string | undefined)[] = []): ExcelJS.Row {
  const row = ws.getRow(rowNum);
  values.forEach((v, i) => {
    const c = row.getCell(i + 1);
    c.value = v;
    const f = fmts[i];
    if (f) c.numFmt = f;
    c.alignment = { vertical: "top", wrapText: typeof v === "string" && v.length > 40 };
  });
  return row;
}

/** Текст в столбце A без переноса: длинная строка продолжается в пустые ячейки справа. */
function noteRow(ws: ExcelJS.Worksheet, rowNum: number, text: string): void {
  const c = ws.getCell(rowNum, 1);
  c.value = text;
  c.alignment = { vertical: "top", wrapText: false };
}

function titleCell(ws: ExcelJS.Worksheet, rowNum: number, text: string, size = 12): void {
  const c = ws.getCell(rowNum, 1);
  c.value = text;
  c.font = { bold: true, size };
}

function disclaimerCell(ws: ExcelJS.Worksheet, rowNum: number, text: string): void {
  const c = ws.getCell(rowNum, 1);
  c.value = text;
  c.font = { bold: true, italic: true };
  c.fill = FILL_CAUTION;
}

function kindFmt(kind: CellKind): string | undefined {
  if (kind === "rub") return FMT.rub;
  if (kind === "years") return FMT.years;
  if (kind === "pct") return FMT.pctUnits;
  return undefined;
}

// ——————————————————————————— 1. Сводка ———————————————————————————

function summarySheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const { results, projectName } = input;
  const ws = sheet(wb, "Сводка", false);
  const cols = scenarioColumns(results);
  widths(ws, [36, ...cols.map(() => 30)]);

  titleCell(ws, 1, "Предварительная оценка роботизации", 14);
  let r = 2;
  const meta: [string, string][] = [
    ["Проект", projectName],
    ["Тип объекта", facilityLabelOf(results.facility)],
    ["Дата расчёта", formatCalcDate(results.calculatedAt)],
    ["Модель расчёта", results.modelVersion],
    ["Модель имитации", results.simModelVersion],
    ["Версия данных", results.dataVersion],
  ];
  for (const [k, v] of meta) {
    putRow(ws, r, [k, v]);
    ws.getCell(r, 1).font = { bold: true };
    r++;
  }
  r++;

  titleCell(ws, r++, "Вывод");
  noteRow(ws, r++, results.conclusion.headline);
  for (const b of results.conclusion.bullets) noteRow(ws, r++, `• ${b}`);
  r++;

  titleCell(ws, r++, "Сравнение сценариев");
  headerRow(ws, r, ["Показатель", ...cols.map((c) => c.title)]);
  cols.forEach((c, i) => {
    if (c.recommended) ws.getCell(r, i + 2).fill = FILL_RECOMMENDED;
  });
  r++;
  for (const row of scenarioTableRows(results)) {
    const fmt = kindFmt(row.kind);
    const values: Value[] = [row.label, ...row.values.map((v, i) => (v === null ? (row.cells[i] ?? "—") : v))];
    const x = putRow(ws, r, values, [undefined, ...row.values.map((v) => (v === null ? undefined : fmt))]);
    x.getCell(1).font = { bold: true };
    cols.forEach((c, i) => {
      if (c.recommended) x.getCell(i + 2).fill = FILL_RECOMMENDED;
      x.getCell(i + 2).alignment = { vertical: "top", wrapText: true };
    });
    r++;
  }
  if (cols.some((c) => c.kind === "raas")) noteRow(ws, r++, `ROI услуги (RaaS): ${RAAS_ROI_NOTE}`);
  if (cols.some((c) => c.manual)) noteRow(ws, r++, MANUAL_NOTE);
  r++;

  const risks = riskRows(results);
  titleCell(ws, r++, "Риски сценариев");
  if (risks.length === 0) {
    noteRow(ws, r++, "Рисков не выявлено");
  } else {
    headerRow(ws, r++, RISKS_HEADER);
    for (const x of risks) putRow(ws, r++, [x.scenarioTitle, x.severity, x.code, x.text]);
  }
  r++;
  disclaimerCell(ws, r, disclaimerOf(results));
}

// ——————————————————————————— 2. Параметры объекта ———————————————————————————

function paramsSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Параметры объекта", true);
  widths(ws, [22, 46, 18, 12, 18, 22, 44, 50]);
  headerRow(ws, 1, PARAMS_HEADER);
  let r = 2;
  for (const p of paramsRows(input.results, input.defs)) {
    const row = putRow(ws, r++, [
      p.section,
      p.label,
      p.value ?? "—",
      p.unit,
      p.base ?? "—",
      p.cells[5] ?? "—",
      p.source,
      p.notes.join("; "),
    ]);
    if (p.outOfRange) row.getCell(3).fill = FILL_WARN;
    else if (p.changed) row.getCell(3).fill = FILL_CAUTION;
  }
}

// ——————————————————————————— 3. Подбор ———————————————————————————

function selectionSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Подбор", true);
  widths(ws, [24, 30, 18, 12, 12, 60, 60, 50, 70, 12, 12, 12, 14, 14, 14, 12, 14, 14, 16]);
  headerRow(ws, 1, SELECTION_HEADER);
  let r = 2;
  const rows = selectionReportRows(input.results);
  if (rows.length === 0) noteRow(ws, r++, "Подбор не выполнялся");
  for (const s of rows) {
    putRow(
      ws,
      r++,
      [
        s.processName,
        s.productName,
        s.statusLabel,
        numOr(s.score),
        s.needsVerification ? "да" : "нет",
        s.reasons || "—",
        s.limitations || "—",
        s.missing || "—",
        s.contributions || "—",
      ],
      [undefined, undefined, undefined, FMT.dec1],
    );
  }
  r++;
  titleCell(ws, r++, "Сравнение решений по единым характеристикам");
  headerRow(ws, r++, COMPARISON_HEADER);
  const rubKeys = new Set<string>(["priceRub", "capexPurchaseRub", "npvPurchaseRub", "raasRubMonth"]);
  for (const c of comparisonReportRows(input.results)) {
    const nums = COMPARISON_NUMERIC_KEYS.map((k) => numOr(c[k]));
    const fmts = COMPARISON_NUMERIC_KEYS.map((k) =>
      rubKeys.has(k) ? FMT.rub : k === "paybackPurchaseYears" ? FMT.years : k === "n" || k === "chargers" ? FMT.int : undefined,
    );
    putRow(ws, r++, [c.processName, c.productTitle, c.statusLabel, ...nums], [undefined, undefined, undefined, ...fmts]);
  }
}

// ——————————————————————————— 4. Состав оборудования ———————————————————————————

function equipmentSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Состав оборудования", true);
  widths(ws, [30, 22, 26, 12, ...Array.from({ length: 20 }, () => 14), 50]);
  headerRow(ws, 1, EQUIPMENT_HEADER);
  let r = 2;
  for (const e of equipmentRows(input.results)) {
    const it = e.item;
    if (!it) {
      putRow(ws, r++, [e.scenarioTitle, e.processName, e.productName, e.unit, ...Array.from({ length: 20 }, () => "—"), e.note]);
      continue;
    }
    putRow(
      ws,
      r++,
      [
        e.scenarioTitle,
        e.processName,
        e.productName,
        e.unit,
        numOr(it.demandPerDay),
        numOr(it.avgPerHour),
        numOr(it.peakPerHour),
        numOr(it.thrNorm),
        numOr(it.thrCycle),
        numOr(it.thrEff),
        it.thrSource ?? "—",
        numOr(it.routeLoadedM),
        numOr(it.routeEmptyM),
        numOr(it.nExact),
        numOr(it.n),
        it.nOverridden ? "да" : "нет",
        numOr(it.coverage * 100),
        it.chargers,
        it.operatorPosts,
        numOr(it.headcount),
        numOr(it.releasedFte),
        numOr(it.baselineLabourRub),
        numOr(it.remainingLabourRub),
        numOr(it.operatingStaffRub),
        e.note || "—",
      ],
      [
        undefined,
        undefined,
        undefined,
        undefined,
        FMT.dec1,
        FMT.dec2,
        FMT.dec2,
        FMT.dec2,
        FMT.dec2,
        FMT.dec2,
        undefined,
        FMT.dec1,
        FMT.dec1,
        FMT.dec2,
        FMT.int,
        undefined,
        FMT.dec1,
        FMT.int,
        FMT.int,
        FMT.dec1,
        FMT.dec2,
        FMT.rub,
        FMT.rub,
        FMT.rub,
      ],
    );
  }
}

// ——————————————————————————— 5–6. CAPEX и OPEX ———————————————————————————

function linesSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput, which: "capex" | "opex"): void {
  const ws = sheet(wb, which === "capex" ? "CAPEX" : "OPEX", true);
  widths(ws, [30, 40, 18, 60, 60, 30, 44]);
  headerRow(ws, 1, LINES_HEADER);
  const totalLabel = which === "capex" ? "Итого CAPEX" : "Итого OPEX в год";
  let r = 2;
  for (const g of lineGroups(input.results, which)) {
    if (g.refusal !== null) {
      putRow(ws, r++, [g.scenarioTitle, "Не рассчитан", "—", g.refusal]);
      r++;
      continue;
    }
    const first = r;
    for (const l of g.lines) {
      putRow(
        ws,
        r++,
        [g.scenarioTitle, l.line.label, l.line.valueRub, l.line.formula, l.line.substituted, l.origin, l.note || "—"],
        [undefined, undefined, FMT.rub],
      );
    }
    const total = g.totalRub ?? 0;
    // Итог — живая сумма статей сценария; без статей (у «Как есть» нет CAPEX) — число.
    const value = g.lines.length > 0 ? formula(`SUM(C${first}:C${r - 1})`, total) : total;
    const row = putRow(ws, r++, [g.scenarioTitle, totalLabel, value], [undefined, undefined, FMT.rub]);
    row.font = { bold: true };
    r++;
  }
}

// ——————————————————————————— 7. Денежный поток ———————————————————————————

const CASHFLOW_XLSX_HEADER = [
  "Год",
  "CAPEX, ₽",
  "OPEX, ₽",
  "АКБ, ₽",
  "Докупка, ₽",
  "Эффект, ₽",
  "Поток, ₽",
  "Накопленный поток, ₽",
  "Дисконтированный поток, ₽",
] as const;

function labelValue(ws: ExcelJS.Worksheet, rowNum: number, label: string, value: Value, fmt?: string): void {
  putRow(ws, rowNum, [label, value], [undefined, fmt]);
  ws.getCell(rowNum, 1).font = { bold: true };
}

/**
 * Блок сценария на листе «Денежный поток»: исходные ячейки (ставка, горизонты, OPEX «Как есть»
 * и OPEX сценария), таблица t = 0…T и итоги формулами от ячеек таблицы. Возвращает номер
 * строки после блока.
 */
function cashflowBlock(ws: ExcelJS.Worksheet, results: ReportResults, res: ScenarioResult, start: number): number {
  let r = start;
  titleCell(ws, r++, `Сценарий: ${scenarioTitle(results, res)}`);
  if (res.status !== "ok") {
    labelValue(ws, r++, "Не рассчитан", res.refusal.message);
    if (res.refusal.fields.length > 0) labelValue(ws, r++, "Что заполнить", res.refusal.fields.join(", "));
    return r + 1;
  }
  const f = scenarioFinance(results, res);
  const asis = res.kind === "asis";

  const rateRow = r;
  labelValue(ws, r++, "Ставка дисконтирования", f.rate, FMT.rate);
  labelValue(ws, r++, "Горизонт расчёта H, лет", numOr(f.H));
  const tRow = r;
  labelValue(ws, r++, "Горизонт TCO T, лет", f.T);
  const asisRow = r;
  labelValue(ws, r++, "OPEX «Как есть» по охвату сравнения, ₽/год", f.opexAsisRub, FMT.rub);
  const opexRow = r;
  labelValue(ws, r++, "OPEX сценария в среднем за год, ₽/год", res.opexYearRub, FMT.rub);

  headerRow(ws, r++, CASHFLOW_XLSX_HEADER);
  const r0 = r;
  const rubFmts = [undefined, FMT.rub, FMT.rub, FMT.rub, FMT.rub, FMT.rub, FMT.rub, FMT.rub, FMT.rub];
  res.cashflows.forEach((c, t) => {
    const x = r0 + t;
    const effect: Value = t === 0 ? c.effectRub : formula(`$B$${asisRow}-C${x}`, c.effectRub);
    const flow: Value = t === 0 ? formula(`-B${x}`, c.cashflowRub) : formula(`F${x}-E${x}`, c.cashflowRub);
    const cumulative: Value = t === 0 ? formula(`G${x}`, c.cumulativeRub) : formula(`H${x - 1}+G${x}`, c.cumulativeRub);
    const discounted: Value = formula(`G${x}/(1+$B$${rateRow})^A${x}`, c.discountedRub);
    putRow(ws, x, [c.year, c.capexRub, c.opexRub, c.batteryRub, c.reinvestRub, effect, flow, cumulative, discounted], rubFmts);
  });
  r = r0 + res.cashflows.length + 1;

  const r1 = r0 + 1;
  const rT = r0 + Math.max(1, res.cashflows.length - 1);
  const capexRow = r;
  labelValue(ws, r++, "CAPEX, ₽", formula(`B${r0}`, res.capexRub), FMT.rub);
  const effRow = r;
  labelValue(ws, r++, "Годовой эффект в среднем, ₽/год", formula(`B${asisRow}-B${opexRow}`, res.effectYearRub), FMT.rub);

  if (asis) {
    labelValue(ws, r++, "Окупаемость, ROI, NPV", "не применимо: базовый сценарий без вложений");
  } else {
    labelValue(
      ws,
      r++,
      "Простой срок окупаемости, лет",
      formula(`IF(B${effRow}>0,B${capexRow}/B${effRow},"не окупается")`, res.paybackYears ?? "не окупается"),
      FMT.years,
    );
    const H = f.H;
    const rH = H !== null ? r0 + H : null;
    const roiRow = r;
    labelValue(
      ws,
      r++,
      `ROI по ТЗ за ${H !== null ? yearsCount(H) : "горизонт"}, %`,
      rH !== null
        ? formula(`IF(B${capexRow}>0,SUM(G${r1}:G${rH})/B${capexRow}*100,"—")`, res.roiTzPct ?? "—")
        : numOr(res.roiTzPct),
      FMT.pctUnits,
    );
    labelValue(
      ws,
      r++,
      "ROI чистый (ROI по ТЗ − 100 %), %",
      formula(`IF(ISNUMBER(B${roiRow}),B${roiRow}-100,"—")`, res.roiNetPct ?? "—"),
      FMT.pctUnits,
    );
    // Функция Excel NPV дисконтирует уже первое значение диапазона (как поток года 1), а
    // вложения года 0 не дисконтируются. Поэтому поток года 0 прибавляется отдельно:
    // NPV = G(год 0) + NPV(ставка; G(год 1) : G(год H)) — ровно Σ CFt / (1 + r)^t, t = 0…H.
    labelValue(
      ws,
      r++,
      `NPV за ${H !== null ? yearsCount(H) : "горизонт"}, ₽`,
      rH !== null ? formula(`G${r0}+NPV(B${rateRow},G${r1}:G${rH})`, numOr(res.npvRub)) : numOr(res.npvRub),
      FMT.rub,
    );
    labelValue(
      ws,
      r++,
      "Дисконтированная окупаемость, лет",
      numOr(res.discountedPaybackYears, "не окупается в горизонте"),
      FMT.years,
    );
    if (res.kind === "raas") labelValue(ws, r++, "Примечание", RAAS_ROI_NOTE);
  }

  // TCO = CAPEX + Σ (OPEXt + докупкаt) за t = 1…T.
  const tcoRow = r;
  labelValue(
    ws,
    r++,
    `TCO за ${yearsCount(f.T)}, ₽`,
    formula(`B${r0}+SUM(C${r1}:C${rT})+SUM(E${r1}:E${rT})`, res.tcoRub),
    FMT.rub,
  );
  const tcoAsisRow = r;
  labelValue(
    ws,
    r++,
    `TCO «Как есть» за ${yearsCount(f.T)}, ₽`,
    formula(`B${tRow}*B${asisRow}`, f.T * f.opexAsisRub),
    FMT.rub,
  );
  if (!asis) {
    labelValue(
      ws,
      r++,
      "Изменение TCO к «Как есть», ₽",
      formula(`B${tcoRow}-B${tcoAsisRow}`, res.tcoDeltaVsAsIsRub),
      FMT.rub,
    );
  }
  return r + 1;
}

function cashflowSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Денежный поток", false);
  widths(ws, [46, 20, 20, 16, 16, 20, 20, 22, 24]);
  titleCell(ws, 1, "Денежный поток по сценариям (год 0 — вложения; суммы в ₽)");
  noteRow(
    ws,
    2,
    "Эффект года = OPEX «Как есть» − OPEX года; поток = эффект − докупка; NPV, ROI и TCO — формулы от ячеек таблицы.",
  );
  let r = 4;
  for (const res of input.results.results) r = cashflowBlock(ws, input.results, res, r);
}

// ——————————————————————————— 8. Чувствительность ———————————————————————————

function sensitivitySheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Чувствительность", true);
  widths(ws, [30, 40, 14, 14, 14, 14, 16, 18, 18, 18, 14, 14, 18, 18, 14]);
  headerRow(ws, 1, SENSITIVITY_HEADER);
  let r = 2;
  const groups = sensitivityGroups(input.results);
  if (groups.length === 0) noteRow(ws, r++, "Анализ чувствительности не выполнялся: нет рассчитанных сценариев роботизации");
  for (const g of groups) {
    // У «Как есть» нет вложений: NPV и окупаемость не применимы, рычаги меняют только TCO.
    const none = g.kind === "asis" ? "—" : "не окупается";
    for (const s of g.rows) {
      const row = putRow(
        ws,
        r++,
        [
          g.scenarioTitle,
          s.label,
          s.unit,
          s.base,
          s.low,
          s.high,
          s.boundsSource,
          numOr(s.npvLow),
          numOr(s.npvHigh),
          s.swing,
          numOr(s.paybackLow, none),
          numOr(s.paybackHigh, none),
          s.tcoLow,
          s.tcoHigh,
          s.signFlip ? "⚠ да" : "нет",
        ],
        [
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          FMT.rub,
          FMT.rub,
          FMT.rub,
          FMT.years,
          FMT.years,
          FMT.rub,
          FMT.rub,
        ],
      );
      if (s.signFlip) row.getCell(15).fill = FILL_WARN;
    }
  }
}

// ——————————————————————————— 9. Имитация ———————————————————————————

function simSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Имитация", true);
  const t = simTable(input.results);
  widths(ws, [40, ...t.columns.map(() => 32)]);
  let r = 1;
  if (t.columns.length === 0) {
    headerRow(ws, r++, ["Имитация"]);
    noteRow(
      ws,
      r++,
      "Имитация для этого расчёта не выполнялась: она запускается при сохранении проекта для сценариев, процесс которых её поддерживает.",
    );
  } else {
    headerRow(ws, r++, ["Показатель", ...t.columns.map((c) => c.title)]);
    t.labels.forEach((label, i) => {
      putRow(ws, r++, [label, ...(t.values[i] ?? [])]);
    });
  }
  if (t.notChecked.length > 0) {
    r++;
    noteRow(ws, r++, `Без имитации: ${t.notChecked.join("; ")}`);
  }
}

// ——————————————————————————— 10. Нормативы и допущения ———————————————————————————

function normsSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Нормативы и допущения", true);
  widths(ws, [18, 44, 26, 14, 12, 14, 10, 10, 18, 80, 60]);
  headerRow(ws, 1, NORMS_HEADER);
  let r = 2;
  for (const n of normsReportRows(input.results)) {
    const row = putRow(ws, r++, [
      n.group,
      n.label,
      n.key,
      n.value,
      n.unit,
      n.defaultValue,
      numOr(n.min),
      numOr(n.max),
      n.origin,
      n.basis,
      n.source,
    ]);
    row.getCell(10).alignment = { vertical: "top", wrapText: true };
    if (n.changed) row.getCell(4).fill = FILL_CAUTION;
  }
  const overrides = normOverrideRows(input.results);
  if (overrides.length > 0) {
    r++;
    titleCell(ws, r++, "Нормативы, переопределённые в сценариях");
    headerRow(ws, r++, ["Сценарий", "Норматив", "Ключ", "Значение", "Ед."]);
    for (const o of overrides) putRow(ws, r++, [o.scenarioTitle, o.label, o.key, o.value, o.unit]);
  }
}

// ——————————————————————————— 11. Источники ———————————————————————————

function sourcesSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Источники", true);
  widths(ws, [30, 34, 30, 20, 13, 13, 60, 50]);
  headerRow(ws, 1, SOURCES_HEADER);
  let r = 2;
  const rows = sourcesRows(input.results);
  if (rows.length === 0) noteRow(ws, r++, "В расчёте нет продуктов с характеристиками");
  for (const s of rows) {
    putRow(ws, r++, [s.productName, s.label, s.value, s.origin, s.confirmed ? "да" : "нет", s.date ?? "—", linkOr(s.url), s.ref ?? "—"]);
  }
  r++;
  noteRow(
    ws,
    r++,
    "Источники параметров объекта — на листе «Параметры объекта», нормативов — на листе «Нормативы и допущения».",
  );
}

// ——————————————————————————— 12. Журнал корректировок ———————————————————————————

function changesSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const ws = sheet(wb, "Журнал корректировок", true);
  widths(ws, [20, 26, 28, 40, 16, 16, 16, 10, 40]);
  headerRow(ws, 1, CHANGES_HEADER);
  const labels = Object.fromEntries(input.defs.map((d) => [d.key, d.label]));
  const titles: Record<string, string> = {};
  for (const c of scenarioColumns(input.results)) {
    titles[c.key] = c.title;
    titles[c.name] = c.title;
  }
  const rows = changeRows(input.changes ?? [], { paramLabels: labels, scenarioTitles: titles });
  let r = 2;
  if (rows.length === 0) noteRow(ws, r++, "Корректировок в журнале нет");
  for (const c of rows) putRow(ws, r++, c.cells);
}

// ——————————————————————————— 13. О расчёте ———————————————————————————

function aboutSheet(wb: ExcelJS.Workbook, input: ProjectXlsxInput): void {
  const { results } = input;
  const ws = sheet(wb, "О расчёте", false);
  widths(ws, [44, 90, 18, 16]);
  titleCell(ws, 1, "О расчёте", 14);
  let r = 3;
  titleCell(ws, r++, "Версии");
  const versions: [string, string][] = [
    ["Дата расчёта", formatCalcDate(results.calculatedAt)],
    ["Модель расчёта", results.modelVersion],
    ["Модель имитации", results.simModelVersion],
    ["Версия данных проекта (хэш снимков продуктов и нормативов)", results.dataVersion],
    ["Датасеты организатора в этой сборке", ORGANIZER_DATA_VERSION.datasets],
    ["Каталог организатора в этой сборке", ORGANIZER_DATA_VERSION.catalog],
    ["«Примеры решений» организатора в этой сборке", ORGANIZER_DATA_VERSION.examples],
    ["Исследование открытых источников", ORGANIZER_DATA_VERSION.research],
  ];
  for (const [k, v] of versions) putRow(ws, r++, [k, v]);
  r++;

  titleCell(ws, r++, "Как устроен файл");
  const notes = [
    "Числа — результат расчёта платформы на момент выгрузки. Итоги CAPEX и OPEX, эффект и поток каждого года, окупаемость, ROI, NPV и TCO записаны живыми формулами Excel от ячеек таблиц: при изменении ячейки итоги пересчитываются.",
    "NPV записан как «поток года 0 + NPV(ставка; потоки лет 1…H)»: функция Excel NPV дисконтирует уже первое значение диапазона, поэтому вложения года 0 прибавляются отдельно.",
    "В русском Excel аргументы формул разделяются «;», а в файле хранятся через «,» — Excel покажет их сам.",
    MANUAL_NOTE,
  ];
  for (const n of notes) putRow(ws, r++, ["", n]);
  r++;

  titleCell(ws, r++, "Формулы модели");
  headerRow(ws, r++, ["Показатель", "Формула", "Единицы", "Источник формулы"]);
  for (const f of formulaRows()) {
    const row = putRow(ws, r++, [f.title, f.expression, f.units, f.source]);
    row.getCell(2).alignment = { vertical: "top", wrapText: true };
  }
  r++;

  titleCell(ws, r++, "Ограничения модели");
  for (const l of modelLimitations()) {
    const row = putRow(ws, r++, ["", l]);
    row.getCell(2).alignment = { vertical: "top", wrapText: true };
  }
  r++;
  disclaimerCell(ws, r, disclaimerOf(results));
}

// ——————————————————————————— Сборка книги ———————————————————————————

/**
 * Книга XLSX проекта: 13 листов (`XLSX_SHEET_NAMES`) — сводка с выводом и таблицей сценариев,
 * параметры, подбор и сравнение, состав оборудования, статьи CAPEX и OPEX, денежный поток с
 * формулами, чувствительность, имитация, нормативы, источники, журнал корректировок и лист «О
 * расчёте» (версии, формулы, ограничения, оговорка). Сценарий с решением, добавленным вручную,
 * везде помечен ⚠.
 */
export async function buildProjectXlsx(input: ProjectXlsxInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Платформа оценки роботизации";
  wb.title = `Предварительная оценка роботизации — ${input.projectName}`;
  // Excel пересчитает формулы при открытии; кешированные результаты — числа платформы.
  wb.calcProperties.fullCalcOnLoad = true;

  summarySheet(wb, input);
  paramsSheet(wb, input);
  selectionSheet(wb, input);
  equipmentSheet(wb, input);
  linesSheet(wb, input, "capex");
  linesSheet(wb, input, "opex");
  cashflowSheet(wb, input);
  sensitivitySheet(wb, input);
  simSheet(wb, input);
  normsSheet(wb, input);
  sourcesSheet(wb, input);
  changesSheet(wb, input);
  aboutSheet(wb, input);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
