import { DEFAULT_NORMS } from "../tz/norms";
import { BUCKET_S, requestedFleet } from "./engine";
import { queueLength } from "./state";
import type { SimEngineState } from "./state";
import {
  SIM_MODEL_VERSION,
  type SimBottleneck,
  type SimInput,
  type SimSummary,
  type SimSummaryStored,
  type SimVerdict,
} from "./types";

/**
 * Сводка прогона: достигнутый поток, разложение времени парка, очередь, ожидание, загрузка
 * точек, узкое место и вердикт «расчёт подтверждён / не подтверждён» (ТЗ §2.1.4, §3.6.2).
 * Всё считается только по пиковому окну; прогрев в метрики не входит.
 */

/**
 * Пороги классификации узкого места. Это правила модели (выбор, а не факт о мире), их
 * назначение — назвать причину, когда вердикт «не подтверждён»:
 * - парк: роботы заняты перевозкой, погрузкой и зарядкой не меньше 95 % времени, а очередь
 *   заданий за окно выросла — роботов просто не хватает;
 * - точки: какие-то ворота заняты не меньше 90 % окна, а роботы стоят в очереди к воротам не
 *   меньше 5 % времени — не хватает ворот, а не роботов;
 * - зарядка: ожидание свободной станции не меньше 5 % времени парка или робот разрядился до
 *   нуля — не хватает станций или автономности.
 */
export const BOTTLENECK_RULES = {
  fleetBusyShare: 0.95,
  pointUtilShare: 0.9,
  pointWaitShare: 0.05,
  chargerWaitShare: 0.05,
} as const;

/** Минимальный допуск очереди в конце окна, заданий: при малом потоке 5 % часа — меньше одного. */
const END_QUEUE_MIN = 3;
/** Допуск очереди в конце окна как доля часового пикового потока. */
const END_QUEUE_SHARE_OF_HOURLY = 0.05;

/** Допустимая очередь заданий в конце окна: max(3; 5 % часового пикового потока). */
export function endQueueLimit(peakPerH: number): number {
  const byRate = Number.isFinite(peakPerH) && peakPerH > 0 ? END_QUEUE_SHARE_OF_HOURLY * peakPerH : 0;
  return byRate > END_QUEUE_MIN ? byRate : END_QUEUE_MIN;
}

/** Что нужно правилу вердикта. */
export type VerdictInputs = {
  /** Доля заданий окна, взятых в работу к концу окна, 0–1. */
  servedShare: number;
  /** Длина очереди заданий в конце окна. */
  queueEnd: number;
  /** 95-й перцентиль ожидания, мин. */
  waitP95Min: number;
  /** Требуемый пиковый поток, ед./ч. */
  requiredPerH: number;
  /** Доля простоя, %. */
  idlePct: number;
  /** Робот разряжался до нуля (модель не умеет «остановить» такого робота — см. ниже). */
  socFloorHit: boolean;
};

/**
 * Вердикт прогона. CONFIRMED тогда и только тогда, когда:
 * - доля обслуженных заданий окна ≥ `servedShareMin` (норматив simServedShareMin);
 * - очередь в конце окна ≤ max(3; 5 % часового пикового потока);
 * - 95-й перцентиль ожидания ≤ `p95WaitMaxMin` (норматив simP95WaitMaxMin);
 * - ни один робот не разрядился до нуля. Разряженный робот в модели продолжает ездить (иначе
 *   его пришлось бы «эвакуировать», а этого модель не описывает), поэтому такой прогон
 *   оптимистичен и подтверждением считаться не может.
 * `oversized` — парк подтверждён, но простой ≥ `oversizedIdleShare` (норматив
 * simOversizedIdleShare): роботов больше, чем нужно.
 */
export function verdict(
  s: VerdictInputs,
  thresholds: SimInput["thresholds"],
): { verdict: "CONFIRMED" | "NOT_CONFIRMED"; oversized: boolean } {
  const ok =
    s.servedShare >= thresholds.servedShareMin &&
    s.queueEnd <= endQueueLimit(s.requiredPerH) &&
    s.waitP95Min <= thresholds.p95WaitMaxMin &&
    !s.socFloorHit;
  return {
    verdict: ok ? "CONFIRMED" : "NOT_CONFIRMED",
    oversized: ok && s.idlePct / 100 >= thresholds.oversizedIdleShare,
  };
}

