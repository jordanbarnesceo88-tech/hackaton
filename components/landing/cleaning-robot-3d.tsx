"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IsoStyles } from "@/components/sim/sim-iso-scene";
import { useReducedMotion } from "@/components/sim/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * 3D-модель робота-уборщика на первой странице: медленно вращается, мышью или пальцем её можно
 * повернуть. Модель собрана из цилиндров (корпус, бампер, лидар, кнопка) и рисуется на canvas
 * плоскими гранями с освещением по Ламберту.
 *
 * Без three.js сознательно: зависимость меняет package-lock.json, а он входит в отпечаток
 * расчётного движка (.gitattributes, «Exact build-worker source graph») — ради картинки на главной
 * менять версию движка нельзя. Порядок отрисовки задан слоями снизу вверх: у тела вращения на
 * вертикальной оси, видимого сверху, этого достаточно, а задние грани отсекаются.
 *
 * Цвета — из палитры схемы склада (IsoStyles, переменные --iso-*), поэтому тема сайта
 * подхватывается сама. Вне экрана цикл стоит; при «уменьшить движение» модель неподвижна;
 * кнопка «Пауза» — для остальных (движение дольше 5 секунд, WCAG 2.2.2).
 */

type V3 = [number, number, number];
type RGB = [number, number, number];
type Palette = { body: RGB; dark: RGB; accent: RGB; glass: RGB; shadow: string };

/** Наклон камеры, рад: смотрим спереди и сверху. */
const ELEVATION = 0.5;
/** Скорость вращения, рад/с, и щёток. */
const SPIN = 0.45;
const BRUSH_SPIN = 9;
/** Фокус лёгкой перспективы в радиусах робота. */
const FOCAL = 9;
const SEGMENTS = 128;
/** Свет: сверху-слева-спереди относительно зрителя. */
const LIGHT: V3 = norm([0.55, 0.55, 0.85]);

function norm([x, y, z]: V3): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function parseColor(raw: string, fallback: RGB): RGB {
  const v = raw.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(v);
  if (rgb) {
    const [r, g, b] = rgb[1]!.split(",").map((c) => parseFloat(c));
    if ([r, g, b].every((c) => Number.isFinite(c))) return [r!, g!, b!];
  }
  return fallback;
}

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  return {
    body: parseColor(cs.getPropertyValue("--iso-bot-body"), [255, 255, 255]),
    dark: parseColor(cs.getPropertyValue("--iso-bot-dark"), [58, 75, 82]),
    accent: parseColor(cs.getPropertyValue("--iso-accent"), [20, 179, 190]),
    glass: parseColor(cs.getPropertyValue("--iso-bot-glass"), [30, 155, 163]),
    shadow: cs.getPropertyValue("--iso-shadow").trim() || "rgba(22,40,45,0.22)",
  };
}

function lighten([r, g, b]: RGB, k: number): RGB {
  return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
}

