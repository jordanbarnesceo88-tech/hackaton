"use client";

import { formatRub } from "@/lib/format/rub";
import type { LineItem } from "@/lib/tz/types";
import { SourceBadge } from "./source-badge";

/**
 * Статьи CAPEX или OPEX с трассировкой (ТЗ §3.5.2 — CAPEX и OPEX по статьям; §3.5.8 — формула,
 * подстановка и источник каждой статьи). Таблица: Статья | Сумма | Формула | Источник.
 *
 * Статья RaaS, принятая входящей в подписку, показывает 0 ₽ и пометку «входит в подписку»:
 * это допущение модели, которое проверяется по договору, а не бесплатная статья.
 *
 * На экране длинное примечание к источнику («сервис производителя не опубликован — …»)
 * раскрывается из бейджа. В печатном варианте (`print`) раскрывающихся блоков нет: бейдж —
 * простая метка, а примечание печатается текстом под ним, чтобы в отчёте было видно,
 * на чём держится каждая статья (ТЗ §3.7.2).
 */

/** Сумма статей, ₽. */
export function linesTotal(lines: readonly LineItem[]): number {
  return lines.reduce((a, l) => a + l.valueRub, 0);
}

const TH = "px-3 py-2 text-left font-medium text-muted-foreground";
const TD = "border-t px-3 py-2 align-top";

export function LineItems({
  title,
  lines,
  totalLabel = "Итого",
  total,
  print = false,
}: {
  title: string;
  lines: readonly LineItem[];
  totalLabel?: string;
  /** Итог из результата движка (capexRub, opexYearRub); без него — сумма строк. */
  total?: number;
  /** Вариант для отчёта: примечание к источнику — текстом, без раскрытия. */
  print?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Статей нет.</p>
      ) : (
        <div className="data-table-wrap">
          <table className="print-table w-full border-collapse text-sm">
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>
                  Статья
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Сумма
                </th>
                <th scope="col" className={TH}>
                  Формула
                </th>
                <th scope="col" className={TH}>
                  Источник
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <th scope="row" className={`${TD} text-left font-normal`}>
                    {l.label}
                    {l.overridden && (
                      <span className="ml-2 rounded bg-caution/15 px-1.5 py-0.5 text-xs font-medium text-caution">
                        задано вами
                      </span>
                    )}
                  </th>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatRub(l.valueRub)}</td>
                  <td className={`${TD} min-w-64`}>
                    <div className="text-xs text-muted-foreground">{l.formula}</div>
                    <div className="mt-0.5 font-mono text-xs break-words">{l.substituted}</div>
                  </td>
                  <td className={`${TD} min-w-40`}>
                    {print ? (
                      <>
                        <SourceBadge origin={l.origin} />
                        {!l.includedInSubscription && l.originNote && (
                          <div className="mt-1 text-xs break-words text-muted-foreground">{l.originNote}</div>
                        )}
                      </>
                    ) : (
                      <SourceBadge origin={l.origin} note={l.includedInSubscription ? undefined : l.originNote} />
                    )}
                    {l.includedInSubscription && (
                      <div className="mt-1 text-xs text-caution">входит в подписку — допущение, проверить в договоре</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className={`${TD} text-left`}>
                  {totalLabel}
                </th>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatRub(total ?? linesTotal(lines))}</td>
                <td className={TD} colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
