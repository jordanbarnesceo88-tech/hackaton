import { LAYOUT_ASSUMPTIONS } from "@/lib/sim/layout";
import type { SimEngineState } from "@/lib/sim/state";
import type { OpPoint, RobotPhase, SimLayout } from "@/lib/sim/types";

/**
 * Отрисовка схемы склада для имитации (ТЗ §3.6.1: типовые зоны, маршруты, роботы, точки
 * операций и зарядка). Одна функция рисует и экран, и PNG-выгрузку (§3.7.4), поэтому картинка в
 * отчёте не может разойтись с тем, что видно на странице.
 *
 * Координаты планировки — метры от левого нижнего угла (ось Y вверх), координаты канвы — пиксели
 * от левого верхнего (ось Y вниз): при переводе ось Y переворачивается.
 *
 * Модуль не трогает DOM при импорте — вспомогательные функции проверяются unit-тестами в Node.
 */

/** Фон схемы — тот же, что у схемы объекта модели v1 (цвета холста сохранены). */
export const SCENE_BG = "#0f172a";

/**
 * Палитра зон — значения скопированы из `ZONE_COLORS` в components/facility-visualization.tsx
 * (файл v1 заморожен, поэтому копия, а не импорт).
 */
export const ZONE_PALETTE = {
  rack: "#94a3b8",
  gate: "#a5b4fc",
  belt: "#fbbf24",
  room: "#86efac",
  zone: "#93c5fd",
  dock: "#f472b6",
} as const;

/** Цвет зоны схемы по её виду. */
export const ZONE_COLORS: Readonly<Record<SimLayout["zones"][number]["kind"], string>> = {
  receiving: ZONE_PALETTE.zone,
  storage: ZONE_PALETTE.rack,
  shipping: ZONE_PALETTE.room,
  charging: ZONE_PALETTE.belt,
};

/** Цвет роботов — тот же голубой, что в схеме v1. */
export const ROBOT_COLOR = "#22d3ee";
/**
 * Цвет значка «на зарядке». Не голубой, чтобы состояние различалось и цветом, и формой, и не
 * янтарный, как сама зарядная станция, — иначе значок сливался бы с ней.
 */
export const CHARGING_ROBOT_COLOR = "#fde047";
/** Ворота приёмки и отгрузки (точки операций). */
export const DOCK_COLOR = ZONE_PALETTE.dock;
/** Зарядные станции. */
export const CHARGER_COLOR = ZONE_PALETTE.belt;
/** Осевые линии проездов — маршруты роботов. Нейтральный серый, как запасной цвет схемы v1. */
export const ROUTE_COLOR = "#64748b";
/** Цвет подписей в полях схемы (часы, «показано N из M»). */
export const CAPTION_COLOR = "#cbd5e1";

/** Шрифт схемы. Системный набор с кириллицей: веб-шрифты страницы канва может не успеть загрузить. */
export const SCENE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Сколько роботов рисовать. Больше 60 значков на схеме шириной в колонку сливаются в пятно;
 * тогда рисуются первые 60 по номеру, а в поле схемы пишется «показано 60 из M».
 */
export const MAX_DRAWN_ROBOTS = 60;

/** Сколько роботов из `count` будет нарисовано. */
export function robotsToDraw(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), MAX_DRAWN_ROBOTS);
}

/** Значок робота: закрашенный квадрат — с грузом, полый круг — без груза, молния — зарядка. */
export type RobotGlyph = "loaded" | "empty" | "charging";

/**
 * Значок робота по фазе. Зарядкой считается и путь к станции, и ожидание её, и сам заряд — как
 * в показателе «Зарядка» сводки. В остальных фазах форму задаёт наличие груза: робот,
 * ожидающий у ворот с паллетой, рисуется квадратом, без неё — кругом.
 */
export function robotGlyph(phase: RobotPhase, loaded: boolean): RobotGlyph {
  if (phase === "toCharger" || phase === "waitCharger" || phase === "charging") return "charging";
  return loaded ? "loaded" : "empty";
}

/** Цвет значка робота. */
export function glyphColor(glyph: RobotGlyph): string {
  return glyph === "charging" ? CHARGING_ROBOT_COLOR : ROBOT_COLOR;
}

/**
 * Ширина главного и стеллажного проходов, восстановленная по планировке: оси поперечных проездов
 * стоят на main/2 от стены, а шаг стеллажных проходов равен ширине прохода плюс двойной ряд
 * стеллажей (`LAYOUT_ASSUMPTIONS.rackRowDepthM`). Так схему можно нарисовать без входа прогона.
 * При одном стеллажном проходе его ширина неизвестна — берётся ширина главного проезда.
 */
