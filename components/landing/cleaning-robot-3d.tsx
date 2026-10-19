"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IsoStyles } from "@/components/sim/sim-iso-scene";
import { useReducedMotion } from "@/components/sim/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * 3D-модели роботов-уборщиков на первой странице, в одном масштабе: большой коммерческий —
 * для складов и ТЦ (по образцу робота alfa: сиреневый корпус, голова-экран с «глазами», белое
 * основание, боковые щётки и скребок) и компактный — для офисов. Медленно вращаются, мышью или
 * пальцем их можно повернуть. Рисуются на canvas плоскими гранями с освещением по Ламберту.
 *
 * Без three.js сознательно: зависимость меняет package-lock.json, а он входит в отпечаток
 * расчётного движка (.gitattributes, «Exact build-worker source graph») — ради картинки на главной
 * менять версию движка нельзя.
 *
 * Детали — выпуклые тела, у каждого видны только грани, смотрящие на зрителя. Порядок тел задан
 * слоями снизу вверх (камера всегда сверху), а внутри слоя — по глубине: так голова и аварийная
 * кнопка меняются местами, когда робот разворачивается. Надписи и окна на гранях рисуются в
 * аффинной проекции грани (перспектива слабая, на мелких деталях разницы не видно).
 *
 * Цвета компактного робота и тень — из палитры схемы склада (IsoStyles, --iso-*), поэтому тема
 * сайта подхватывается сама; у большого — цвета изделия. Вне экрана цикл стоит; при «уменьшить
 * движение» модели неподвижны; кнопка «Пауза» — для остальных (движение дольше 5 секунд, WCAG 2.2.2).
 */

type V3 = [number, number, number];
type RGB = [number, number, number];
type Palette = { body: RGB; dark: RGB; accent: RGB; glass: RGB; shadow: string };

/** Наклон камеры, рад: смотрим спереди и чуть сверху, как на снимке изделия. */
const ELEVATION = 0.38;
/** Скорость вращения, рад/с, и щёток. */
const SPIN = 0.4;
const BRUSH_SPIN = 9;
/** Фокус лёгкой перспективы, м. */
const FOCAL_M = 3;
const SEGMENTS = 128;
/** Свет: сверху-слева-спереди относительно зрителя. */
const LIGHT: V3 = norm([0.55, 0.55, 0.85]);
/** Радиус компактного робота, м: его модель построена в радиусах. */
const COMPACT_R = 0.17;
/** Где стоят роботы, доля ширины холста. Подписи под ними — в тех же долях. */
const BIG_AT = 0.4;
const COMPACT_AT = 0.69;

function norm([x, y, z]: V3): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

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

/** Камера и место одного робота на холсте. scale — пикселей на единицу модели, focal — в тех же единицах. */
type Frame = {
  ctx: CanvasRenderingContext2D;
  cos: number;
  sin: number;
  cx: number;
  cy: number;
  scale: number;
  focal: number;
};

/** Поворот модели вокруг вертикали. */
function yaw(f: Frame, [x, y, z]: V3): V3 {
  return [x * f.cos - y * f.sin, x * f.sin + y * f.cos, z];
}

/** Насколько точка ближе к зрителю: камера на +x, наклон ELEVATION. */
function depthOf(f: Frame, p: V3): number {
  const [x, , z] = yaw(f, p);
  return x * Math.cos(ELEVATION) + z * Math.sin(ELEVATION);
}

