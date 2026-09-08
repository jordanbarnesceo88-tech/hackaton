"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateLayout } from "@/lib/scene/layout";
import { spawnRobots, stepRobots } from "@/lib/scene/simulate";
import { deployedCapacity, utilizationPct, roiAccrued } from "@/lib/scene/kpi";
import { formatCost } from "@/lib/format/currency";
import { pluralRu } from "@/lib/format/plural";
import { isCalculable } from "@/lib/economics/types";
import type { FacilityKind, RobotState } from "@/lib/scene/types";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "@/lib/economics/types";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

const MAX_RENDERED = 24;
const LOOP_MS = 20000;
const ZONE_COLORS: Record<string, string> = {
  rack: "#94a3b8", gate: "#a5b4fc", belt: "#fbbf24", room: "#86efac",
  zone: "#93c5fd", dock: "#f472b6",
};

export function FacilityVisualization({
  facilityKind,
  params,
  assumptions,
  capacity,
  capacityUnit,
  result,
}: {
  facilityKind: FacilityKind;
  params: FacilityParams;
  assumptions: AssumptionValues;
  capacity: SolutionCapacity;
  capacityUnit: string;
  result: EconomicsResult;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const robotsRef = useRef<RobotState[]>([]);
  // Lives in a ref so it survives the draw effect re-running (pause/resume, layout changes).
  const elapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  // A media query is an external store, and the server has no snapshot of it. Reading it in a
  // useState initializer made the SSR markup («❚❚ Пауза», aria-pressed false) disagree with
  // what a reduced-motion client hydrates to; reading it in an effect meant setState during
  // mount. useSyncExternalStore is the API for this: it takes an explicit server snapshot, and
  // it keeps up if the preference changes while the page is open. A CSS media query cannot
  // reach a requestAnimationFrame loop, so this has to be read in JS either way.
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotion,
    () => false
  );
  // SC 2.2.2 (Pause, Stop, Hide) — Level A: motion that starts by itself, runs longer than five
  // seconds and sits alongside other content needs a user-operable way to stop it. null means
  // "no explicit choice yet", so the OS preference decides until the user overrides it.
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? prefersReducedMotion;

  // The engine returns a typed `invalid_inputs` variant (no numeric fields) for degenerate
  // inputs; `isCalculable` detects it and narrows the union. Fall back to 1 robot in that case
  // so the scene still renders while the calculator shows its "проверьте параметры" notice.
  // When numbers are present the engine guarantees `quantity` is finite.
  const hasNumbers = isCalculable(result);
  const q = hasNumbers ? result.quantity : 1;
  const renderCount = Math.max(1, Math.min(MAX_RENDERED, Math.floor(q)));
  const overflow = q > MAX_RENDERED;

  // Key on areaM2, not the whole params object. generateLayout reads only params.areaM2
  // (lib/scene/layout.ts: `clamp(Math.round(params.areaM2 / 200), 4, 36)`), but `params` is a
  // fresh object on every edit, so typing in «Объём операций» or «Персонал» minted a new layout,
  // which retriggered the respawn effect below and snapped every robot back to its start
  // position — a visible jump on a field that has nothing to do with the scene's geometry.
  const layout = useMemo(
    () => generateLayout(facilityKind, params.areaM2),
    [facilityKind, params.areaM2]
  );

  // (Re)spawn robots when the layout or render count changes.
  useEffect(() => {
    robotsRef.current = spawnRobots(layout, renderCount);
  }, [layout, renderCount]);

  // Animation loop: advance + draw each frame; pause when tab hidden.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    // Fixed illustrative speed: per the plan's "numbers are real, motion is illustrative"
    // line, robot speed is decorative and intentionally not tied to throughput (that would
    // read as a physical simulation we don't claim to be). The real figures live in the KPIs.
    const speed = 0.15;

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(now - last, 100); // clamp dt (e.g. after tab refocus)
      last = now;

      // Paused still draws one frame, so the scene stays visible and legible — it just stops
      // advancing. Hiding it would lose the layout, which is the informative part.
      if (!paused) {
        robotsRef.current = stepRobots(robotsRef.current, dt, speed);
        // Accumulate rather than measuring from an effect-local start time. The effect re-runs
        // on pause/resume, so a local `start` was reset on every resume and the «Накопленная
        // экономия» bar snapped back to zero instead of carrying on.
        elapsedRef.current += dt;
        setElapsed(elapsedRef.current);
      }

      // Буфер канвы подгоняется под её реальный размер на экране, умноженный на плотность
      // пикселей устройства. Раньше он был фиксированным 720×360 и растягивался CSS до ширины
      // колонки: на ретине это давало заметное мыло — на схеме объекта, которая и есть
      // единственная картинка в продукте.
      //
      // Проверка на каждом кадре, а не ResizeObserver: сравнение двух чисел дешевле подписки,
      // а изменение размера буфера очищает канву, поэтому делается только при расхождении.
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth || 720;
      const H = Math.round(W / 2); // aspect-ratio 2/1 задан стилем
      const bw = Math.round(W * dpr);
      const bh = Math.round(H * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      // Рисуем в CSS-пикселях: всё ниже мыслит логическими координатами, а масштаб под
      // плотность делает трансформация. Иначе радиус робота пришлось бы умножать вручную в
      // каждом месте, и одно из них однажды забыли бы.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, W, H);

      for (const z of layout.zones) {
        ctx.fillStyle = ZONE_COLORS[z.kind] ?? "#64748b";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "#22d3ee";
      for (const r of robotsRef.current) {
        ctx.beginPath();
        ctx.arc(r.pos.x * W, r.pos.y * H, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!paused) raf = requestAnimationFrame(draw);
    };

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        // Cancel any pending frame before scheduling so a hidden-mount (whose initial
        // frame was skipped) or a rapid hide→show can't leave two rAF loops running.
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    // Don't schedule while hidden: a callback registered here never fires until the tab
    // is shown, at which point onVis would schedule a second, independent loop.
    if (!document.hidden) raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [layout, paused, renderCount]);

  const util = hasNumbers
    ? utilizationPct(capacity, params, assumptions, result.quantity)
    : null;
  const deployed = hasNumbers
    ? deployedCapacity(result.quantity, capacity.capacityPerUnit)
    : null;
  const savings = result.economical ? result.annualSavingsUsd : 0;
  // Paused shows the completed year, not zero. The bar fills 0 → annual purely as illustration
  // — the number it lands on is the real figure, and the label already says «за год». Leaving it
  // at 0 while paused meant a reduced-motion user (who starts paused) permanently read
  // «Накопленная экономия (за год): 0 ₽» beside a panel reporting 6 075 000 ₽, and this readout
  // appears nowhere else, so the canvas label's promise that the numbers are also given as text
  // was not true for them.
  // Only a scene that never ran shows the completed year. An explicit pause freezes wherever
  // the loop had got to — jumping the bar from 40% to full on ❚❚ and back on ▶ would be its own
  // small lie. The reduced-motion case (no explicit choice, animation never started) is the one
  // that needs the full figure, because otherwise that reader sees 0 ₽ and this number appears
  // nowhere else on the page.
  // Pressing ▶ from the never-ran state does drop this readout from the full year to 0, and
  // that is not removable: `roiAccrued` is `(elapsed % loopMs) / loopMs`, so every fill from
  // "complete" must pass through the wrap — seeding `elapsedRef` to LOOP_MS lands on exactly 0
  // too. Deferring it by one frame would not make it read differently. It is also not a loss
  // of information: the annual figure this restarts from stays on screen in the results panel
  // («Годовая экономия») the whole time, and a counter visibly climbing from 0 next to it is
  // what an accrual animation is. Left as is deliberately — don't "fix" it by seeding.
  const neverRan = userPaused === null && prefersReducedMotion;
  const accrued = !result.economical
    ? 0
    : neverRan
      ? savings
      : roiAccrued(elapsed, LOOP_MS, savings);
  const accruedFrac = savings > 0 ? accrued / savings : 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle as="h2">Визуализация работы роботов</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="relative">
          {/* SC 1.1.1: the canvas is decorative — "numbers are real, motion is illustrative".
              Every figure it depicts (robot count, throughput, utilisation) is spelled out as
              text in the KPI column beside it, so the scene itself carries no information that
              is lost. Labelled rather than aria-hidden so its purpose is still discoverable. */}
          <canvas
            ref={canvasRef}
            // Размер буфера выставляется в кадре по фактической ширине и плотности пикселей;
            // эти атрибуты — только стартовое значение до первого кадра.
            width={720}
            height={360}
            role="img"
            // pluralRu, not a two-branch guess: Russian needs the genitive singular for 2–4
            // (and 22–24, …), so `renderCount === 1 ? … : "роботов"` announced "2 роботов".
            aria-label={`Иллюстрация работы решения: ${renderCount} ${pluralRu(renderCount, [
              "робот",
              "робота",
              "роботов",
            ])} на схеме объекта. Движение декоративное; показатели приведены рядом текстом.`}
            className="w-full rounded-md border"
            style={{ aspectRatio: "2 / 1" }}
          />
          {overflow && (
            <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
              показано {MAX_RENDERED} из {q}
            </span>
          )}
          {/* Two ways to expose a play/pause control are correct (APG, Button (Toggle)): a
              stable name plus `aria-pressed`, or a name that changes with the action and no
              `aria-pressed`. Doing both announced «Продолжить, кнопка-переключатель, нажато» —
              a name saying "resume" beside a state saying "on". The visible label is the
              affordance here, so the label flips and the state attribute is gone; the name
              alone carries what pressing it will do, and it still matches the visible text
              (SC 2.5.3, Label in Name). */}
          <button
            type="button"
            onClick={() => setUserPaused(!paused)}
            className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white"
          >
            {paused ? "▶ Продолжить" : "❚❚ Пауза"}
          </button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            Роботов в работе: <b>{renderCount}</b>
            {overflow ? ` (всего ${q})` : ""}
          </div>
          <div>
            Производительность: <b>{deployed === null ? "—" : `${deployed.toLocaleString("ru-RU")} ${capacityUnit}`}</b>
          </div>
          <div>Загрузка: <b>{util === null ? "—" : `${util.toFixed(0)}%`}</b></div>
          <div>
            <div className="mb-1">Накопленная экономия (за год):</div>
            {!hasNumbers ? (
              // Invalid inputs: stay consistent with the results panel's neutral notice rather
              // than claiming the solution is unprofitable.
              <div className="font-medium text-muted-foreground">
                Проверьте параметры расчёта
              </div>
            ) : result.economical ? (
              <>
                <div className="h-3 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-positive transition-[width] duration-100"
                    style={{ width: `${Math.round(accruedFrac * 100)}%` }}
                  />
                </div>
                <div className="mt-1 font-medium">{formatCost(accrued, assumptions.usdToRub)}</div>
              </>
            ) : (
              <div className="font-medium text-destructive">
                Решение не окупается — экономия не накапливается
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