export function aisleWidths(layout: SimLayout): { mainM: number; rackM: number } {
  const first = layout.crossAislesY[0];
  const mainM = first !== undefined && first > 0 ? 2 * first : 0;
  const x0 = layout.rackAislesX[0];
  const x1 = layout.rackAislesX[1];
  const rackM =
    x0 !== undefined && x1 !== undefined && x1 - x0 > LAYOUT_ASSUMPTIONS.rackRowDepthM
      ? x1 - x0 - LAYOUT_ASSUMPTIONS.rackRowDepthM
      : mainM;
  return { mainM, rackM };
}

/** Перевод метров планировки в пиксели канвы: px = ox + x·k, py = oy + (heightM − y)·k. */
export type SceneGeometry = {
  /** Пикселей на метр. */
  k: number;
  ox: number;
  oy: number;
  /** Высота планировки, м (для переворота оси Y). */
  heightM: number;
  /** Высота полосы подписей над схемой и под ней, px (0 без подписей). */
  band: number;
};

/**
 * Геометрия схемы в области W × H: планировка вписывается с сохранением пропорций и
 * центрируется; сверху и снизу остаются полосы для подписей зон, часов и примечаний, чтобы
 * подписи не закрывали роботов.
 */
export function sceneGeometry(layout: SimLayout, W: number, H: number, scale = 1, labels = true): SceneGeometry {
  const pad = 6 * scale;
  const band = labels ? 16 * scale : 0;
  const availW = Math.max(1, W - 2 * pad);
  const availH = Math.max(1, H - 2 * pad - 2 * band);
  const wM = layout.widthM > 0 ? layout.widthM : 1;
  const hM = layout.heightM > 0 ? layout.heightM : 1;
  const k = Math.min(availW / wM, availH / hM);
  return {
    k,
    ox: pad + (availW - wM * k) / 2,
    oy: pad + band + (availH - hM * k) / 2,
    heightM: hM,
    band,
  };
}

/** Точка планировки (м) в пикселях канвы. */
export function toPx(g: SceneGeometry, x: number, y: number): { px: number; py: number } {
  return { px: g.ox + x * g.k, py: g.oy + (g.heightM - y) * g.k };
}

/**
 * Смещение робота, стоящего в очереди к точке, в долях размера значка: очередь вытягивается от
 * ворот внутрь склада (от приёмки — вправо, от отгрузки — влево), от зарядки — вправо. Так
 * очередь у ворот видна на схеме, а не складывается в один значок. `index` — место в очереди
 * среди стоящих у точки (0 — первый за работающим).
 */
export function queueOffset(kind: OpPoint["kind"], index: number): { dx: number; dy: number } {
  const step = 1.3 * (index + 1);
  return kind === "shipping" ? { dx: -step, dy: 0 } : { dx: step, dy: 0 };
}

/** Часы модели «чч:мм» от начала прогона (прогрев + пик). */
export function formatSimClock(tS: number): string {
  const t = Number.isFinite(tS) && tS > 0 ? Math.floor(tS) : 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Фаза прогона для подписи часов. */
export function simPhaseLabel(tS: number, warmupS: number, endS: number): string {
  if (tS >= endS) return "окончен";
  return tS < warmupS ? "прогрев" : "пик";
}

/** Параметры отрисовки. */
export type DrawSceneOptions = {
  /** Логическая ширина области, px (CSS-пиксели). */
  W: number;
  /** Логическая высота области, px. */
  H: number;
  /** Плотность пикселей буфера: 1–3 на экране, 2 в PNG-выгрузке. */
  dpr: number;
  /** Множитель размеров значков и шрифтов (1 на экране; в PNG — крупнее для печати). */
  scale?: number;
  /** Рисовать подписи зон и поля с часами (по умолчанию да). */
  labels?: boolean;
  /** Смещение области в логических пикселях — для размещения схемы внутри PNG. */
  x?: number;
  y?: number;
};

type Ctx = CanvasRenderingContext2D;

function font(size: number, weight = 600): string {
  return `${weight} ${size}px ${SCENE_FONT_FAMILY}`;
}

/** Молния с центром (cx, cy) высотой s. */
function boltPath(ctx: Ctx, cx: number, cy: number, s: number): void {
  const pts: [number, number][] = [
    [0.12, -0.5],
    [-0.32, 0.08],
    [-0.02, 0.08],
    [-0.12, 0.5],
    [0.32, -0.08],
    [0.02, -0.08],
  ];
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(cx + x * s, cy + y * s);
    else ctx.lineTo(cx + x * s, cy + y * s);
  });
  ctx.closePath();
}

