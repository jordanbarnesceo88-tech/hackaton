"use client";

import { formatMRub, formatRub } from "@/lib/format/rub";
import { fx, rangeText } from "@/lib/tz/econ/text";
import type { SensitivityRow } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Анализ чувствительности сценария (ТЗ §3.5.6: минимум три параметра на сценарий; бонус —
 * расширенная чувствительность). Каждое плечо — полный пересчёт движком с одним изменённым
 * входом; здесь только показ: таблица и «торнадо» вокруг базового значения.
 *
 * Для сценариев роботизации результат — NPV, для «Как есть» (у него нет NPV) — TCO. Рычаг с
 * нулевым размахом не выбрасывается, а приглушается: исчезнувший рычаг выглядел бы как
 * забытый. Отказ расчёта на границе — не «нулевой размах»: такая строка не приглушается, а в
 * ячейках пишется «отказ расчёта», размах — прочерк. Смена знака NPV внутри диапазона отмечается ⚠ — это риск вывода, а не шум.
 *
 * SVG нарисован руками, без библиотеки графиков: цвета — токены темы --chart-1/--chart-2
 * (палитра проверена на контраст и цветовую слепоту, см. app/globals.css), подписи — токены
 * текста, у каждой полосы есть <title> для подсказки.
 */

export type SensitivityMetric = "npv" | "tco";

/** Значение рычага с единицей: доли — процентами (0,775 → «77,5 %»), остальное — как есть. */
export function leverValueText(v: number, unit: string): string {
  if (unit === "доля" || unit.startsWith("доля ")) {
    const tail = unit === "доля" ? "" : unit.slice("доля".length);
    return `${fx(v * 100, 1)} %${tail}`;
  }
  return `${fx(v)} ${unit}`;
}

/** Результат плеча на нижней и верхней границе для выбранной метрики; null — отказ расчёта. */
export function metricPair(row: SensitivityRow, metric: SensitivityMetric): [number | null, number | null] {
  return metric === "npv" ? [row.npvLow, row.npvHigh] : [row.tcoLow, row.tcoHigh];
}

/**
 * Рычаг не влияет на результат: обе границы посчитаны, а размах меньше полурубля (шум
 * двоичной арифметики — тоже «не влияет»). Если на границе отказ расчёта, движок пишет
 * размах 0, но это «не посчитано», а не «не влияет»: такая строка не приглушается.
 */
export function leverHasNoEffect(row: SensitivityRow, metric: SensitivityMetric): boolean {
  const [vLow, vHigh] = metricPair(row, metric);
  return vLow !== null && vHigh !== null && Math.abs(row.swing) < 0.5;
}

const TH = "px-3 py-2 text-left font-medium text-muted-foreground";
const TD = "border-t px-3 py-1.5 align-top";

// Геометрия диаграммы (единицы viewBox).
const ROW_H = 26;
const BAR_H = 14;
const PAD_LEFT = 230;
const PLOT_W = 420;
const PAD_RIGHT = 20;
const PAD_TOP = 26;
const PAD_BOTTOM = 8;

