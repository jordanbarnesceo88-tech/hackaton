"use client";

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSim, isDone } from "@/lib/sim/engine";
import { simWasRun, summarize, type SimRunSummary } from "@/lib/sim/metrics";
import type { SimEngineState } from "@/lib/sim/state";
import { formatNum } from "@/lib/format/rub";
import { originLabel } from "@/lib/tz/characteristics";
import { formatSimClock, simPhaseLabel } from "./scene-model";
import { SIM_FOOTER, exportSimPng } from "./export-png";
import { parseSimInputKey, simInputKey } from "./input-key";
import { canvasAriaLabel, statusText, storedCheck, withFinalVerdict, type RunStatus } from "./kpi-text";
import { DEFAULT_SPEED } from "./playback";
import { CadPlanConcept } from "./cad-plan-concept";
import { isAbortError, runHeadless } from "./run-headless";
import { SimIsoScene } from "./sim-iso-scene";
import { SimControls } from "./sim-controls";
import { SimKpis } from "./sim-kpis";
import { SimLegend } from "./sim-legend";
import { useReducedMotion } from "./use-reduced-motion";
import { SpatialPreview, type SpatialFinancialAssumptions } from "./spatial-preview";
import type { SpatialProjectSnapshot, SpatialProjectResult } from "@/lib/sim/spatial-bridge";
import type { SpatialScenarioProposal } from "@/lib/sim/spatial-proposal";
import type { SpatialEvidence } from "@/lib/tz/types";
import { spatialEvidenceMatchesInput } from "@/lib/sim/spatial-evidence";
import { simSummaryMatchesInput } from "@/lib/sim/identity";
import {
  optionValue,
  resolveSelection,
  simOptions,
  withFleetFacts,
  type SimScenario,
  type SimVariantId,
} from "./variants";

/** Each transport workflow uses its own server receipt; playback mounts only on explicit open. */

/** Шаг прогресса в строке состояния, %: чаще обновлять aria-live незачем — скринридер зачитывает каждое. */
const PROGRESS_STEP_PCT = 5;

