import { pluralRu } from "@/lib/format/plural";
import type { Layout as SceneLayout, Zone as SceneZone } from "@/lib/scene/types";
import type { SimEngineState } from "@/lib/sim/state";
import type { SimLayout } from "@/lib/sim/types";
import {
  SCENE_FONT_FAMILY,
  formatSimClock,
  queueOffset,
  rackRects,
  robotGlyph,
  robotsToDraw,
  simPhaseLabel,
  type RobotGlyph,
} from "./scene-model";

/**
 * Изометрическая схема склада — изометрия прототипа BCB (цифровой двойник здания) на планировке
 * имитации: плита и полы зон, стеллажи коробками с тремя видимыми гранями, стены, ворота и
 * зарядка, роботы-спрайты с паллетой и оставшийся путь каждого робота. Одни и те же функции
 * собирают SVG для экрана, для PNG-выгрузки и для печатного отчёта, поэтому картинка в отчёте не
 * расходится с экраном.
 *
 * Мир — метры планировки. У планировки ось Y смотрит вверх (0 — нижняя стена); в мире y = H − y,
 * и зритель смотрит со стороны нижней стены и стены отгрузки: видны верх, южная и восточная грани
 * (как в прототипе). Цвета заданы CSS-переменными `--iso-*` в таблице стилей `isoStyleSheet`:
 * светлая и тёмная палитры прототипа переключаются вместе с темой страницы, а PNG и печать берут
 * светлую.
 *
 * Модуль не трогает DOM — строки SVG проверяются unit-тестами в Node, а на сервере отчёт рисует
 * ту же схему без браузера.
 */

// ——————————————————————————— Проекция ———————————————————————————

/** cos 30° — горизонталь изометрии прототипа. */
const C = 0.866;
/** Сжатие глубины прототипа. */
const K = 0.42;
/** Ширина пола склада в единицах viewBox: масштаб подбирается так, чтобы склад любой площади вписался в неё. */
export const ISO_SCENE_W = 1000;

/** Высоты и размеры обстановки, м. Условные: это схема, а не чертёж объекта. */
const RACK_H = 2.2;
const WALL_H = 4.2;
const WALL_T = 0.5;
const CURB_H = 0.35;
const GLASS_H = 3.6;
const DOOR_W = 3.2;
const DOOR_H = 3;
const PAD_M = 2.6;
const CHARGER = { w: 1.7, d: 0.8, h: 1.9 };
/** Толщина плиты, единицы viewBox. */
const SLAB_U = 9;
/** Шаг очереди у ворот, м: спрайт робота крупнее настоящего робота, поэтому шаг шире самого робота. */
const QUEUE_STEP_M = 2.2;
/** Масштаб спрайта робота (рисунок 64 × 64, основание на y = 58). */
const BOT_K = 0.44;

export type IsoGeometry = {
  /** Единиц viewBox на метр. */
  s: number;
  /** Ширина и глубина планировки, м. */
  W: number;
  H: number;
  vb: { x: number; y: number; w: number; h: number };
};

/** Геометрия сцены: масштаб и рамка, в которую помещаются пол, стены, подписи и часы. */
export function isoGeometry(layout: SimLayout): IsoGeometry {
  return isoGeometryWH(layout.widthM, layout.heightM);
}

/** Геометрия для пола W × H (единицы мира). */
function isoGeometryWH(width: number, height: number): IsoGeometry {
  const W = Number.isFinite(width) && width > 0 ? width : 1;
  const H = Number.isFinite(height) && height > 0 ? height : 1;
  const s = ISO_SCENE_W / ((W + H) * C);
  const left = -H * C * s;
  const right = W * C * s;
  const top = -WALL_H * s;
  const bottom = (W + H) * K * s + SLAB_U;
  const mx = 26;
  const mTop = 44;
  const mBottom = 34;
  return { s, W, H, vb: { x: left - mx, y: top - mTop, w: right - left + 2 * mx, h: bottom - top + mTop + mBottom } };
}

/** Точка мира на экране: wx — вдоль планировки, wy — от верхней стены, wz — высота; всё в метрах. */
export function isoPoint(g: IsoGeometry, wx: number, wy: number, wz = 0): { x: number; y: number } {
  return { x: (wx - wy) * C * g.s, y: ((wx + wy) * K - wz) * g.s };
}

/** Число для атрибута SVG: одна цифра после запятой, без «-0». */
function n1(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
}

function pts(g: IsoGeometry, list: readonly [number, number, number][]): string {
  return list.map(([x, y, z]) => {
    const p = isoPoint(g, x, y, z);
    return `${n1(p.x)},${n1(p.y)}`;
  }).join(" ");
}

/** Коробка мира: x, y — угол, w — вдоль x, d — вдоль y, z0 — низ, h — высота (м). */
type Box = { x: number; y: number; w: number; d: number; z0: number; h: number; mat: Material; title?: string };

