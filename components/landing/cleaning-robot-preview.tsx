"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IsoStyles } from "@/components/sim/sim-iso-scene";
import { useReducedMotion } from "@/components/sim/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Полоса во всю ширину первой страницы: один робот проходит торговый зал полосами между
 * стеллажами и возвращается на базу, убранный пол подсвечивается следом. Схема условная;
 * полная сцена с парком, зарядкой и диспетчерской — отдельная страница /demo/cleaning
 * (≈4 МБ, на первую страницу её не тянем, а встроить во фрейм не даёт frame-ancestors 'none').
 *
 * Проекция фронтальная (кабинетная), а не изометрия схемы склада: изометрия всегда около 2 : 1 и
 * в широкую низкую полосу не ложится, а здесь пропорцию задают размеры зала. Палитра и материалы —
 * из таблицы стилей изометрии (IsoStyles). Схема вписывается в высоту, которую ей оставила
 * страница; кадры двигают DOM напрямую и React-состояние не трогают. Вне экрана цикл стоит; при
 * «уменьшить движение» показан конечный кадр; кнопка «Пауза» — для остальных (движение дольше
 * 5 секунд, WCAG 2.2.2).
 */

/** Зал, м: x — вдоль экрана, y — от дальней стены к зрителю. */
const W = 28;
const H = 9;
/** Единиц viewBox на метр. */
const S = 40;
/** Сдвиг вправо на метр глубины и сжатие глубины. */
const DX = 0.45;
const DY = 0.55;
/** Ширина полосы уборки, м. */
const BRUSH_M = 0.7;
/** Отступ центра робота от стеллажей и стен, м. */
const CLEARANCE_M = 0.4;
/** Скорость показа, м/с: это темп схемы, не паспорт робота. */
const SPEED_MPS = 10;
/** Пауза на базе перед новым кругом, с. */
const HOLD_S = 2.5;
const WALL_H = 0.6;
const SLAB_H = 0.25;

type P = { x: number; y: number };
type Box = { x: number; y: number; w: number; d: number; h: number; mat: "rack" | "charger" };

/** Точка зала на экране: дальнее — выше и правее. */
function proj(x: number, y: number, z = 0): P {
  return { x: (x + (H - y) * DX) * S, y: (y * DY - z) * S };
}

function n1(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
}

function pts(list: readonly [number, number, number][]): string {
  return list.map(([x, y, z]) => {
    const p = proj(x, y, z);
    return `${n1(p.x)},${n1(p.y)}`;
  }).join(" ");
}

/**
 * Три ряда низких стеллажей вдоль зала, у торцов свободный проезд; куски по 3,2 м, чтобы порядок
 * отрисовки не ошибался у соседей. Высота занижена нарочно: стеллаж в рост закрывал бы робота
 * в проходе за ним.
 */
const SHELF_ROWS = [2.0, 4.2, 6.4];
const SHELF_X0 = 4.5;
const SHELF_PIECE = 3.2;
const SHELF_D = 0.8;
const SHELVES: Box[] = SHELF_ROWS.flatMap((y) =>
  [0, 1, 2, 3, 4, 5].map((i) => ({ x: SHELF_X0 + i * SHELF_PIECE, y, w: SHELF_PIECE, d: SHELF_D, h: 0.45, mat: "rack" as const })),
);
const CHARGER: Box = { x: 0.1, y: 0.3, w: 0.5, d: 0.8, h: 0.5, mat: "charger" };
/** Глубина для порядка отрисовки: ближе к зрителю — позже. */
const depthOf = (b: Box) => b.y + b.d / 2;
const BOXES = [...SHELVES, CHARGER].sort((a, b) => depthOf(a) - depthOf(b));
const DOCK: P = { x: 1.0, y: 0.7 };

/** Полосы «змейкой» по свободным проходам, проезд между полосами — у торцов стеллажей. */
function buildRoute(): { route: P[]; cleanEnd: number } {
  const free: [number, number][] = [];
  let y0 = 0;
  for (const y of SHELF_ROWS) {
    free.push([y0, y]);
    y0 = y + SHELF_D;
  }
  free.push([y0, H]);
  const stripes: number[] = [];
  for (const [a, b] of free) {
    const span = b - a - 2 * CLEARANCE_M;
    const n = Math.max(1, Math.ceil(span / BRUSH_M) + 1);
    for (let i = 0; i < n; i++) stripes.push(a + CLEARANCE_M + (n === 1 ? span / 2 : (span * i) / (n - 1)));
  }
  const left = DOCK.x + 0.2;
  const right = W - CLEARANCE_M;
  const route: P[] = [DOCK];
  stripes.forEach((y, i) => {
    const [from, to] = i % 2 === 0 ? [left, right] : [right, left];
    route.push({ x: from, y }, { x: to, y });
  });
  const cleanEnd = route.length - 1;
  const last = route[cleanEnd]!;
  if (last.x !== left) route.push({ x: left, y: last.y });
  route.push({ x: left, y: DOCK.y }, DOCK);
  return { route, cleanEnd };
}

