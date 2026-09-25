"use client";

import { formatYearsRu, pluralRu } from "@/lib/format/plural";
import { formatPct, formatRub } from "@/lib/format/rub";
import { BOTTLENECK_LABELS } from "@/lib/sim/export-rows";
import type { SimSummaryStored } from "@/lib/sim/types";
import { isViableScenario, pickRecommended } from "@/lib/tz/econ/conclusion";
import { interpretBand } from "@/lib/tz/econ/interpret";
import { DEFAULT_NORMS, type NormValues } from "@/lib/tz/norms";
import type { Risk, ScenarioOk, ScenarioResult } from "@/lib/tz/types";
import { cn } from "@/lib/utils";
import { RefusalNote } from "./refusal-note";

/**
 * Таблица сценариев (ТЗ §2.2 шаг 6 — базовый и альтернативные сценарии в одной таблице;
 * §3.5.5 — текущий процесс, покупка и услуга; §3.7.1 — сравнение сценариев). Колонки —
 * сценарии, строки — показатели в фиксированном порядке `SCENARIO_ROWS`; тот же порядок
 * использует отчёт.
 *
 * Отказ расчёта занимает всю колонку сценария (RefusalNote), а не превращается в нули.
 * Рекомендуемый сценарий (наибольший NPV среди жизнеспособных) выделен и помечен ★. У RaaS
 * ROI показан приглушённо с пометкой: при почти нулевом CAPEX отношение к CAPEX теряет смысл,
 * сравнивать нужно NPV и TCO.
 */

/** Строки таблицы сценариев в порядке показа. «TCO за {T} лет» подставляется по горизонту. */
export const SCENARIO_ROWS = [
  { key: "composition", label: "Состав оборудования" },
  { key: "capex", label: "CAPEX" },
  { key: "opex", label: "OPEX в год" },
  { key: "labour", label: "ФОТ процесса" },
  { key: "effect", label: "Годовой эффект" },
  { key: "payback", label: "Окупаемость (простая)" },
  { key: "band", label: "Интерпретация" },
  { key: "roiTz", label: "ROI по ТЗ" },
  { key: "roiNet", label: "ROI чистый" },
  { key: "npv", label: "NPV" },
  { key: "dpb", label: "Дисконтированная окупаемость" },
  { key: "tco", label: "TCO за {T} лет" },
  { key: "tcoDelta", label: "Изменение TCO к «Как есть»" },
  { key: "sim", label: "Имитация" },
  { key: "risks", label: "Риски" },
  { key: "verdict", label: "Вывод" },
] as const;

export type ScenarioRowKey = (typeof SCENARIO_ROWS)[number]["key"];

/** Пометка к ROI сценария RaaS (тот же текст, что у риска RAAS_ROI_UNINFORMATIVE). */
export const RAAS_ROI_NOTE = "ROI неинформативен при малом CAPEX — сравнивайте NPV и TCO";

/** Подпись строки; для TCO — с горизонтом и согласованием («за 5 лет», «за 21 год»). */
export function scenarioRowLabel(key: ScenarioRowKey, tcoYears: number): string {
  if (key === "tco") return `TCO за ${tcoYears} ${pluralRu(tcoYears, ["год", "года", "лет"])}`;
  return SCENARIO_ROWS.find((r) => r.key === key)?.label ?? key;
}

/** «10 роботов · 1 зарядка · 1 пост диспетчера»; несколько позиций — через «;» с названием. */
export function compositionText(result: ScenarioResult): string {
  if (result.kind === "asis") return "Без роботов: текущий процесс";
  if (result.items.length === 0) return "—";
  const one = (it: ScenarioResult["items"][number]): string => {
    const parts: string[] = [];
    if (it.n !== null) parts.push(`${it.n} ${pluralRu(it.n, ["робот", "робота", "роботов"])}`);
    if (it.chargers > 0) parts.push(`${it.chargers} ${pluralRu(it.chargers, ["зарядка", "зарядки", "зарядок"])}`);
    if (it.operatorPosts > 0) {
      parts.push(`${it.operatorPosts} ${pluralRu(it.operatorPosts, ["пост", "поста", "постов"])} диспетчера`);
    }
    return parts.join(" · ") || "—";
  };
  if (result.items.length === 1) {
    const [it] = result.items;
    return it ? one(it) : "—";
  }
  return result.items.map((it) => `${it.productName}: ${one(it)}`).join("; ");
}