/** Видимые грани коробки: юг, восток, верх (порядок отрисовки прототипа). */
function boxMarkup(g: IsoGeometry, b: Box, extra = ""): string {
  const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.d, z0 = b.z0, z1 = b.z0 + b.h;
  const south = pts(g, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]);
  const east = pts(g, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  const top = pts(g, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  const title = b.title ? `<title>${esc(b.title)}</title>` : "";
  return `<g class="iso-box iso-${b.mat}">${title}<polygon class="s" points="${south}"/><polygon class="e" points="${east}"/><polygon class="t" points="${top}"/>${extra}</g>`;
}

/** Ключ глубины для алгоритма художника: дальше от зрителя — меньше. */
function depth(b: Box): number {
  return b.x + b.w / 2 + (b.y + b.d / 2) + b.z0 * 0.01;
}

/** Длинные коробки режутся на куски — иначе сортировка по центру ошибается у соседей. */
function chop(boxes: readonly Box[], maxLen: number): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const alongX = b.w >= b.d;
    const len = alongX ? b.w : b.d;
    const k = Math.max(1, Math.ceil(len / maxLen));
    for (let i = 0; i < k; i++) {
      const a = (len * i) / k;
      const e = (len * (i + 1)) / k;
      out.push(alongX ? { ...b, x: b.x + a, w: e - a } : { ...b, y: b.y + a, d: e - a });
    }
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ——————————————————————————— Палитры ———————————————————————————

type Material = "slab" | "rack" | "wall" | "curb" | "charger" | "belt";
type ZoneKind = SimLayout["zones"][number]["kind"];

/** Палитра схемы: светлая и тёмная — палитры материалов прототипа BCB. */
export type IsoPalette = {
  light: boolean;
  /** Базовый цвет материала — верхняя грань; южная и восточная затеняются от него. */
  mats: Readonly<Record<Material, string>>;
  floor: Readonly<Record<ZoneKind, string>>;
  grid: string;
  aisle: string;
  shelf: string;
  glass: string;
  glassLine: string;
  door: string;
  dock: string;
  dockBusy: string;
  bolt: string;
  label: string;
  labelDim: string;
  halo: string;
  botBody: string;
  botDark: string;
  botLine: string;
  botGlass: string;
  accent: string;
  warn: string;
  wood: string;
  cargo: string;
  cargoLine: string;
  shadow: string;
  route: string;
  routeCharge: string;
};

export const ISO_LIGHT: IsoPalette = {
  light: true,
  mats: { slab: "#D6DEDE", rack: "#8FA4A7", wall: "#FFFFFF", curb: "#E9EEEE", charger: "#FFFFFF", belt: "#B9A57A" },
  floor: { receiving: "#E2EFF0", storage: "#F1F4F4", shipping: "#E4F0E8", charging: "#F5EDDA" },
  grid: "rgba(35,75,78,0.08)",
  aisle: "rgba(35,75,78,0.30)",
  shelf: "#6E8487",
  glass: "rgba(30,155,163,0.07)",
  glassLine: "rgba(30,155,163,0.5)",
  door: "#9DB2B4",
  dock: "#1E9BA3",
  dockBusy: "rgba(30,155,163,0.32)",
  bolt: "#B7791F",
  label: "#16282D",
  labelDim: "#5E6A74",
  halo: "#F4F6F6",
  botBody: "#FFFFFF",
  botDark: "#3A4B52",
  botLine: "#16282D",
  botGlass: "#1E9BA3",
  accent: "#14B3BE",
  warn: "#B7791F",
  wood: "#C9A36B",
  cargo: "#E3CFA8",
  cargoLine: "#8A7355",
  shadow: "rgba(22,40,45,0.22)",
  route: "#14B3BE",
  routeCharge: "#B7791F",
};

export const ISO_DARK: IsoPalette = {
  light: false,
  mats: { slab: "#16292E", rack: "#4A6F75", wall: "#4A777D", curb: "#3B6268", charger: "#50767B", belt: "#7A6A45" },
  floor: { receiving: "#1B4046", storage: "#1F3A3F", shipping: "#1E3D35", charging: "#3A3524" },
  grid: "rgba(98,204,210,0.10)",
  aisle: "rgba(98,204,210,0.34)",
  shelf: "#2E4E54",
  glass: "rgba(98,204,210,0.09)",
  glassLine: "rgba(98,204,210,0.55)",
  door: "#2C4A4F",
  dock: "#62CCD2",
  dockBusy: "rgba(98,204,210,0.32)",
  bolt: "#F4C25A",
  label: "#EAECEC",
  labelDim: "#8FA0A4",
  halo: "#0E1D21",
  botBody: "#EAECEC",
  botDark: "#2A3F44",
  botLine: "#0E1D21",
  botGlass: "#22CCD6",
  accent: "#22CCD6",
  warn: "#F4C25A",
  wood: "#A88455",
  cargo: "#C8B28A",
  cargoLine: "#6E5B3F",
  shadow: "rgba(0,0,0,0.35)",
  route: "#22CCD6",
  routeCharge: "#F4C25A",
};

/** Грань, затенённая от базового цвета: юг темнее, восток ещё темнее (как у прототипа). */
function shade(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x * k));
  return `rgb(${c.join(",")})`;
}

function paletteVars(p: IsoPalette): string {
  const out: string[] = [];
  for (const [m, base] of Object.entries(p.mats)) {
    out.push(`--iso-${m}-t:${base}`, `--iso-${m}-s:${shade(base, p.light ? 0.86 : 0.74)}`, `--iso-${m}-e:${shade(base, p.light ? 0.74 : 0.58)}`);
  }
  for (const [z, c] of Object.entries(p.floor)) out.push(`--iso-floor-${z}:${c}`);
  const plain: [string, string][] = [
    ["grid", p.grid], ["aisle", p.aisle], ["shelf", p.shelf], ["glass", p.glass], ["glass-line", p.glassLine],
    ["door", p.door], ["dock", p.dock], ["dock-busy", p.dockBusy], ["bolt", p.bolt], ["label", p.label],
    ["label-dim", p.labelDim], ["halo", p.halo], ["bot-body", p.botBody], ["bot-dark", p.botDark],
    ["bot-line", p.botLine], ["bot-glass", p.botGlass], ["accent", p.accent], ["warn", p.warn], ["wood", p.wood],
    ["cargo", p.cargo], ["cargo-line", p.cargoLine], ["shadow", p.shadow], ["route", p.route], ["route-charge", p.routeCharge],
  ];
  for (const [k, v] of plain) out.push(`--iso-${k}:${v}`);
  return out.join(";");
}