/** Что нужно правилам узкого места. Проценты — 0–100. */
export type BottleneckInputs = {
  /** Перевозка с грузом, порожний пробег и погрузка/выгрузка, %. */
  productivePct: number;
  /** Зарядка вместе с дорогой к станции и ожиданием её, %. */
  chargingPct: number;
  /** Ожидание свободной станции, %. */
  chargerWaitPct: number;
  /** Ожидание у занятых ворот, %. */
  waitAtPointsPct: number;
  /** Наибольшая загрузка ворот приёмки или отгрузки за окно, %. */
  maxDockUtilPct: number;
  socFloorHit: boolean;
  /** Очередь заданий в конце окна длиннее, чем в начале. */
  queueGrew: boolean;
};

/**
 * Узкое место по правилам `BOTTLENECK_RULES`, в порядке проверки: зарядка → ворота → парк.
 * 'none' — ни одно правило не сработало.
 */
export function detectBottleneck(m: BottleneckInputs): SimBottleneck {
  const r = BOTTLENECK_RULES;
  if (m.chargerWaitPct >= r.chargerWaitShare * 100 || m.socFloorHit) return "charging";
  if (m.maxDockUtilPct >= r.pointUtilShare * 100 && m.waitAtPointsPct >= r.pointWaitShare * 100) return "points";
  if (m.productivePct + m.chargingPct >= r.fleetBusyShare * 100 && m.queueGrew) return "fleet";
  return "none";
}

/** 95-й перцентиль по методу ближайшего ранга; пустой список — 0. */
export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[idx < 0 ? 0 : idx]!;
}

/** Данные о прогоне, которых нет во входе: сценарий, заложенная загрузка, длительность. */
export type SimSummaryMeta = {
  /** Ключ сценария проекта (`ScenarioSpec.key`); по умолчанию пустая строка. */
  scenarioKey?: string;
  /**
   * Загрузка, заложенная в расчёт парка, % (норматив utilization × 100). По умолчанию —
   * значение норматива по умолчанию (77,5 %).
   */
  assumedUtilPct?: number;
  /** Длительность прогона, мс — измеряет вызывающий код; движку часы запрещены. */
  durationMs?: number;
};

/**
 * Полная сводка прогона: контракт `SimSummary` плюс величины, из которых выведен вердикт, —
 * чтобы интерфейс и тесты могли показать, почему он такой. В проект сохраняется только
 * `SimSummaryStored` (см. `toStored`).
 */
export type SimRunSummary = SimSummary & {
  /** Результат предварительной проверки входа. */
  precheck: SimEngineState["precheck"];
  /** Очередь заданий в конце окна (с учётом хвоста прогрева). */
  queueEnd: number;
  /** Очередь в начале окна. */
  queueAtPeakStart: number;
  /** Допустимая очередь в конце окна: max(3; 5 % часового потока). */
  endQueueLimit: number;
  /** Поступило и завершено заданий за окно. */
  arrivedPeak: number;
  donePeak: number;
  /**
   * Фактически поступивший поток за окно, ед./ч. Поток случайный (испытания Бернулли), поэтому
   * он отличается от требуемого `requiredPerH` на величину порядка √n заданий; достигнутый
   * поток ограничен именно им — это стоит показывать рядом с «достигнуто».
   */
  arrivedPerH: number;
  /** Среднее ожидание задания, мин. */
  waitMeanMin: number;
  /** Ожидание свободной зарядной станции, % времени парка (входит в chargingPct). */
  chargerWaitPct: number;
  /** Хотя бы один робот разряжался до нуля. */
  socFloorHit: boolean;
  /** Пройденная длительность пикового окна, мин. */
  peakWindowMin: number;
};

/**
 * Прогон выполнялся. Нет — если вход отклонён предварительной проверкой: вердикт NOT_SUPPORTED
 * (вход не моделируется) или узкое место «грузоподъёмность» (робот не поднимает груз). Тогда
 * доли времени, загрузка, простой, ожидание и очередь в сводке — нули со смыслом «не
 * применимо», и показывать их как «Простой 0 %» нельзя. Работает и по сохранённой сводке
 * (`SimSummaryStored`), где поля `precheck` нет: узкое место «грузоподъёмность» ставит только
 * предварительная проверка.
 */