function shade([r, g, b]: RGB, k: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

type Frame = {
  ctx: CanvasRenderingContext2D;
  cos: number;
  sin: number;
  cx: number;
  cy: number;
  scale: number;
};

/** Поворот модели вокруг вертикали. */
function yaw(f: Frame, [x, y, z]: V3): V3 {
  return [x * f.cos - y * f.sin, x * f.sin + y * f.cos, z];
}

/** Точка модели на экране: камера на +x, наклон ELEVATION, лёгкая перспектива. */
function screen(f: Frame, p: V3): [number, number] {
  const [x, y, z] = yaw(f, p);
  const se = Math.sin(ELEVATION), ce = Math.cos(ELEVATION);
  const depth = x * ce + z * se;
  const k = (f.scale * FOCAL) / (FOCAL - depth);
  return [f.cx + y * k, f.cy + (x * se - z * ce) * k];
}

/** Видна ли грань с нормалью n (в координатах модели) и насколько она освещена. */
function light(f: Frame, n: V3): { visible: boolean; k: number } {
  const [x, y, z] = yaw(f, n);
  const facing = x * Math.cos(ELEVATION) + z * Math.sin(ELEVATION);
  const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
  return { visible: facing > 0, k: 0.62 + 0.38 * diffuse + 0.12 * Math.pow(diffuse, 24) };
}

function polygon(f: Frame, points: V3[], fill: string) {
  const { ctx } = f;
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = screen(f, p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // Тонкая обводка того же цвета закрывает щели сглаживания между соседними гранями.
  ctx.strokeStyle = fill;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

function ring(cx: number, cy: number, r: number, z: number, from = 0, to = Math.PI * 2, n = SEGMENTS): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  }
  return out;
}

/** Боковина цилиндра (или её дуга) гранями и, по желанию, крышка. */
function cylinder(
  f: Frame,
  o: { cx?: number; cy?: number; r: number; z0: number; z1: number; color: RGB; cap?: RGB | null; from?: number; to?: number },
) {
  const cx = o.cx ?? 0, cy = o.cy ?? 0;
  const from = o.from ?? 0, to = o.to ?? Math.PI * 2;
  const n = Math.max(8, Math.round((SEGMENTS * (to - from)) / (Math.PI * 2)));
  for (let i = 0; i < n; i++) {
    const a0 = from + ((to - from) * i) / n, a1 = from + ((to - from) * (i + 1)) / n, am = (a0 + a1) / 2;
    const { visible, k } = light(f, [Math.cos(am), Math.sin(am), 0]);
    if (!visible) continue;
    const p = (a: number, z: number): V3 => [cx + o.r * Math.cos(a), cy + o.r * Math.sin(a), z];
    polygon(f, [p(a0, o.z0), p(a1, o.z0), p(a1, o.z1), p(a0, o.z1)], shade(o.color, k));
  }
  if (o.cap) polygon(f, ring(cx, cy, o.r, o.z1), shade(o.cap, light(f, [0, 0, 1]).k));
}

function stroke(f: Frame, points: V3[], color: string, width: number) {
  const { ctx } = f;
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = screen(f, p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

/** Робот целиком, снизу вверх. x — вперёд, y — влево, z — вверх; радиус корпуса — 1. */
function drawRobot(f: Frame, pal: Palette, brushAngle: number) {
  const { ctx } = f;
  const unit = f.scale / 100;

  // Тень на полу.
  ctx.save();
  ctx.filter = `blur(${Math.max(2, 10 * unit)}px)`;
  polygon(f, ring(0, 0, 1.12, 0, 0, Math.PI * 2, 48), pal.shadow);
  ctx.restore();

  // Боковые щётки спереди: три пучка, вращаются навстречу друг другу.
  for (const side of [1, -1]) {
    const bx = 0.62, by = 0.6 * side;
    for (let i = 0; i < 3; i++) {
      const a = brushAngle * side + (i * Math.PI * 2) / 3;
      stroke(f, [[bx, by, 0.04], [bx + 0.42 * Math.cos(a), by + 0.42 * Math.sin(a), 0.02]], shade(pal.dark, 1.1), Math.max(1, 2.2 * unit));
    }
    cylinder(f, { cx: bx, cy: by, r: 0.07, z0: 0.02, z1: 0.07, color: pal.dark, cap: pal.dark });
  }

  // Юбка-основание, корпус, бампер спереди.
  cylinder(f, { r: 0.95, z0: 0.02, z1: 0.11, color: pal.dark });
  cylinder(f, { r: 1, z0: 0.11, z1: 0.42, color: pal.body, cap: pal.body });
  cylinder(f, { r: 1.022, z0: 0.14, z1: 0.27, color: pal.dark, from: -1.25, to: 1.25 });

  // Крышка: паз панели, полоса-индикатор спереди, кнопка.
  stroke(f, ring(0, 0, 0.8, 0.421), shade(pal.dark, 1.6), Math.max(1, 1.4 * unit));
  stroke(f, ring(0, 0, 0.88, 0.421, -0.55, 0.55, 24), shade(pal.accent, 1), Math.max(1.5, 4 * unit));
  cylinder(f, { cx: 0.42, r: 0.09, z0: 0.42, z1: 0.44, color: pal.dark, cap: pal.accent });

  // Лидар сзади: башня, окно, крышка.
  cylinder(f, { cx: -0.32, r: 0.26, z0: 0.42, z1: 0.5, color: pal.dark });
  cylinder(f, { cx: -0.32, r: 0.262, z0: 0.5, z1: 0.54, color: pal.glass });
  cylinder(f, { cx: -0.32, r: 0.26, z0: 0.54, z1: 0.6, color: pal.dark, cap: lighten(pal.dark, 1.3) });
}

export function CleaningRobot3D({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = useRef({ angle: -0.7, brush: 0, drag: null as null | { x: number; angle: number } });

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    let palette = readPalette(wrap);
    let width = 0, height = 0, dpr = 1;

    function resize() {
      const r = canvas!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = r.width;
      height = r.height;
      canvas!.width = Math.max(1, Math.round(width * dpr));
      canvas!.height = Math.max(1, Math.round(height * dpr));
    }

    function draw() {
      const st = state.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      // Робот ≈ 2,3 радиуса в ширину и ≈ 1,6 в высоту на экране — вписываем с полями.
      const scale = Math.min(width / 2.9, height / 1.9);
      drawRobot(
        { ctx: ctx!, cos: Math.cos(st.angle), sin: Math.sin(st.angle), cx: width / 2, cy: height * 0.5 + scale * 0.1, scale },
        palette,
        st.brush,
      );
    }

    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    // Тема сайта: класс .dark на <html> или системная настройка.
    const repaint = () => {
      palette = readPalette(wrap);
      draw();
    };
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", repaint);

    function onDown(e: PointerEvent) {
      state.current.drag = { x: e.clientX, angle: state.current.angle };
      canvas!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      const d = state.current.drag;
      if (!d) return;
      state.current.angle = d.angle + (e.clientX - d.x) * 0.012;
      draw();
    }
    function onUp() {
      state.current.drag = null;
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    let raf = 0, last = 0, visible = true;
    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      const st = state.current;
      if (!st.drag) st.angle += SPIN * dt;
      st.brush += BRUSH_SPIN * dt;
      draw();
      raf = requestAnimationFrame(frame);
    }
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !raf && !reduced && !paused) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    });
    if (!reduced && !paused) {
      io.observe(canvas);
      raf = requestAnimationFrame(frame);
    }

    return () => {
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      mq.removeEventListener("change", repaint);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, paused]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "iso-root relative overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_center,var(--muted)_0%,transparent_70%)]",
        className,
      )}
    >
      <IsoStyles />
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-pan-y active:cursor-grabbing"
        role="img"
        aria-label="3D-модель робота-уборщика: круглый корпус, бампер спереди, лидар сверху, боковые щётки"
      />
      <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground" aria-hidden="true">
        Потяните, чтобы повернуть
      </p>
      {!reduced && (
        <Button type="button" variant="outline" size="sm" className="absolute top-2 right-2" onClick={() => setPaused((v) => !v)}>
          {paused ? "Продолжить" : "Пауза"}
        </Button>
      )}
    </div>
  );
}