const ISO_RULES = [
  `.iso-root{font-family:${SCENE_FONT_FAMILY}}`,
  ...(["slab", "rack", "wall", "curb", "charger", "belt"] as const).map(
    (m) => `.iso-${m} .t{fill:var(--iso-${m}-t)}.iso-${m} .s{fill:var(--iso-${m}-s)}.iso-${m} .e{fill:var(--iso-${m}-e)}`,
  ),
  ...(["receiving", "storage", "shipping", "charging"] as const).map((z) => `.iso-floor-${z}{fill:var(--iso-floor-${z})}`),
  ".iso-grid{stroke:var(--iso-grid);stroke-width:.6}",
  ".iso-aisle{fill:none;stroke:var(--iso-aisle);stroke-width:1;stroke-dasharray:5 5}",
  ".iso-shelf{fill:none;stroke:var(--iso-shelf);stroke-width:.6}",
  ".iso-glass{fill:var(--iso-glass)}",
  ".iso-mullion{stroke:var(--iso-glass-line);stroke-width:.8}",
  ".iso-door{fill:var(--iso-door)}",
  ".iso-door-line{stroke:var(--iso-bot-line);stroke-opacity:.25;stroke-width:.5}",
  ".iso-pad{fill:none;stroke:var(--iso-dock);stroke-width:1.2}",
  '.iso-pad[data-busy="1"]{fill:var(--iso-dock-busy)}',
  ".iso-pad-label{font-size:10px;font-weight:700;fill:var(--iso-dock);stroke:var(--iso-halo);stroke-width:2.5px;paint-order:stroke;text-anchor:middle}",
  ".iso-bolt{fill:var(--iso-bolt)}",
  ".iso-label{font-size:15px;font-weight:600;fill:var(--iso-label);stroke:var(--iso-halo);stroke-width:4px;paint-order:stroke;stroke-linejoin:round;text-anchor:middle}",
  ".iso-hud{font-size:14px;font-weight:600;fill:var(--iso-label-dim)}",
  ".iso-hud--end{text-anchor:end}",
  ".iso-shadow{fill:var(--iso-shadow)}",
  ".iso-bot path,.iso-bot rect,.iso-bot circle{vector-effect:non-scaling-stroke}",
  ".iso-bot .b-body{fill:var(--iso-bot-body);stroke:var(--iso-bot-line);stroke-width:1.1}",
  ".iso-bot .b-dark{fill:var(--iso-bot-dark);stroke:var(--iso-bot-line);stroke-width:1.1}",
  ".iso-bot .b-glass{fill:var(--iso-bot-glass);stroke:var(--iso-bot-line);stroke-width:.8}",
  ".iso-bot .b-led{fill:var(--iso-accent)}",
  ".iso-bot .b-cargo,.iso-bot .b-bolt{display:none}",
  '.iso-bot[data-glyph="loaded"] .b-cargo{display:inline}',
  '.iso-bot[data-glyph="charging"] .b-bolt{display:inline}',
  '.iso-bot[data-glyph="charging"] .b-led{fill:var(--iso-warn)}',
  ".iso-bot .b-wood{fill:var(--iso-wood);stroke:var(--iso-bot-line);stroke-width:.8}",
  ".iso-bot .b-box{fill:var(--iso-cargo);stroke:var(--iso-cargo-line);stroke-width:.8}",
  ".iso-bot .b-tape{fill:none;stroke:var(--iso-cargo-line);stroke-width:.8}",
  ".iso-bot .b-bolt{fill:var(--iso-warn);stroke:var(--iso-bot-line);stroke-width:.8}",
  ".iso-route{fill:none;stroke:var(--iso-route);stroke-width:1.8;stroke-dasharray:5 4;stroke-linecap:round;stroke-linejoin:round;animation:iso-march 1.1s linear infinite}",
  '.iso-route[data-kind="empty"]{opacity:.55}',
  '.iso-route[data-kind="charge"]{stroke:var(--iso-route-charge)}',
  "@keyframes iso-march{to{stroke-dashoffset:-18}}",
  "@media (prefers-reduced-motion:reduce){.iso-route{animation:none}}",
].join("");

/**
 * Таблица стилей схемы. «auto» — светлая палитра, а на экране при тёмной теме (класс `.dark` или
 * тёмная тема системы — как вариант `dark:` в globals.css) — тёмная; печать всегда светлая.
 * «light» — только светлая: для SVG, который собирается в PNG. Классы и анимация с префиксом
 * iso-: стили встроенного SVG действуют на весь документ.
 */
export function isoStyleSheet(mode: "auto" | "light"): string {
  const light = `.iso-root{${paletteVars(ISO_LIGHT)}}`;
  if (mode === "light") return light + ISO_RULES;
  const dark = paletteVars(ISO_DARK);
  return `${light}@media screen and (prefers-color-scheme:dark){.iso-root{${dark}}}@media screen{.dark .iso-root{${dark}}}${ISO_RULES}`;
}

// ——————————————————————————— Статичная сцена ———————————————————————————

/** Подпись точки операции по-русски: приёмка — П, отгрузка — О, зарядка — З, с номером точки. */
export function pointLabel(id: string): string {
  const num = id.replace(/^\D+/, "");
  if (id.startsWith("R")) return `П${num}`;
  if (id.startsWith("S")) return `О${num}`;
  if (id.startsWith("C")) return `З${num}`;
  return id;
}

function floorRect(g: IsoGeometry, x: number, y: number, w: number, d: number, z = 0): string {
  return pts(g, [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]]);
}

function line(g: IsoGeometry, a: [number, number, number], b: [number, number, number], cls: string): string {
  const p = isoPoint(g, ...a);
  const q = isoPoint(g, ...b);
  return `<line class="${cls}" x1="${n1(p.x)}" y1="${n1(p.y)}" x2="${n1(q.x)}" y2="${n1(q.y)}"/>`;
}

/** Плита под полом склада. */
function slabMarkup(g: IsoGeometry): string {
  const t = SLAB_U / g.s;
  return boxMarkup(g, { x: -WALL_T - 1, y: -WALL_T - 1, w: g.W + WALL_T + 2, d: g.H + WALL_T + 2, z0: -t, h: t, mat: "slab" });
}

function floorsMarkup(layout: SimLayout, g: IsoGeometry): string {
  return layout.zones
    .map((z) => `<polygon class="iso-floor-${z.kind}" points="${floorRect(g, z.x, g.H - z.y - z.h, z.w, z.h)}"/>`)
    .join("");
}

/** Сетка пола: 5 м у обычного склада, 10 м у большого — фактура «инженерного планшета» прототипа. */
function gridMarkup(g: IsoGeometry): string {
  const step = g.W + g.H > 260 ? 10 : 5;
  let out = "";
  for (let x = step; x < g.W; x += step) out += line(g, [x, 0, 0], [x, g.H, 0], "iso-grid");
  for (let y = step; y < g.H; y += step) out += line(g, [0, y, 0], [g.W, y, 0], "iso-grid");
  return `<g>${out}</g>`;
}

