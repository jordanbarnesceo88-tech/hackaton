import { describe, expect, it } from "vitest";
import { buildWarehouseLayout } from "../../lib/sim/layout";
import { WAREHOUSE_BASE_LAYOUT } from "../../lib/sim/fixtures";
import { siteSegmentIsClear, validateSiteLayout } from "../../lib/sim/site-layout";
import { complexSite } from "./site";
import { packPodRows, POD_ROW_LAYOUT } from "./pod-layout";

describe("dense real underlift row layout", () => {
  it("fills both declared complex-site compartments with accessible physical homes", () => {
    const source = complexSite(10000, 1, true), before = structuredClone(source);
    const { layout, docks } = packPodRows(source);
    expect(source).toEqual(before);
    expect(docks.length).toBeGreaterThan(650);
    expect(docks.length).toBeLessThan(1100);
    expect(layout.slots).toHaveLength(docks.length);
    const storageArea = layout.compartments!.filter(r => r.kind === "storage").reduce((sum, r) => sum + r.w * r.h, 0);
    expect(docks.length * 1.4 / storageArea).toBeGreaterThan(0.25);
    for (const compartment of layout.compartments!.filter(r => r.kind === "storage")) {
      const rows = docks.filter(d => d.x > compartment.x && d.x < compartment.x + compartment.w);
      expect(rows.length).toBeGreaterThan(300);
      expect(Math.max(...rows.map(d => d.y)) - Math.min(...rows.map(d => d.y))).toBeGreaterThan(compartment.h * 0.75);
      expect(Math.max(...rows.map(d => d.x)) - Math.min(...rows.map(d => d.x))).toBeGreaterThan(compartment.w * 0.8);
    }
    expect(layout.receiving).toEqual(source.receiving);
    expect(layout.shipping).toEqual(source.shipping);
    expect(layout.chargers).toEqual(source.chargers);
    expect(layout.walls).toEqual(source.walls);
    expect(layout.columns).toEqual(source.columns);
    expect(validateSiteLayout(layout)).toEqual([]);
    for (const [i, dock] of docks.entries()) {
      expect(Math.abs(dock.x - dock.entry.x)).toBeCloseTo(2, 6);
      expect(dock.y).toBe(dock.entry.y);
      expect(siteSegmentIsClear(layout, dock, dock.entry)).toBe(true);
      const node = layout.routingGraph!.nodes.find(n => n.id === `pod-home-${i + 1}`)!;
      const edges = layout.routingGraph!.edges.filter(e => e.from === node.id || e.to === node.id);
      expect(edges).toHaveLength(1);
      const targetId = edges[0]!.from === node.id ? edges[0]!.to : edges[0]!.from;
      expect(targetId).toMatch(/^pod-entry-/);
      expect(layout.routingGraph!.nodes.find(n => n.id === targetId)).toMatchObject(dock.entry);
    }
  });

  it("uses the full generated storage strip rather than sampling a sparse representative grid", () => {
    const source = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 10000 });
    const result = packPodRows(source);
    expect(result.docks.length).toBeGreaterThan(1500);
    expect(validateSiteLayout(result.layout)).toEqual([]);
    expect(packPodRows(source)).toEqual(result);
  });

  it("keeps the agreed side/rear gaps and a clear rectangular extraction envelope", () => {
    const { docks } = packPodRows(buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 5000 }));
    expect(docks.length).toBeGreaterThan(650);
    const sameRow = docks.filter(d => Math.abs(d.x - docks[0]!.x) < 1e-7).sort((a, b) => a.y - b.y);
    expect(sameRow[1]!.y - sameRow[0]!.y).toBeCloseTo(POD_ROW_LAYOUT.pitchM);
    let obstructedExtractions = 0, obstructedTurnPoints = 0;
    for (const dock of docks) {
      const minX = Math.min(dock.x, dock.entry.x) - 0.7, maxX = Math.max(dock.x, dock.entry.x) + 0.7;
      for (const other of docks) {
        if (other === dock) continue;
        const overlapsX = other.x + 0.7 + 0.15 > minX + 1e-7 && other.x - 0.7 - 0.15 < maxX - 1e-7;
        const overlapsY = Math.abs(other.y - dock.y) < 1.15 - 1e-7;
        if (overlapsX && overlapsY) obstructedExtractions++;
        const dx = Math.max(0, Math.abs(other.x - dock.entry.x) - 0.7);
        const dy = Math.max(0, Math.abs(other.y - dock.entry.y) - 0.5);
        if (Math.hypot(dx, dy) < 1.05 - 1e-7) obstructedTurnPoints++;
      }
    }
    expect(obstructedExtractions).toBe(0);
    expect(obstructedTurnPoints).toBe(0);
  });

  it("rejects oversized or unusable layouts without truncating real stock", () => {
    expect(() => packPodRows(buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 50000 }))).toThrow("4096");
    const floor = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 5000 });
    expect(() => packPodRows(floor, [{ x: 20, y: 20, w: 5, h: 20 }])).toThrow("не вмещают");
  });

  it("omits physically obstructed homes and never extracts a shelf through a column", () => {
    const floor = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 5000 });
    const normal = packPodRows(floor);
    floor.columns = [{ x: 10.9, y: 3.3, w: 0.8, h: 0.8, id: "surveyed-column" }];
    const packed = packPodRows(floor);
    expect(packed.docks.length).toBeLessThan(normal.docks.length);
    expect(packed.docks.length).toBeGreaterThan(normal.docks.length - 12);
    expect(packed.layout.columns).toEqual(floor.columns);
    expect(packed.docks.every(d => siteSegmentIsClear(packed.layout, d, d.entry))).toBe(true);
    expect(validateSiteLayout(packed.layout)).toEqual([]);
  });

  it("rejects an inaccessible storage island rather than attaching an imaginary straight route", () => {
    const floor = buildWarehouseLayout({ ...WAREHOUSE_BASE_LAYOUT, activeAreaM2: 5000 });
    floor.walls = [{ x: floor.widthM / 2, y: 0, w: 1, h: floor.heightM }];
    expect(() => packPodRows(floor)).toThrow("не связаны с воротами");
  });
});
