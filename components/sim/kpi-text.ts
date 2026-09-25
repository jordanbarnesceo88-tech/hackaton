import { formatNum, formatPct } from "@/lib/format/rub";
import { pluralRu } from "@/lib/format/plural";
import { BOTTLENECK_LABELS, NO_RUN_VALUE, VERDICT_LABELS } from "@/lib/sim/export-rows";
import { simWasRun } from "@/lib/sim/metrics";
import type { SimSummary, SimSummaryStored } from "@/lib/sim/types";

/**
 * Тексты показателей имитации: одни и те же строки выводятся на экране (sim-kpis.tsx), в
 * подписи канвы для скринридера и в PNG-выгрузке. Чистые функции без DOM — проверяются в Node.
 *
 * Имитация моделирует перемещение паллет (шаблон «паллетная транспортировка», lib/sim), поэтому
 * единица потока — паллеты в час.
 */

/** Единица потока имитации. */
export const FLOW_UNIT = "пал./ч";

/** Процент с одним знаком: «62,8 %». */
function pct1(v: number): string {
  return formatPct(v, 1);
}

/** «Рассчитано: 129,5 пал./ч в пик · Достигнуто: 132,5 пал./ч». */
export function throughputText(s: SimSummaryStored): string {
  const achieved = simWasRun(s) ? `${formatNum(s.achievedPerH, 1)} ${FLOW_UNIT}` : NO_RUN_VALUE;
  return `Рассчитано: ${formatNum(s.requiredPerH, 1)} ${FLOW_UNIT} в пик · Достигнуто: ${achieved}`;
}

/** «Загрузка парка: 62,8 % (в расчёте 77,5 %)». */
export function utilText(s: SimSummaryStored): string {
  const v = simWasRun(s) ? pct1(s.fleetUtilPct) : NO_RUN_VALUE;
  return `Загрузка парка: ${v} (в расчёте ${pct1(s.assumedUtilPct)})`;
}

/** «Простой: 31,3 %». */
export function idleText(s: SimSummaryStored): string {
  return `Простой: ${simWasRun(s) ? pct1(s.idlePct) : NO_RUN_VALUE}`;
}

/** «Зарядка: 2,1 %» (путь к станции, ожидание её и сам заряд). */
export function chargingText(s: SimSummaryStored): string {
  return `Зарядка: ${simWasRun(s) ? pct1(s.chargingPct) : NO_RUN_VALUE}`;
}

/** «Ожидание у точек: 0,4 %». */
export function waitText(s: SimSummaryStored): string {
  return `Ожидание у точек: ${simWasRun(s) ? pct1(s.waitAtPointsPct) : NO_RUN_VALUE}`;
}

/** «Очередь заданий: макс. 4, ожидание p95 0,8 мин». */
export function queueText(s: SimSummaryStored): string {
  if (!simWasRun(s)) return `Очередь заданий: ${NO_RUN_VALUE}`;
  return `Очередь заданий: макс. ${s.queueMax}, ожидание p95 ${formatNum(s.waitP95Min, 1)} мин`;
}

/** «Узкое место: нет | парк роботов | точки приёмки и отгрузки | зарядные станции | грузоподъёмность». */
export function bottleneckText(s: SimSummaryStored): string {
  return `Узкое место: ${BOTTLENECK_LABELS[s.bottleneck]}`;
}

/** Показатели одной строкой каждый — в порядке экрана. Для PNG и подписи канвы. */
export function kpiLines(s: SimSummaryStored): string[] {
  return [throughputText(s), utilText(s), idleText(s), chargingText(s), waitText(s), queueText(s), bottleneckText(s)];
}

/** Тон значка вердикта: определяет цвет, текст несёт смысл сам. */
export type VerdictTone = "confirmed" | "oversized" | "not-confirmed" | "not-supported";

/**
 * Значок вердикта:
 * - «Расчёт подтверждён имитацией»;
 * - «Расчёт подтверждён имитацией · парк избыточен: минимальный по имитации M» (простой не ниже
 *   порога и известен меньший устойчивый парк);
 * - «Не подтверждён: {узкое место} — минимальный парк по имитации M» (M — если известен; при
 *   грузоподъёмности число роботов не помогает, поэтому M не пишется);
 * - «Имитация для этого класса не поддерживается» — вход вне модели.
 */
export function verdictBadge(s: SimSummaryStored): { tone: VerdictTone; text: string } {
  const m = s.minStableFleet;
  if (s.verdict === "NOT_SUPPORTED") return { tone: "not-supported", text: VERDICT_LABELS.NOT_SUPPORTED };
  if (s.verdict === "NOT_CONFIRMED") {
    if (s.bottleneck === "payload") {
      return {
        tone: "not-confirmed",
        text: `${VERDICT_LABELS.NOT_CONFIRMED}: ${BOTTLENECK_LABELS.payload} — робот не поднимает груз объекта`,
      };
    }
    const tail = m !== null ? ` — минимальный парк по имитации ${m}` : "";
    return { tone: "not-confirmed", text: `${VERDICT_LABELS.NOT_CONFIRMED}: ${BOTTLENECK_LABELS[s.bottleneck]}${tail}` };
  }
  if (s.oversized) {
    const tail = m !== null && m < s.fleet ? `: минимальный по имитации ${m}` : "";
    return { tone: "oversized", text: `${VERDICT_LABELS.CONFIRMED} · парк избыточен${tail}` };
  }
  return { tone: "confirmed", text: VERDICT_LABELS.CONFIRMED };
}