/** Оси проездов — сеть маршрутов, по которой ездят роботы (как пунктир старой схемы). */
function aislesMarkup(layout: SimLayout, g: IsoGeometry): string {
  const cross = layout.crossAislesY;
  if (cross.length === 0) return "";
  const yLo = Math.min(...cross);
  const yHi = Math.max(...cross);
  const xLeft = layout.receiving[0]?.x ?? 0;
  const xRight = layout.shipping[0]?.x ?? g.W;
  let out = "";
  for (const y of cross) out += line(g, [xLeft, g.H - y, 0.02], [xRight, g.H - y, 0.02], "iso-aisle");
  for (const x of [xLeft, ...layout.rackAislesX, xRight]) out += line(g, [x, g.H - yHi, 0.02], [x, g.H - yLo, 0.02], "iso-aisle");
  return `<g>${out}</g>`;
}

/** Задние стены (верхняя и левая): высокие, с воротами приёмки на левой. */
function backWallsMarkup(layout: SimLayout, g: IsoGeometry): string {
  return backWalls(g, layout.receiving.map((p) => g.H - p.y));
}

/** Задние стены с воротами на левой стене в точках `doorsWy` (м от верхней стены). */
function backWalls(g: IsoGeometry, doorsWy: readonly number[]): string {
  const walls = chop(
    [
      { x: -WALL_T, y: -WALL_T, w: g.W + WALL_T, d: WALL_T, z0: 0, h: WALL_H, mat: "wall" as const },
      { x: -WALL_T, y: 0, w: WALL_T, d: g.H, z0: 0, h: WALL_H, mat: "wall" as const },
    ],
    12,
  );
  let doors = "";
  for (const wy of doorsWy) {
    const a = Math.max(0, wy - DOOR_W / 2);
    const b = Math.min(g.H, wy + DOOR_W / 2);
    doors += `<polygon class="iso-door" points="${pts(g, [[0, a, 0], [0, b, 0], [0, b, DOOR_H], [0, a, DOOR_H]])}"/>`;
    for (let z = 0.5; z < DOOR_H; z += 0.5) doors += line(g, [0, a, z], [0, b, z], "iso-door-line");
  }
  return walls.map((w) => boxMarkup(g, w)).join("") + doors;
}

/** Площадки у ворот и у зарядок — контур на полу; занятые закрашиваются по кадру. */
function padsMarkup(layout: SimLayout, g: IsoGeometry, busy: ReadonlySet<string>): string {
  let out = "";
  for (const p of [...layout.receiving, ...layout.shipping, ...layout.chargers]) {
    const r = PAD_M / 2;
    const what = p.kind === "receiving" ? "Ворота приёмки" : p.kind === "shipping" ? "Ворота отгрузки" : "Место у зарядки";
    out += `<polygon class="iso-pad" data-point="${esc(p.id)}" data-busy="${busy.has(p.id) ? 1 : 0}" points="${floorRect(g, p.x - r, g.H - p.y - r, PAD_M, PAD_M, 0.03)}"><title>${what} ${pointLabel(p.id)}</title></polygon>`;
  }
  return out;
}

/**
 * Номера точек (П1, О1, З1) — в верхнем слое, поверх стеллажей, роботов и стекла, со стороны
 * стены: у приёмки — между площадкой и левой стеной, у отгрузки — между площадкой и фасадом, у
 * зарядки — справа от площадки.
 */
function pointLabelsMarkup(layout: SimLayout, g: IsoGeometry): string {
  let out = "";
  for (const p of [...layout.receiving, ...layout.shipping, ...layout.chargers]) {
    const r = PAD_M / 2;
    const dx = p.kind === "receiving" ? -(r + 1.1) : r + 1.1;
    const c = isoPoint(g, p.x + dx, g.H - p.y, 0);
    out += `<text class="iso-pad-label" x="${n1(c.x)}" y="${n1(c.y + 3.5)}">${pointLabel(p.id)}</text>`;
  }
  return out;
}

/** Зарядная станция — невысокая стойка за площадкой, с молнией на южной грани. */
function chargerBoxes(layout: SimLayout, g: IsoGeometry): Box[] {
  return layout.chargers.map((p) => ({
    x: p.x - CHARGER.w / 2,
    y: g.H - p.y - PAD_M / 2 - CHARGER.d,
    w: CHARGER.w,
    d: CHARGER.d,
    z0: 0,
    h: CHARGER.h,
    mat: "charger" as const,
    title: `Зарядная станция ${pointLabel(p.id)}`,
  }));
}

function boltOnSouth(g: IsoGeometry, b: Box): string {
  const cx = b.x + b.w / 2;
  const y = b.y + b.d;
  const z = b.h / 2;
  const u = Math.min(b.w, b.h) * 0.32;
  const shape: [number, number][] = [[0.12, 0.5], [-0.32, -0.08], [-0.02, -0.08], [-0.12, -0.5], [0.32, 0.08], [0.02, 0.08]];
  return `<polygon class="iso-bolt" points="${pts(g, shape.map(([dx, dz]) => [cx + dx * u, y, z + dz * u] as [number, number, number]))}"/>`;
}

/** Стеллажи — коробки с полками, зарядки — стойки; всё вместе сортируется по глубине. */
function boxesMarkup(layout: SimLayout, g: IsoGeometry): string {
  const racks: Box[] = rackRects(layout).map((r) => ({ x: r.x, y: r.y, w: r.w, d: r.h, z0: 0, h: RACK_H, mat: "rack" as const }));
  const items = [...chop(racks, 8), ...chargerBoxes(layout, g)].sort((a, b) => depth(a) - depth(b));
  return items
    .map((b) => {
      if (b.mat === "charger") return boxMarkup(g, b, boltOnSouth(g, b));
      // Полки: две линии на южной и восточной гранях — коробка читается как стеллаж, а не блок.
      let shelves = "";
      for (const z of [RACK_H / 3, (2 * RACK_H) / 3]) {
        shelves += line(g, [b.x, b.y + b.d, z], [b.x + b.w, b.y + b.d, z], "iso-shelf");
        shelves += line(g, [b.x + b.w, b.y, z], [b.x + b.w, b.y + b.d, z], "iso-shelf");
      }
      return boxMarkup(g, b, shelves);
    })
    .join("");
}

