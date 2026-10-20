"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IsoStyles } from "@/components/sim/sim-iso-scene";
import { useReducedMotion } from "@/components/sim/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Нижняя полоса первой страницы: робот Alfa Robot (по образцу коммерческого робота alfa —
 * сиреневый корпус, голова-экран с «глазами», белое основание, боковые щётки, скребок) ездит
 * туда-обратно по офисному полу и убирает мусор — бумагу, банановую кожуру, листы, стаканчики,
 * фантики. Мусор, задетый щётками, втягивается под робота, за ним остаётся влажный след. Новый
 * мусор падает позади робота, на уже убранном участке и не ближе SPAWN_GAP, — на обратном пути
 * ему снова есть что убирать. У края робот разворачивается лицом к зрителю и моргает. Нажатие на
 * пол подкидывает мусор туда, куда нажали. Сам робот — ссылка на каталог: поверх холста ездит
 * настоящий <a> (доступен с клавиатуры и открывается в новой вкладке), под указателем робот
 * останавливается и показывает подпись.
 *
 * Рисуется на canvas плоскими гранями с освещением по Ламберту. Без three.js сознательно:
 * зависимость меняет package-lock.json, а он входит в отпечаток расчётного движка
 * (.gitattributes, «Exact build-worker source graph»), — ради картинки на главной менять версию
 * движка нельзя.
 *
 * Детали робота — выпуклые тела, у каждого видны только грани, смотрящие на зрителя. Порядок тел
 * задан слоями снизу вверх (камера всегда сверху), а внутри слоя — по глубине: так голова и
 * аварийная кнопка меняются местами, когда робот разворачивается. Надписи и окна на гранях
 * рисуются в аффинной проекции грани (перспектива слабая, на мелких деталях разницы не видно).
 *
 * Пол, след и тень — из палитры схемы склада (IsoStyles, --iso-*), поэтому тема сайта
 * подхватывается сама; у робота и мусора — свои цвета. Вне экрана цикл стоит; при «уменьшить
 * движение» показан неподвижный кадр; кнопка «Пауза» — для остальных (движение дольше 5 секунд,
 * WCAG 2.2.2).
 */

type V3 = [number, number, number];
type RGB = [number, number, number];
type RGBA = [number, number, number, number];
type Palette = { accent: RGB; floor: RGB; grid: RGBA; shadow: string };

/** Наклон камеры, рад: спереди и сверху, чтобы мусор на полу был виден. */
const ELEVATION = 0.5;
/**
 * Фокус перспективы, м. Камера далеко: полоса широкая, и при близкой камере робот у края экрана
 * заваливался бы наружу, как в широкоугольнике.
 */
const FOCAL_M = 14;
const SEGMENTS = 64;
/** Свет: сверху-слева-спереди относительно зрителя. */
const LIGHT: V3 = norm([0.55, 0.55, 0.85]);

/** Езда: скорость, м/с; разворот у края, с; щётки, рад/с. */
const SPEED = 0.7;
const TURN_S = 1.8;
const BRUSH_SPIN = 9;
/** Робот едет по x = 0; мусор лежит в пределах ±LANE, м. */
const LANE = 0.28;
/** Сколько щётки захватывают вперёд и назад от центра робота, м. */
const REACH_AHEAD = 0.44;
const REACH_BEHIND = 0.3;
/** Новый мусор — не ближе этого позади робота, м: иначе кажется, что робот его роняет. */
const SPAWN_GAP = 1.4;
/** Длительности, с: появление мусора, втягивание, искорка, высыхание следа. */
const APPEAR_S = 0.7;
const SUCK_S = 0.35;
const SPARKLE_S = 0.5;
const TRAIL_S = 3;

function norm([x, y, z]: V3): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

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