/** Значок робота с центром (cx, cy) размером s. */
export function drawRobotGlyph(ctx: Ctx, glyph: RobotGlyph, cx: number, cy: number, s: number): void {
  const color = glyphColor(glyph);
  ctx.lineWidth = Math.max(1, s / 5);
  if (glyph === "loaded") {
    ctx.fillStyle = color;
    ctx.strokeStyle = SCENE_BG;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  } else if (glyph === "empty") {
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fillStyle = SCENE_BG;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    boltPath(ctx, cx, cy, s * 1.5);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = SCENE_BG;
    ctx.lineWidth = Math.max(1, s / 6);
    ctx.stroke();
  }
}

/** Маркер ворот: закрашен, когда у ворот работает робот. */
export function drawDockMarker(ctx: Ctx, cx: number, cy: number, s: number, busy: boolean): void {
  ctx.lineWidth = Math.max(1, s / 6);
  ctx.strokeStyle = DOCK_COLOR;
  // Свободные ворота залиты фоном, чтобы осевая линия проезда под ними не читалась как точка.
  ctx.fillStyle = busy ? DOCK_COLOR : SCENE_BG;
  ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
}

/** Маркер зарядной станции: янтарный квадрат с молнией внутри. */
export function drawChargerMarker(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.lineWidth = Math.max(1, s / 6);
  ctx.strokeStyle = CHARGER_COLOR;
  ctx.fillStyle = SCENE_BG;
  ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  boltPath(ctx, cx, cy, s * 0.7);
  ctx.fillStyle = CHARGER_COLOR;
  ctx.fill();
}

/** Стеллажи и проезды внутри зоны хранения. */
function drawStorage(ctx: Ctx, layout: SimLayout, g: SceneGeometry, zone: SimLayout["zones"][number]): void {
  const { mainM, rackM } = aisleWidths(layout);
  const halfRow = LAYOUT_ASSUMPTIONS.rackRowDepthM / 2;
  const xs = layout.rackAislesX;
  // Полосы стеллажей по X: двойные ряды между соседними проходами и одинарные с внешней стороны
  // крайних проходов (проход обслуживает стеллажи с обеих сторон).
  const rows: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const left = x - rackM / 2;
    const right = x + rackM / 2;
    if (i === 0) rows.push([left - halfRow, left]);
    const next = xs[i + 1];
    if (next !== undefined) rows.push([right, next - rackM / 2]);
    else rows.push([right, right + halfRow]);
  }
  // Полосы стеллажей по Y: всё, кроме полос поперечных проездов.
  const bands: [number, number][] = [];
  const cuts = [...layout.crossAislesY].sort((a, b) => a - b);
  let y0 = zone.y;
  for (const c of cuts) {
    const lo = c - mainM / 2;
    if (lo > y0) bands.push([y0, lo]);
    y0 = Math.max(y0, c + mainM / 2);
  }
  if (zone.y + zone.h > y0) bands.push([y0, zone.y + zone.h]);

  ctx.fillStyle = ZONE_PALETTE.rack;
  ctx.globalAlpha = 0.5;
  for (const [xa, xb] of rows) {
    const x0 = Math.max(zone.x, xa);
    const x1 = Math.min(zone.x + zone.w, xb);
    if (x1 <= x0) continue;
    for (const [ya, yb] of bands) {
      const a = toPx(g, x0, yb);
      const b = toPx(g, x1, ya);
      ctx.fillRect(a.px, a.py, b.px - a.px, b.py - a.py);
    }
  }
  ctx.globalAlpha = 1;
}

/** Осевые линии проездов — сеть маршрутов, по которой ездят роботы. */
function drawRoutes(ctx: Ctx, layout: SimLayout, g: SceneGeometry, scale: number): void {
  const cross = layout.crossAislesY;
  if (cross.length === 0) return;
  const yLo = Math.min(...cross);
  const yHi = Math.max(...cross);
  const xLeft = layout.receiving[0]?.x ?? 0;
  const xRight = layout.shipping[0]?.x ?? layout.widthM;
  ctx.save();
  ctx.strokeStyle = ROUTE_COLOR;
  ctx.lineWidth = Math.max(1, scale);
  ctx.setLineDash([3 * scale, 3 * scale]);
  ctx.beginPath();
  for (const y of cross) {
    const a = toPx(g, xLeft, y);
    const b = toPx(g, xRight, y);
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
  }
  for (const x of [xLeft, ...layout.rackAislesX, xRight]) {
    const a = toPx(g, x, yHi);
    const b = toPx(g, x, yLo);
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
  }
  ctx.stroke();
  ctx.restore();
}