/**
 * Подписи зон с ореолом. «Хранение» — над стеллажами в центре; узкие полосы у стен подписаны
 * снаружи пола, чтобы подпись не ложилась на ворота: приёмка — над задней стеной, отгрузка — перед
 * восточным фасадом, зарядка — перед юго-западным углом.
 */
function labelsMarkup(layout: SimLayout, g: IsoGeometry): string {
  return layout.zones
    .map((z) => {
      const cy = g.H - z.y - z.h / 2;
      const at: [number, number, number] =
        z.kind === "storage"
          ? [z.x + z.w / 2, cy, RACK_H + 1.8]
          : z.kind === "receiving"
            ? [-WALL_T, cy, WALL_H + 1.4]
            : z.kind === "shipping"
              ? [g.W + 5, cy, 0]
              : [z.x + z.w + 2, g.H + 4, 0];
      const c = isoPoint(g, ...at);
      return `<text class="iso-label" x="${n1(c.x)}" y="${n1(c.y)}">${esc(z.label)}</text>`;
    })
    .join("");
}

/** Передние стены (нижняя и правая): низкий бортик и остекление с воротами отгрузки — как южный фасад прототипа. */
function frontMarkup(layout: SimLayout, g: IsoGeometry): string {
  return frontFacade(g, layout.shipping.map((p) => g.H - p.y));
}

/** Бортик и остекление передних стен, ворота — на правом фасаде в точках `doorsWy`. */
function frontFacade(g: IsoGeometry, doorsWy: readonly number[]): string {
  const curbs = [
    { x: 0, y: g.H, w: g.W, d: WALL_T, z0: 0, h: CURB_H, mat: "curb" as const },
    { x: g.W, y: -WALL_T, w: WALL_T, d: g.H + WALL_T * 2, z0: 0, h: CURB_H, mat: "curb" as const },
  ];
  const south = pts(g, [[0, g.H, 0], [g.W, g.H, 0], [g.W, g.H, GLASS_H], [0, g.H, GLASS_H]]);
  const east = pts(g, [[g.W, 0, 0], [g.W, g.H, 0], [g.W, g.H, GLASS_H], [g.W, 0, GLASS_H]]);
  let mullions = "";
  for (let x = 0; x <= g.W + 1e-6; x += 6) mullions += line(g, [x, g.H, 0], [x, g.H, GLASS_H], "iso-mullion");
  for (let y = 0; y <= g.H + 1e-6; y += 6) mullions += line(g, [g.W, y, 0], [g.W, y, GLASS_H], "iso-mullion");
  mullions += line(g, [0, g.H, GLASS_H], [g.W, g.H, GLASS_H], "iso-mullion");
  mullions += line(g, [g.W, 0, GLASS_H], [g.W, g.H, GLASS_H], "iso-mullion");
  let doors = "";
  for (const wy of doorsWy) {
    const a = Math.max(0, wy - DOOR_W / 2);
    const b = Math.min(g.H, wy + DOOR_W / 2);
    doors += `<polygon class="iso-door" opacity="0.8" points="${pts(g, [[g.W, a, 0], [g.W, b, 0], [g.W, b, DOOR_H], [g.W, a, DOOR_H]])}"/>`;
  }
  return (
    curbs.map((b) => boxMarkup(g, b)).join("") +
    `<g pointer-events="none"><polygon class="iso-glass" points="${south}"/><polygon class="iso-glass" points="${east}"/>${doors}${mullions}</g>`
  );
}

/**
 * Статичная часть схемы: задний план до роботов и передний после них. `busy` — точки, у которых
 * работает робот (для SVG одного кадра); на экране их закрашивает обновление кадра.
 */
export function isoStaticMarkup(
  layout: SimLayout,
  g: IsoGeometry,
  busy: ReadonlySet<string> = new Set(),
): { back: string; front: string } {
  return {
    back:
      `<g class="iso-slab-g">${slabMarkup(g)}</g>` +
      `<g class="iso-floors">${floorsMarkup(layout, g)}</g>` +
      gridMarkup(g) +
      aislesMarkup(layout, g) +
      `<g class="iso-walls">${backWallsMarkup(layout, g)}</g>` +
      `<g class="iso-pads">${padsMarkup(layout, g, busy)}</g>` +
      `<g class="iso-boxes">${boxesMarkup(layout, g)}</g>`,
    // Подписи — поверх роботов и стекла: робот, проезжающий под подписью, не должен её закрывать.
    front:
      `<g class="iso-front">${frontMarkup(layout, g)}</g>` +
      `<g class="iso-labels" pointer-events="none">${labelsMarkup(layout, g)}${pointLabelsMarkup(layout, g)}</g>`,
  };
}

// ——————————————————————————— Кадр прогона ———————————————————————————

/** Робот на кадре: экранная точка основания и состояние. */
export type IsoBot = { id: number; x: number; y: number; glyph: RobotGlyph };
/** Оставшийся путь робота: loaded — везёт паллету, empty — едет за ней, charge — на зарядку. */
export type IsoRoute = { id: number; kind: "loaded" | "empty" | "charge"; points: string };

export type IsoFrame = {
  bots: IsoBot[];
  routes: IsoRoute[];
  /** Точки (ворота и зарядки), у которых сейчас работает робот. */
  busy: string[];
  /** Часы модели; null — прогона не было (вход отклонён предварительной проверкой). */
  clock: string | null;
  /** «показано N из M роботов», если парк больше предела рисования. */
  caption: string | null;
};

/** Остаток маршрута робота от его текущей точки (координаты планировки). */
function remainingPath(r: SimEngineState["robots"][number]): { x: number; y: number }[] {
  if (r.path.length < 2) return [];
  let walked = 0;
  for (let i = 1; i < r.path.length; i++) {
    const a = r.path[i - 1]!;
    const b = r.path[i]!;
    walked += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (walked > r.distM + 1e-9) return [{ x: r.x, y: r.y }, ...r.path.slice(i)];
  }
  return [];
}