const { route: ROUTE, cleanEnd: CLEAN_END_IDX } = buildRoute();
const CUM = ROUTE.reduce<number[]>((acc, p, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1]! + Math.hypot(p.x - ROUTE[i - 1]!.x, p.y - ROUTE[i - 1]!.y));
  return acc;
}, []);
const TOTAL = CUM[CUM.length - 1]!;
const CLEAN_LEN = CUM[CLEAN_END_IDX]!;
const ROUTE_SCREEN = ROUTE.map((p) => {
  const s = proj(p.x, p.y);
  return `${n1(s.x)},${n1(s.y)}`;
});

/** Точка маршрута на пройденном расстоянии d и номер последней пройденной вершины. */
function at(d: number): { p: P; i: number } {
  let i = 0;
  while (i < CUM.length - 2 && CUM[i + 1]! <= d) i++;
  const a = ROUTE[i]!, b = ROUTE[i + 1]!;
  const len = CUM[i + 1]! - CUM[i]!;
  const t = len > 0 ? Math.min(1, Math.max(0, (d - CUM[i]!) / len)) : 0;
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, i };
}

/** Видимые грани коробки: перед, правый бок (дальнее уходит вправо) и верх. */
function boxFaces(b: Box) {
  const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.d, z1 = b.h;
  return {
    front: pts([[x0, y1, 0], [x1, y1, 0], [x1, y1, z1], [x0, y1, z1]]),
    side: pts([[x1, y1, 0], [x1, y0, 0], [x1, y0, z1], [x1, y1, z1]]),
    top: pts([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
  };
}

const FLOOR = pts([[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]]);
const SLAB_FRONT = pts([[0, H, 0], [W, H, 0], [W, H, -SLAB_H], [0, H, -SLAB_H]]);
const SLAB_SIDE = pts([[W, H, 0], [W, 0, 0], [W, 0, -SLAB_H], [W, H, -SLAB_H]]);
const WALL_BACK = pts([[0, 0, 0], [W, 0, 0], [W, 0, WALL_H], [0, 0, WALL_H]]);
const WALL_LEFT = pts([[0, 0, 0], [0, H, 0], [0, H, WALL_H], [0, 0, WALL_H]]);
const GRID = [
  ...Array.from({ length: Math.floor(W / 2) - 1 }, (_, i) => [proj((i + 1) * 2, 0), proj((i + 1) * 2, H)] as const),
  ...Array.from({ length: Math.ceil(H / 2) - 1 }, (_, i) => [proj(0, (i + 1) * 2), proj(W, (i + 1) * 2)] as const),
];
const DOCK_PAD = pts([[DOCK.x - 0.45, DOCK.y - 0.45, 0.02], [DOCK.x + 0.45, DOCK.y - 0.45, 0.02], [DOCK.x + 0.45, DOCK.y + 0.45, 0.02], [DOCK.x - 0.45, DOCK.y + 0.45, 0.02]]);
const DOCK_SCREEN = proj(DOCK.x, DOCK.y);
const DOCK_LABEL = proj(CHARGER.x + CHARGER.w / 2, CHARGER.y, CHARGER.h + 0.5);

const VB = (() => {
  const left = proj(0, H).x - 12;
  const right = proj(W, 0).x + 12;
  const top = proj(0, 0, WALL_H + 0.9).y;
  const bottom = proj(0, H, -SLAB_H).y + 10;
  return { x: left, y: top, w: right - left, h: bottom - top };
})();

/** Полоса уборки на экране: ширина щётки, приведённая к сжатой глубине схемы. */
const TRAIL_W = BRUSH_M * S * DY * 1.1;

/** Робот-поломойка: низкий круглый корпус, датчик сверху, щётка снизу. Нарисован в экранных единицах, основание — (0, 0). */
function CleanerSprite() {
  return (
    <g transform="scale(1.3)">
      <ellipse className="iso-shadow" cx="0" cy="1" rx="17" ry="6.5" />
      <ellipse className="b-dark" cx="0" cy="0" rx="15.5" ry="5.8" />
      <path className="b-body" d="M-14 -13v9a14 5.3 0 0 0 28 0v-9z" />
      <ellipse className="b-body" cx="0" cy="-13" rx="14" ry="5.3" />
      <rect className="b-led" x="-9" y="-7.5" width="9" height="2.2" rx="1.1" />
      <ellipse className="b-glass" cx="2" cy="-14.5" rx="5" ry="2" />
    </g>
  );
}

export function CleaningRobotPreview({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const botRef = useRef<SVGGElement | null>(null);
  const trailRef = useRef<SVGPolylineElement | null>(null);
  const hudRef = useRef<HTMLSpanElement | null>(null);
  const progress = useRef({ d: 0, hold: 0 });

  useEffect(() => {
    const svg = svgRef.current, layer = layerRef.current, bot = botRef.current, trail = trailRef.current, hud = hudRef.current;
    if (!svg || !layer || !bot || !trail || !hud) return;
    const boxEls = Array.from(layer.querySelectorAll<SVGGElement>("[data-depth]"));

    function render(d: number) {
      const { p, i } = at(d);
      const s = proj(p.x, p.y);
      trail!.setAttribute("points", `${ROUTE_SCREEN.slice(0, i + 1).join(" ")} ${n1(s.x)},${n1(s.y)}`);
      bot!.setAttribute("transform", `translate(${n1(s.x)} ${n1(s.y)})`);
      // Робот встаёт перед первым рядом, который ближе к зрителю, — иначе он «проезжал» бы сквозь стеллажи.
      const ahead = boxEls.find((el) => Number(el.dataset.depth) > p.y) ?? null;
      if (bot!.nextSibling !== ahead) layer!.insertBefore(bot!, ahead);
      hud!.textContent = `Убрано ${Math.round((100 * Math.min(d, CLEAN_LEN)) / CLEAN_LEN)} %`;
    }

    if (reduced) {
      render(TOTAL);
      return;
    }
    render(progress.current.d);
    if (paused) return;

    let raf = 0;
    let last = 0;
    let visible = true;
    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      const pr = progress.current;
      if (pr.d >= TOTAL) {
        pr.hold += dt;
        if (pr.hold >= HOLD_S) {
          pr.d = 0;
          pr.hold = 0;
        }
      } else {
        pr.d = Math.min(TOTAL, pr.d + SPEED_MPS * dt);
      }
      render(pr.d);
      raf = requestAnimationFrame(frame);
    }
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(svg);
    raf = requestAnimationFrame(frame);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, paused]);

  return (
    <div className={cn("relative", className)}>
      <IsoStyles />
      <svg
        ref={svgRef}
        className="iso-root block h-auto w-full xl:h-full"
        viewBox={[VB.x, VB.y, VB.w, VB.h].map(n1).join(" ")}
        role="img"
        aria-label="Схема: робот-уборщик проходит торговый зал полосами между стеллажами и возвращается на базу"
      >
        <defs>
          <clipPath id="cleaning-floor">
            <polygon points={FLOOR} />
          </clipPath>
        </defs>
        <g className="iso-slab">
          <polygon className="s" points={SLAB_FRONT} />
          <polygon className="e" points={SLAB_SIDE} />
        </g>
        <polygon className="iso-floor-storage" points={FLOOR} />
        {GRID.map(([a, b], i) => (
          <line key={i} className="iso-grid" x1={n1(a.x)} y1={n1(a.y)} x2={n1(b.x)} y2={n1(b.y)} />
        ))}
        <g className="iso-wall">
          <polygon className="s" points={WALL_BACK} />
          <polygon className="e" points={WALL_LEFT} />
        </g>
        <polyline
          ref={trailRef}
          points={ROUTE_SCREEN[0]}
          clipPath="url(#cleaning-floor)"
          style={{ fill: "none", stroke: "var(--iso-accent)", strokeOpacity: 0.28, strokeWidth: TRAIL_W, strokeLinecap: "round", strokeLinejoin: "round" }}
        />
        <polygon className="iso-pad" points={DOCK_PAD} />
        <g ref={layerRef}>
          {BOXES.map((b, i) => {
            const f = boxFaces(b);
            return (
              <g key={i} className={`iso-box iso-${b.mat}`} data-depth={depthOf(b)}>
                <polygon className="s" points={f.front} />
                <polygon className="e" points={f.side} />
                <polygon className="t" points={f.top} />
              </g>
            );
          })}
          <g ref={botRef} className="iso-bot" transform={`translate(${n1(DOCK_SCREEN.x)} ${n1(DOCK_SCREEN.y)})`}>
            <CleanerSprite />
          </g>
        </g>
        <text className="iso-pad-label" x={n1(DOCK_LABEL.x)} y={n1(DOCK_LABEL.y)} aria-hidden="true">
          База
        </text>
      </svg>
      <span ref={hudRef} className="absolute top-2 right-3 text-sm font-semibold text-muted-foreground" aria-hidden="true">
        Убрано 0 %
      </span>
      {!reduced && (
        <Button type="button" variant="outline" size="sm" className="absolute top-2 left-2" onClick={() => setPaused((v) => !v)}>
          {paused ? "Продолжить" : "Пауза"}
        </Button>
      )}
    </div>
  );
}