export type WarehouseSimulationProps = {
  /** Сценарии проекта с вариантами парка (см. `buildSimVariants`). */
  scenarios: SimScenario[];
  /** Ключ сценария, выбранного при открытии. */
  initialKey: string;
  selectedScenarioKey?: string;
  /** Только чтение: без кнопки «Принять парк по имитации». */
  readOnly?: boolean;
  /** The form has edits not represented by the calculated simulation input. Unsaved calculated data is valid. */
  stale?: boolean;
  spatialEvidenceByKey?: Record<string, SpatialEvidence | undefined>;
  onSpatialResult?: (snapshot: SpatialProjectSnapshot, result: SpatialProjectResult) => void;
  onSpatialScenario?: (proposal: SpatialScenarioProposal, assumptions: SpatialFinancialAssumptions) => void;
  onScenarioSelect?: (key: string) => void;
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
  scenarios, initialKey, selectedScenarioKey, spatialEvidenceByKey = {}, stale = false, readOnly = false,
  onSpatialResult, onSpatialScenario, onScenarioSelect, nowFn, headingAs = "h2",
}: WarehouseSimulationProps) {
  const selectId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const [analyticalOpen, setAnalyticalOpen] = useState(false);
  const scenario = scenarios.find(s => s.key === (selectedScenarioKey ?? picked ?? initialKey)) ?? scenarios[0];
  const variant = scenario?.variants.find(v => v.id === "calculated");
  const input = variant?.input;
  const evidence = scenario ? spatialEvidenceByKey[scenario.key] : undefined;
  const spatial = input?.transportWorkflow === "closed-pod-1";
  const fresh = spatial && !stale && spatialEvidenceMatchesInput(evidence, input);
  const analytical = !spatial && !stale && scenario?.stored?.scenarioKey === scenario?.key && simSummaryMatchesInput(scenario?.stored, input) ? scenario.stored : null;
  const measured = fresh && evidence.assessment.status !== "NOT_EVALUATED";
  const status = stale ? "stale" : spatial ? fresh ? evidence.assessment.status : evidence ? "stale" : "missing"
    : analytical ? analytical.verdict : scenario?.stored ? "stale" : "missing";
  return <Card data-validation-kind={spatial ? "spatial" : input ? "analytical" : "unsupported"}
    data-spatial-receipt={spatial ? status : undefined} data-analytical-receipt={!spatial && input ? status : undefined}>
    <CardHeader>
      <CardTitle as={headingAs}>{spatial ? "Проверка работы склада в 3D" : input ? "Аналитическая проверка транспортного процесса" : "Проверка нагрузки"}</CardTitle>
      <CardDescription>{spatial ? "Проверяем выбранный состав на исходной нагрузке: движение, подхват стеллажей, возвраты, зарядку и защитные остановки."
        : input ? "Проверяем одиночную перевозку: задания, ожидание, работу точек и зарядку. Пространственная безопасность и подхват стеллажа этой моделью не проверяются."
        : "Доступность имитации зависит от выбранного процесса и исходных данных."}</CardDescription>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-4">
      <div className="grid gap-1">
        <label htmlFor={selectId} className="text-sm font-medium">Сценарий</label>
        <select id={selectId} className="field max-w-xl" value={scenario?.key ?? ""} disabled={!scenarios.length}
          onChange={event => { setPicked(event.target.value); onScenarioSelect?.(event.target.value); }}>
          {!scenarios.length && <option value="">Нет сценария для проверки</option>}
          {scenarios.map(s => <option key={s.key} value={s.key} disabled={!s.variants.some(v => v.id === "calculated" && v.input)}>{s.name}</option>)}
        </select>
      </div>
      <div role="status" aria-live="polite" className="grid gap-2 text-sm">
        <p className="font-medium">{stale ? "Условия изменены. Пересчитайте сценарий для актуальной проверки."
          : fresh ? evidence.assessment.headline
          : analytical ? analytical.verdict === "CONFIRMED" ? "Серверная аналитическая 2D-модель: критерии текущего входа выполнены."
            : analytical.verdict === "NOT_CONFIRMED" ? "Серверная аналитическая 2D-модель не подтвердила заданную нагрузку."
            : analytical.verdict === "NOT_EVALUATED" ? analytical.assessmentReason ?? "Нагрузка не оценена: в пиковом окне не наблюдались клиентские задания."
            : "Серверная аналитическая 2D-модель не поддерживает этот вход."
          : input ? spatial ? "Актуальная пространственная проверка этого входа отсутствует. Выполните расчёт сценария."
            : "Актуальная серверная 2D-сводка этого входа отсутствует. Пересчитайте сценарий."
          : scenario?.unavailableReason ?? "Выберите сценарий роботизации с данными для поддерживаемой проверки нагрузки."}</p>
        {measured && <dl className="grid gap-x-5 gap-y-3 border-y border-border py-3 tabular-nums sm:grid-cols-3" aria-label="Результат пространственной проверки">
          <div><dt className="text-xs text-muted-foreground">Доставлено / требуется</dt><dd className="m-0 font-semibold">{formatNum(evidence.summary.achievedPerH, 1)} / {formatNum(evidence.summary.requiredPerH, 1)} пал./ч</dd></div>
          <div><dt className="text-xs text-muted-foreground">Ещё не начата обработка</dt><dd className="m-0 font-semibold">{formatNum(evidence.summary.queueEnd)} заявок</dd></div>
          <div><dt className="text-xs text-muted-foreground">Ожидание до начала обработки p95</dt><dd className="m-0 font-semibold">{formatNum(evidence.summary.waitP95Min, 1)} мин</dd></div>
        </dl>}
        {analytical && analytical.verdict !== "NOT_EVALUATED" && simWasRun(analytical) && <dl className="grid gap-x-5 gap-y-3 border-y border-border py-3 tabular-nums sm:grid-cols-3" aria-label="Результат аналитической проверки">
          <div><dt className="text-xs text-muted-foreground">Достигнуто / требуется</dt><dd className="m-0 font-semibold">{formatNum(analytical.achievedPerH, 1)} / {formatNum(analytical.requiredPerH, 1)} пал./ч</dd></div>
          <div><dt className="text-xs text-muted-foreground">Максимальная очередь заданий</dt><dd className="m-0 font-semibold">{formatNum(analytical.queueMax)} заявок</dd></div>
          <div><dt className="text-xs text-muted-foreground">Ожидание назначения p95</dt><dd className="m-0 font-semibold">{formatNum(analytical.waitP95Min, 1)} мин</dd></div>
        </dl>}
      </div>
      {input && <p className="text-xs text-muted-foreground">Парк: {input.robots.count} · зарядок: {input.layout.chargers}. Окно: {formatNum(input.demand.peakMin)} мин после {formatNum(input.demand.warmupMin)} мин прогрева; seed {input.seed}.{fresh ? ` Модель ${evidence.simModelVersion}.` : analytical ? ` Модель ${analytical.simModelVersion}.` : ""} {spatial ? "Начало обработки включает подачу носителя для конкретной заявки; завершённые доставки учитываются отдельно." : "Результат относится к аналитическому циклу одиночной перевозки выбранного транспортного процесса."}</p>}
      {input && <p className="text-xs text-muted-foreground">{input.demand.mix
        ? `Клиентский поток: приёмка ${formatNum(input.demand.mix.inbound*100,1)} %, отгрузка ${formatNum(input.demand.mix.outbound*100,1)} %, хранение → хранение ${formatNum(input.demand.mix.internal*100,1)} %.`
        : "Исторический вход: смесь 50/50 приёмки и отгрузки, без внутренних клиентских перемещений."}
        {input.demand.mix && input.demand.mix.internal>0 ? ` Начальная доля свободных мест — явное допущение ${formatNum((input.demand.storageVacancyShare??0)*100,1)} %. Свободное место выбирается и резервируется при назначении; после переноса домашний адрес того же носителя меняется. Товарный запас не моделируется.` : ""}</p>}
      {spatial && <SpatialPreview stale={stale} readOnly={readOnly} onResult={onSpatialResult} onCreateScenario={onSpatialScenario}
        selection={scenario && variant && input ? { scenarioKey: scenario.key, scenarioName: scenario.name, variantId: "calculated", input,
          ...(variant.provenance ? { provenance: variant.provenance } : {}),
          ...(scenario.assumedUtilPct === undefined ? {} : { assumedUtilPct: scenario.assumedUtilPct }) } : null} />}
      {spatial && <CadPlanConcept />}
      {input && <details className="min-w-0 border-t border-border pt-3" open={analyticalOpen}
        onToggle={event => setAnalyticalOpen(event.currentTarget.open)}>
        <summary className="tap-target cursor-pointer text-sm font-medium">Упрощённая аналитическая проверка</summary>
        <p className="mt-2 text-xs text-muted-foreground">{input?.transportWorkflow === "closed-pod-1"
          ? "Однорейсовая 2D-модель не учитывает обязательную подачу и возврат стеллажей. Для этого процесса используется пространственная проверка выше."
          : "Схема и локальное воспроизведение аналитического цикла. Серверный результат текущих условий показан выше; просмотр других парков не изменяет сценарий и его подтверждение."}</p>
        {analyticalOpen && !spatial && <div className="mt-3"><AnalyticalWarehouseSimulation scenarios={scenarios.filter(s => s.variants.some(v => v.input && v.input.transportWorkflow !== "closed-pod-1")).map(s => ({ ...s, variants: s.variants.filter(v => v.input?.transportWorkflow !== "closed-pod-1") }))} initialKey={scenario?.key ?? initialKey}
          selectedScenarioKey={scenario?.key} stale={stale} readOnly onScenarioSelect={onScenarioSelect} nowFn={nowFn} headingAs="h3" /></div>}
      </details>}
    </CardContent>
  </Card>;
}