export function simWasRun(s: Pick<SimSummaryStored, "verdict" | "bottleneck">): boolean {
  return s.verdict !== "NOT_SUPPORTED" && s.bottleneck !== "payload";
}

/** Доля в процентах; нулевой знаменатель даёт 0. */
function pct(part: number, total: number): number {
  return total > 0 ? (100 * part) / total : 0;
}

/**
 * Сводка по состоянию прогона. Работает и посреди прогона (визуализация обновляет показатели
 * на лету): тогда метрики считаются по пройденной части пикового окна.
 *
 * - Достигнутый поток — завершённые за окно задания / длительность окна, ч.
 * - Доля обслуженных — задания, поступившие в окне и взятые роботом до конца окна, к числу
 *   поступивших в окне (нет поступлений — 1). Задания, которые к концу окна ещё едут, —
 *   обслуживаются, а не теряются, поэтому в долю входят.
 * - Ожидание — от поступления до момента, когда задание взял робот; не взятое к концу окна
 *   считается с ожиданием до конца окна (оценка снизу), чтобы перцентиль не занижался.
 * - Разложение времени парка — по робото-секундам окна; в сумме 100 %.
 * - Пятиминутные корзины: «требуется» — фактически поступившие в корзине задания, «достигнуто»
 *   — завершённые, оба в пересчёте на час (неполная последняя корзина — на её длительность).
 * - Узкое место указывается только при «не подтверждён»: если правила `BOTTLENECK_RULES` не
 *   сработали, узким местом считается парк — единственный рычаг модели, который остаётся.
 * - `fleet` — число роботов, запрошенное входом, даже если прогон не выполнялся.
 * - Вход отклонён предварительной проверкой (`precheck` ≠ 'ok') — прогона нет: доли времени
 *   (в сумме 0, а не 100), загрузка, простой, ожидание и очередь — нули со смыслом «не
 *   применимо». Интерфейс и выгрузка проверяют это через `simWasRun`.
 */