function parseRgba(raw: string, fallback: RGBA): RGBA {
  const m = /rgba?\(([^)]+)\)/i.exec(raw.trim());
  if (!m) return raw.trim() ? [...parseColor(raw, [fallback[0], fallback[1], fallback[2]]), 1] : fallback;
  const [r, g, b, a = 1] = m[1]!.split(",").map((c) => parseFloat(c));
  return [r, g, b, a].every((c) => Number.isFinite(c)) ? [r!, g!, b!, a] : fallback;
}

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  return {
    accent: parseColor(cs.getPropertyValue("--iso-accent"), [20, 179, 190]),
    floor: parseColor(cs.getPropertyValue("--iso-floor-storage"), [241, 244, 244]),
    grid: parseRgba(cs.getPropertyValue("--iso-grid"), [35, 75, 78, 0.08]),
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

function rgba([r, g, b]: RGB, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Камера и место тела на холсте. Тело поворачивается на (cos, sin) вокруг вертикали и сдвигается
 * на (ox, oy) по полу; cx, cy — где на экране начало координат мира; scale — пикселей на метр.
 */
type Frame = {
  ctx: CanvasRenderingContext2D;
  cos: number;
  sin: number;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
  scale: number;
  focal: number;
};

/** Точка тела в координатах мира. */
function place(f: Frame, [x, y, z]: V3): V3 {
  return [x * f.cos - y * f.sin + f.ox, x * f.sin + y * f.cos + f.oy, z];
}

/** Насколько точка ближе к зрителю: камера на +x, наклон ELEVATION. */
function depthOf(f: Frame, p: V3): number {
  const [x, , z] = place(f, p);
  return x * Math.cos(ELEVATION) + z * Math.sin(ELEVATION);
}

/** Точка на экране с лёгкой перспективой. */
function screen(f: Frame, p: V3): [number, number] {
  const [x, y, z] = place(f, p);
  const se = Math.sin(ELEVATION), ce = Math.cos(ELEVATION);
  const k = (f.scale * f.focal) / (f.focal - (x * ce + z * se));
  return [f.cx + y * k, f.cy + (x * se - z * ce) * k];
}

/** Видна ли грань с нормалью n (в координатах тела) и насколько она освещена. */
function light(f: Frame, [nx, ny, nz]: V3): { visible: boolean; k: number } {
  const x = nx * f.cos - ny * f.sin, y = nx * f.sin + ny * f.cos;
  const facing = x * Math.cos(ELEVATION) + nz * Math.sin(ELEVATION);
  const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + nz * LIGHT[2]);
  return { visible: facing > 0, k: 0.62 + 0.38 * diffuse + 0.12 * Math.pow(diffuse, 24) };
}

/** Многоугольник. seams — обвести тем же цветом: закрывает щели сглаживания между гранями. */
function polygon(f: Frame, points: V3[], fill: string | CanvasGradient, seams = true) {
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
  if (!seams) return;
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

function ring(cx: number, cy: number, r: number, z: number, n = SEGMENTS): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * 2 * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  }
  return out;
}

