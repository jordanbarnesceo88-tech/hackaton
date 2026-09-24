import { describe, expect, it } from "vitest";
import { WAREHOUSE_BASE_LAYOUT } from "./fixtures";
import { buildWarehouseLayout } from "./layout";
import { mulberry32 } from "./rng";
import { positionAlong, route, routeLengthBetween, routeLengthM } from "./routing";

const layout = buildWarehouseLayout(WAREHOUSE_BASE_LAYOUT);
const points = [...layout.receiving, ...layout.shipping, ...layout.chargers, ...layout.slots];

describe("route", () => {
  it("начинается в a, кончается в b, все отрезки параллельны осям", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const a = points[Math.floor(rng() * points.length)]!;
      const b = points[Math.floor(rng() * points.length)]!;
      const pts = route(layout, a, b);
      expect(pts[0]).toEqual({ x: a.x, y: a.y });
      expect(pts.at(-1)).toEqual({ x: b.x, y: b.y });
      for (let k = 1; k < pts.length; k++) {
        const dx = pts[k]!.x - pts[k - 1]!.x;
        const dy = pts[k]!.y - pts[k - 1]!.y;
        expect(dx === 0 || dy === 0).toBe(true);
      }
    }
  });

  it("длина симметрична, не меньше манхэттенской и совпадает с routeLengthBetween", () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 500; i++) {
      const a = points[Math.floor(rng() * points.length)]!;
      const b = points[Math.floor(rng() * points.length)]!;
      const ab = routeLengthM(route(layout, a, b));
      const ba = routeLengthM(route(layout, b, a));
      expect(ab).toBeCloseTo(ba, 9);
      expect(ab).toBeGreaterThanOrEqual(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) - 1e-9);
      expect(routeLengthBetween(layout, a.x, a.y, b.x, b.y)).toBeCloseTo(ab, 9);
    }
  });

  it("в одном проходе — прямо по вертикали", () => {
    const a = { x: layout.rackAislesX[3]!, y: 6 };
    const b = { x: layout.rackAislesX[3]!, y: 30 };
    expect(route(layout, a, b)).toEqual([a, b]);
    expect(routeLengthM(route(layout, a, b))).toBe(24);
  });

  it("между проходами — через поперечный проезд, минимизирующий длину", () => {
    // Обе точки в верхней половине: выгоднее верхний проезд (H − 1,75), а не средний.
    const a = { x: layout.rackAislesX[0]!, y: 66 };
    const b = { x: layout.rackAislesX[5]!, y: 62 };
    const pts = route(layout, a, b);
    expect(pts).toHaveLength(4);
    expect(pts[1]!.y).toBeCloseTo(layout.heightM - 1.75, 10);
    expect(routeLengthM(pts)).toBeCloseTo(26 + (layout.heightM - 1.75 - 66) + (layout.heightM - 1.75 - 62), 9);
  });

  it("из точки в неё же — маршрут из одной точки нулевой длины", () => {
    const a = layout.slots[10]!;
    const pts = route(layout, a, a);
    expect(pts).toHaveLength(1);
    expect(routeLengthM(pts)).toBe(0);
  });
});

describe("positionAlong", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 5, y: 10 },
  ];

  it("концы и прижатие к диапазону", () => {
    expect(positionAlong(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(positionAlong(pts, -3)).toEqual({ x: 0, y: 0 });
    expect(positionAlong(pts, 15)).toEqual({ x: 5, y: 10 });
    expect(positionAlong(pts, 100)).toEqual({ x: 5, y: 10 });
  });

  it("середина отрезков", () => {
    expect(positionAlong(pts, 4)).toEqual({ x: 0, y: 4 });
    expect(positionAlong(pts, 10)).toEqual({ x: 0, y: 10 });
    expect(positionAlong(pts, 12.5)).toEqual({ x: 2.5, y: 10 });
  });

  it("пустой маршрут — начало координат", () => {
    expect(positionAlong([], 5)).toEqual({ x: 0, y: 0 });
  });
});