/** Подпись в полосе над схемой или под ней; возвращает занятый отрезок по X. */
function bandLabel(
  ctx: Ctx,
  text: string,
  centerX: number,
  y: number,
  W: number,
  minX: number,
  color: string,
  size: number,
): number {
  ctx.font = font(size);
  const w = ctx.measureText(text).width;
  let x = centerX - w / 2;
  if (x < minX) x = minX;
  if (x + w > W - 2) x = Math.max(minX, W - 2 - w);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x, y);
  return x + w;
}

/**
 * Рисует схему склада и, если передано состояние прогона, точки операций с занятостью и роботов.
 * Без состояния (прогон ещё идёт) рисуется пустая планировка — зоны, стеллажи и проезды.
 *
 * Функция сама выставляет трансформацию `setTransform(dpr, …, x·dpr, y·dpr)` и восстанавливает
 * контекст по окончании, поэтому её можно вызывать и для экранной канвы, и для области внутри
 * PNG-выгрузки.
 */
export function drawScene(ctx: Ctx, layout: SimLayout, state: SimEngineState | null, opts: DrawSceneOptions): void {
  const { W, H, dpr } = opts;
  const scale = opts.scale ?? 1;
  const labels = opts.labels ?? true;
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = SCENE_BG;
  ctx.fillRect(0, 0, W, H);

  const g = sceneGeometry(layout, W, H, scale, labels);

  // Зоны: слабая заливка и контур, чтобы роботы на тёмном фоне оставались заметны.
  for (const z of layout.zones) {
    const a = toPx(g, z.x, z.y + z.h);
    const w = z.w * g.k;
    const h = z.h * g.k;
    ctx.fillStyle = ZONE_COLORS[z.kind];
    ctx.globalAlpha = z.kind === "storage" ? 0.08 : 0.18;
    ctx.fillRect(a.px, a.py, w, h);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = ZONE_COLORS[z.kind];
    ctx.lineWidth = 1;
    ctx.strokeRect(a.px + 0.5, a.py + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.globalAlpha = 1;
    if (z.kind === "storage") drawStorage(ctx, layout, g, z);
  }

  drawRoutes(ctx, layout, g, scale);

  // Размеры значков: ворота ≈ 2,2 м, робот ≈ 1,8 м в масштабе схемы, но не мельче, чем
  // различимо глазом, и не крупнее, чем помещается между стеллажами.
  const markerS = Math.min(14, Math.max(7, g.k * 2.2)) * scale;
  const robotS = Math.min(12, Math.max(6, g.k * 1.8)) * scale;

  // Точки операций. Занятость ворот берётся из состояния прогона.
  const busy = new Set<string>();
  if (state) {
    for (const p of state.points) if (p.holder !== null) busy.add(p.id);
  }
  for (const p of [...layout.receiving, ...layout.shipping]) {
    const { px, py } = toPx(g, p.x, p.y);
    drawDockMarker(ctx, px, py, markerS, busy.has(p.id));
  }
  for (const p of layout.chargers) {
    const { px, py } = toPx(g, p.x, p.y);
    drawChargerMarker(ctx, px, py, markerS);
  }

  let drawn = 0;
  if (state) {
    const n = robotsToDraw(state.robots.length);
    // Роботы, стоящие в очереди к точке, смещаются от неё по порядку очереди (считаются только
    // нарисованные — иначе в очереди были бы пропуски).
    const offsets = new Map<number, { dx: number; dy: number }>();
    for (const p of state.points) {
      let k = 0;
      for (const id of p.queue) {
        const r = state.robots[id];
        if (!r || id >= n || (r.phase !== "waitPoint" && r.phase !== "waitCharger")) continue;
        offsets.set(id, queueOffset(p.kind, k));
        k++;
      }
    }
    for (let i = 0; i < n; i++) {
      const r = state.robots[i]!;
      const { px, py } = toPx(g, r.x, r.y);
      const off = offsets.get(r.id);
      const cx = px + (off ? off.dx * robotS : 0);
      const cy = py + (off ? off.dy * robotS : 0);
      drawRobotGlyph(ctx, robotGlyph(r.phase, r.loaded), cx, cy, robotS);
    }
    drawn = n;
  }

  if (labels) {
    const size = 11 * scale;
    const topY = g.oy - g.band / 2;
    const bottomY = g.oy + g.heightM * g.k + g.band / 2;
    const topZones = layout.zones.filter((z) => z.y + z.h >= layout.heightM - 1e-6);
    const bottomZones = layout.zones.filter((z) => !(z.y + z.h >= layout.heightM - 1e-6));
    let minX = 2;
    for (const z of [...topZones].sort((a, b) => a.x - b.x)) {
      const c = toPx(g, z.x + z.w / 2, 0).px;
      minX = bandLabel(ctx, z.label, c, topY, W, minX, ZONE_COLORS[z.kind], size) + 8 * scale;
    }
    minX = 2;
    for (const z of [...bottomZones].sort((a, b) => a.x - b.x)) {
      const c = toPx(g, z.x + z.w / 2, 0).px;
      minX = bandLabel(ctx, z.label, c, bottomY, W, minX, ZONE_COLORS[z.kind], size) + 8 * scale;
    }
    ctx.font = font(size, 500);
    ctx.fillStyle = CAPTION_COLOR;
    ctx.textBaseline = "middle";
    if (state && state.robots.length > drawn) {
      ctx.textAlign = "center";
      ctx.fillText(`показано ${drawn} из ${state.robots.length} роботов`, W / 2, bottomY);
    }
    // Часы — только у выполненного прогона: вход, отклонённый предварительной проверкой
    // (грузоподъёмность, вне модели), не двигался, и «00:00 · прогрев» вводило бы в заблуждение.
    if (state && state.precheck === "ok") {
      ctx.textAlign = "right";
      ctx.fillText(
        `${formatSimClock(state.tS)} · ${simPhaseLabel(state.tS, state.warmupS, state.endS)}`,
        W - 4 * scale,
        bottomY,
      );
    }
    ctx.textAlign = "left";
  }

  ctx.restore();
}

/** Элемент легенды: подпись и что рисовать. */
export type LegendItem = {
  label: string;
  swatch:
    | { kind: "robot"; glyph: RobotGlyph }
    /** Ворота: полый квадрат — свободны, закрашенный — у ворот работает робот. */
    | { kind: "dock"; busy: boolean }
    | { kind: "charger" }
    | { kind: "route" }
    | { kind: "zone"; color: string };
};

/** Легенда схемы: одна для экрана (sim-legend.tsx) и для PNG-выгрузки. */
export const LEGEND_ITEMS: readonly LegendItem[] = [
  { label: "робот с грузом", swatch: { kind: "robot", glyph: "loaded" } },
  { label: "робот без груза", swatch: { kind: "robot", glyph: "empty" } },
  { label: "робот на зарядке (путь, ожидание, заряд)", swatch: { kind: "robot", glyph: "charging" } },
  { label: "ворота приёмки и отгрузки свободны", swatch: { kind: "dock", busy: false } },
  { label: "у ворот работает робот", swatch: { kind: "dock", busy: true } },
  { label: "зарядная станция", swatch: { kind: "charger" } },
  { label: "проезды — маршруты роботов", swatch: { kind: "route" } },
  { label: "приёмка", swatch: { kind: "zone", color: ZONE_COLORS.receiving } },
  { label: "хранение (стеллажи)", swatch: { kind: "zone", color: ZONE_COLORS.storage } },
  { label: "отгрузка", swatch: { kind: "zone", color: ZONE_COLORS.shipping } },
  { label: "зарядка", swatch: { kind: "zone", color: ZONE_COLORS.charging } },
];

/** Образец элемента легенды с центром (cx, cy) размером s — для PNG-выгрузки. */
export function drawLegendSwatch(ctx: Ctx, item: LegendItem, cx: number, cy: number, s: number): void {
  const sw = item.swatch;
  if (sw.kind === "robot") drawRobotGlyph(ctx, sw.glyph, cx, cy, s);
  else if (sw.kind === "dock") drawDockMarker(ctx, cx, cy, s * 1.2, sw.busy);
  else if (sw.kind === "charger") drawChargerMarker(ctx, cx, cy, s * 1.3);
  else if (sw.kind === "route") {
    ctx.save();
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = Math.max(1, s / 6);
    ctx.setLineDash([s / 3, s / 3]);
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.lineTo(cx + s, cy);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.fillStyle = sw.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(cx - s * 0.7, cy - s / 2, s * 1.4, s);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = sw.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - s * 0.7, cy - s / 2, s * 1.4, s);
  }
}