function AnalyticalWarehouseSimulation({
  scenarios,
  initialKey,
  selectedScenarioKey,
  onScenarioSelect,
  nowFn,
  headingAs = "h2",
}: WarehouseSimulationProps) {
  const reducedMotion = useReducedMotion();
  const selectId = useId();

  // Выбор пользователя; если после пересчёта такого пункта нет — выбор по умолчанию.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedKey = picked ? resolveSelection(scenarios, picked, initialKey)?.scenario.key : null;
  const sel = resolveSelection(scenarios, selectedScenarioKey && pickedKey !== selectedScenarioKey ? null : picked, selectedScenarioKey ?? initialKey);
  const scenario = sel?.scenario ?? null;
  const variant = sel?.variant ?? null;
  const selectedValue = sel ? optionValue(sel.scenario.key, sel.variant.id) : null;
  const scenarioKey = scenario?.key ?? "";
  const variantId: SimVariantId | null = variant?.id ?? null;
  const assumedUtilPct = scenario?.assumedUtilPct ?? scenario?.stored?.assumedUtilPct;

  // Вход сравнивается по значению, а не по ссылке (см. input-key.ts): владелец может собирать
  // сценарии заново на каждой отрисовке — ключ по ссылке
  // зациклил бы прогон. Все записи ниже помечены этим ключом.
  const input = variant?.input ?? null;
  const inputKey = input ? simInputKey(input) : null;

  const options = useMemo(() => simOptions(scenarios), [scenarios]);

  // ——— Прогон без анимации ———
  const [run, setRun] = useState<RunRecord | null>(null);
  const [progress, setProgress] = useState<{ key: string; pct: number } | null>(null);
  const clockNow = useEffectEvent(() => (nowFn ?? defaultNow)());

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
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbortError(e)) return;
        setRun({ key: inputKey, ok: false, error: errorText(e) });
      });
    return () => ac.abort();
  }, [inputKey, scenarioKey, assumedUtilPct]);

  const current = run && inputKey !== null && run.key === inputKey ? run : null;
  const done = current?.ok ? current : null;
  const layout = done?.state.layout ?? null;
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
    const st = createSim(parseSimInputKey(inputKey));
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
    const chosen = resolveSelection(scenarios, value, initialKey);
    if (chosen) onScenarioSelect?.(chosen.scenario.key);
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
        <CardTitle as={headingAs}>Упрощённая аналитическая проверка</CardTitle>
        <CardDescription>
          Локальное воспроизведение одиночной перевозки на исходной планировке. Серверная сводка показана выше; этот просмотр не подтверждает подхват стеллажа или пространственную безопасность.
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
          accept={null}
          onAccept={() => undefined}
        />
        {input && (
          <p className="text-xs text-muted-foreground">
            ×1 — реальное время, ×2 — ускорение вдвое. Обзор ×480 — ускоренное воспроизведение, не физическая скорость робота.
            {" "}Скорость по модели: {formatNum(input.robots.speedMps, 2)} м/с без груза,
            {" "}{formatNum(input.robots.speedMps * input.robots.loadedSpeedFactor, 2)} м/с с грузом.
          </p>
        )}
        {done && !canPlay && (
          <p className="text-xs text-muted-foreground">
            Проигрывать нечего: прогон не выполнялся (причина — в вердикте).
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
              <SimIsoScene
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
                {input ? "Схема появится после завершения аналитического прогона." : "Выберите сценарий роботизации: для «Как есть» роботов нет — имитировать нечего."}
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