/** Точка модели на экране с лёгкой перспективой. */
function screen(f: Frame, p: V3): [number, number] {
  const [x, y, z] = yaw(f, p);
  const se = Math.sin(ELEVATION), ce = Math.cos(ELEVATION);
  const k = (f.scale * f.focal) / (f.focal - (x * ce + z * se));
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

/** Грань выпуклого тела: точки, внешняя нормаль, цвет. */
type Face = { pts: V3[]; n: V3; color: RGB };

function faces(f: Frame, list: readonly Face[]) {
  for (const face of list) {
    const { visible, k } = light(f, face.n);
    if (visible) polygon(f, face.pts, shade(face.color, k));
  }
}

type Outline = [number, number][];

function arc(cx: number, cy: number, r: number, a0: number, a1: number, seg = 6): Outline {
  const out: Outline = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Контур в плане со скруглёнными углами, против часовой: x — от кормы к носу, y — от правого борта к левому. */
function roundedRect(x0: number, x1: number, y0: number, y1: number, r: number): Outline {
  return [
    ...arc(x1 - r, y0 + r, r, -Math.PI / 2, 0),
    ...arc(x1 - r, y1 - r, r, 0, Math.PI / 2),
    ...arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI),
    ...arc(x0 + r, y0 + r, r, Math.PI, (3 * Math.PI) / 2),
  ];
}

/** Носовая и кормовая части такого контура, разрезанного поперёк на x = split; последнее ребро — разрез. */
function bowPart(split: number, x1: number, y0: number, y1: number, r: number): Outline {
  return [[split, y0], ...arc(x1 - r, y0 + r, r, -Math.PI / 2, 0), ...arc(x1 - r, y1 - r, r, 0, Math.PI / 2), [split, y1]];
}
function sternPart(x0: number, split: number, y0: number, y1: number, r: number): Outline {
  return [[split, y1], ...arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI), ...arc(x0 + r, y0 + r, r, Math.PI, (3 * Math.PI) / 2), [split, y0]];
}

/** Призма по контуру в плане. cut — последнее ребро внутри сборки (разрез), его грань не рисуется. */
function prism(outline: Outline, z0: number, z1: number, side: RGB, top: RGB | null, cut = false): Face[] {
  const out: Face[] = [];
  const n = outline.length;
  for (let i = 0; i < (cut ? n - 1 : n); i++) {
    const [x0, y0] = outline[i]!, [x1, y1] = outline[(i + 1) % n]!;
    out.push({ pts: [[x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]], n: norm([y1 - y0, -(x1 - x0), 0]), color: side });
  }
  if (top) out.push({ pts: outline.map(([x, y]) => [x, y, z1] as V3), n: [0, 0, 1], color: top });
  return out;
}

/** Тело, вытянутое вдоль y по профилю в плоскости x–z (против часовой). color(i) — цвет грани ребра i. */
function extrudeY(profile: Outline, y0: number, y1: number, color: (i: number) => RGB, sides: RGB): Face[] {
  const out: Face[] = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = profile[i]!, [x1, z1] = profile[(i + 1) % n]!;
    out.push({ pts: [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], n: norm([z1 - z0, 0, -(x1 - x0)]), color: color(i) });
  }
  out.push({ pts: profile.map(([x, z]) => [x, y1, z] as V3), n: [0, 1, 0], color: sides });
  out.push({ pts: profile.map(([x, z]) => [x, y0, z] as V3), n: [0, -1, 0], color: sides });
  return out;
}

/** Плоскость грани для рисунка на ней: начало, «вправо» и «вверх» для смотрящего на грань, нормаль. */
type Plane = { o: V3; u: V3; v: V3; n: V3 };

/**
 * Рисунок на грани, если она смотрит на зрителя. Единица — миллиметр, x — вправо по грани, y — вниз;
 * k — освещённость грани, чтобы рисунок темнел вместе с ней.
 */