/** Кадр схемы из состояния прогона: роботы (с очередями у точек), их пути, занятые точки, часы. */
export function isoFrame(layout: SimLayout, state: SimEngineState, g: IsoGeometry = isoGeometry(layout)): IsoFrame {
  const n = robotsToDraw(state.robots.length);
  // Роботы, стоящие в очереди к точке, отодвигаются от неё по порядку очереди (считаются только
  // нарисованные — иначе в очереди были бы пропуски).
  const offsets = new Map<number, number>();
  for (const p of state.points) {
    let k = 0;
    for (const id of p.queue) {
      const r = state.robots[id];
      if (!r || id >= n || (r.phase !== "waitPoint" && r.phase !== "waitCharger")) continue;
      offsets.set(id, queueOffset(p.kind, k).dx);
      k++;
    }
  }
  const bots: IsoBot[] = [];
  const routes: IsoRoute[] = [];
  for (let i = 0; i < n; i++) {
    const r = state.robots[i]!;
    const dx = (offsets.get(r.id) ?? 0) * (QUEUE_STEP_M / 1.3);
    const p = isoPoint(g, r.x + dx, g.H - r.y, 0);
    bots.push({ id: r.id, x: p.x, y: p.y, glyph: robotGlyph(r.phase, r.loaded) });
    if (r.phase === "toPickup" || r.phase === "toDrop" || r.phase === "toCharger") {
      const rest = remainingPath(r);
      if (rest.length > 1) {
        routes.push({
          id: r.id,
          kind: r.phase === "toCharger" ? "charge" : r.phase === "toDrop" ? "loaded" : "empty",
          points: rest
            .map((q) => {
              const s = isoPoint(g, q.x, g.H - q.y, 0.05);
              return `${n1(s.x)},${n1(s.y)}`;
            })
            .join(" "),
        });
      }
    }
  }
  const busy = state.points.filter((p) => p.holder !== null).map((p) => p.id);
  const clock = state.precheck === "ok" ? `${formatSimClock(state.tS)} · ${simPhaseLabel(state.tS, state.warmupS, state.endS)}` : null;
  const total = state.robots.length;
  const caption = total > n ? `показано ${n} из ${total} ${pluralRu(total, ["робота", "роботов", "роботов"])}` : null;
  return { bots, routes, busy, clock, caption };
}

/** Подпись робота для всплывающей подсказки. */
export function botTitle(b: IsoBot): string {
  const what = b.glyph === "loaded" ? "везёт паллету" : b.glyph === "charging" ? "на зарядке" : "без груза";
  return `Робот ${b.id + 1} · ${what}`;
}

/**
 * Рисунок робота — паллетный AMR в манере рисунков роботов прототипа (64 × 64, основание на
 * y = 58): низкий корпус с подъёмной площадкой, датчик спереди, полоса-индикатор. Паллета с
 * коробками видна, когда робот везёт груз; молния — когда он на зарядке.
 */
const BOT_ART =
  '<g class="b-cargo"><rect class="b-wood" x="9" y="31" width="46" height="5" rx="1"/>' +
  '<rect class="b-box" x="11" y="14" width="21" height="17" rx="1"/><rect class="b-box" x="32" y="18" width="21" height="13" rx="1"/>' +
  '<rect class="b-box" x="16" y="4" width="20" height="10" rx="1"/><path class="b-tape" d="M21.5 14v17M42.5 18v13M26 4v10"/></g>' +
  '<rect class="b-dark" x="14" y="36.5" width="36" height="3" rx="1.2"/>' +
  '<path class="b-body" d="M12 39.5h40a4 4 0 0 1 4 4v7H8v-7a4 4 0 0 1 4-4z"/>' +
  '<rect class="b-glass" x="47" y="42.5" width="6" height="4.5" rx="1.2"/>' +
  '<rect class="b-led" x="14" y="44.2" width="15" height="2.4" rx="1.2"/>' +
  '<rect class="b-dark" x="7" y="50.5" width="50" height="4.5" rx="2"/>' +
  '<circle class="b-dark" cx="17" cy="55.5" r="2.8"/><circle class="b-dark" cx="47" cy="55.5" r="2.8"/>' +
  '<path class="b-bolt" d="M35 14 25 29h6.5L29 40l10-15h-6.5z"/>';

/** Спрайт робота, поставленный на точку (0, 0): тень и рисунок. */
export function botSprite(): string {
  return (
    '<ellipse class="iso-shadow" cx="0" cy="0" rx="10" ry="3.6"/>' +
    `<g transform="translate(${n1(-32 * BOT_K)} ${n1(-58 * BOT_K)}) scale(${BOT_K})">${BOT_ART}</g>`
  );
}

export function botMarkup(b: IsoBot): string {
  return `<g class="iso-bot" data-bot="${b.id}" data-glyph="${b.glyph}" transform="translate(${n1(b.x)} ${n1(b.y)})"><title>${botTitle(b)}</title>${botSprite()}</g>`;
}

export function routeMarkup(r: IsoRoute): string {
  return `<polyline class="iso-route" data-route="${r.id}" data-kind="${r.kind}" points="${r.points}"/>`;
}

/** Координаты подписей поверх схемы: часы — справа сверху, «показано N из M» — слева снизу. */
export function hudAnchors(g: IsoGeometry): { clock: { x: number; y: number }; caption: { x: number; y: number } } {
  return {
    clock: { x: g.vb.x + g.vb.w - 16, y: g.vb.y + 24 },
    caption: { x: g.vb.x + 10, y: g.vb.y + g.vb.h - 12 },
  };
}

export function viewBoxAttr(g: IsoGeometry): string {
  return [g.vb.x, g.vb.y, g.vb.w, g.vb.h].map(n1).join(" ");
}

/**
 * Схема целиком одной строкой SVG: статичная часть, роботы кадра, часы. Для PNG-выгрузки и
 * печатного отчёта; экран собирает ту же разметку, но роботов двигает по кадрам (iso-dom.ts).
 */
