"use client";

import { formatRub } from "@/lib/format/rub";
import type { CashflowRow } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Денежный поток сценария по годам t = 0…T (ТЗ §3.5.2: TCO на горизонте не менее 5 лет с
 * заменой основных компонентов). Год 0 — вложения (CAPEX); OPEX года уже содержит фактическую
 * замену АКБ этого года вместо средней; докупка оборудования — по сроку службы.
 *
 * NPV, ROI и дисконтированная окупаемость считаются по первым H годам (горизонт расчёта), TCO —
 * по всем T годам. Годы после H, если `horizonYears` передан, приглушены и подписаны «только
 * TCO», чтобы строки таблицы не спорили с NPV в таблице сценариев.
 */

/** Колонки таблицы: ключ строки CashflowRow и русский заголовок. */
export const CASHFLOW_COLUMNS: readonly { key: Exclude<keyof CashflowRow, "year">; label: string }[] = [
  { key: "capexRub", label: "CAPEX" },
  { key: "opexRub", label: "OPEX" },
  { key: "batteryRub", label: "в т. ч. замена АКБ" },
  { key: "reinvestRub", label: "Докупка оборудования" },
  { key: "effectRub", label: "Эффект" },
  { key: "cashflowRub", label: "Денежный поток" },
  { key: "cumulativeRub", label: "Накопленный поток" },
  { key: "discountedRub", label: "Дисконтированный поток" },
  { key: "cumulativeDiscountedRub", label: "Накопленный дисконтированный" },
];

const TH = "px-3 py-2 text-right font-medium text-muted-foreground";
const TD = "border-t px-3 py-1.5 text-right tabular-nums whitespace-nowrap";

export function CashflowTable({
  rows,
  horizonYears,
  title = "Денежный поток по годам",
}: {
  rows: readonly CashflowRow[];
  /** Горизонт расчёта H: годы после него входят только в TCO. */
  horizonYears?: number;
  title?: string;
  /** Для единообразия с отчётом: элементов управления здесь нет, вид не меняется. */
  print?: boolean;
}) {
  if (rows.length === 0) return null;
  const afterHorizon = (year: number) => horizonYears !== undefined && year > horizonYears;
  const hasTail = rows.some((r) => afterHorizon(r.year));
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="data-table-wrap">
        <table className="print-table w-full border-collapse text-sm">
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={`${TH} text-left`}>
                Год
              </th>
              {CASHFLOW_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className={TH}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className={cn(afterHorizon(r.year) && "text-muted-foreground")}>
                <th scope="row" className="border-t px-3 py-1.5 text-left font-normal whitespace-nowrap">
                  {r.year}
                  {afterHorizon(r.year) && <span className="ml-1 text-xs">(только TCO)</span>}
                </th>
                {CASHFLOW_COLUMNS.map((c) => (
                  <td key={c.key} className={cn(TD, r[c.key] < 0 && !afterHorizon(r.year) && "text-destructive")}>
                    {formatRub(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Поток года = OPEX «Как есть» − OPEX сценария − докупка; год 0 — вложения. OPEX года уже содержит
        фактическую замену АКБ этого года.
        {hasTail && " Годы после горизонта расчёта входят только в TCO, но не в NPV и ROI."}
      </p>
    </div>
  );
}