/** Ячейка «Имитация»: «✓ подтверждено» | «✗ не подтверждено: {узкое место}» | «—». */
export function simCellText(s: SimSummaryStored | null | undefined): string {
  if (!s) return "—";
  if (s.verdict === "CONFIRMED") return s.oversized ? "✓ подтверждено (парк избыточен)" : "✓ подтверждено";
  if (s.verdict === "NOT_CONFIRMED") return `✗ не подтверждено: ${BOTTLENECK_LABELS[s.bottleneck]}`;
  return "—";
}

const SEVERITY_LABELS: Readonly<Record<Risk["severity"], string>> = {
  high: "высокий",
  medium: "средний",
  low: "низкий",
};

/** Число рисков с согласованием: «3 риска, высоких: 1». */
export function risksSummary(risks: readonly Risk[]): string {
  if (risks.length === 0) return "нет";
  const high = risks.filter((r) => r.severity === "high").length;
  const base = `${risks.length} ${pluralRu(risks.length, ["риск", "риска", "рисков"])}`;
  return high > 0 ? `${base}, высоких: ${high}` : base;
}

export type ScenarioCell = {
  text: string;
  /** Показатель неинформативен — приглушить. */
  muted?: boolean;
  /** Пояснение под значением. */
  note?: string;
  tone?: "good" | "bad";
};

type CellCtx = {
  sim?: SimSummaryStored | null;
  recommended: boolean;
  bands: Pick<NormValues, "paybackBandFastYears" | "paybackBandSlowYears">;
};

function signedRub(v: number): string {
  if (v > 0) return `+${formatRub(v)}`;
  return formatRub(v);
}

/**
 * Текст ячейки рассчитанного сценария по ключу строки. Чистая функция: её же проверяют тесты,
 * а отчёт получает те же строки, что и экран.
 */
export function scenarioCell(key: ScenarioRowKey, r: ScenarioOk, ctx: CellCtx): ScenarioCell {
  const asis = r.kind === "asis";
  const dash: ScenarioCell = { text: "—", muted: true };
  switch (key) {
    case "composition":
      return { text: compositionText(r) };
    case "capex":
      return { text: formatRub(r.capexRub) };
    case "opex":
      return { text: formatRub(r.opexYearRub) };
    case "labour":
      return { text: formatRub(r.processLabourYearRub) };
    case "effect":
      if (asis) return { text: "база сравнения", muted: true };
      return { text: formatRub(r.effectYearRub), tone: r.effectYearRub > 0 ? "good" : "bad" };
    case "payback":
      if (asis) return dash;
      return r.paybackYears === null ? { text: "не окупается", tone: "bad" } : { text: formatYearsRu(r.paybackYears) };
    case "band":
      if (asis) return dash;
      return { text: interpretBand(r.paybackYears, ctx.bands).text };
    case "roiTz":
    case "roiNet": {
      if (asis) return dash;
      const v = key === "roiTz" ? r.roiTzPct : r.roiNetPct;
      // До десятых — как в трассировке, контрольном примере и выгрузке CSV/XLSX (140,3 %).
      const text = formatPct(v, 1);
      return r.kind === "raas" ? { text, muted: true, note: RAAS_ROI_NOTE } : { text };
    }
    case "npv":
      if (asis || r.npvRub === null) return dash;
      return { text: formatRub(r.npvRub), tone: r.npvRub >= 0 ? "good" : "bad" };
    case "dpb":
      if (asis) return dash;
      return r.discountedPaybackYears === null
        ? { text: "не окупается за горизонт", tone: "bad" }
        : { text: formatYearsRu(r.discountedPaybackYears) };
    case "tco":
      return { text: formatRub(r.tcoRub) };
    case "tcoDelta":
      if (asis) return { text: "база сравнения", muted: true };
      return { text: signedRub(r.tcoDeltaVsAsIsRub), tone: r.tcoDeltaVsAsIsRub < 0 ? "good" : "bad" };
    case "sim":
      return { text: simCellText(ctx.sim), muted: !ctx.sim };
    case "risks":
      return { text: risksSummary(r.risks) };
    case "verdict":
      if (asis) return { text: "База сравнения", muted: true };
      if (ctx.recommended) return { text: "★ Рекомендуется: наибольший NPV среди окупаемых", tone: "good" };
      return isViableScenario(r)
        ? { text: "Окупается за горизонт, но уступает по NPV" }
        : { text: "Не окупается за горизонт расчёта", tone: "bad" };
  }
}

const TH = "px-3 py-2 text-left align-bottom font-medium";
const TD = "border-t px-3 py-2 align-top";
const TOP_RISKS = 3;