export function isoSceneSvg(
  layout: SimLayout,
  state: SimEngineState | null,
  opts: { style: "auto" | "light" | "none"; background?: string; label?: string; className?: string } = { style: "light" },
): string {
  const g = isoGeometry(layout);
  const frame = state ? isoFrame(layout, state, g) : null;
  const st = isoStaticMarkup(layout, g, new Set(frame?.busy ?? []));
  const hud = hudAnchors(g);
  const style = opts.style === "none" ? "" : `<style>${isoStyleSheet(opts.style)}</style>`;
  const bg = opts.background
    ? `<rect x="${n1(g.vb.x)}" y="${n1(g.vb.y)}" width="${n1(g.vb.w)}" height="${n1(g.vb.h)}" fill="${opts.background}"/>`
    : "";
  const title = opts.label ? `<title>${esc(opts.label)}</title>` : "";
  const aria = opts.label ? ` aria-label="${esc(opts.label)}"` : "";
  const cls = opts.className ? `iso-root ${esc(opts.className)}` : "iso-root";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="${viewBoxAttr(g)}" width="${n1(g.vb.w)}" height="${n1(g.vb.h)}" role="img"${aria}>` +
    title +
    style +
    bg +
    st.back +
    `<g class="iso-routes">${frame ? frame.routes.map(routeMarkup).join("") : ""}</g>` +
    `<g class="iso-bots">${frame ? frame.bots.map(botMarkup).join("") : ""}</g>` +
    st.front +
    (frame?.clock ? `<text class="iso-hud iso-hud--end iso-hud-clock" x="${n1(hud.clock.x)}" y="${n1(hud.clock.y)}">${frame.clock}</text>` : "") +
    (frame?.caption ? `<text class="iso-hud iso-hud-caption" x="${n1(hud.caption.x)}" y="${n1(hud.caption.y)}">${frame.caption}</text>` : "") +
    "</svg>"
  );
}

/**
 * Разметка схемы для экрана — содержимое <svg>: статичная часть, пустые слои путей и роботов и
 * пустые подписи часов, которые заполняет покадровое обновление (iso-dom.ts). Стили подключает
 * компонент один раз на страницу.
 */
export function isoScreenMarkup(layout: SimLayout, g: IsoGeometry): string {
  const st = isoStaticMarkup(layout, g);
  const hud = hudAnchors(g);
  return (
    st.back +
    '<g class="iso-routes"></g><g class="iso-bots"></g>' +
    st.front +
    `<text class="iso-hud iso-hud--end iso-hud-clock" x="${n1(hud.clock.x)}" y="${n1(hud.clock.y)}"></text>` +
    `<text class="iso-hud iso-hud-caption" x="${n1(hud.caption.x)}" y="${n1(hud.caption.y)}"></text>`
  );
}

// ——————————————————————————— Легенда ———————————————————————————

export type IsoSwatch =
  | { kind: "bot"; glyph: RobotGlyph }
  | { kind: "route"; route: IsoRoute["kind"] }
  | { kind: "pad"; busy: boolean }
  | { kind: "charger" }
  | { kind: "rack" }
  | { kind: "aisle" };

export type IsoLegendItem = { label: string; swatch: IsoSwatch };

/** Легенда схемы: одна для экрана, PNG-выгрузки и отчёта. */
export const ISO_LEGEND: readonly IsoLegendItem[] = [
  { label: "робот везёт паллету", swatch: { kind: "bot", glyph: "loaded" } },
  { label: "робот без груза", swatch: { kind: "bot", glyph: "empty" } },
  { label: "робот на зарядке (путь, ожидание, заряд)", swatch: { kind: "bot", glyph: "charging" } },
  { label: "оставшийся путь робота", swatch: { kind: "route", route: "loaded" } },
  { label: "ворота или зарядка свободны", swatch: { kind: "pad", busy: false } },
  { label: "у ворот или зарядки работает робот", swatch: { kind: "pad", busy: true } },
  { label: "зарядная станция", swatch: { kind: "charger" } },
  { label: "стеллажи", swatch: { kind: "rack" } },
  { label: "проезды — сеть маршрутов", swatch: { kind: "aisle" } },
];

/** Размер образца легенды, единицы viewBox. */
export const SWATCH_W = 30;
export const SWATCH_H = 22;

/** Разметка образца легенды внутри области SWATCH_W × SWATCH_H (без обёртки <svg>). */
export function isoSwatchMarkup(sw: IsoSwatch): string {
  switch (sw.kind) {
    case "bot":
      return `<g class="iso-bot" data-glyph="${sw.glyph}" transform="translate(15 20) scale(0.85)">${botSprite()}</g>`;
    case "route":
      return `<polyline class="iso-route" data-kind="${sw.route}" points="3,15 13,9 27,9" style="animation:none"/>`;
    case "pad":
      return `<polygon class="iso-pad" data-busy="${sw.busy ? 1 : 0}" points="15,5 27,11 15,17 3,11"/>`;
    case "charger":
      return (
        '<g class="iso-box iso-charger"><polygon class="s" points="9,19 17,21 17,8 9,6"/><polygon class="e" points="17,21 22,18 22,5 17,8"/>' +
        '<polygon class="t" points="9,6 17,8 22,5 14,3"/></g><polygon class="iso-bolt" points="13.6,9 11,14 13,14 12,18 15,12.5 13,12.5"/>'
      );
    case "rack":
      return (
        '<g class="iso-box iso-rack"><polygon class="s" points="3,15 13,19 13,12 3,8"/><polygon class="e" points="13,19 27,12 27,5 13,12"/>' +
        '<polygon class="t" points="3,8 13,12 27,5 17,1"/></g><line class="iso-shelf" x1="13" y1="15.5" x2="27" y2="8.5"/>'
      );
    case "aisle":
      return '<line class="iso-aisle" x1="3" y1="15" x2="27" y2="7"/>';
  }
}

// ——————————————————————————— Условная схема объекта без имитации ———————————————————————————

/** Пол условной схемы (аэропорт, медучреждение): нормированная планировка 0–1 растягивается на 100 × 56. */
const SCHEMATIC_W = 100;
const SCHEMATIC_H = 56;

/** Зона условной схемы в изометрии: коробка своей высоты и материала; «зона» (коридор) — тонированный пол. */
const ZONE_BOX: Readonly<Record<SceneZone["kind"], { h: number; mat: Material } | null>> = {
  dock: { h: 0.8, mat: "charger" },
  rack: { h: 2.2, mat: "rack" },
  gate: { h: 1.4, mat: "wall" },
  belt: { h: 1, mat: "belt" },
  room: { h: 2.4, mat: "wall" },
  zone: null,
};

/**
 * Условная схема объекта, для которого в модели нет имитации (аэропорт, медучреждение), — в той
 * же изометрии, что склад: пол-плита, зоны коробками, типовой маршрут робота бегущим пунктиром,
 * точки операций на нём и робот на первом плече. Размеры условные — схема, а не планировка.
 * `labelFor` возвращает подпись зоны или null, если зону не подписывать.
 */
export function isoSchematicSvg(
  layout: SceneLayout,
  opts: { label: string; labelFor: (z: SceneZone, i: number) => string | null; className?: string },
): string {
  const g = isoGeometryWH(SCHEMATIC_W, SCHEMATIC_H);
  const W = SCHEMATIC_W;
  const H = SCHEMATIC_H;
  const inset = 0.4;
  const tiles = layout.zones
    .filter((z) => ZONE_BOX[z.kind] === null)
    .map((z) => `<polygon class="iso-floor-receiving" points="${floorRect(g, z.x * W, z.y * H, z.w * W, z.h * H, 0.02)}"/>`)
    .join("");
  const boxes: Box[] = [];
  layout.zones.forEach((z) => {
    const spec = ZONE_BOX[z.kind];
    if (!spec) return;
    boxes.push({
      x: z.x * W + inset,
      y: z.y * H + inset,
      w: Math.max(0.2, z.w * W - 2 * inset),
      d: Math.max(0.2, z.h * H - 2 * inset),
      z0: 0,
      h: spec.h,
      mat: spec.mat,
    });
  });
  const boxesSvg = chop(boxes, 10)
    .sort((a, b) => depth(a) - depth(b))
    .map((b) => {
      if (b.mat !== "rack") return boxMarkup(g, b);
      let shelves = "";
      for (const zz of [b.h / 3, (2 * b.h) / 3]) {
        shelves += line(g, [b.x, b.y + b.d, zz], [b.x + b.w, b.y + b.d, zz], "iso-shelf");
        shelves += line(g, [b.x + b.w, b.y, zz], [b.x + b.w, b.y + b.d, zz], "iso-shelf");
      }
      return boxMarkup(g, b, shelves);
    })
    .join("");

  // Маршрут идёт туда и обратно: точки операций — его вершины без повторов.
  const route = layout.pathTemplate.map((p) => ({ x: p.x * W, y: p.y * H }));
  const points = route.filter((p, i, all) => all.findIndex((q) => q.x === p.x && q.y === p.y) === i);
  const pads = points
    .map((p) => `<polygon class="iso-pad" data-busy="0" points="${floorRect(g, p.x - PAD_M / 2, p.y - PAD_M / 2, PAD_M, PAD_M, 0.03)}"><title>Точка операции</title></polygon>`)
    .join("");
  const routeSvg =
    route.length > 1
      ? `<polyline class="iso-route" data-kind="loaded" points="${route
          .map((p) => {
            const q = isoPoint(g, p.x, p.y, 0.05);
            return `${n1(q.x)},${n1(q.y)}`;
          })
          .join(" ")}"/>`
      : "";
  const a = route[0];
  const b = route[1];
  const bot = a && b ? isoPoint(g, (a.x + b.x) / 2, (a.y + b.y) / 2, 0) : null;
  const botSvg = bot
    ? `<g class="iso-bot" data-glyph="loaded" transform="translate(${n1(bot.x)} ${n1(bot.y)})"><title>Робот на типовом маршруте</title>${botSprite()}</g>`
    : "";

  const labels = layout.zones
    .map((z, i) => {
      const text = opts.labelFor(z, i);
      if (!text) return "";
      const spec = ZONE_BOX[z.kind];
      const c = isoPoint(g, (z.x + z.w / 2) * W, (z.y + z.h / 2) * H, (spec?.h ?? 0) + 1.2);
      return `<text class="iso-label" x="${n1(c.x)}" y="${n1(c.y)}">${esc(text)}</text>`;
    })
    .join("");

  const cls = opts.className ? `iso-root ${esc(opts.className)}` : "iso-root";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="${viewBoxAttr(g)}" width="${n1(g.vb.w)}" height="${n1(g.vb.h)}" role="img" aria-label="${esc(opts.label)}">` +
    `<title>${esc(opts.label)}</title><style>${isoStyleSheet("auto")}</style>` +
    `<g class="iso-slab-g">${slabMarkup(g)}</g>` +
    `<polygon class="iso-floor-storage" points="${floorRect(g, 0, 0, W, H)}"/>` +
    tiles +
    gridMarkup(g) +
    `<g class="iso-walls">${backWalls(g, [])}</g>` +
    `<g class="iso-boxes">${boxesSvg}</g>` +
    // Маршрут и точки — поверх зон: на условной схеме это главное, и лента или выходы не должны их прятать.
    `<g class="iso-pads">${pads}</g>` +
    `<g class="iso-routes">${routeSvg}</g>` +
    `<g class="iso-bots">${botSvg}</g>` +
    `<g class="iso-front">${frontFacade(g, [])}</g>` +
    `<g class="iso-labels" pointer-events="none">${labels}</g>` +
    "</svg>"
  );
}

/** Образец зоны условной схемы для легенды (без обёртки <svg>, область SWATCH_W × SWATCH_H). */
export function isoZoneSwatchMarkup(kind: SceneZone["kind"]): string {
  const spec = ZONE_BOX[kind];
  if (!spec) return '<polygon class="iso-floor-receiving" points="15,5 27,11 15,17 3,11"/>';
  return (
    `<g class="iso-box iso-${spec.mat}"><polygon class="s" points="3,15 13,19 13,12 3,8"/><polygon class="e" points="13,19 27,12 27,5 13,12"/>` +
    '<polygon class="t" points="3,8 13,12 27,5 17,1"/></g>'
  );
}