/**
 * Показатели кадра посреди проигрывания с вердиктом полного прогона. Вердикт, узкое место и
 * «парк избыточен» по пройденной части окна преждевременны (очередь, поступившая к этому кадру,
 * ещё не разобрана), поэтому берутся из полного прогона — как и значок вердикта. Остальные
 * показатели — по пройденной части окна.
 */
export function withFinalVerdict<T extends SimSummaryStored>(partial: T, final: SimSummaryStored): T {
  return { ...partial, verdict: final.verdict, bottleneck: final.bottleneck, oversized: final.oversized };
}

/** «11 роботов». */
export function robotsText(n: number): string {
  return `${n} ${pluralRu(n, ["робот", "робота", "роботов"])}`;
}

/**
 * Подпись канвы для скринридера (role="img"): что изображено и чем кончилась проверка. Меняется
 * по вердикту, а не по кадрам — иначе скринридер зачитывал бы её каждые полсекунды.
 */
export function canvasAriaLabel(s: SimSummaryStored | null, fleet: number | null): string {
  const scene = "Схема склада: зоны приёмки, хранения, отгрузки и зарядки, проезды, ворота и зарядные станции";
  const robots = fleet !== null && fleet > 0 ? `, ${robotsText(fleet)}` : "";
  if (!s) return `${scene}${robots}. Имитация выполняется.`;
  const badge = verdictBadge(s).text;
  const flow = simWasRun(s)
    ? ` Рассчитано ${formatNum(s.requiredPerH, 1)} ${FLOW_UNIT} в пик, достигнуто ${formatNum(s.achievedPerH, 1)} ${FLOW_UNIT}.`
    : "";
  return `${scene}${robots}. ${badge}.${flow} Показатели приведены рядом текстом.`;
}

/** Строка состояния прогона для области aria-live. */
export type RunStatus =
  | { kind: "running"; pct: number }
  | { kind: "done"; durationMs: number; seed: number; modelVersion: string }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: string };

/**
 * «Имитация: выполняется… 42 %» → «Имитация завершена за 17 мс · seed 1 · модель sim-1.0.0».
 */
export function statusText(st: RunStatus): string {
  switch (st.kind) {
    case "running":
      return `Имитация: выполняется… ${formatNum(Math.min(100, Math.max(0, st.pct)), 0)} %`;
    case "done":
      return `Имитация завершена за ${formatNum(st.durationMs, 0)} мс · seed ${st.seed} · модель ${st.modelVersion}`;
    case "error":
      return `Имитация остановлена: ${st.message}`;
    case "unavailable":
      return `Имитация недоступна: ${st.reason}`;
  }
}

/** Округление до десятых — как в строках «Итоги имитации». */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Сверка прогона в браузере с результатом, сохранённым в проекте (воспроизводимость, ТЗ §3.1.5).
 * null — сверять не с чем: сохранённого нет или он получен для другого парка, зерна или пикового
 * потока (параметры изменены после сохранения). Разная версия модели при том же входе — это
 * расхождение: его и надо показать. Длительность прогона не сравнивается — это настенное время.
 */
export function storedCheck(
  stored: SimSummaryStored | null | undefined,
  s: SimSummaryStored,
): { match: true; text: string } | { match: false; text: string } | null {
  if (!stored || stored.seed !== s.seed || stored.fleet !== s.fleet) return null;
  if (!(Math.abs(stored.requiredPerH - s.requiredPerH) <= 1e-6 * Math.max(1, Math.abs(s.requiredPerH)))) return null;
  const same =
    stored.simModelVersion === s.simModelVersion &&
    stored.verdict === s.verdict &&
    stored.bottleneck === s.bottleneck &&
    stored.oversized === s.oversized &&
    stored.queueMax === s.queueMax &&
    round1(stored.achievedPerH) === round1(s.achievedPerH) &&
    round1(stored.fleetUtilPct) === round1(s.fleetUtilPct) &&
    round1(stored.waitP95Min) === round1(s.waitP95Min);
  if (same) return { match: true, text: "Совпадает с результатом, сохранённым в проекте." };
  return {
    match: false,
    text:
      `Отличается от результата, сохранённого в проекте (сохранено: достигнуто ` +
      `${formatNum(stored.achievedPerH, 1)} ${FLOW_UNIT}, ${verdictBadge(stored).text}; модель ` +
      `${stored.simModelVersion}). Пересчитайте проект на актуальных данных.`,
  };
}

/**
 * Точки ломаных для спарклайна «требуется / достигнуто» по пятиминутным корзинам в области
 * w × h: строки для атрибута `points` и верх шкалы. Одна корзина растягивается на всю ширину
 * (иначе ломаная из одной точки не видна). Пустой ряд — пустые строки.
 */
export function sparklinePoints(
  buckets: SimSummary["buckets5min"],
  w: number,
  h: number,
): { required: string; achieved: string; max: number } {
  if (buckets.length === 0) return { required: "", achieved: "", max: 0 };
  let max = 0;
  for (const b of buckets) max = Math.max(max, b.required, b.achieved);
  const top = max > 0 ? max * 1.1 : 1;
  const xs = buckets.length === 1 ? [0, w] : buckets.map((_, i) => (i * w) / (buckets.length - 1));
  const at = (v: number) => (h - (v / top) * h).toFixed(1);
  const series = (pick: (b: SimSummary["buckets5min"][number]) => number) => {
    const src = buckets.length === 1 ? [buckets[0]!, buckets[0]!] : buckets;
    return src.map((b, i) => `${xs[i]!.toFixed(1)},${at(pick(b))}`).join(" ");
  };
  return { required: series((b) => b.required), achieved: series((b) => b.achieved), max };
}
