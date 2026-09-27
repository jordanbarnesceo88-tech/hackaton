"use client";

import { useEffect, useEffectEvent, useMemo, useRef, type RefObject } from "react";
import { isDone, stepSim } from "@/lib/sim/engine";
import type { SimEngineState } from "@/lib/sim/state";
import type { SimLayout } from "@/lib/sim/types";
import { applyIsoFrame, bindIsoDom } from "./iso-dom";
import { isoFrame, isoGeometry, isoScreenMarkup, isoStyleSheet, viewBoxAttr } from "./iso-scene";
import { KPI_PUSH_INTERVAL_MS, stepsForFrame } from "./playback";

/** Таблица стилей схемы и легенды: одна на страницу (React поднимает <style href> в head и не дублирует). */
const ISO_CSS = isoStyleSheet("auto");

export function IsoStyles() {
  return (
    <style href="iso-scene" precedence="default">
      {ISO_CSS}
    </style>
  );
}

/**
 * Изометрическая схема склада с проигрыванием имитации — изометрия прототипа BCB на месте
 * плоской канвы. Статичная часть (пол, стеллажи, стены, ворота) собирается один раз на
 * планировку; по кадрам двигаются только роботы, их пути, занятость точек и часы.
 *
 * Два режима, как у прежней канвы:
 * - «final» — показан конечный кадр прогона без анимации;
 * - «play» — показано состояние проигрывания из `playRef`; пока `playing`, цикл
 *   requestAnimationFrame делает speed × 60 × длительность кадра шагов модели за кадр.
 *
 * Цикл читает только ref и замыкание эффекта, React-состояние не трогает; показатели уходят
 * наверх через `onTick` не чаще 4 раз в секунду. Скрытая вкладка останавливает цикл, возврат на
 * неё продолжает без скачка времени. Размер схема берёт от viewBox — её не нужно подгонять под
 * буфер, как канву.
 */
export function SimIsoScene({
  layout,
  finalState,
  playRef,
  mode,
  playToken,
  playing,
  speed,
  ariaLabel,
  onTick,
  onEnd,
}: {
  layout: SimLayout;
  /** Конечное состояние прогона без анимации; null — прогон ещё идёт (показан пустой склад). */
  finalState: SimEngineState | null;
  /** Состояние проигрывания (создаёт и меняет владелец в обработчиках кнопок). */
  playRef: RefObject<SimEngineState | null>;
  mode: "final" | "play";
  /** Меняется при каждом новом проигрывании (Старт с начала, Перезапуск). */
  playToken: number;
  playing: boolean;
  speed: number;
  ariaLabel: string;
  /** Состояние проигрывания для показателей: не чаще 4 раз в секунду и в конце прогона. */
  onTick: (state: SimEngineState) => void;
  /** Проигрывание дошло до конца. */
  onEnd: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tick = useEffectEvent((state: SimEngineState) => onTick(state));
  const end = useEffectEvent(() => onEnd());
  const geom = useMemo(() => isoGeometry(layout), [layout]);
  const markup = useMemo(() => ({ __html: isoScreenMarkup(layout, geom) }), [layout, geom]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const dom = bindIsoDom(svg);
    if (!dom) return;

    const animate = mode === "play" && playing;
    let raf = 0;
    let last = 0;
    let carry = 0;
    let lastPush = -Infinity;

    const paint = () => {
      const state = mode === "play" ? playRef.current : finalState;
      applyIsoFrame(dom, state ? isoFrame(layout, state, geom) : null);
    };

    const loop = (now: number) => {
      const st = playRef.current;
      if (!st || isDone(st)) {
        paint();
        if (st) {
          tick(st);
          end();
        }
        return;
      }
      const f = stepsForFrame(speed, last ? (now - last) / 1000 : 0, carry);
      last = now;
      carry = f.carry;
      for (let i = 0; i < f.steps && !isDone(st); i++) stepSim(st);
      paint();
      if (isDone(st)) {
        tick(st);
        end();
        return;
      }
      if (now - lastPush >= KPI_PUSH_INTERVAL_MS) {
        lastPush = now;
        tick(st);
      }
      raf = requestAnimationFrame(loop);
    };

    // Без анимации кадр рисуется сразу — даже в скрытой вкладке, где rAF не срабатывает.
    if (!animate) paint();
    else if (!document.hidden) raf = requestAnimationFrame(loop);

    const onVisibility = () => {
      if (!animate) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        // Отсчёт времени кадра начинается заново: модель не «догоняет» время, пока вкладка была скрыта.
        last = 0;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [layout, geom, markup, finalState, playRef, mode, playToken, playing, speed]);

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-[radial-gradient(ellipse_80%_70%_at_55%_45%,var(--card),transparent_72%)]">
      <IsoStyles />
      <svg
        ref={svgRef}
        className="iso-root block h-auto w-full"
        viewBox={viewBoxAttr(geom)}
        role="img"
        aria-label={ariaLabel}
        dangerouslySetInnerHTML={markup}
      />
    </div>
  );
}
