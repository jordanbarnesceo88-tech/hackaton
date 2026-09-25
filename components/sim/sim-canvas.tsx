"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { isDone, stepSim } from "@/lib/sim/engine";
import type { SimEngineState } from "@/lib/sim/state";
import type { SimLayout } from "@/lib/sim/types";
import { drawScene } from "./draw-scene";
import { fitCanvas } from "./fit-canvas";
import { KPI_PUSH_INTERVAL_MS, stepsForFrame } from "./playback";

/**
 * Канва схемы склада с проигрыванием имитации.
 *
 * Два режима:
 * - «final» — рисуется конечное состояние прогона без анимации (последний кадр);
 * - «play» — рисуется состояние проигрывания из `playRef`; пока `playing`, цикл
 *   requestAnimationFrame делает speed × 60 × длительность кадра шагов модели за кадр.
 *
 * Цикл читает только ref и замыкание эффекта, React-состояние не трогает; показатели уходят
 * наверх через `onTick` не чаще 4 раз в секунду, а не на каждом кадре (иначе вся карточка
 * перерисовывалась бы 60 раз в секунду). Скрытая вкладка останавливает цикл, возврат на неё
 * продолжает без скачка времени; изменение размера перерисовывает кадр под новый буфер.
 */
export function SimCanvas({
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
  /** Конечное состояние прогона без анимации; null — прогон ещё идёт (рисуется пустая схема). */
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tick = useEffectEvent((state: SimEngineState) => onTick(state));
  const end = useEffectEvent(() => onEnd());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const animate = mode === "play" && playing;
    let raf = 0;
    let last = 0;
    let carry = 0;
    let lastPush = -Infinity;

    const paint = () => {
      const { W, H, dpr } = fitCanvas(canvas, 2);
      const state = mode === "play" ? playRef.current : finalState;
      drawScene(ctx, layout, state, { W, H, dpr, scale: W < 480 ? 0.85 : 1, labels: true });
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

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(animate ? loop : () => paint());
    };

    // Без анимации кадр рисуется сразу — даже в скрытой вкладке, где rAF не срабатывает.
    if (!animate) paint();
    else if (!document.hidden) schedule();

    const onResize = () => {
      // Во время проигрывания буфер подгоняется в каждом кадре; на паузе — перерисовка по событию.
      if (!animate) schedule();
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        // Отсчёт времени кадра начинается заново: модель не «догоняет» время, пока вкладка была скрыта.
        last = 0;
        schedule();
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    // Ширина колонки меняется и без изменения окна (свёрнутая боковая панель, перенос сетки).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    observer?.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [layout, finalState, playRef, mode, playToken, playing, speed]);

  return (
    <canvas
      ref={canvasRef}
      // Размер буфера выставляется по фактической ширине и плотности пикселей; эти атрибуты —
      // только стартовое значение до первого кадра.
      width={720}
      height={360}
      role="img"
      aria-label={ariaLabel}
      className="block w-full rounded-md border"
      style={{ aspectRatio: "2 / 1", background: "#0f172a" }}
    />
  );
}
