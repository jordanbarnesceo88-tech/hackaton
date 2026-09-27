// Набор для рисунков тура: линии «от руки» (rough.js) и рукописные подписи, переведённые в
// контуры (opentype.js), — готовый SVG не зависит от шрифтов и одинаков во всех браузерах.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import rough from "roughjs";
import opentype from "opentype.js";

export const W = 1600, H = 900;
export const INK = "#1b1b1b";
export const RED = "#d8392c";
export const ORANGE = "#ee7a16";
export const BLUE = "#2e6bd0";

// Шрифты (OFL) не хранятся в репозитории: скачиваются один раз в кэш node_modules.
const FONT_DIR = new URL("../../node_modules/.cache/illustrations/", import.meta.url);
const FONTS = {
  "Neucha.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/neucha/Neucha.ttf",
  "Pangolin-Regular.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/pangolin/Pangolin-Regular.ttf",
};
let font, fallback;

export async function loadFonts() {
  mkdirSync(FONT_DIR, { recursive: true });
  for (const [name, url] of Object.entries(FONTS)) {
    const file = new URL(name, FONT_DIR);
    if (existsSync(file)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`не скачался шрифт ${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  font = opentype.loadSync(fileURLToPath(new URL("Neucha.ttf", FONT_DIR)));
  // В Neucha нет ², ×, ₽ — эти знаки берутся из Pangolin.
  fallback = opentype.loadSync(fileURLToPath(new URL("Pangolin-Regular.ttf", FONT_DIR)));
}

function runs(str) {
  const out = [];
  for (const ch of str) {
    const f = font.charToGlyphIndex(ch) > 0 || ch === " " ? font : fallback;
    if (out.length && out[out.length - 1].f === f) out[out.length - 1].s += ch;
    else out.push({ f, s: ch });
  }
  return out;
}

export function measure(str, size) {
  return runs(str).reduce((w, r) => w + r.f.getAdvanceWidth(r.s, size), 0);
}

const gen = rough.generator();

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (d) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(+n * 10) / 10));

/** Одна картинка. Все случайности — от seed, поэтому пересборка даёт тот же файл. */
export class Scene {
  constructor(seed = 1, { w = W, h = H } = {}) {
    this.w = w;
    this.h = h;
    this.parts = [];
    this.seed = seed * 101;
    this.rand = mulberry32(seed * 7 + 3);
  }
  nextSeed() { return ++this.seed; }
  opts(o = {}) {
    return {
      roughness: 0.85, bowing: 0.7, stroke: INK, strokeWidth: 3.4,
      disableMultiStroke: true, disableMultiStrokeFill: true,
      hachureGap: 11, fillWeight: 1.6, hachureAngle: -40,
      seed: this.nextSeed(), ...o,
    };
  }
  push(drawable) {
    const dash = drawable.options.strokeLineDash;
    for (const p of gen.toPaths(drawable)) {
      const fill = p.fill && p.fill !== "none" ? p.fill : "none";
      const stroke = p.stroke && p.stroke !== "none" ? p.stroke : "none";
      this.parts.push(`<path d="${fmt(p.d)}" fill="${fill}" stroke="${stroke}"${stroke !== "none" ? ` stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash.join(" ")}"` : ""}` : ""}/>`);
    }
    return this;
  }
  raw(s) { this.parts.push(s); return this; }
  line(x1, y1, x2, y2, o) { return this.push(gen.line(x1, y1, x2, y2, this.opts(o))); }
  lines(pts, o) { return this.push(gen.linearPath(pts, this.opts(o))); }
  curve(pts, o) { return this.push(gen.curve(pts, this.opts(o))); }
  rect(x, y, w, h, o) { return this.push(gen.rectangle(x, y, w, h, this.opts(o))); }
  poly(pts, o) { return this.push(gen.polygon(pts, this.opts(o))); }
  ellipse(cx, cy, w, h, o) { return this.push(gen.ellipse(cx, cy, w, h, this.opts(o))); }
  circle(cx, cy, d, o) { return this.push(gen.circle(cx, cy, d, this.opts(o))); }
  arc(cx, cy, w, h, a0, a1, o) { return this.push(gen.arc(cx, cy, w, h, a0, a1, false, this.opts(o))); }
  path(d, o) { return this.push(gen.path(d, this.opts(o))); }
  /** Белая заливка без контура — прячет линии за предметом переднего плана. */
  mask(pts) { this.parts.push(`<path d="M${pts.map((p) => p.join(" ")).join("L")}Z" fill="#fff"/>`); return this; }
  maskEllipse(cx, cy, w, h) { this.parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="#fff"/>`); return this; }
  /** Штриховка внутри многоугольника, без контура. */
  hatch(pts, o = {}) { return this.push(gen.polygon(pts, this.opts({ stroke: "none", fill: INK, fillStyle: "hachure", ...o }))); }

  text(str, x, y, { size = 56, color = INK, anchor = "start", rotate = 0 } = {}) {
    const w = measure(str, size);
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    let d = "", cx = x0;
    for (const r of runs(str)) {
      d += fmt(r.f.getPath(r.s, cx, y, size).toPathData(1));
      cx += r.f.getAdvanceWidth(r.s, size);
    }
    const t = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : "";
    this.parts.push(`<path d="${d}" fill="${color}"${t}/>`);
    return { x0, x1: x0 + w, w };
  }

  /** Кривая стрелка через точки с открытым наконечником. */
  arrow(pts, { color = ORANGE, width = 3.6, head = 24, spread = 0.5, o = {} } = {}) {
    this.curve(pts, { stroke: color, strokeWidth: width, roughness: 0.7, ...o });
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (const s of [-spread, spread]) {
      this.line(b[0], b[1], b[0] - head * Math.cos(ang + s), b[1] - head * Math.sin(ang + s), { stroke: color, strokeWidth: width, roughness: 0.5 });
    }
    return this;
  }

  /**
   * Xiaohei: чёрное тело с чуть неровным контуром «от руки», белые точки глаз, тонкие руки и
   * ноги. arms/legs — списки точек от края тела к кисти/ступне.
   */
  xiaohei({ cx, cy, w = 90, h = 116, look = [0, 0], eyeGap = 15, eyeY = -0.2, arms = [], legs = [], feet = true, hands = true, tilt = 0 }) {
    const n = 14, pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const e = 2.35; // суперэллипс: чуть угловатее овала
      let x = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * (w / 2);
      let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * (h / 2);
      if (y < 0) x *= 0.9 + 0.1 * (1 + y / (h / 2)); // верх уже низа — «боб»
      const j = 1 + (this.rand() - 0.5) * 0.06;
      x *= j; y *= j;
      const r = (tilt * Math.PI) / 180;
      pts.push([cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]);
    }
    // замкнутый сплайн Кэтмелла — Рома через точки контура
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1.map((v) => v.toFixed(1)).join(" ")} ${c2.map((v) => v.toFixed(1)).join(" ")} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    d += "Z";
    for (const l of legs) {
      this.curve(l, { strokeWidth: 3.4, roughness: 0.6 });
      if (feet) {
        const [ex, ey] = l[l.length - 1];
        const dir = l[l.length - 1][0] >= l[0][0] ? 1 : -1;
        this.line(ex - dir * 3, ey, ex + dir * 15, ey + 1, { strokeWidth: 3.4, roughness: 0.4 });
      }
    }
    for (const a of arms) {
      this.curve(a, { strokeWidth: 3.2, roughness: 0.6 });
      if (hands) { const [hx, hy] = a[a.length - 1]; this.raw(`<ellipse cx="${hx}" cy="${hy}" rx="6.5" ry="5.5" fill="${INK}"/>`); }
    }
    this.raw(`<path d="${d}" fill="${INK}"/>`);
    this.path(d, { strokeWidth: 3, roughness: 0.7, bowing: 0.4 });
    const ey = cy + h * eyeY + look[1];
    for (const sx of [-1, 1]) this.raw(`<ellipse cx="${(cx + sx * eyeGap + look[0]).toFixed(1)}" cy="${ey.toFixed(1)}" rx="6" ry="7" fill="#fff"/>`);
    return this;
  }

  svg() {
    const { w, h } = this;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><!-- собрано scripts/illustrations/build.mjs — правится там, не здесь --><rect width="${w}" height="${h}" fill="#fff"/>${this.parts.join("")}</svg>\n`;
  }
}
