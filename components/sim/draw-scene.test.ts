import { describe, expect, it } from "vitest";
import { createSim, stepSim } from "@/lib/sim/engine";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { buildWarehouseLayout } from "@/lib/sim/layout";
import type { RobotPhase } from "@/lib/sim/types";
import {
  CHARGING_ROBOT_COLOR,
  DOCK_COLOR,
  LEGEND_ITEMS,
  MAX_DRAWN_ROBOTS,
  ROBOT_COLOR,
  SCENE_BG,
  aisleWidths,
  drawLegendSwatch,
  drawScene,
  formatSimClock,
  glyphColor,
  queueOffset,
  robotGlyph,
  robotsToDraw,
  sceneGeometry,
  simPhaseLabel,
  toPx,
} from "./draw-scene";

const ALL_PHASES: RobotPhase[] = [
  "idle",
  "toPickup",
  "waitPoint",
  "loading",
  "toDrop",
  "unloading",
  "toCharger",
  "waitCharger",
  "charging",
];

describe("robotGlyph", () => {
  it("shows every charging phase as a bolt, whatever the load flag says", () => {
    for (const phase of ["toCharger", "waitCharger", "charging"] as const) {
      expect(robotGlyph(phase, false)).toBe("charging");
      expect(robotGlyph(phase, true)).toBe("charging");
    }
  });

  it("uses the load flag for the work phases: filled square with a pallet, hollow circle without", () => {
    for (const phase of ALL_PHASES.filter((p) => !["toCharger", "waitCharger", "charging"].includes(p))) {
      expect(robotGlyph(phase, true)).toBe("loaded");
      expect(robotGlyph(phase, false)).toBe("empty");
    }
  });

  it("distinguishes charging by colour too, not only by shape", () => {
    expect(glyphColor("loaded")).toBe(ROBOT_COLOR);
    expect(glyphColor("empty")).toBe(ROBOT_COLOR);
    expect(glyphColor("charging")).toBe(CHARGING_ROBOT_COLOR);
    expect(CHARGING_ROBOT_COLOR).not.toBe(ROBOT_COLOR);
  });

  it("keeps the v1 canvas colours: background #0f172a, robots #22d3ee", () => {
    expect(ROBOT_COLOR).toBe("#22d3ee");
  });
});

describe("robotsToDraw", () => {
  it("draws everyone up to the cap and the first 60 above it", () => {
    expect(robotsToDraw(11)).toBe(11);
    expect(robotsToDraw(MAX_DRAWN_ROBOTS)).toBe(60);
    expect(robotsToDraw(577)).toBe(60);
  });

  it("draws nobody for a missing or broken count", () => {
    expect(robotsToDraw(0)).toBe(0);
    expect(robotsToDraw(-3)).toBe(0);
    expect(robotsToDraw(Number.NaN)).toBe(0);
  });
});

describe("aisleWidths", () => {
  it("recovers the organiser's aisle widths from the built layout (3.5 m main, 2.8 m rack)", () => {
    const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
    const w = aisleWidths(layout);
    expect(w.mainM).toBeCloseTo(3.5, 9);
    expect(w.rackM).toBeCloseTo(2.8, 9);
  });

  it("falls back to the main aisle width when there is a single rack aisle", () => {
    // 50 м²: ширина 10 м, отступ проходов от стен 2,5 м — помещается один проход (x = 2,5).
    const layout = buildWarehouseLayout({ ...warehouseBaseInput(1).layout, activeAreaM2: 50 });
    expect(layout.rackAislesX.length).toBe(1);
    expect(aisleWidths(layout).rackM).toBeCloseTo(aisleWidths(layout).mainM, 9);
  });
});

describe("sceneGeometry", () => {
  const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);

  it("fits the whole layout inside the canvas, with label bands above and below", () => {
    const W = 720;
    const H = 360;
    const g = sceneGeometry(layout, W, H, 1, true);
    const topLeft = toPx(g, 0, layout.heightM);
    const bottomRight = toPx(g, layout.widthM, 0);
    expect(topLeft.px).toBeGreaterThanOrEqual(0);
    expect(topLeft.py).toBeGreaterThanOrEqual(g.band);
    expect(bottomRight.px).toBeLessThanOrEqual(W);
    expect(bottomRight.py).toBeLessThanOrEqual(H - g.band);
  });

  it("flips the Y axis: the layout's bottom wall is drawn lower on the canvas", () => {
    const g = sceneGeometry(layout, 720, 360);
    expect(toPx(g, 0, 0).py).toBeGreaterThan(toPx(g, 0, layout.heightM).py);
  });

  it("has no label bands when labels are off", () => {
    expect(sceneGeometry(layout, 720, 360, 1, false).band).toBe(0);
  });
});

