import type { FacilityParams } from "@/lib/economics/types";
import type { FacilityKind, Layout, Zone, Waypoint } from "./types";

const KINDS: FacilityKind[] = ["warehouse", "airport", "medical", "other"];

export function mapKind(slug: string): FacilityKind {
  return (KINDS as string[]).includes(slug) ? (slug as FacilityKind) : "other";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Grid size derived from area but hard-capped at 6x6 (I7). ~200 m^2 per cell, clamped.
function gridDims(params: FacilityParams): { cols: number; rows: number } {
  const cells = clamp(Math.round(params.areaM2 / 200), 4, 36);
  const cols = clamp(Math.round(Math.sqrt(cells)), 2, 6);
  const rows = clamp(Math.round(cells / cols), 2, 6);
  return { cols, rows };
}

const DOCK: Zone = { kind: "dock", x: 0.02, y: 0.45, w: 0.1, h: 0.1, label: "Док" };

function gridZones(
  kind: Zone["kind"],
  params: FacilityParams,
  area: { x0: number; y0: number; x1: number; y1: number }
): Zone[] {
  const { cols, rows } = gridDims(params);
  const zones: Zone[] = [];
  const gapX = 0.02;
  const gapY = 0.03;
  const cw = (area.x1 - area.x0 - gapX * (cols - 1)) / cols;
  const ch = (area.y1 - area.y0 - gapY * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      zones.push({
        kind,
        x: area.x0 + c * (cw + gapX),
        y: area.y0 + r * (ch + gapY),
        w: cw,
        h: ch,
      });
    }
  }
  return zones;
}

export function generateLayout(kind: FacilityKind, params: FacilityParams): Layout {
  const area = { x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.92 };

  if (kind === "airport") {
    const belt: Zone = { kind: "belt", x: 0.18, y: 0.46, w: 0.8, h: 0.08, label: "Лента" };
    const gates = gridZones("gate", { ...params, areaM2: Math.min(params.areaM2, 1200) }, {
      x0: 0.18,
      y0: 0.08,
      x1: 0.98,
      y1: 0.36,
    }).slice(0, 12);
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.22 },
      { x: 0.5, y: 0.5 },
    ];
    return { kind, zones: [DOCK, belt, ...gates], pathTemplate };
  }

  if (kind === "medical") {
    // A single clamped room grid above a corridor (I7: one grid, never two).
    const rooms = gridZones("room", params, { x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.62 });
    const corridor: Zone = { kind: "zone", x: 0.18, y: 0.68, w: 0.8, h: 0.06, label: "Коридор" };
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 },
      { x: 0.55, y: 0.71 },
      { x: 0.55, y: 0.35 },
      { x: 0.55, y: 0.71 },
    ];
    return { kind, zones: [DOCK, corridor, ...rooms], pathTemplate };
  }

  if (kind === "warehouse") {
    const racks = gridZones("rack", params, area);
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.15 },
      { x: 0.5, y: 0.5 },
    ];
    return { kind, zones: [DOCK, ...racks], pathTemplate };
  }

  // other / generic
  const cells = gridZones("zone", params, area);
  const pathTemplate: Waypoint[] = [
    { x: 0.07, y: 0.5 },
    { x: 0.55, y: 0.55 },
    { x: 0.85, y: 0.3 },
    { x: 0.55, y: 0.55 },
  ];
  return { kind, zones: [DOCK, ...cells], pathTemplate };
}