export function summarize(state: SimEngineState, meta: SimSummaryMeta = {}): SimRunSummary {
  const s = state;
  const input = s.input;
  const acc = s.acc;
  const tNow = s.tS < s.endS ? s.tS : s.endS;
  const windowS = tNow > s.warmupS ? tNow - s.warmupS : 0;
  const hours = windowS / 3600;

  const arrivedInWindow: number[] = [];
  let started = 0;
  let waitSum = 0;
  for (const task of s.tasks) {
    if (task.arrivalS < s.warmupS || task.arrivalS >= tNow) continue;
    const startedAt = task.startS !== null && task.startS < tNow ? task.startS : null;
    if (startedAt !== null) started++;
    const waitS = (startedAt ?? tNow) - task.arrivalS;
    arrivedInWindow.push(waitS / 60);
    waitSum += waitS / 60;
  }
  const arrivedPeak = arrivedInWindow.length;
  const servedShare = arrivedPeak > 0 ? started / arrivedPeak : 1;
  const waitP95Min = percentile95(arrivedInWindow);
  const waitMeanMin = arrivedPeak > 0 ? waitSum / arrivedPeak : 0;

  const total = acc.loadedS + acc.emptyS + acc.handlingS + acc.waitPointS + acc.chargingS + acc.idleS;
  const shares = {
    loadedPct: pct(acc.loadedS, total),
    emptyPct: pct(acc.emptyS, total),
    handlingPct: pct(acc.handlingS, total),
    waitAtPointsPct: pct(acc.waitPointS, total),
    chargingPct: pct(acc.chargingS, total),
    idlePct: pct(acc.idleS, total),
  };
  const fleetUtilPct = shares.loadedPct + shares.emptyPct + shares.handlingPct;
  const chargerWaitPct = pct(acc.chargerWaitS, total);
  const socFloorHit = acc.socFloorS > 0;

  const pointUtilization = s.points.map((p) => ({ id: p.id, kind: p.kind, utilPct: pct(p.busyS, windowS) }));
  let maxDockUtilPct = 0;
  for (const p of pointUtilization) {
    if (p.kind !== "charger" && p.utilPct > maxDockUtilPct) maxDockUtilPct = p.utilPct;
  }

  const queueEnd = queueLength(s);
  const queueAtPeakStart = acc.queueAtPeakStart ?? queueEnd;
  const achievedPerH = hours > 0 ? acc.doneInPeak / hours : 0;

  const buckets5min: SimSummary["buckets5min"] = [];
  for (let b = 0; b < acc.bucketArrivals.length; b++) {
    const b0 = s.warmupS + b * BUCKET_S;
    if (b0 >= tNow) break;
    const b1 = b0 + BUCKET_S < tNow ? b0 + BUCKET_S : tNow;
    const perHour = 3600 / (b1 - b0);
    buckets5min.push({
      t: (b * BUCKET_S) / 60,
      required: acc.bucketArrivals[b]! * perHour,
      achieved: acc.bucketDone[b]! * perHour,
    });
  }

  let v: SimVerdict;
  let bottleneck: SimBottleneck;
  let oversized = false;
  if (s.precheck === "invalid") {
    v = "NOT_SUPPORTED";
    bottleneck = "none";
  } else if (s.precheck === "payload") {
    v = "NOT_CONFIRMED";
    bottleneck = "payload";
  } else {
    const judged = verdict(
      { servedShare, queueEnd, waitP95Min, requiredPerH: input.demand.peakPerH, idlePct: shares.idlePct, socFloorHit },
      input.thresholds,
    );
    v = judged.verdict;
    oversized = judged.oversized;
    if (v === "CONFIRMED") bottleneck = "none";
    else {
      const found = detectBottleneck({
        productivePct: fleetUtilPct,
        chargingPct: shares.chargingPct,
        chargerWaitPct,
        waitAtPointsPct: shares.waitAtPointsPct,
        maxDockUtilPct,
        socFloorHit,
        queueGrew: queueEnd > queueAtPeakStart,
      });
      bottleneck = found === "none" ? "fleet" : found;
    }
  }

  return {
    simModelVersion: SIM_MODEL_VERSION,
    seed: input.seed,
    scenarioKey: meta.scenarioKey ?? "",
    fleet: requestedFleet(input),
    requiredPerH: input.demand.peakPerH,
    achievedPerH,
    servedShare: s.precheck === "ok" ? servedShare : 0,
    fleetUtilPct,
    assumedUtilPct: meta.assumedUtilPct ?? DEFAULT_NORMS.utilization * 100,
    idlePct: shares.idlePct,
    chargingPct: shares.chargingPct,
    waitAtPointsPct: shares.waitAtPointsPct,
    queueMax: acc.queueMax,
    waitP95Min,
    verdict: v,
    bottleneck,
    oversized,
    minStableFleet: null,
    fleetByNorm: null,
    verdictByNorm: null,
    durationMs: meta.durationMs ?? 0,
    buckets5min,
    pointUtilization,
    shares,
    precheck: s.precheck,
    queueEnd,
    queueAtPeakStart,
    endQueueLimit: endQueueLimit(input.demand.peakPerH),
    arrivedPeak,
    donePeak: acc.doneInPeak,
    arrivedPerH: hours > 0 ? arrivedPeak / hours : 0,
    waitMeanMin,
    chargerWaitPct,
    socFloorHit,
    peakWindowMin: windowS / 60,
  };
}

/**
 * Только сохраняемые поля (`SimSummaryStored`) — без рядов, загрузки точек и служебных
 * величин, чтобы `Project.results` оставался компактным.
 */
export function toStored(summary: SimSummaryStored): SimSummaryStored {
  return {
    simModelVersion: summary.simModelVersion,
    seed: summary.seed,
    scenarioKey: summary.scenarioKey,
    fleet: summary.fleet,
    requiredPerH: summary.requiredPerH,
    achievedPerH: summary.achievedPerH,
    servedShare: summary.servedShare,
    fleetUtilPct: summary.fleetUtilPct,
    assumedUtilPct: summary.assumedUtilPct,
    idlePct: summary.idlePct,
    chargingPct: summary.chargingPct,
    waitAtPointsPct: summary.waitAtPointsPct,
    queueMax: summary.queueMax,
    waitP95Min: summary.waitP95Min,
    verdict: summary.verdict,
    bottleneck: summary.bottleneck,
    oversized: summary.oversized,
    minStableFleet: summary.minStableFleet,
    fleetByNorm: summary.fleetByNorm,
    verdictByNorm: summary.verdictByNorm,
    durationMs: summary.durationMs,
  };
}