describe("queueOffset", () => {
  it("stretches a dock queue into the warehouse: right of receiving, left of shipping", () => {
    expect(queueOffset("receiving", 0).dx).toBeGreaterThan(0);
    expect(queueOffset("shipping", 0).dx).toBeLessThan(0);
    expect(queueOffset("charger", 1).dx).toBeGreaterThan(queueOffset("charger", 0).dx);
  });
});

describe("formatSimClock and simPhaseLabel", () => {
  it("formats model time as hh:mm", () => {
    expect(formatSimClock(0)).toBe("00:00");
    expect(formatSimClock(59)).toBe("00:00");
    expect(formatSimClock(900)).toBe("00:15");
    expect(formatSimClock(8100)).toBe("02:15");
    expect(formatSimClock(Number.NaN)).toBe("00:00");
  });

  it("names the window the clock is in", () => {
    expect(simPhaseLabel(100, 900, 8100)).toBe("прогрев");
    expect(simPhaseLabel(900, 900, 8100)).toBe("пик");
    expect(simPhaseLabel(8100, 900, 8100)).toBe("окончен");
  });
});

/** Контекст канвы, который записывает вызовы: хватает, чтобы проверить отрисовку в Node. */
function recordingCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 6 });
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
      };
    },
    set(target, prop, value) {
      if (typeof prop === "string") target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("drawScene", () => {
  it("draws the empty layout with all four zone labels when there is no run yet", () => {
    const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
    const { ctx, calls } = recordingCtx();
    drawScene(ctx, layout, null, { W: 720, H: 360, dpr: 2 });
    const texts = calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(texts).toEqual(expect.arrayContaining(["Приёмка", "Хранение", "Отгрузка", "Зарядка"]));
    // Без прогона роботов нет: дуги рисуют только полые круги пустых роботов.
    expect(calls.filter((c) => c.name === "arc")).toHaveLength(0);
    // Контекст возвращается в исходное состояние: сохранения и восстановления парные.
    expect(calls.filter((c) => c.name === "save").length).toBe(calls.filter((c) => c.name === "restore").length);
  });

  it("draws one hollow circle per empty robot and the model clock", () => {
    const state = createSim(warehouseBaseInput(11));
    for (let i = 0; i < 1500; i++) stepSim(state);
    const empty = state.robots.filter((r) => robotGlyph(r.phase, r.loaded) === "empty").length;
    const { ctx, calls } = recordingCtx();
    drawScene(ctx, state.layout, state, { W: 720, H: 360, dpr: 1 });
    expect(calls.filter((c) => c.name === "arc")).toHaveLength(empty);
    const texts = calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    expect(texts).toContain("00:25 · пик");
  });

  it("draws no model clock for a run refused by the pre-check (the robot cannot lift the load)", () => {
    const state = createSim(warehouseBaseInput(11, { loadMassKg: 2000 }));
    expect(state.precheck).toBe("payload");
    const { ctx, calls } = recordingCtx();
    drawScene(ctx, state.layout, state, { W: 720, H: 360, dpr: 1 });
    const texts = calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    expect(texts.some((t) => /^\d\d:\d\d · /.test(t))).toBe(false);
    expect(texts).toEqual(expect.arrayContaining(["Приёмка", "Хранение", "Отгрузка", "Зарядка"]));
  });

  it("says how many robots are shown when the fleet is above the drawing cap", () => {
    const state = createSim(warehouseBaseInput(70));
    const { ctx, calls } = recordingCtx();
    drawScene(ctx, state.layout, state, { W: 720, H: 360, dpr: 1 });
    const texts = calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    expect(texts).toContain("показано 60 из 70 роботов");
  });

  it("explains both dock states in the legend: hollow — free, filled — a robot works at the dock", () => {
    const docks = LEGEND_ITEMS.filter((i) => i.swatch.kind === "dock");
    expect(docks.map((d) => (d.swatch.kind === "dock" ? d.swatch.busy : null))).toEqual([false, true]);
    const fills: unknown[] = [];
    for (const item of docks) {
      const { ctx, calls } = recordingCtx();
      // Маркер ворот задаёт заливку один раз, поэтому после вызова fillStyle — цвет его заливки.
      const rec = ctx as unknown as { fillStyle: unknown };
      drawLegendSwatch(ctx, item, 10, 10, 12);
      expect(calls.some((c) => c.name === "fillRect")).toBe(true);
      fills.push(rec.fillStyle);
    }
    expect(fills).toEqual([SCENE_BG, DOCK_COLOR]);
  });

  it("offsets the drawing area inside a larger canvas (PNG export)", () => {
    const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
    const { ctx, calls } = recordingCtx();
    drawScene(ctx, layout, null, { W: 1152, H: 576, dpr: 2, x: 24, y: 70 });
    expect(calls.find((c) => c.name === "setTransform")?.args).toEqual([2, 0, 0, 2, 48, 140]);
  });
});
