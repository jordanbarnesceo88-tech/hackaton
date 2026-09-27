import { describe, expect, it } from "vitest";
import { warehouseBaseInput } from "@/lib/sim/fixtures";
import { buildWarehouseLayout } from "@/lib/sim/layout";
import type { RobotPhase } from "@/lib/sim/types";
import {
  MAX_DRAWN_ROBOTS,
  aisleWidths,
  formatSimClock,
  queueOffset,
  rackRects,
  robotGlyph,
  robotsToDraw,
  simPhaseLabel,
} from "./scene-model";

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
  it("shows every charging phase as charging, whatever the load flag says", () => {
    for (const phase of ["toCharger", "waitCharger", "charging"] as const) {
      expect(robotGlyph(phase, false)).toBe("charging");
      expect(robotGlyph(phase, true)).toBe("charging");
    }
  });

  it("uses the load flag for the work phases: with a pallet or empty", () => {
    for (const phase of ALL_PHASES.filter((p) => !["toCharger", "waitCharger", "charging"].includes(p))) {
      expect(robotGlyph(phase, true)).toBe("loaded");
      expect(robotGlyph(phase, false)).toBe("empty");
    }
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
  it("recovers the dataset's aisle widths from the built layout (3.5 m main, 2.8 m rack)", () => {
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

describe("rackRects", () => {
  it("keeps every rack inside the storage zone and out of the aisles", () => {
    const layout = buildWarehouseLayout(warehouseBaseInput(11).layout);
    const storage = layout.zones.find((z) => z.kind === "storage")!;
    const racks = rackRects(layout);
    expect(racks.length).toBeGreaterThan(0);
    for (const r of racks) {
      expect(r.x).toBeGreaterThanOrEqual(storage.x - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(storage.x + storage.w + 1e-9);
      for (const x of layout.rackAislesX) expect(x > r.x + 1e-9 && x < r.x + r.w - 1e-9).toBe(false);
    }
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