/** Боковина цилиндра гранями и, по желанию, крышка. */
function cylinder(f: Frame, o: { cx?: number; cy?: number; r: number; z0: number; z1: number; color: RGB; cap?: RGB | null }) {
  const cx = o.cx ?? 0, cy = o.cy ?? 0;
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (Math.PI * 2 * i) / SEGMENTS, a1 = (Math.PI * 2 * (i + 1)) / SEGMENTS, am = (a0 + a1) / 2;
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

// ── Робот (м). Нос — +x, левый борт — +y. ──────────────────────────────────────────────────────

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

const BODY_X0 = -0.3, BODY_X1 = 0.27, BODY_Y = 0.27, BODY_R = 0.08, BODY_SPLIT = 0.06;
const BODY_Z0 = 0.22, BODY_Z1 = 0.74, LID_Z1 = 0.765;

const ROBOT = {
  squeegee: prism(roundedRect(-0.39, -0.362, -0.3, 0.3, 0.012), 0.012, 0.042, SQUEEGEE, SQUEEGEE),
  trim: prism(roundedRect(-0.345, 0.345, -0.305, 0.305, 0.135), 0.02, 0.075, TRIM, null),
  base: prism(roundedRect(-0.35, 0.35, -0.31, 0.31, 0.14), 0.075, BODY_Z0, BASE, BASE),
  bow: prism(bowPart(BODY_SPLIT, BODY_X1, -BODY_Y, BODY_Y, BODY_R), BODY_Z0, BODY_Z1, LAVENDER, LAVENDER, true),
  stern: prism(sternPart(BODY_X0, BODY_SPLIT, -BODY_Y, BODY_Y, BODY_R), BODY_Z0, BODY_Z1, VIOLET, VIOLET, true),
  lid: prism(roundedRect(BODY_X0 - 0.004, BODY_X1 + 0.004, -BODY_Y - 0.004, BODY_Y + 0.004, BODY_R + 0.004), BODY_Z1, LID_Z1, LID, LID),
  // Голова-экран: профиль сбоку — низ на крышке, лицо наклонено вперёд и чуть нависает над носом.
  head: extrudeY([[0.06, LID_Z1], [0.3, LID_Z1], [0.24, 0.92], [0.06, 0.92]], -0.19, 0.19, (i) => (i === 1 ? BEZEL : HEAD), HEAD),
};

/** Середина ровного участка борта у кормы — там логотип. */
const LOGO_X = (BODY_X0 + BODY_R + BODY_SPLIT) / 2;
const FACE_N = norm([0.155, 0, 0.06]);
const PLANES = {
  screen: { o: add([0.27, 0, 0.8425], mul(FACE_N, 0.0015)), u: [0, 1, 0], v: norm([-0.06, 0, 0.155]), n: FACE_N },
  bow: { o: [BODY_X1 + 0.0015, 0, 0.48], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  base: { o: [0.3515, 0, 0.148], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  left: { o: [LOGO_X, BODY_Y + 0.0015, 0.52], u: [-1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  right: { o: [LOGO_X, -BODY_Y - 0.0015, 0.52], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
} satisfies Record<string, Plane>;

/** Логотип на борту: значок-«лицо» и надпись, по центру ровного участка. */
function paintLogo(ctx: CanvasRenderingContext2D, k: number, font: string) {
  const ink = shade([250, 250, 252], Math.min(1, k + 0.15));
  ctx.font = `600 36px ${font}`;
  ctx.textBaseline = "middle";
  const text = "Alfa Robot";
  const x0 = -(36 + 10 + ctx.measureText(text).width) / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 5;
  roundRect(ctx, x0, -15, 36, 30, 8);
  ctx.stroke();
  ctx.fillRect(x0 + 9, -5, 5, 8);
  ctx.fillRect(x0 + 22, -5, 5, 8);
  ctx.fillText(text, x0 + 46, 1);
}

function bristles(f: Frame, bx: number, by: number, angle: number, r: number, width: number) {
  for (let i = 0; i < 22; i++) {
    const a = angle + (i * Math.PI * 2) / 22;
    stroke(f, [[bx + 0.02 * Math.cos(a), by + 0.02 * Math.sin(a), 0.014], [bx + r * Math.cos(a), by + r * Math.sin(a), 0.004]], "rgba(30,30,35,0.8)", width);
  }
  cylinder(f, { cx: bx, cy: by, r: 0.03, z0: 0.01, z1: 0.035, color: BRISTLE, cap: BRISTLE });
}

/** Робот целиком. blink — высота «глаз»: 1 — открыты, меньше — моргает. */
function drawRobot(f: Frame, pal: Palette, brushAngle: number, font: string, blink: number) {
  const { ctx } = f;
  ctx.save();
  ctx.filter = `blur(${Math.max(3, f.scale * 0.035)}px)`;
  polygon(f, roundedRect(-0.43, 0.43, -0.38, 0.38, 0.2).map(([x, y]) => [x, y, 0] as V3), pal.shadow);
  ctx.restore();

  const bristle = Math.max(0.8, f.scale * 0.0035);
  const parts: { layer: number; at: V3; draw: () => void }[] = [
    { layer: 0, at: [0.29, 0.24, 0], draw: () => bristles(f, 0.29, 0.24, brushAngle, 0.17, bristle) },
    { layer: 0, at: [0.29, -0.24, 0], draw: () => bristles(f, 0.29, -0.24, -brushAngle, 0.17, bristle) },
    { layer: 0, at: [-0.38, 0, 0], draw: () => faces(f, ROBOT.squeegee) },
    { layer: 1, at: [0, 0, 0.05], draw: () => faces(f, ROBOT.trim) },
    {
      layer: 2,
      at: [0, 0, 0.15],
      draw: () => {
        faces(f, ROBOT.base);
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
        faces(f, ROBOT.bow);
        faces(f, ROBOT.stern);
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
    { layer: 4, at: [0, 0, 0.75], draw: () => faces(f, ROBOT.lid) },
    {
      layer: 5,
      at: [0.18, 0, 0.84],
      draw: () => {
        faces(f, ROBOT.head);
        decal(f, PLANES.screen, (c) => {
          c.fillStyle = shade(SCREEN, 1);
          roundRect(c, -150, -64, 300, 128, 24);
          c.fill();
          // «Глаза» светятся сами — освещение грани их не гасит.
          c.strokeStyle = "rgb(244,244,247)";
          c.lineWidth = 9;
          const h = Math.max(4, 60 * blink);
          for (const x of [-74, 30]) {
            roundRect(c, x, -h / 2, 44, h, Math.min(16, h / 2));
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

// ── Мусор (м, на полу мира). ───────────────────────────────────────────────────────────────────

type Kind = "ball" | "banana" | "sheet" | "cup" | "wrapper";
const KINDS: [Kind, number][] = [["ball", 0.3], ["banana", 0.2], ["sheet", 0.2], ["cup", 0.15], ["wrapper", 0.15]];
const WRAPPERS: RGB[] = [[226, 72, 61], [47, 128, 237], [242, 153, 74]];
/** Мусор крупнее настоящего: в масштабе робота лист бумаги на экране почти не виден. */
const KIND_SCALE: Record<Kind, number> = { ball: 1.8, banana: 1.6, sheet: 1.3, cup: 1.5, wrapper: 2 };
/** Радиус тени, м до масштаба: у плоских предметов она едва заметна. */
const KIND_SHADOW: Record<Kind, number> = { ball: 0.05, banana: 0.045, sheet: 0.03, cup: 0.045, wrapper: 0.03 };

/** Предмет мусора. born — когда начал падать; gone — когда его задели щётки (тогда он летит к suckTo). */
type Litter = { kind: Kind; x: number; y: number; rot: number; size: number; seed: number; born: number; gone: number | null; suckTo: [number, number] };

function randomKind(): Kind {
  let r = Math.random();
  for (const [kind, w] of KINDS) {
    if ((r -= w) <= 0) return kind;
  }
  return "ball";
}

/** Псевдослучайное 0…1 от зерна предмета: форма комка и цвет фантика не меняются от кадра к кадру. */
function hash(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** Отскок при падении: 1 → 0 с одним подскоком. */
function dropHeight(a: number): number {
  return (1 - a) ** 2 * Math.abs(Math.cos(a * Math.PI * 1.5));
}

function drawLitter(f: Frame, it: Litter, t: number, pal: Palette) {
  const { ctx } = f;
  let x = it.x, y = it.y, s = it.size * KIND_SCALE[it.kind], alpha = 1, lift = 0;
  const age = t - it.born;
  if (age < APPEAR_S) {
    const a = clamp(age / APPEAR_S);
    alpha = Math.min(1, a * 2.5);
    lift = 0.3 * dropHeight(a);
    s *= 0.8 + 0.2 * a;
  }
  if (it.gone !== null) {
    const b = clamp((t - it.gone) / SUCK_S);
    x += (it.suckTo[0] - x) * b * b;
    y += (it.suckTo[1] - y) * b * b;
    s *= 1 - 0.85 * b;
    alpha *= 1 - b;
  }
  if (alpha <= 0.01 || s <= 0.01) return;
  const cos = Math.cos(it.rot), sin = Math.sin(it.rot);
  /** Точка предмета: u, v — в его плоскости, м до масштаба; z — высота над полом. */
  const at = (u: number, v: number, z: number): V3 => [x + (u * cos - v * sin) * s, y + (u * sin + v * cos) * s, z + lift];

  ctx.save();
  ctx.globalAlpha = alpha;
  // Тень остаётся на полу, пока предмет падает.
  ctx.globalAlpha = alpha * (0.4 - Math.min(0.3, lift));
  polygon(f, ring(x, y, KIND_SHADOW[it.kind] * s, 0.0005, 20), pal.shadow, false);
  ctx.globalAlpha = alpha;

  if (it.kind === "ball") {
    const r = 0.045;
    const c = screen(f, at(0, 0, r * s));
    // Радиус — по горизонтали экрана, то есть вдоль y мира, а не вдоль повёрнутой оси предмета.
    const R = Math.abs(screen(f, [x, y + r * s, r * s + lift])[0] - c[0]) || 1;
    ctx.beginPath();
    for (let i = 0; i < 11; i++) {
      const a = it.rot + (i * Math.PI * 2) / 11;
      const rr = R * (0.8 + 0.2 * hash(it.seed, i));
      const px = c[0] + Math.cos(a) * rr, py = c[1] + Math.sin(a) * rr * 0.92;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(c[0] - R * 0.35, c[1] - R * 0.4, R * 0.1, c[0], c[1], R * 1.1);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#c6ccd2");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(120,128,136,0.55)";
    ctx.lineWidth = Math.max(0.7, R * 0.08);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = it.rot + i * 2.1 + hash(it.seed, i + 20);
      ctx.moveTo(c[0] + Math.cos(a) * R * 0.15, c[1] + Math.sin(a) * R * 0.15);
      ctx.lineTo(c[0] + Math.cos(a + 0.5) * R * 0.7, c[1] + Math.sin(a + 0.5) * R * 0.7);
    }
    ctx.stroke();
  } else if (it.kind === "banana") {
    const petals = [0, 1.75, 3.3, 4.7].map((a, i) => a + (hash(it.seed, i) - 0.5) * 0.5);
    const tips = petals.map((a) => at(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.006));
    petals
      .map((a, i) => ({ a, tip: tips[i]! }))
      .sort((p, q) => p.tip[0] - q.tip[0])
      .forEach(({ a, tip }) => {
        const pts: V3[] = [];
        for (let j = 0; j <= 8; j++) {
          const tt = j / 8, w = 0.032 * Math.sin(Math.PI * tt) ** 0.7 * (1 - 0.3 * tt);
          pts.push(at(Math.cos(a) * 0.1 * tt - Math.sin(a) * w, Math.sin(a) * 0.1 * tt + Math.cos(a) * w, 0.006));
        }
        for (let j = 8; j >= 0; j--) {
          const tt = j / 8, w = 0.032 * Math.sin(Math.PI * tt) ** 0.7 * (1 - 0.3 * tt);
          pts.push(at(Math.cos(a) * 0.1 * tt + Math.sin(a) * w, Math.sin(a) * 0.1 * tt - Math.cos(a) * w, 0.006));
        }
        polygon(f, pts, "rgb(242,201,76)");
        ctx.strokeStyle = "rgb(184,138,27)";
        ctx.lineWidth = Math.max(0.6, f.scale * 0.002);
        ctx.stroke();
        // Светлая изнанка кожуры вдоль лепестка.
        const inner: V3[] = [];
        for (let j = 1; j <= 7; j++) {
          const tt = j / 8, w = 0.013 * Math.sin(Math.PI * tt) ** 0.7;
          inner.push(at(Math.cos(a) * 0.1 * tt - Math.sin(a) * w, Math.sin(a) * 0.1 * tt + Math.cos(a) * w, 0.007));
        }
        for (let j = 7; j >= 1; j--) {
          const tt = j / 8, w = 0.013 * Math.sin(Math.PI * tt) ** 0.7;
          inner.push(at(Math.cos(a) * 0.1 * tt + Math.sin(a) * w, Math.sin(a) * 0.1 * tt - Math.cos(a) * w, 0.007));
        }
        polygon(f, inner, "rgb(248,236,190)", false);
        polygon(f, ring(tip[0], tip[1], 0.008 * s, tip[2], 10), "rgb(107,74,26)");
      });
    polygon(f, ring(x, y, 0.017 * s, 0.014 + lift, 16), "rgb(222,180,60)");
    polygon(f, ring(x, y, 0.007 * s, 0.018 + lift, 10), "rgb(107,74,26)");
  } else if (it.kind === "sheet") {
    polygon(f, [at(-0.105, -0.075, 0.003), at(0, -0.075, 0.003), at(0, 0.075, 0.003), at(-0.105, 0.075, 0.003)], "rgb(250,250,250)");
    polygon(f, [at(0, -0.075, 0.003), at(0.105, -0.075, 0.03), at(0.105, 0.075, 0.012), at(0, 0.075, 0.003)], "rgb(224,228,232)");
    for (let i = 0; i < 4; i++) {
      const v = -0.045 + i * 0.025;
      stroke(f, [at(-0.09, v, 0.004), at(-0.02 - hash(it.seed, i) * 0.03, v, 0.004)], "rgba(140,150,160,0.6)", Math.max(0.6, f.scale * 0.002));
    }
  } else if (it.kind === "cup") {
    const r = 0.034 * s, h = 0.095 * s;
    cylinder(f, { cx: x, cy: y, r, z0: lift, z1: lift + h, color: [246, 246, 246] });
    cylinder(f, { cx: x, cy: y, r: r * 1.02, z0: lift + h * 0.32, z1: lift + h * 0.65, color: [150, 105, 70] });
    cylinder(f, { cx: x, cy: y, r: r * 1.08, z0: lift + h, z1: lift + h + 0.008, color: [60, 60, 64], cap: [72, 72, 76] });
  } else {
    const color = WRAPPERS[Math.floor(hash(it.seed, 7) * WRAPPERS.length)]!;
    const end = (sx: number): V3[] => [at(0.025 * sx, -0.012, 0.005), at(0.05 * sx, -0.02, 0.005), at(0.042 * sx, 0, 0.005), at(0.05 * sx, 0.02, 0.005), at(0.025 * sx, 0.012, 0.005)];
    polygon(f, end(-1), shade(color, 0.8));
    polygon(f, end(1), shade(color, 0.8));
    polygon(f, [at(-0.026, -0.013, 0.007), at(0.026, -0.013, 0.007), at(0.026, 0.013, 0.007), at(-0.026, 0.013, 0.007)], shade(color, 1));
    polygon(f, [at(-0.026, -0.003, 0.008), at(0.026, -0.003, 0.008), at(0.026, 0.003, 0.008), at(-0.026, 0.003, 0.008)], shade(lighten(color, 1.4), 1));
  }
  ctx.restore();
}

// ── Сцена. ─────────────────────────────────────────────────────────────────────────────────────

/** Состояние сцены: время, где робот и куда едет, начало разворота, мусор, искорки, след; hold — робот под указателем и стоит. */
type Scene = {
  t: number;
  hold: boolean;
  y: number;
  dir: 1 | -1;
  turn: number | null;
  brush: number;
  half: number;
  cleaned: number;
  pending: number;
  litter: Litter[];
  sparkles: { x: number; y: number; t: number }[];
  trail: { y: number; t: number }[];
};

/** Сколько мусора держать на полу: по ширине видимого пола. */
const litterTarget = (half: number) => Math.max(4, Math.min(10, Math.round(half * 2.4)));
/** Где робот разворачивается: так, чтобы у края он был виден целиком вместе со щётками. */
const turnAt = (half: number) => Math.max(0.2, half - 0.95);

/** Свободное место на отрезке [a, b], подальше от уже лежащего мусора; null — отрезок слишком мал. */
function freeSpot(sc: Scene, a: number, b: number): number | null {
  if (b - a < 0.2) return null;
  let best = a, bestGap = -1;
  for (let i = 0; i < 10; i++) {
    const y = a + Math.random() * (b - a);
    const gap = Math.min(Infinity, ...sc.litter.map((it) => Math.abs(it.y - y)));
    if (gap > bestGap) {
      best = y;
      bestGap = gap;
    }
  }
  return best;
}

function drop(sc: Scene, y: number, born: number, x = (Math.random() * 2 - 1) * LANE) {
  sc.litter.push({
    kind: randomKind(),
    x,
    y,
    rot: Math.random() * Math.PI * 2,
    size: 0.9 + Math.random() * 0.25,
    seed: Math.random() * 1000,
    born,
    gone: null,
    suckTo: [0, y],
  });
}

/** still — неподвижный кадр: робот вполоборота, впереди мусор, позади след. */
function newScene(half: number, still: boolean): Scene {
  const end = turnAt(half);
  const sc: Scene = { t: 0, hold: false, y: still ? -0.35 * end : -end + 0.4, dir: 1, turn: null, brush: 0, half, cleaned: 0, pending: 0, litter: [], sparkles: [], trail: [] };
  const n = litterTarget(half);
  for (let i = 0; i < n; i++) {
    const y = still ? freeSpot(sc, sc.y + 0.7, half - 0.4) : (freeSpot(sc, sc.y + 0.9, half - 0.4) ?? freeSpot(sc, -half + 0.4, sc.y - 0.9));
    if (y !== null) drop(sc, y, -10);
  }
  if (still) for (let y = sc.y - 1.6; y <= sc.y; y += 0.05) sc.trail.push({ y, t: -TRAIL_S * ((sc.y - y) / 1.6) * 0.9 });
  return sc;
}

/**
 * Ширина пола поменялась: робот и мусор остаются в видимых пределах, а если пол стал шире
 * (или сцену создали, пока холст ещё не разложен), мусор добирается сразу, без падения.
 */
function fitScene(sc: Scene, half: number) {
  sc.half = half;
  const end = turnAt(half);
  sc.y = clamp(sc.y, -end, end);
  const before = sc.litter.length;
  sc.litter = sc.litter.filter((it) => Math.abs(it.y) <= half - 0.3);
  sc.pending += before - sc.litter.length;
  const missing = litterTarget(half) - sc.litter.length - sc.pending;
  for (let i = 0; i < missing; i++) {
    const y = freeSpot(sc, sc.y + 0.9, half - 0.4) ?? freeSpot(sc, -half + 0.4, sc.y - 0.9);
    if (y !== null) drop(sc, y, sc.t - APPEAR_S);
  }
}

function step(sc: Scene, dt: number) {
  sc.t += dt;
  sc.brush += BRUSH_SPIN * dt;
  const end = turnAt(sc.half);
  if (sc.hold) {
    // Стоит под указателем; разворот, если начат, ждёт.
    if (sc.turn !== null) sc.turn += dt;
  } else if (sc.turn === null) {
    sc.y += sc.dir * SPEED * dt;
    if (sc.dir * sc.y >= end) {
      sc.y = sc.dir * end;
      sc.turn = sc.t;
    }
    const last = sc.trail[sc.trail.length - 1];
    if (!last || Math.abs(last.y - sc.y) >= 0.05) sc.trail.push({ y: sc.y, t: sc.t });
  } else if (sc.t - sc.turn >= TURN_S) {
    sc.dir = sc.dir === 1 ? -1 : 1;
    sc.turn = null;
  }
  sc.trail = sc.trail.filter((p) => sc.t - p.t < TRAIL_S);

  // Щётки задевают мусор только на ходу: он втягивается под робота.
  if (sc.turn === null && !sc.hold) {
    for (const it of sc.litter) {
      if (it.gone !== null || sc.t - it.born < APPEAR_S * 0.6) continue;
      const ahead = (it.y - sc.y) * sc.dir;
      if (ahead < REACH_AHEAD && ahead > -REACH_BEHIND && Math.abs(it.x) <= LANE + 0.05) {
        it.gone = sc.t;
        it.suckTo = [0, sc.y + sc.dir * 0.15];
      }
    }
  }
  const kept: Litter[] = [];
  for (const it of sc.litter) {
    if (it.gone !== null && sc.t - it.gone >= SUCK_S) {
      sc.cleaned += 1;
      sc.pending += 1;
      sc.sparkles.push({ x: it.suckTo[0], y: it.suckTo[1], t: sc.t });
    } else kept.push(it);
  }
  sc.litter = kept;
  sc.sparkles = sc.sparkles.filter((p) => sc.t - p.t < SPARKLE_S);

  // Новый мусор — позади робота, на убранном участке: на обратном пути будет что убирать.
  while (sc.pending > 0) {
    const y = sc.dir === 1 ? freeSpot(sc, -sc.half + 0.4, sc.y - SPAWN_GAP) : freeSpot(sc, sc.y + SPAWN_GAP, sc.half - 0.4);
    if (y === null) break;
    drop(sc, y, sc.t);
    sc.pending -= 1;
  }
}

/** Куда смотрит робот: на ходу — по движению; у края — разворачивается через «лицом к зрителю». */
function robotYaw(sc: Scene, still: boolean): number {
  if (still) return 0.6;
  const along = (sc.dir * Math.PI) / 2;
  if (sc.turn === null) return along;
  const u = clamp((sc.t - sc.turn) / TURN_S);
  const ease = (v: number) => (v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2);
  // Повернулся к зрителю, постоял и повернулся дальше.
  const r = u < 0.35 ? ease(u / 0.35) * 0.5 : u < 0.65 ? 0.5 : 0.5 + ease((u - 0.65) / 0.35) * 0.5;
  return along - sc.dir * Math.PI * r;
}

/** Моргание раз в несколько секунд. */
function blinkAt(t: number): number {
  return t % 3.7 < 0.14 ? 0.15 : 1;
}

function drawFloor(f: Frame, pal: Palette, half: number) {
  const { ctx } = f;
  const far = -1.1, near = 0.9, w = half + 0.5;
  const top = screen(f, [far, 0, 0])[1], bottom = screen(f, [near, 0, 0])[1];
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, rgba(pal.floor, 0));
  fill.addColorStop(0.4, rgba(pal.floor, 0.75));
  fill.addColorStop(1, rgba(pal.floor, 1));
  polygon(f, [[far, -w, 0], [far, w, 0], [near, w, 0], [near, -w, 0]], fill, false);
  // Плитка 0,5 м, к дальнему краю растворяется вместе с полом.
  const [r, g, b, a] = pal.grid;
  const lines = ctx.createLinearGradient(0, top, 0, bottom);
  lines.addColorStop(0, `rgba(${r},${g},${b},0)`);
  lines.addColorStop(1, `rgba(${r},${g},${b},${Math.min(1, a * 1.8)})`);
  ctx.beginPath();
  for (let x = -1; x <= near; x += 0.5) {
    const [x0, y0] = screen(f, [x, -w, 0]), [x1, y1] = screen(f, [x, w, 0]);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  for (let y = Math.ceil(-w / 0.5) * 0.5; y <= w; y += 0.5) {
    const [x0, y0] = screen(f, [far, y, 0]), [x1, y1] = screen(f, [near, y, 0]);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.strokeStyle = lines;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Влажный след: полоса шириной с робота, высыхает за TRAIL_S. */
function drawTrail(f: Frame, pal: Palette, sc: Scene) {
  for (let i = 1; i < sc.trail.length; i++) {
    const p = sc.trail[i - 1]!, q = sc.trail[i]!;
    const a = 0.2 * (1 - (sc.t - q.t) / TRAIL_S);
    if (a > 0) polygon(f, [[-0.32, p.y, 0.001], [-0.32, q.y, 0.001], [0.32, q.y, 0.001], [0.32, p.y, 0.001]], rgba(pal.accent, a), false);
  }
}

/** Искорка там, где мусор исчез под роботом. */
function drawSparkles(f: Frame, pal: Palette, sc: Scene) {
  const { ctx } = f;
  for (const p of sc.sparkles) {
    const a = clamp((sc.t - p.t) / SPARKLE_S);
    // У ближнего борта робота, над полом: под корпусом её было бы не видно.
    const [sx, sy] = screen(f, [p.x + 0.4, p.y, 0.12]);
    const s = f.scale * 0.05 * (0.5 + a);
    ctx.fillStyle = rgba(pal.accent, 1 - a);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? s : s * 0.28, ang = (i * Math.PI) / 4;
      ctx.lineTo(sx + Math.cos(ang) * r, sy - a * s + Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** Точка пола (z = 0) под точкой экрана — обратная проекция для нажатий. */
function floorAt(cam: { cx: number; cy: number; scale: number }, sx: number, sy: number): [number, number] {
  const se = Math.sin(ELEVATION), ce = Math.cos(ELEVATION);
  const a = (sy - cam.cy) / (se * cam.scale * FOCAL_M);
  const x = (a * FOCAL_M) / (1 + a * ce);
  const k = (cam.scale * FOCAL_M) / (FOCAL_M - x * ce);
  return [x, (sx - cam.cx) / k];
}

export function CleaningRobot3D({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const countRef = useRef<HTMLSpanElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  /** Под указателем или в фокусе робот стоит — по движущейся цели трудно попасть. */
  const hold = (on: boolean) => {
    if (sceneRef.current) sceneRef.current.hold = on;
  };

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current, count = countRef.current, link = linkRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx || !count || !link) return;
    let palette = readPalette(wrap);
    const font = getComputedStyle(wrap).fontFamily || "sans-serif";
    let width = 0, height = 0, dpr = 1;
    let cam = { cx: 0, cy: 0, scale: 1 };

    function layout() {
      const r = canvas!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = r.width;
      height = r.height;
      canvas!.width = Math.max(1, Math.round(width * dpr));
      canvas!.height = Math.max(1, Math.round(height * dpr));
      // Робот ≈ 0,92 м в высоту плюс глубина полосы с мусором; по ширине видно не меньше 3,4 м пола.
      // Сверху остаётся место под подпись ссылки и строку со счётчиком.
      const se = Math.sin(ELEVATION), ce = Math.cos(ELEVATION);
      const perM = Math.max(1, Math.min((height * 0.72) / (0.92 * ce + 0.8 * se), width / 3.4));
      cam = { cx: width / 2, cy: height / 2 + (perM * (0.92 * ce - 0.1 * se)) / 2, scale: perM };
      const half = width / 2 / perM;
      if (!sceneRef.current) sceneRef.current = newScene(half, reduced);
      else fitScene(sceneRef.current, half);
    }

    function draw() {
      const sc = sceneRef.current!;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      const world: Frame = { ctx: ctx!, cos: 1, sin: 0, ox: 0, oy: 0, ...cam, focal: FOCAL_M };
      drawFloor(world, palette, sc.half);
      drawTrail(world, palette, sc);
      [...sc.litter].sort((a, b) => a.x - b.x).forEach((it) => drawLitter(world, it, sc.t, palette));
      const yaw = robotYaw(sc, reduced);
      const robot: Frame = { ...world, cos: Math.cos(yaw), sin: Math.sin(yaw), oy: sc.y };
      drawRobot(robot, palette, sc.brush, font, reduced ? 1 : blinkAt(sc.t));
      drawSparkles(world, palette, sc);
      count!.textContent = `Убрано: ${sc.cleaned}`;
      placeLink(robot);
    }

    /** Ссылка на каталог — прямоугольник вокруг робота на экране, по углам его габаритов. */
    function placeLink(f: Frame) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [-0.36, 0.36]) {
        for (const y of [-0.33, 0.33]) {
          for (const z of [0, 0.92]) {
            const [sx, sy] = screen(f, [x, y, z]);
            x0 = Math.min(x0, sx);
            y0 = Math.min(y0, sy);
            x1 = Math.max(x1, sx);
            y1 = Math.max(y1, sy);
          }
        }
      }
      const left = clamp(x0 - 4, 0, width), top = clamp(y0 - 4, 0, height);
      link!.style.left = `${left}px`;
      link!.style.top = `${top}px`;
      link!.style.width = `${clamp(x1 + 4, 0, width) - left}px`;
      link!.style.height = `${clamp(y1 + 4, 0, height) - top}px`;
      // Подпись — над роботом, а если сверху тесно, то внутри, поверх его верха.
      link!.dataset.tip = top > 36 ? "above" : "inside";
    }

    layout();
    draw();
    const ro = new ResizeObserver(() => {
      layout();
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

    // Нажатие на пол подкидывает мусор туда, куда нажали (в пределах полосы, не под робота).
    function onDown(e: PointerEvent) {
      const sc = sceneRef.current!;
      const r = canvas!.getBoundingClientRect();
      const [x, y] = floorAt(cam, e.clientX - r.left, e.clientY - r.top);
      if (Math.abs(x) > 0.9 || sc.litter.length >= litterTarget(sc.half) + 8) return;
      const at = clamp(y, -sc.half + 0.4, sc.half - 0.4);
      if (Math.abs(at - sc.y) < 0.45) return;
      const still = reduced || paused;
      drop(sc, at, still ? sc.t - APPEAR_S : sc.t, clamp(x, -LANE, LANE));
      if (still) draw();
    }
    canvas.addEventListener("pointerdown", onDown);

    let raf = 0, last = 0, visible = true;
    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      step(sceneRef.current!, dt);
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
        className="block h-full w-full cursor-crosshair touch-pan-y"
        role="img"
        aria-label="Робот-уборщик Alfa Robot ездит туда-обратно по офису и убирает мусор: бумагу, банановую кожуру, стаканчики"
      />
      <span ref={countRef} className="pointer-events-none absolute top-3 left-4 text-sm font-semibold tabular-nums" aria-hidden="true">
        Убрано: 0
      </span>
      {/* Робот — ссылка на каталог; draw() ставит её поверх робота в каждом кадре. */}
      <Link
        ref={linkRef}
        href="/catalog"
        aria-label="Каталог роботизированных решений"
        className="group absolute rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ left: 0, top: 0, width: 0, height: 0 }}
        onPointerEnter={() => hold(true)}
        onPointerLeave={() => hold(false)}
        onFocus={() => hold(true)}
        onBlur={() => hold(false)}
      >
        <span
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium whitespace-nowrap opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[tip=above]:bottom-full group-data-[tip=above]:mb-1 group-data-[tip=inside]:top-1"
          aria-hidden="true"
        >
          Каталог роботов →
        </span>
      </Link>
      <p className="pointer-events-none absolute bottom-2 left-4 text-xs text-muted-foreground" aria-hidden="true">
        Нажмите на пол, чтобы подкинуть мусор, или на робота — чтобы открыть каталог
      </p>
      {!reduced && (
        <Button type="button" variant="outline" size="sm" className="absolute top-2 right-2" onClick={() => setPaused((v) => !v)}>
          {paused ? "Продолжить" : "Пауза"}
        </Button>
      )}
    </div>
  );
}
