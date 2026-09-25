"use client";

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSim, isDone } from "@/lib/sim/engine";
import { buildWarehouseLayout } from "@/lib/sim/layout";
import { simWasRun, summarize, type SimRunSummary } from "@/lib/sim/metrics";
import type { SimEngineState } from "@/lib/sim/state";
import { formatNum } from "@/lib/format/rub";
import { originLabel } from "@/lib/tz/characteristics";
import { formatSimClock, simPhaseLabel } from "./draw-scene";
import { SIM_FOOTER, exportSimPng } from "./export-png";
import { parseSimInputKey, simInputKey } from "./input-key";
import { canvasAriaLabel, statusText, storedCheck, withFinalVerdict, type RunStatus } from "./kpi-text";
import { DEFAULT_SPEED } from "./playback";
import { isAbortError, runHeadless } from "./run-headless";
import { SimCanvas } from "./sim-canvas";
import { SimControls, type AcceptFleetControl } from "./sim-controls";
import { SimKpis } from "./sim-kpis";
import { SimLegend } from "./sim-legend";
import { useReducedMotion } from "./use-reduced-motion";
import {
  optionValue,
  resolveSelection,
  simOptions,
  variantFleet,
  withFleetFacts,
  type SimScenario,
  type SimVariantId,
} from "./variants";

/**
 * Имитация работы склада (ТЗ §3.6): схема с зонами, проездами, воротами, зарядкой и роботами;
 * старт, стоп, перезапуск, скорость и выбор сценария (§3.6.3); показатели и вердикт
 * «расчёт подтверждён / не подтверждён» (§2.1.4, §3.6.2); выгрузка PNG (§3.7.4); видимый статус
 * прогона (§4.3.3).
 *
 * Как устроено:
 * - при монтировании и при каждой смене входа (по значению) выполняется прогон без анимации — по
 *   частям, с отменой и прогрессом; по его итогу показываются последний кадр, вердикт и
 *   показатели. Само ничего не проигрывается: движение начинается только по «▶ Старт»;
 * - проигрывание — отдельный прогон с тем же зерном, который цикл кадров двигает на
 *   speed × 60 × длительность кадра шагов. Движок детерминирован, поэтому проигрывание приходит
 *   к тому же итогу, что и прогон без анимации;
 * - состояние React меняется только в обработчиках событий и в колбэках промисов и кадров, не в
 *   теле эффектов (правила react-hooks v7).
 */

/** Шаг прогресса в строке состояния, %: чаще обновлять aria-live незачем — скринридер зачитывает каждое. */
const PROGRESS_STEP_PCT = 5;

export type WarehouseSimulationProps = {
  /** Сценарии проекта с вариантами парка (см. `buildSimVariants`). */
  scenarios: SimScenario[];
  /** Ключ сценария, выбранного при открытии. */
  initialKey: string;
  /** Только чтение: без кнопки «Принять парк по имитации». */
  readOnly?: boolean;
  /**
   * Итог прогона парка по расчёту сценария — для строки «Имитация» в таблице сценариев.
   * Варианты «минимальный» и «по норме» сюда не сообщаются: у них другой парк.
   */
  onSummary?: (key: string, summary: SimRunSummary) => void;
  /** «Принять парк по имитации»: записать в сценарий ручной парк M (владелец пишет журнал). */
  onAcceptFleet?: (key: string, n: number) => void;
  /** Часы, мс, для длительности прогона и нарезки; по умолчанию `performance.now`. */
  nowFn?: () => number;
  /** Уровень заголовка карточки (по умолчанию h2). */
  headingAs?: "h2" | "h3";
};

/** Записи прогона и проигрывания помечены ключом входа по значению (`simInputKey`). */
type RunRecord =
  | { key: string; ok: true; state: SimEngineState; summary: SimRunSummary; durationMs: number }
  | { key: string; ok: false; error: string };

type PlayRecord = { key: string; token: number; playing: boolean };
type LiveRecord = { token: number; summary: SimRunSummary; tS: number };

function defaultNow(): number {
  return performance.now();
}