function decal(f: Frame, pl: Plane, paint: (ctx: CanvasRenderingContext2D, k: number) => void) {
  const { visible, k } = light(f, pl.n);
  if (!visible) return;
  const step = 0.05;
  const s0 = screen(f, pl.o), su = screen(f, add(pl.o, mul(pl.u, step))), sv = screen(f, add(pl.o, mul(pl.v, step)));
  const mm = 0.001 / step;
  const { ctx } = f;
  ctx.save();
  ctx.transform((su[0] - s0[0]) * mm, (su[1] - s0[1]) * mm, -(sv[0] - s0[0]) * mm, -(sv[1] - s0[1]) * mm, s0[0], s0[1]);
  paint(ctx, k);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ── Большой робот (м). Нос — +x, левый борт — +y. ──────────────────────────────────────────────

const LAVENDER: RGB = [162, 150, 222];
const VIOLET: RGB = [75, 58, 158];
const SLOT: RGB = [47, 39, 82];
const LID: RGB = [57, 57, 65];
const HEAD: RGB = [42, 42, 48];
const BEZEL: RGB = [214, 214, 219];
const SCREEN: RGB = [20, 20, 24];
const BASE: RGB = [237, 237, 240];
const TRIM: RGB = [70, 70, 77];
const BRISTLE: RGB = [35, 35, 40];
const SQUEEGEE: RGB = [96, 96, 104];
const ESTOP: RGB = [216, 52, 58];

const BODY_X0 = -0.3, BODY_X1 = 0.27, BODY_Y = 0.27, BODY_R = 0.08, BODY_SPLIT = 0.03;
const BODY_Z0 = 0.22, BODY_Z1 = 0.74, LID_Z1 = 0.765;

const BIG = {
  squeegee: prism(roundedRect(-0.39, -0.362, -0.3, 0.3, 0.012), 0.012, 0.042, SQUEEGEE, SQUEEGEE),
  trim: prism(roundedRect(-0.345, 0.345, -0.305, 0.305, 0.135), 0.02, 0.075, TRIM, null),
  base: prism(roundedRect(-0.35, 0.35, -0.31, 0.31, 0.14), 0.075, BODY_Z0, BASE, BASE),
  bow: prism(bowPart(BODY_SPLIT, BODY_X1, -BODY_Y, BODY_Y, BODY_R), BODY_Z0, BODY_Z1, LAVENDER, LAVENDER, true),
  stern: prism(sternPart(BODY_X0, BODY_SPLIT, -BODY_Y, BODY_Y, BODY_R), BODY_Z0, BODY_Z1, VIOLET, VIOLET, true),
  lid: prism(roundedRect(BODY_X0 - 0.004, BODY_X1 + 0.004, -BODY_Y - 0.004, BODY_Y + 0.004, BODY_R + 0.004), BODY_Z1, LID_Z1, LID, LID),
  // Голова-экран: профиль сбоку — низ на крышке, лицо наклонено вперёд и чуть нависает над носом.
  head: extrudeY([[0.06, LID_Z1], [0.3, LID_Z1], [0.24, 0.92], [0.06, 0.92]], -0.19, 0.19, (i) => (i === 1 ? BEZEL : HEAD), HEAD),
};

const FACE_N = norm([0.155, 0, 0.06]);
const PLANES = {
  screen: { o: add([0.27, 0, 0.8425], mul(FACE_N, 0.0015)), u: [0, 1, 0], v: norm([-0.06, 0, 0.155]), n: FACE_N },
  bow: { o: [BODY_X1 + 0.0015, 0, 0.48], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  base: { o: [0.3515, 0, 0.148], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  left: { o: [-0.095, BODY_Y + 0.0015, 0.52], u: [-1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  right: { o: [-0.095, -BODY_Y - 0.0015, 0.52], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
} satisfies Record<string, Plane>;

/** Логотип на борту: значок-«лицо» и надпись. */
function paintLogo(ctx: CanvasRenderingContext2D, k: number, font: string) {
  const ink = shade([250, 250, 252], Math.min(1, k + 0.15));
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 6;
  roundRect(ctx, -80, -18, 40, 34, 9);
  ctx.stroke();
  ctx.fillRect(-70, -6, 6, 9);
  ctx.fillRect(-56, -6, 6, 9);
  ctx.font = `600 50px ${font}`;
  ctx.textBaseline = "middle";
  ctx.fillText("alfa", -30, 0);
}

function bristles(f: Frame, bx: number, by: number, angle: number, r: number, width: number) {
  const color = "rgba(30,30,35,0.8)";
  for (let i = 0; i < 22; i++) {
    const a = angle + (i * Math.PI * 2) / 22;
    stroke(f, [[bx + 0.02 * Math.cos(a), by + 0.02 * Math.sin(a), 0.014], [bx + r * Math.cos(a), by + r * Math.sin(a), 0.004]], color, width);
  }
  cylinder(f, { cx: bx, cy: by, r: 0.03, z0: 0.01, z1: 0.035, color: BRISTLE, cap: BRISTLE });
}

function drawBigRobot(f: Frame, pal: Palette, brushAngle: number, font: string) {
  const { ctx } = f;
  ctx.save();
  ctx.filter = `blur(${Math.max(3, f.scale * 0.035)}px)`;
  polygon(f, roundedRect(-0.43, 0.43, -0.38, 0.38, 0.2).map(([x, y]) => [x, y, 0] as V3), pal.shadow);
  ctx.restore();

  const bristle = Math.max(0.8, f.scale * 0.0035);
  const parts: { layer: number; at: V3; draw: () => void }[] = [
    { layer: 0, at: [0.29, 0.24, 0], draw: () => bristles(f, 0.29, 0.24, brushAngle, 0.17, bristle) },
    { layer: 0, at: [0.29, -0.24, 0], draw: () => bristles(f, 0.29, -0.24, -brushAngle, 0.17, bristle) },
    { layer: 0, at: [-0.38, 0, 0], draw: () => faces(f, BIG.squeegee) },
    { layer: 1, at: [0, 0, 0.05], draw: () => faces(f, BIG.trim) },
    {
      layer: 2,
      at: [0, 0, 0.15],
      draw: () => {
        faces(f, BIG.base);
        decal(f, PLANES.base, (c, k) => {
          c.fillStyle = shade(TRIM, k);
          roundRect(c, -80, -12, 160, 24, 12);
          c.fill();
        });
      },
    },
    {
      layer: 3,
      at: [0, 0, 0.48],
      draw: () => {
        faces(f, BIG.bow);
        faces(f, BIG.stern);
        decal(f, PLANES.bow, (c, k) => {
          c.fillStyle = shade(SLOT, k);
          roundRect(c, -95, -75, 30, 150, 15);
          c.fill();
          for (const x of [-150, -128, 128, 150]) {
            c.beginPath();
            c.arc(x, 150, 7, 0, Math.PI * 2);
            c.fill();
          }
        });
        decal(f, PLANES.left, (c, k) => paintLogo(c, k, font));
        decal(f, PLANES.right, (c, k) => paintLogo(c, k, font));
      },
    },
    { layer: 4, at: [0, 0, 0.75], draw: () => faces(f, BIG.lid) },
    {
      layer: 5,
      at: [0.18, 0, 0.84],
      draw: () => {
        faces(f, BIG.head);
        decal(f, PLANES.screen, (c) => {
          c.fillStyle = shade(SCREEN, 1);
          roundRect(c, -150, -64, 300, 128, 24);
          c.fill();
          // «Глаза» светятся сами — освещение грани их не гасит.
          c.strokeStyle = "rgb(244,244,247)";
          c.lineWidth = 9;
          for (const x of [-74, 30]) {
            roundRect(c, x, -30, 44, 60, 16);
            c.stroke();
          }
        });
      },
    },
    {
      layer: 5,
      at: [-0.17, 0, 0.78],
      draw: () => {
        cylinder(f, { cx: -0.17, r: 0.034, z0: LID_Z1, z1: LID_Z1 + 0.008, color: HEAD, cap: HEAD });
        cylinder(f, { cx: -0.17, r: 0.024, z0: LID_Z1 + 0.008, z1: LID_Z1 + 0.034, color: ESTOP, cap: lighten(ESTOP, 1.1) });
      },
    },
  ];
  parts
    .sort((a, b) => a.layer - b.layer || depthOf(f, a.at) - depthOf(f, b.at))
    .forEach((p) => p.draw());
}

// ── Компактный робот (в радиусах корпуса). ─────────────────────────────────────────────────────

/** Робот-пылесос: круглый корпус, бампер, лидар сверху, щётки. Слои — снизу вверх. */
function drawCompactRobot(f: Frame, pal: Palette, brushAngle: number) {
  const { ctx } = f;
  const unit = f.scale / 100;

  ctx.save();
  ctx.filter = `blur(${Math.max(2, 10 * unit)}px)`;
  polygon(f, ring(0, 0, 1.12, 0, 0, Math.PI * 2, 48), pal.shadow);
  ctx.restore();

  for (const side of [1, -1]) {
    const bx = 0.62, by = 0.6 * side;
    for (let i = 0; i < 3; i++) {
      const a = brushAngle * side + (i * Math.PI * 2) / 3;
      stroke(f, [[bx, by, 0.04], [bx + 0.42 * Math.cos(a), by + 0.42 * Math.sin(a), 0.02]], shade(pal.dark, 1.1), Math.max(1, 2.2 * unit));
    }
    cylinder(f, { cx: bx, cy: by, r: 0.07, z0: 0.02, z1: 0.07, color: pal.dark, cap: pal.dark });
  }

  cylinder(f, { r: 0.95, z0: 0.02, z1: 0.11, color: pal.dark });
  cylinder(f, { r: 1, z0: 0.11, z1: 0.42, color: pal.body, cap: pal.body });
  cylinder(f, { r: 1.022, z0: 0.14, z1: 0.27, color: pal.dark, from: -1.25, to: 1.25 });

  stroke(f, ring(0, 0, 0.8, 0.421), shade(pal.dark, 1.6), Math.max(1, 1.4 * unit));
  stroke(f, ring(0, 0, 0.88, 0.421, -0.55, 0.55, 24), shade(pal.accent, 1), Math.max(1.5, 4 * unit));
  cylinder(f, { cx: 0.42, r: 0.09, z0: 0.42, z1: 0.44, color: pal.dark, cap: pal.accent });

  cylinder(f, { cx: -0.32, r: 0.26, z0: 0.42, z1: 0.5, color: pal.dark });
  cylinder(f, { cx: -0.32, r: 0.262, z0: 0.5, z1: 0.54, color: pal.glass });
  cylinder(f, { cx: -0.32, r: 0.26, z0: 0.54, z1: 0.6, color: pal.dark, cap: lighten(pal.dark, 1.3) });
}

export function CleaningRobot3D({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = useRef({ angle: -0.6, brush: 0, drag: null as null | { x: number; angle: number } });

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    let palette = readPalette(wrap);
    const font = getComputedStyle(wrap).fontFamily || "sans-serif";
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
      // Большой робот на экране ≈ 0,92 м по высоте с поправкой на наклон и ≈ 1 м в ширину с щётками.
      const se = Math.sin(ELEVATION), ce = Math.cos(ELEVATION);
      const tall = 0.92 * ce + 0.9 * se;
      // Снизу оставляем строку под подписи.
      const perM = Math.min((height * 0.76) / tall, (width * 0.42) / 1.0);
      const floorY = height / 2 + (perM * (0.92 * ce - 0.1 * se)) / 2 - 10;
      const common = { ctx: ctx!, cos: Math.cos(st.angle), sin: Math.sin(st.angle), cy: floorY };
      drawBigRobot({ ...common, cx: width * BIG_AT, scale: perM, focal: FOCAL_M }, palette, st.brush, font);
      drawCompactRobot(
        { ...common, cx: width * COMPACT_AT, scale: perM * COMPACT_R, focal: FOCAL_M / COMPACT_R },
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
        aria-label="3D-модели роботов-уборщиков в одном масштабе: большой — для складов и торговых центров, компактный — для офисов"
      />
      <p className="pointer-events-none absolute top-3 left-3 text-xs text-muted-foreground" aria-hidden="true">
        Потяните, чтобы повернуть
      </p>
      {/* Подписи стоят под роботами: доли ширины те же, что у BIG_AT и COMPACT_AT. */}
      <p
        className="pointer-events-none absolute bottom-2 -translate-x-1/2 text-center text-xs font-medium whitespace-nowrap"
        style={{ left: `${BIG_AT * 100}%` }}
        aria-hidden="true"
      >
        <span className="hidden sm:inline">Большой · </span>для складов и ТЦ
      </p>
      <p
        className="pointer-events-none absolute bottom-2 -translate-x-1/2 text-center text-xs font-medium whitespace-nowrap"
        style={{ left: `${COMPACT_AT * 100}%` }}
        aria-hidden="true"
      >
        <span className="hidden sm:inline">Компактный · </span>для офисов
      </p>
      {!reduced && (
        <Button type="button" variant="outline" size="sm" className="absolute top-2 right-2" onClick={() => setPaused((v) => !v)}>
          {paused ? "Продолжить" : "Пауза"}
        </Button>
      )}
    </div>
  );
}
