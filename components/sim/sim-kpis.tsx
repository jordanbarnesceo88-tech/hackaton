import { formatNum } from "@/lib/format/rub";
import { simSummaryRows } from "@/lib/sim/export-rows";
import { simWasRun, type SimRunSummary } from "@/lib/sim/metrics";
import { formatSimClock, simPhaseLabel } from "./draw-scene";
import {
  FLOW_UNIT,
  bottleneckText,
  chargingText,
  idleText,
  queueText,
  sparklinePoints,
  throughputText,
  utilText,
  verdictBadge,
  waitText,
  type VerdictTone,
} from "./kpi-text";

/**
 * Показатели имитации рядом со схемой (ТЗ §2.1.4: достижимость производительности, загрузка,
 * простои, узкие места; §3.6.2: визуализация подтверждает расчёт). Всё, что видно на канве,
 * повторено текстом — это и текстовая альтернатива схемы для скринридера.
 */

const TONE_CLASS: Readonly<Record<VerdictTone, string>> = {
  confirmed: "border-positive/40 bg-positive/10 text-positive",
  oversized: "border-caution/40 bg-caution/10 text-caution",
  "not-confirmed": "border-destructive/40 bg-destructive/10 text-destructive",
  "not-supported": "border-border bg-muted text-muted-foreground",
};

const SPARK_W = 240;
const SPARK_H = 48;

/** Спарклайн «требуется / достигнуто» по пятиминутным корзинам пикового окна. */
function Sparkline({ buckets }: { buckets: SimRunSummary["buckets5min"] }) {
  if (buckets.length === 0) return null;
  const { required, achieved } = sparklinePoints(buckets, SPARK_W, SPARK_H);
  const range = (pick: (b: SimRunSummary["buckets5min"][number]) => number) => {
    const vals = buckets.map(pick);
    return `от ${formatNum(Math.min(...vals), 0)} до ${formatNum(Math.max(...vals), 0)}`;
  };
  const label =
    `График по 5-минутным интервалам пикового окна: поступало ${range((b) => b.required)} ${FLOW_UNIT}, ` +
    `выполнялось ${range((b) => b.achieved)} ${FLOW_UNIT}.`;
  return (
    <figure className="grid gap-1">
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-12 w-full rounded-sm bg-muted/40"
      >
        <polyline
          points={required}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={achieved}
          fill="none"
          className="stroke-chart-1"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>
          <span aria-hidden="true">- - </span>поступило заданий
        </span>
        <span>
          <span aria-hidden="true" className="text-chart-1">
            ——{" "}
          </span>
          выполнено, {FLOW_UNIT} за 5 мин
        </span>
      </figcaption>
    </figure>
  );
}

/** Значение строки «Итоги имитации»: числа — с десятичной запятой. */
function rowValue(v: number | string): string {
  if (typeof v === "string") return v;
  return formatNum(v, Number.isInteger(v) ? 0 : 1);
}

export function SimKpis({
  shown,
  final,
  partial,
  clock,
  check,
}: {
  /** Показываемая сводка: проигрывание (посреди прогона) или итог. null — прогон ещё идёт. */
  shown: SimRunSummary | null;
  /** Итог прогона без анимации — вердикт и таблица «Итоги имитации». */
  final: SimRunSummary | null;
  /** `shown` посчитана по пройденной части пикового окна. */
  partial: boolean;
  /** Часы модели на показанном кадре. */
  clock: { tS: number; warmupS: number; endS: number } | null;
  /** Сверка с сохранённым в проекте результатом (null — не с чем сверять). */
  check: { match: boolean; text: string } | null;
}) {
  if (!shown || !final) {
    return (
      <div className="text-sm text-muted-foreground">Показатели появятся после прогона имитации.</div>
    );
  }
  const badge = verdictBadge(final);
  const ran = simWasRun(shown);
  // Прогон, отклонённый предварительной проверкой, не двигался: часов у него нет.
  const showClock = clock !== null && simWasRun(final);
  const warmup = partial && clock !== null && clock.tS < clock.warmupS;
  return (
    <div className="grid content-start gap-3 text-sm">
      <p className={`rounded-md border px-3 py-2 font-medium ${TONE_CLASS[badge.tone]}`}>{badge.text}</p>

      {showClock && clock && (
        <p className="tabular-nums">
          Время имитации: {formatSimClock(clock.tS)}{" "}
          <span className="text-muted-foreground">({simPhaseLabel(clock.tS, clock.warmupS, clock.endS)})</span>
        </p>
      )}

      <ul className="grid gap-1">
        <li className="font-medium">{throughputText(shown)}</li>
        {ran && (
          <li className="text-xs text-muted-foreground">
            Фактически поступило за окно: {formatNum(shown.arrivedPerH, 1)} {FLOW_UNIT} — поток заданий
            случайный, выполнить больше поступившего нельзя.
          </li>
        )}
        <li>{utilText(shown)}</li>
        <li>{idleText(shown)}</li>
        <li>{chargingText(shown)}</li>
        <li>{waitText(shown)}</li>
        <li>{queueText(shown)}</li>
        <li>{bottleneckText(shown)}</li>
      </ul>

      {partial && clock && (
        <p className="text-xs text-muted-foreground">
          {warmup
            ? `Идёт прогрев (до ${formatSimClock(clock.warmupS)}): показатели считаются только по пиковому окну и появятся после прогрева, вердикт и узкое место — по полному прогону.`
            : "Идёт проигрывание: показатели — по пройденной части пикового окна, вердикт и узкое место — по полному прогону."}
        </p>
      )}

      {ran && <Sparkline buckets={shown.buckets5min} />}

      {check && (
        <p className={`text-xs ${check.match ? "text-muted-foreground" : "text-destructive"}`}>{check.text}</p>
      )}

      <table className="w-full text-xs">
        <caption className="mb-1 text-left text-sm font-medium">Итоги имитации</caption>
        <tbody>
          {simSummaryRows(final).map(([label, value]) => (
            <tr key={label} className="border-t border-border/60">
              <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground">
                {label}
              </th>
              <td className="py-1 text-right tabular-nums">{rowValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