function RisksCell({ risks, print }: { risks: readonly Risk[]; print: boolean }) {
  const top = risks.slice(0, TOP_RISKS);
  const rest = risks.slice(TOP_RISKS);
  return (
    <div className="flex flex-col gap-1">
      <span>{risksSummary(risks)}</span>
      {top.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {top.map((r) => (
            <li key={`${r.code}-${r.text}`}>
              <span className="font-medium text-foreground">{SEVERITY_LABELS[r.severity]}</span> · {r.text}{" "}
              <span className="font-mono">[{r.code}]</span>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 &&
        (print ? (
          <span className="text-xs text-muted-foreground">и ещё {rest.length} — в разделе рисков</span>
        ) : (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">ещё {rest.length}</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {rest.map((r) => (
                <li key={`${r.code}-${r.text}`}>
                  <span className="font-medium text-foreground">{SEVERITY_LABELS[r.severity]}</span> · {r.text}{" "}
                  <span className="font-mono">[{r.code}]</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
    </div>
  );
}

export function ScenarioTable({
  results,
  sim = {},
  tcoYears,
  recommendedKey,
  norms = DEFAULT_NORMS,
  print = false,
  readOnly = false,
  paramLabels,
}: {
  results: readonly ScenarioResult[];
  /** Сводки имитации по ключу сценария; null или нет ключа — имитацией не проверялся. */
  sim?: Readonly<Record<string, SimSummaryStored | null>>;
  /** Горизонт TCO, лет (T = max(H, минимальный горизонт TCO)). */
  tcoYears: number;
  /** Рекомендуемый сценарий из вывода (Conclusion.recommendedScenarioKey); не передан — то же правило здесь. */
  recommendedKey?: string | null;
  /** Нормативы — границы интервалов окупаемости для строки «Интерпретация». */
  norms?: Pick<NormValues, "paybackBandFastYears" | "paybackBandSlowYears">;
  /** Вариант для отчёта: без раскрывающихся элементов. */
  print?: boolean;
  /** Только чтение (гость, чужой снимок): отказ не зовёт к кнопкам исправления. */
  readOnly?: boolean;
  /** Подписи параметров объекта — для полей отказа 'param:<ключ>'. */
  paramLabels?: Readonly<Record<string, string>>;
}) {
  const recKey = recommendedKey === undefined ? (pickRecommended(results)?.key ?? null) : recommendedKey;
  const rowCount = SCENARIO_ROWS.length;
  const colClass = (key: string) => cn(key === recKey && "bg-primary/5");

  return (
    <div className="data-table-wrap">
      <table className="print-table w-full border-collapse text-sm">
        <caption className="sr-only">Сравнение сценариев: показатели по столбцам сценариев</caption>
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={`${TH} text-muted-foreground`}>
              Показатель
            </th>
            {results.map((r) => {
              const manual = r.items.some((it) => it.manuallyAdded);
              return (
                <th key={r.key} scope="col" className={cn(TH, "min-w-48", colClass(r.key))}>
                  {r.key === recKey && (
                    <span className="mr-1 text-positive" aria-label="Рекомендуемый сценарий">
                      ★
                    </span>
                  )}
                  {r.name}
                  {manual && (
                    <span className="ml-1 text-caution" title="В сценарии есть решение, добавленное вручную">
                      ⚠
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {SCENARIO_ROWS.map((row, ri) => (
            <tr key={row.key}>
              <th scope="row" className={`${TD} text-left font-normal text-muted-foreground whitespace-nowrap`}>
                {scenarioRowLabel(row.key, tcoYears)}
              </th>
              {results.map((r) => {
                if (r.status === "refused") {
                  return ri === 0 ? (
                    <td key={r.key} rowSpan={rowCount} className={cn(TD, "min-w-48", colClass(r.key))}>
                      <RefusalNote refusal={r.refusal} paramLabels={paramLabels} actionable={!print && !readOnly} />
                    </td>
                  ) : null;
                }
                if (row.key === "risks") {
                  return (
                    <td key={r.key} className={cn(TD, colClass(r.key))}>
                      {r.kind === "asis" ? <span className="text-muted-foreground">—</span> : <RisksCell risks={r.risks} print={print} />}
                    </td>
                  );
                }
                const c = scenarioCell(row.key, r, { sim: sim[r.key], recommended: r.key === recKey, bands: norms });
                return (
                  <td
                    key={r.key}
                    className={cn(
                      TD,
                      colClass(r.key),
                      row.key !== "composition" && row.key !== "band" && row.key !== "verdict" && "tabular-nums",
                      c.muted && "text-muted-foreground",
                      c.tone === "good" && !c.muted && "text-positive",
                      c.tone === "bad" && !c.muted && "text-destructive",
                      row.key === "verdict" && "font-medium",
                    )}
                  >
                    {c.text}
                    {c.note && <div className="mt-0.5 text-xs text-muted-foreground">{c.note}</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
