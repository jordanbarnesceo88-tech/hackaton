import { describe, expect, it } from "vitest";
import { createSim, stepSim } from "@/lib/sim/engine";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { buildWarehouseLayout } from "@/lib/sim/layout";
import {
  ISO_LEGEND,
  isoFrame,
  isoGeometry,
  isoPoint,
  isoSceneSvg,
  isoScreenMarkup,
  isoStyleSheet,
  isoSwatchMarkup,
  pointLabel,
} from "./iso-scene";
import { rackRects, robotGlyph } from "./scene-model";

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("isoGeometry", () => {
  const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
  const g = isoGeometry(layout);

  it("fits the floor corners and the back wall into the view box", () => {
    const inside = (p: { x: number; y: number }) =>
      p.x >= g.vb.x && p.x <= g.vb.x + g.vb.w && p.y >= g.vb.y && p.y <= g.vb.y + g.vb.h;
    for (const [x, y] of [[0, 0], [g.W, 0], [0, g.H], [g.W, g.H]] as const) expect(inside(isoPoint(g, x, y, 0))).toBe(true);
    expect(inside(isoPoint(g, 0, 0, 4))).toBe(true);
  });

  it("looks from the bottom wall: the layout's bottom (world y = H) is nearer, i.e. lower on screen", () => {
    expect(isoPoint(g, 0, g.H).y).toBeGreaterThan(isoPoint(g, 0, 0).y);
    expect(isoPoint(g, g.W, 0).x).toBeGreaterThan(isoPoint(g, 0, 0).x);
  });

  it("keeps the scene the same width for a small and a large warehouse", () => {
    const big = isoGeometry(buildWarehouseLayout({ ...warehouseBaseInput(11).layout, activeAreaM2: 40_000 }));
    expect(Math.round(big.vb.w)).toBe(Math.round(g.vb.w));
  });
});

describe("isoSceneSvg", () => {
  it("draws the empty warehouse: four zones, racks, doors and chargers, no robots and no clock", () => {
    const layout = buildWarehouseLayout({ ...warehouseBaseInput(11).layout, chargers: 3 });
    const svg = isoSceneSvg(layout, null, { style: "none" });
    for (const label of ["Приёмка", "Хранение", "Отгрузка", "Зарядка"]) expect(svg).toContain(`>${label}<`);
    expect(count(svg, "iso-box iso-rack")).toBeGreaterThanOrEqual(rackRects(layout).length);
    expect(count(svg, 'class="iso-pad"')).toBe(layout.receiving.length + layout.shipping.length + layout.chargers.length);
    expect(count(svg, "Зарядная станция C")).toBe(3);
    expect(svg).not.toContain('class="iso-bot"');
    expect(svg).not.toContain("iso-hud-clock");
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("draws every robot of a run with its state, and the model clock", () => {
    const state = createSim(warehouseBaseInput(11));
    for (let i = 0; i < 1500; i++) stepSim(state);
    // Без встроенных стилей: в них те же имена атрибутов, и счёт по строке задел бы правила CSS.
    const svg = isoSceneSvg(state.layout, state, { style: "none" });
    expect(count(svg, 'class="iso-bot"')).toBe(11);
    const loaded = state.robots.filter((r) => robotGlyph(r.phase, r.loaded) === "loaded").length;
    expect(count(svg, 'data-glyph="loaded"')).toBe(loaded);
    expect(svg).toContain(">00:25 · пик<");
    const busy = state.points.filter((p) => p.holder !== null).length;
    expect(count(svg, 'data-busy="1"')).toBe(busy);
  });

  it("shows no model clock for a run refused by the pre-check (the robot cannot lift the load)", () => {
    const state = createSim(warehouseBaseInput(11, { loadMassKg: 2000 }));
    expect(state.precheck).toBe("payload");
    const svg = isoSceneSvg(state.layout, state, { style: "light" });
    expect(svg).not.toContain("iso-hud-clock");
    expect(svg).toContain(">Хранение<");
  });

  it("says how many robots are shown when the fleet is above the drawing cap", () => {
    const state = createSim(warehouseBaseInput(70));
    const svg = isoSceneSvg(state.layout, state, { style: "light" });
    expect(count(svg, 'class="iso-bot"')).toBe(60);
    expect(svg).toContain(">показано 60 из 70 роботов<");
  });

  it("names the scheme for screen readers when a label is given", () => {
    const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
    expect(isoSceneSvg(layout, null, { style: "none", label: "Схема склада" })).toMatch(/<svg[^>]*role="img" aria-label="Схема склада"/);
  });
});

describe("isoFrame", () => {
  it("spreads a queue at one dock along the floor instead of stacking the robots", () => {
    const state = createSim(warehouseBaseInput(11));
    for (let i = 0; i < 1500; i++) stepSim(state);
    const g = isoGeometry(state.layout);
    const point = state.points.find((p) => p.queue.length >= 2);
    if (!point) return; // очереди может не быть в этом кадре — тогда проверять нечего
    const frame = isoFrame(state.layout, state, g);
    const xs = point.queue.slice(0, 2).map((id) => frame.bots.find((b) => b.id === id)!.x);
    expect(xs[0]).not.toBeCloseTo(xs[1]!, 1);
  });

  it("gives a remaining path only to robots on the move", () => {
    const state = createSim(warehouseBaseInput(11));
    for (let i = 0; i < 1500; i++) stepSim(state);
    const frame = isoFrame(state.layout, state);
    const moving = new Set(state.robots.filter((r) => ["toPickup", "toDrop", "toCharger"].includes(r.phase)).map((r) => r.id));
    for (const r of frame.routes) expect(moving.has(r.id)).toBe(true);
  });
});

describe("screen markup, styles and legend", () => {
  it("leaves empty layers and clock slots for the frame updates", () => {
    const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
    const html = isoScreenMarkup(layout, isoGeometry(layout));
    expect(html).toContain('<g class="iso-routes"></g><g class="iso-bots"></g>');
    expect(html).toContain("iso-hud-clock");
    expect(html).toContain("iso-hud-caption");
  });

  it("follows the page theme on screen and prints light; PNG takes only the light palette", () => {
    const auto = isoStyleSheet("auto");
    expect(auto).toContain("@media screen and (prefers-color-scheme:dark)");
    expect(auto).toContain(".dark .iso-root");
    expect(isoStyleSheet("light")).not.toContain("prefers-color-scheme");
  });

  it("explains both dock states and every robot state in the legend", () => {
    const pads = ISO_LEGEND.filter((i) => i.swatch.kind === "pad").map((i) => (i.swatch.kind === "pad" ? i.swatch.busy : null));
    expect(pads).toEqual([false, true]);
    const bots = ISO_LEGEND.filter((i) => i.swatch.kind === "bot").map((i) => (i.swatch.kind === "bot" ? i.swatch.glyph : null));
    expect(bots).toEqual(["loaded", "empty", "charging"]);
    for (const item of ISO_LEGEND) expect(isoSwatchMarkup(item.swatch).length).toBeGreaterThan(20);
  });

  it("labels points in Russian: П — receiving, О — shipping, З — charging", () => {
    expect(pointLabel("R1")).toBe("П1");
    expect(pointLabel("S12")).toBe("О12");
    expect(pointLabel("C3")).toBe("З3");
  });
});
