import { toCsv, type CsvCell } from "../../files/csv";
import type { ScenarioOk } from "../../tz/types";
import {
  CASHFLOW_HEADER,
  MANUAL_NOTE,
  RAAS_ROI_NOTE,
  disclaimerOf,
  facilityLabelOf,
  formatCalcDate,
  kindUnit,
  scenarioColumns,
  scenarioFinance,
  scenarioTableRows,
  scenarioTitle,
  yearsCount,
  type CellKind,
  type ReportResults,
} from "./rows";

/**
 * Выгрузка проекта в CSV для русского Excel (ТЗ §3.7.3): BOM, разделитель «;», десятичная
 * запятая, CRLF и защита от формул — всё это делает `toCsv` из lib/files/csv. Модуль без
 * библиотеки XLSX и без Node-зависимостей: гостевой расчёт собирает CSV прямо в браузере.
 *
 * Содержание по порядку: шапка (проект, объект, дата, версии), сравнение сценариев с выводом,
 * денежные потоки каждого рассчитанного сценария и последней строкой — оговорка о
 * предварительной оценке.
 *
 * Числа пишутся числами (без пробелов и «₽»), а единица — в подписи строки или столбца: иначе
 * Excel прочтёт «35 420 000 ₽» как текст, а «-640 375» защита от формул превратит в «'-640 375».
 */

/** Округление числа для CSV по виду строки: рубли — до рубля, годы — до сотых, проценты — до десятых. */
function csvNumber(v: number, kind: CellKind): number {
  if (kind === "rub") return Math.round(v);
  if (kind === "years") return Math.round(v * 100) / 100;
  if (kind === "pct") return Math.round(v * 10) / 10;
  return v;
}

function withUnit(label: string, kind: CellKind): string {
  const u = kindUnit(kind);
  return u ? `${label}, ${u}` : label;
}

function cashflowSection(results: ReportResults, r: ScenarioOk): CsvCell[][] {
  const f = scenarioFinance(results, r);
  const rows: CsvCell[][] = [];
  rows.push([`Денежный поток: ${scenarioTitle(results, r)}`]);
  rows.push([
    "Ставка дисконтирования, %",
    Math.round(f.rate * 1000) / 10,
    "Горизонт расчёта, лет",
    f.H ?? "—",
    "Горизонт TCO, лет",
    f.T,
  ]);
  rows.push(CASHFLOW_HEADER.map((h, i) => (i === 0 ? h : `${h}, ₽`)));
  for (const c of r.cashflows) {
    rows.push([
      c.year,
      Math.round(c.capexRub),
      Math.round(c.opexRub),
      Math.round(c.batteryRub),
      Math.round(c.reinvestRub),
      Math.round(c.effectRub),
      Math.round(c.cashflowRub),
      Math.round(c.cumulativeRub),
    ]);
  }
  const summary: CsvCell[] = [];
  if (r.kind !== "asis") {
    summary.push("NPV, ₽", r.npvRub === null ? "—" : Math.round(r.npvRub));
    summary.push("ROI по ТЗ, %", r.roiTzPct === null ? "—" : Math.round(r.roiTzPct * 10) / 10);
  }
  summary.push(`TCO за ${yearsCount(f.T)}, ₽`, Math.round(r.tcoRub));
  rows.push(summary);
  return rows;
}

/**
 * CSV проекта: сравнение сценариев, денежные потоки по сценариям и оговорка последней строкой.
 * `projectName` проходит через защиту от формул: имя «=cmd» станет текстом «'=cmd».
 */
export function projectCsv(results: ReportResults, opts: { projectName: string }): string {
  const cols = scenarioColumns(results);
  const table = scenarioTableRows(results);
  const rows: CsvCell[][] = [];

  rows.push(["Предварительная оценка роботизации", opts.projectName]);
  rows.push(["Тип объекта", facilityLabelOf(results.facility)]);
  rows.push(["Дата расчёта", formatCalcDate(results.calculatedAt)]);
  rows.push(["Модель расчёта", results.modelVersion]);
  rows.push(["Модель имитации", results.simModelVersion]);
  rows.push(["Версия данных", results.dataVersion]);
  rows.push([]);

  rows.push(["Сравнение сценариев"]);
  rows.push(["Показатель", ...cols.map((c) => c.title)]);
  for (const row of table) {
    rows.push([
      withUnit(row.label, row.kind),
      ...row.values.map((v, i) => (v === null ? (row.cells[i] ?? "—") : csvNumber(v, row.kind))),
    ]);
  }
  rows.push(["Вывод по проекту", results.conclusion.headline]);
  for (const b of results.conclusion.bullets) rows.push(["", b]);
  if (cols.some((c) => c.kind === "raas")) rows.push(["Примечание", `ROI услуги (RaaS): ${RAAS_ROI_NOTE}`]);
  if (cols.some((c) => c.manual)) rows.push(["Примечание", MANUAL_NOTE]);
  rows.push([]);

  for (const r of results.results) {
    if (r.status === "ok") {
      rows.push(...cashflowSection(results, r));
    } else {
      rows.push([`Денежный поток: ${scenarioTitle(results, r)}`]);
      rows.push(["Не рассчитан", r.refusal.message]);
    }
    rows.push([]);
  }

  rows.push([disclaimerOf(results)]);
  return toCsv(rows);
}
