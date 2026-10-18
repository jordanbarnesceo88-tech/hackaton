"use client";

import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMlnRub, formatNum, formatPct } from "@/lib/format/rub";
import { formatYearsRu } from "@/lib/format/plural";
import { originLabel } from "@/lib/tz/characteristics";
import type { MatchedComparison as Comparison, MatchedPhysicalState } from "@/lib/tz/matched-comparison";
import { matchedComparisonCsv, matchedComparisonExport } from "@/lib/tz/matched-comparison";
import type { ScenarioSpec } from "@/lib/tz/types";
import { refusalMessage } from "./refusal-note";

export type MatchedComparisonProps = {
  comparison: Comparison;
  onAdopt?: (spec: ScenarioSpec) => void;
  readOnly?: boolean;
};
const PHYSICAL_LABEL: Record<MatchedPhysicalState["status"], string> = {
  confirmed: "Подтверждено моделью", partial: "Нагрузка выполнена частично", failed: "Проверка не пройдена",
  stale: "Проверка устарела", "not-checked": "Нужна проверка потока", unavailable: "Нет входа для проверки",
};

function exportComparison(comparison: Comparison, format: "json" | "csv") {
  const content = format === "json" ? JSON.stringify(matchedComparisonExport(comparison), null, 2) : matchedComparisonCsv(comparison);
  const url = URL.createObjectURL(new Blob([content], { type: `${format === "json" ? "application/json" : "text/csv"};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url; link.download = `warehouse-matched-comparison.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Money is the existing engine's result; physical status is an independent observation. */
export function MatchedComparison({ comparison, onAdopt, readOnly = false }: MatchedComparisonProps) {
  const a = comparison.assumptions;
  const staffing = a.staffing
    ? a.staffing.mode === "dedicated" ? "Отдельный персонал эксплуатации" : a.staffing.mode === "shared-existing" ? "Дополнительные часы текущего персонала" : "Обслуживание интегратором"
    : "Норматив постов эксплуатации исходной модели";
  return <Card data-matched-comparison={comparison.sourceKey}>
    <CardHeader className="flex flex-wrap items-start justify-between gap-3 sm:flex-row">
      <div className="grid gap-2"><CardTitle>Сравнить модели и способы приобретения</CardTitle><p className="text-sm text-muted-foreground">Предварительная экономика на одной нагрузке и одном плане. До трёх моделей: покупка и RaaS.</p></div>
      {comparison.rows.length > 0 && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => exportComparison(comparison, "json")}>Сравнение JSON</Button><Button type="button" variant="outline" onClick={() => exportComparison(comparison, "csv")}>Сравнение CSV</Button></div>}
    </CardHeader>
    <CardContent className="grid min-w-0 gap-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Общие условия сравнения">
        <div><dt className="text-muted-foreground">План и нагрузка</dt><dd>{a.layout === "explicit" ? "Один явный план; зарядки фиксированы его точками" : "Одна типовая планировка и одинаковый спрос"}. Зерно {a.seed}.</dd></div>
        <div><dt className="text-muted-foreground">Годовой охват</dt><dd>{a.annualCoverageShare === null ? "По аналитической мощности; отдельная годовая оценка не задана" : `${formatPct(a.annualCoverageShare * 100)} — общая явная оценка`}</dd></div>
        <div><dt className="text-muted-foreground">Денежная реализация труда</dt><dd>{formatPct(a.cashRealizationShare * 100)}{a.cashRealizationExplicit ? " — явное условие" : " — значение по умолчанию"}. Высвобождение времени не означает сокращение штата.</dd></div>
        <div><dt className="text-muted-foreground">Эксплуатация</dt><dd>{staffing}; одинаковый режим для всех строк. Остаточная стоимость — 0 во всём сравнении.</dd></div>
      </dl>
      {comparison.reason && <p className="callout text-sm" data-tone="warning">{comparison.reason}</p>}
      {comparison.rows.length > 0 && <>
        <p className="text-sm">NPV: горизонт {a.horizonYears ?? "не определён"} лет, ставка {formatPct(a.discountRate * 100, 2)}. Общие нормативы и трудовые допущения взяты из исходного сценария.</p>
        <p className="text-sm">У исходной модели сохраняется заданный парк; у других парк рассчитан по их характеристикам. Цены, сервисные корректировки и пакет исходного продукта другим моделям не передаются. Условия доставки сохраняются только для исходного продукта и способа приобретения; остальные варианты требуют своей оценки. Смета пилота задаётся после выбора.</p>
        <div className="max-w-full overflow-x-auto"><table className="block w-full text-left text-sm md:table">
          <caption className="sr-only">Модели, состав, предварительные финансовые показатели и независимый статус физической проверки</caption>
          <thead className="hidden md:table-header-group"><tr className="border-b border-border"><th className="p-2">Модель / условия</th><th className="p-2">N / C</th><th className="p-2">CAPEX</th><th className="p-2">OPEX/год</th><th className="p-2">NPV</th><th className="p-2">Окупаемость</th><th className="p-2">Проверка потока</th><th className="p-2">Выбор</th></tr></thead>
          <tbody className="grid gap-4 md:table-row-group">{comparison.rows.map(row => {
            const r = row.result, ok = r.status === "ok" ? r : null;
            const item = r.items[0], physical = row.physical;
            const refusal = r.status === "refused" ? refusalMessage(r.refusal, false) : null;
            const physicalReason = r.status === "refused" && physical.reason === r.refusal.message ? null : physical.reason;
            const fields = [
              ["CAPEX", ok ? formatMlnRub(ok.capexRub) : "Не рассчитан"],
              ["OPEX/год", ok ? formatMlnRub(ok.opexYearRub) : "Не рассчитан"],
              ["NPV", ok ? formatMlnRub(ok.npvRub) : "Не рассчитан"],
              ["Окупаемость", ok ? ok.paybackYears === null ? "Не достигается" : formatYearsRu(ok.paybackYears) : "Не рассчитана"],
            ];
            return <Fragment key={row.spec.key}><tr className="grid grid-cols-2 gap-x-3 rounded border border-border p-3 align-top md:table-row md:rounded-none md:border-x-0 md:border-b-0 md:p-0" data-comparison-row={row.spec.key}>
              <th scope="row" className="col-span-2 min-w-0 py-2 font-normal md:max-w-56 md:p-2"><strong className="block break-words">{row.product.name}</strong><span className="text-muted-foreground">{row.spec.kind === "purchase" ? "Покупка" : "RaaS"}</span>
                <details className="mt-2 text-xs"><summary className="cursor-pointer py-1">Основания затрат</summary><ul className="grid gap-2 py-2">{row.costBasis.map(note => <li key={note}>{note}</li>)}{ok && [...ok.capexLines, ...ok.opexLines].map((line, i) => <li key={`${line.key}-${i}`}>{line.label}: {originLabel(line.origin)}{line.originNote ? `; ${line.originNote}` : ""}.</li>)}</ul></details>
              </th>
              <td className="col-span-2 py-2 md:p-2"><span className="mr-2 text-muted-foreground md:hidden">Парк / зарядки</span><strong>{item?.n ?? "—"} / {item?.chargers ?? "—"}</strong><small className="mt-1 block text-muted-foreground">{row.fleetBasis === "source-fixed" ? "Парк задан в источнике" : "Парк по расчёту"}; {row.chargersBasis === "auto" ? "зарядки по модели" : row.chargersBasis === "fixed-site" ? "зарядки по плану" : "зарядки заданы"}</small></td>
              {fields.map(([label, value]) => <td key={label} className="py-2 tabular-nums md:p-2"><span className="block text-xs text-muted-foreground md:hidden">{label}</span>{value}</td>)}
              <td className="col-span-2 py-2 md:max-w-60 md:p-2"><strong className="text-xs">{PHYSICAL_LABEL[physical.status]}</strong>{physicalReason && <p className="mt-1 text-xs text-muted-foreground">{physicalReason}</p>}{physical.summary && <p className="mt-1 text-xs tabular-nums">{formatNum(physical.summary.achievedPerH, 6)} / {formatNum(physical.summary.requiredPerH, 6)} пал./ч; очередь {physical.summary.queueEnd}.</p>}{refusal && <p className="mt-2 text-xs" role="note">{refusal}</p>}</td>
              <td className="col-span-2 py-2 md:p-2"><Button type="button" variant="outline" disabled={readOnly || !onAdopt || !row.canAdopt} onClick={() => onAdopt?.(structuredClone(row.spec))}>Создать сценарий</Button>{!row.canAdopt && <p className="mt-1 text-xs text-muted-foreground">Сначала устраните причину недоступности.</p>}</td>
            </tr></Fragment>;
          })}</tbody>
        </table></div>
        <p className="text-xs text-muted-foreground">Цена и NPV не подтверждают выполнение нагрузки. Новый продукт и новый состав требуют отдельного прогона на исходном плане. Габариты, совместимость грузоносителя и интервал SOC зарядки требуют проверки источников; условный корпус 3D не подтверждает конструкцию каждой модели. Это короткий список, а не поиск глобального оптимума. Жёстко исключённых подбором: {comparison.excludedProducts}; других подходящих моделей вне списка: {comparison.additionalEligibleProducts}.</p>
      </>}
    </CardContent>
  </Card>;
}