function Tornado({
  rows,
  metric,
  base,
}: {
  rows: readonly SensitivityRow[];
  metric: SensitivityMetric;
  base: number | null;
}) {
  const values: number[] = [];
  for (const r of rows) {
    for (const v of metricPair(r, metric)) if (v !== null && Number.isFinite(v)) values.push(v);
  }
  if (base !== null && Number.isFinite(base)) values.push(base);
  if (values.length === 0) return null;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1) {
    lo -= 1;
    hi += 1;
  }
  const x = (v: number) => PAD_LEFT + ((v - lo) / (hi - lo)) * PLOT_W;
  const width = PAD_LEFT + PLOT_W + PAD_RIGHT;
  const height = PAD_TOP + PAD_BOTTOM + rows.length * ROW_H;
  const metricLabel = metric === "npv" ? "NPV" : "TCO";
  const zeroInside = metric === "npv" && lo < 0 && hi > 0;

  return (
    <figure className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: "var(--chart-1)" }} />
          параметр на нижней границе
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: "var(--chart-2)" }} />
          параметр на верхней границе
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-foreground" />
          базовый расчёт
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          className="h-auto max-w-full"
          role="img"
          aria-label={`${metricLabel} при границах каждого параметра относительно базового расчёта; числа — в таблице выше`}
        >
          {base !== null && (
            <g>
              <line x1={x(base)} y1={PAD_TOP - 8} x2={x(base)} y2={height - PAD_BOTTOM} stroke="var(--foreground)" strokeWidth={1.5} />
              <text x={x(base)} y={PAD_TOP - 12} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                база {formatMRub(base)}
              </text>
            </g>
          )}
          {zeroInside && (
            <line
              x1={x(0)}
              y1={PAD_TOP - 4}
              x2={x(0)}
              y2={height - PAD_BOTTOM}
              stroke="var(--destructive)"
              strokeWidth={1}
              strokeDasharray="4 3"
            >
              <title>{`${metricLabel} = 0 ₽`}</title>
            </line>
          )}
          {rows.map((r, i) => {
            const y = PAD_TOP + i * ROW_H;
            const [vLow, vHigh] = metricPair(r, metric);
            const dim = leverHasNoEffect(r, metric);
            const from = base ?? vLow ?? vHigh ?? lo;
            const seg = (v: number | null, color: string, which: string) => {
              if (v === null) return null;
              const a = Math.min(x(from), x(v));
              const w = Math.max(2, Math.abs(x(v) - x(from)));
              return (
                <rect x={a} y={y} width={w} height={BAR_H} rx={2} fill={color}>
                  <title>{`${r.label}, ${which} ${leverValueText(which === "нижняя граница" ? r.low : r.high, r.unit)}: ${metricLabel} ${formatRub(v)}`}</title>
                </rect>
              );
            };
            return (
              <g key={r.lever} opacity={dim ? 0.4 : 1}>
                <text x={PAD_LEFT - 10} y={y + BAR_H - 3} textAnchor="end" fontSize={12} fill="var(--muted-foreground)">
                  {r.label}
                  {r.signFlip ? " ⚠" : ""}
                  {dim ? " — не влияет" : ""}
                </text>
                {seg(vLow, "var(--chart-1)", "нижняя граница")}
                {seg(vHigh, "var(--chart-2)", "верхняя граница")}
                {(vLow === null || vHigh === null) && (
                  <text x={PAD_LEFT + PLOT_W} y={y + BAR_H - 3} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
                    на границе — отказ расчёта
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export function SensitivityPanel({
  scenarioName,
  rows,
  metric,
  baseValue,
}: {
  scenarioName: string;
  rows: readonly SensitivityRow[];
  metric: SensitivityMetric;
  /** Базовый результат: NPV сценария (по умолчанию npvBase строк) или TCO для «Как есть». */
  baseValue?: number | null;
  /** Для единообразия с отчётом: элементов управления здесь нет, вид не меняется. */
  print?: boolean;
}) {
  const metricLabel = metric === "npv" ? "NPV" : "TCO";
  const base = baseValue ?? (metric === "npv" ? (rows[0]?.npvBase ?? null) : null);
  const anyClamped = rows.some((r) => r.clampedLow || r.clampedHigh);
  const flips = rows.filter((r) => r.signFlip).length;
  return (
    <section aria-label={`Чувствительность: ${scenarioName}`} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Чувствительность: {scenarioName}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Чувствительность не рассчитана: сценарий не рассчитан или у него нет параметров для перебора.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Каждая строка — полный пересчёт с одним параметром на границе диапазона; остальные входы — как в базовом
            расчёте. Размах — разница {metricLabel} между границами; строки отсортированы по размаху.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="print-table w-full border-collapse text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th scope="col" className={TH}>
                    Параметр
                  </th>
                  <th scope="col" className={TH}>
                    Диапазон
                  </th>
                  <th scope="col" className={TH}>
                    Источник границ
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {metricLabel} при нижнем
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {metricLabel} при верхнем
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Размах
                  </th>
                  {metric === "npv" && (
                    <th scope="col" className={TH}>
                      ⚠ смена знака
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [vLow, vHigh] = metricPair(r, metric);
                  const clamped = r.clampedLow || r.clampedHigh;
                  const noEffect = leverHasNoEffect(r, metric);
                  const refused = vLow === null || vHigh === null;
                  return (
                    <tr key={r.lever} className={cn(noEffect && "opacity-50")}>
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        {r.label}
                        {noEffect && <span className="ml-1 text-xs text-muted-foreground">(не влияет)</span>}
                      </th>
                      <td className={`${TD} tabular-nums`}>
                        {rangeText(r.low, r.high, r.unit)}
                        {clamped ? " *" : ""}
                        <div className="text-xs text-muted-foreground">база {leverValueText(r.base, r.unit)}</div>
                      </td>
                      <td className={TD}>{r.boundsSource}</td>
                      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                        {vLow === null ? "отказ расчёта" : formatRub(vLow)}
                      </td>
                      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                        {vHigh === null ? "отказ расчёта" : formatRub(vHigh)}
                      </td>
                      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                        {refused ? "—" : formatRub(r.swing)}
                      </td>
                      {metric === "npv" && (
                        <td className={`${TD} font-medium text-caution`}>{r.signFlip ? "⚠ да" : ""}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(anyClamped || flips > 0) && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {anyClamped && (
                <li>
                  * Граница прижата к физическому пределу (например, загрузка не больше 100 %) или расширена до текущего
                  значения, если оно вне диапазона источника.
                </li>
              )}
              {flips > 0 && (
                <li>
                  ⚠ NPV меняет знак внутри диапазона параметра — вывод зависит от него; уточните это значение до решения.
                </li>
              )}
            </ul>
          )}
          <Tornado rows={rows} metric={metric} base={base} />
        </>
      )}
    </section>
  );
}