/** Значение строки «Откуда параметры»: число — в ru-RU, не больше двух знаков после запятой. */
function provenanceValue(v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "string") return v;
  const r = Math.round(v * 100) / 100;
  const digits = Number.isInteger(r) ? 0 : Number.isInteger(Math.round(r * 100) / 10) ? 1 : 2;
  return formatNum(r, digits);
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "неизвестная ошибка — обновите страницу";
}

export function WarehouseSimulation({
  scenarios,
  initialKey,
  readOnly = false,
  onSummary,
  onAcceptFleet,
  nowFn,
  headingAs = "h2",
}: WarehouseSimulationProps) {
  const reducedMotion = useReducedMotion();
  const selectId = useId();

  // Выбор пользователя; если после пересчёта такого пункта нет — выбор по умолчанию.
  const [picked, setPicked] = useState<string | null>(null);
  const sel = resolveSelection(scenarios, picked, initialKey);
  const scenario = sel?.scenario ?? null;
  const variant = sel?.variant ?? null;
  const selectedValue = sel ? optionValue(sel.scenario.key, sel.variant.id) : null;
  const scenarioKey = scenario?.key ?? "";
  const variantId: SimVariantId | null = variant?.id ?? null;
  const assumedUtilPct = scenario?.assumedUtilPct ?? scenario?.stored?.assumedUtilPct;

  // Вход сравнивается по значению, а не по ссылке (см. input-key.ts): владелец может собирать
  // сценарии заново на каждой отрисовке и обновлять своё состояние в onSummary — ключ по ссылке
  // зациклил бы прогон. Все записи ниже помечены этим ключом.
  const inputKey = variant?.input ? simInputKey(variant.input) : null;
  const input = useMemo(() => (inputKey ? parseSimInputKey(inputKey) : null), [inputKey]);

  const options = useMemo(() => simOptions(scenarios), [scenarios]);
  const layout = useMemo(() => (input ? buildWarehouseLayout(input.layout) : null), [input]);

  // ——— Прогон без анимации ———
  const [run, setRun] = useState<RunRecord | null>(null);
  const [progress, setProgress] = useState<{ key: string; pct: number } | null>(null);
  const clockNow = useEffectEvent(() => (nowFn ?? defaultNow)());
  const reportDone = useEffectEvent((summary: SimRunSummary) => {
    if (onSummary && scenario && variantId === "calculated") {
      onSummary(scenario.key, withFleetFacts(summary, scenario, "calculated"));
    }
  });

  useEffect(() => {
    if (!inputKey) return;
    const ac = new AbortController();
    // Прогресс приходит после каждой части (~10 мс): в состояние — только при смене шага в 5 %,
    // иначе долгий прогон перерисовывал бы карточку и строку aria-live до 100 раз в секунду.
    let lastPct = -1;
    runHeadless(parseSimInputKey(inputKey), {
      now: () => clockNow(),
      signal: ac.signal,
      onProgress: (pct) => {
        const step = pct >= 100 ? 100 : Math.floor(pct / PROGRESS_STEP_PCT) * PROGRESS_STEP_PCT;
        if (step === lastPct) return;
        lastPct = step;
        setProgress({ key: inputKey, pct: step });
      },
      scenarioKey,
      assumedUtilPct,
    })
      .then((res) => {
        if (ac.signal.aborted) return;
        setRun({ key: inputKey, ok: true, ...res });
        reportDone(res.summary);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbortError(e)) return;
        setRun({ key: inputKey, ok: false, error: errorText(e) });
      });
    return () => ac.abort();
  }, [inputKey, scenarioKey, assumedUtilPct]);

  const current = run && inputKey !== null && run.key === inputKey ? run : null;
  const done = current?.ok ? current : null;
  const failed = current && !current.ok ? current : null;
  const pct = progress && progress.key === inputKey ? progress.pct : 0;

  // ——— Проигрывание ———
  const playRef = useRef<SimEngineState | null>(null);
  const tokenRef = useRef(0);
  const [play, setPlay] = useState<PlayRecord | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [live, setLive] = useState<LiveRecord | null>(null);
  const activePlay = play && done && play.key === inputKey ? play : null;
  const playing = activePlay?.playing ?? false;
  const liveNow = live && activePlay && live.token === activePlay.token ? live : null;

  const meta = { scenarioKey, assumedUtilPct };

  function startFresh(autoplay: boolean) {
    if (!input || !inputKey) return;
    tokenRef.current += 1;
    const st = createSim(input);
    playRef.current = st;
    // Показатели сразу по кадру 00:00, а не итог полного прогона рядом с часами «00:00»: при
    // «уменьшении движения» перезапуск не проигрывает, и кадр до первого тика остаётся на экране.
    setLive({ token: tokenRef.current, summary: summarize(st, meta), tS: st.tS });
    setPlay({ key: inputKey, token: tokenRef.current, playing: autoplay });
  }

  function handleStart() {
    const st = playRef.current;
    if (activePlay && st && !isDone(st)) setPlay({ ...activePlay, playing: true });
    else startFresh(true);
  }

  function handleStop() {
    if (!activePlay) return;
    const st = playRef.current;
    // Показатели на паузе — ровно по остановленному кадру, а не по последней отправке цикла.
    if (st) setLive({ token: activePlay.token, summary: summarize(st, meta), tS: st.tS });
    setPlay({ ...activePlay, playing: false });
  }

  function handleRestart() {
    // При «уменьшении движения» перезапуск ставит прогон в начало, но не запускает движение.
    startFresh(!reducedMotion);
  }

  function handleSkip() {
    playRef.current = null;
    setPlay(null);
    setLive(null);
  }

  function handleSelect(value: string) {
    playRef.current = null;
    setPlay(null);
    setLive(null);
    setPicked(value);
  }

  function handleTick(st: SimEngineState) {
    if (!activePlay) return;
    setLive({ token: activePlay.token, summary: summarize(st, meta), tS: st.tS });
  }

  function handleEnd() {
    setPlay((p) => (p ? { ...p, playing: false } : p));
  }

  // ——— Что показывать ———
  // Сведения о других парках — только из сводки, относящейся к текущему расчёту (`fleetFacts`);
  // вердикт по норме у проигрываемого кадра — из полного прогона, а не из части окна.
  const finalSummary =
    done && scenario && variantId ? withFleetFacts(done.summary, scenario, variantId) : null;
  const shownSummary =
    liveNow && done && scenario && variantId
      ? withFleetFacts(withFinalVerdict(liveNow.summary, done.summary), scenario, variantId, done.summary)
      : finalSummary;
  // Вход, отклонённый предварительной проверкой (грузоподъёмность, вне модели), не двигался:
  // проигрывать нечего.
  const canPlay = done !== null && simWasRun(done.summary);
  const clock = done
    ? { tS: activePlay ? (liveNow?.tS ?? 0) : done.state.tS, warmupS: done.state.warmupS, endS: done.state.endS }
    : null;
  const partial = clock !== null && activePlay !== null && clock.tS < clock.endS;
  const check =
    finalSummary && scenario && variantId === "calculated" ? storedCheck(scenario.stored, finalSummary) : null;

  const status: RunStatus = !input
    ? {
        kind: "unavailable",
        reason: scenarios.length === 0 ? "нет сценариев проекта" : "нет сценария роботизации с данными для имитации",
      }
    : failed
      ? { kind: "error", message: failed.error }
      : done
        ? { kind: "done", durationMs: done.durationMs, seed: input.seed, modelVersion: done.summary.simModelVersion }
        : { kind: "running", pct };

  // ——— «Принять парк по имитации» ———
  // Прогон отклонён предварительной проверкой (робот не поднимает груз) — число роботов не
  // помогает, предлагать парк нечего.
  const m = finalSummary && simWasRun(finalSummary) ? finalSummary.minStableFleet : null;
  const calcFleet = scenario ? variantFleet(scenario, "calculated") : null;
  const accept: AcceptFleetControl | null =
    !readOnly && onAcceptFleet && scenario && m !== null
      ? {
          fleet: m,
          disabled: calcFleet === m,
          hint:
            calcFleet === m
              ? `Парк сценария уже равен минимальному по имитации (${m}).`
              : `Парк сценария «${scenario.name}» станет ${m} вместо ${calcFleet ?? "—"}; изменение попадёт в журнал.`,
        }
      : null;

  function handleAccept() {
    if (scenario && m !== null && onAcceptFleet) onAcceptFleet(scenario.key, m);
  }

  // ——— PNG ———
  const [png, setPng] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

  function handlePng() {
    if (!done || !layout || !scenario || !variant || !input || !finalSummary) return;
    const st = activePlay ? playRef.current : done.state;
    const mid = activePlay !== null && st !== null && !isDone(st);
    const summaryForPng =
      mid && st
        ? withFleetFacts(withFinalVerdict(summarize(st, meta), done.summary), scenario, variant.id, done.summary)
        : finalSummary;
    const clockText =
      st && simWasRun(done.summary)
        ? `время имитации ${formatSimClock(st.tS)} (${simPhaseLabel(st.tS, st.warmupS, st.endS)})`
        : undefined;
    const dateText = new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
    setPng({ busy: true, message: null });
    exportSimPng(layout, st, summaryForPng, {
      scenarioName: variant.label,
      seed: input.seed,
      dateText,
      clockText,
      partial: mid,
      finalSummary,
    })
      .then((name) => setPng({ busy: false, message: `PNG сохранён: ${name}` }))
      .catch((e: unknown) => setPng({ busy: false, message: `PNG не собран: ${errorText(e)}` }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as={headingAs}>Имитация работы склада</CardTitle>
        <CardDescription>
          Проверка расчёта имитацией: тот же парк, та же планировка и тот же пиковый поток, что в экономике.
          Схема показывает итог прогона; движение — только по кнопке «▶ Старт».
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SimControls
          selectId={selectId}
          options={options}
          value={selectedValue}
          onSelect={handleSelect}
          canPlay={canPlay}
          playing={playing}
          canSkip={activePlay !== null}
          speed={speed}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onSkip={handleSkip}
          onSpeed={setSpeed}
          canExport={done !== null}
          exporting={png.busy}
          onPng={handlePng}
          accept={accept}
          onAccept={handleAccept}
        />
        {done && !canPlay && (
          <p className="text-xs text-muted-foreground">
            Проигрывать нечего: вход отклонён до прогона (причина — в вердикте), роботы не двигались.
          </p>
        )}
        {reducedMotion && canPlay && (
          <p className="text-xs text-muted-foreground">
            В системе включено уменьшение движения: показан итог прогона, проигрывание — только по «▶ Старт».
          </p>
        )}
        <div role="status" aria-live="polite" className="grid gap-0.5 text-sm">
          <p>{statusText(status)}</p>
          {png.message && <p className="text-muted-foreground">{png.message}</p>}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="grid content-start gap-2">
            {layout ? (
              <SimCanvas
                layout={layout}
                finalState={done?.state ?? null}
                playRef={playRef}
                mode={activePlay ? "play" : "final"}
                playToken={activePlay?.token ?? 0}
                playing={playing}
                speed={speed}
                ariaLabel={canvasAriaLabel(finalSummary, input?.robots.count ?? null)}
                onTick={handleTick}
                onEnd={handleEnd}
              />
            ) : (
              <div className="rounded-md border p-6 text-sm text-muted-foreground">
                Выберите сценарий роботизации: для «Как есть» роботов нет — имитировать нечего.
              </div>
            )}
            <SimLegend />
          </div>
          <SimKpis shown={shownSummary} final={finalSummary} partial={partial} clock={clock} check={check} />
        </div>

        {variant?.provenance && variant.provenance.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Откуда параметры имитации</summary>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-normal">
                    Параметр
                  </th>
                  <th scope="col" className="py-1 pr-2 font-normal">
                    Значение
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Откуда
                  </th>
                </tr>
              </thead>
              <tbody>
                {variant.provenance.map((p) => (
                  <tr key={p.field} className="border-t border-border/60 align-top">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {p.label}
                    </th>
                    <td className="py-1 pr-2 whitespace-nowrap tabular-nums">
                      {provenanceValue(p.value)}
                      {p.value !== null && p.unit ? ` ${p.unit}` : ""}
                    </td>
                    <td className="py-1 text-muted-foreground">
                      {originLabel(p.origin)}
                      {p.note ? ` — ${p.note}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        <p className="text-xs text-muted-foreground">{SIM_FOOTER}</p>
      </CardContent>
    </Card>
  );
}
