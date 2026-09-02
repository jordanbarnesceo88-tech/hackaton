import type { FacilityKind, Layout, Zone, Waypoint } from "./types";

const KINDS: FacilityKind[] = ["warehouse", "airport", "medical", "other"];

export function mapKind(slug: string): FacilityKind {
  return (KINDS as string[]).includes(slug) ? (slug as FacilityKind) : "other";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Grid size derived from area but hard-capped at 6x6 (I7). ~200 m^2 per cell, clamped.
function gridDims(areaM2: number): { cols: number; rows: number } {
  const cells = clamp(Math.round(areaM2 / 200), 4, 36);
  const cols = clamp(Math.round(Math.sqrt(cells)), 2, 6);
  const rows = clamp(Math.round(cells / cols), 2, 6);
  return { cols, rows };
}

const DOCK: Zone = { kind: "dock", x: 0.02, y: 0.45, w: 0.1, h: 0.1, label: "Док" };

function gridZones(
  kind: Zone["kind"],
  areaM2: number,
  area: { x0: number; y0: number; x1: number; y1: number }
): Zone[] {
  const { cols, rows } = gridDims(areaM2);
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

/**
 * Build the scene for a facility. Takes `areaM2` rather than the whole `FacilityParams`
 * because that is genuinely all it reads — the grid is sized from area alone. Narrowing the
 * signature lets the caller memoize on exactly the input that matters: keyed on the params
 * object, a new identity on every keystroke regenerated the layout and snapped the robots back
 * to their start positions while editing fields the scene does not depend on.
 */
export function generateLayout(kind: FacilityKind, areaM2: number): Layout {
  const area = { x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.92 };

  if (kind === "airport") {
    const belt: Zone = { kind: "belt", x: 0.18, y: 0.46, w: 0.8, h: 0.08, label: "Лента" };
    const gates = gridZones("gate", Math.min(areaM2, 1200), {
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
    const rooms = gridZones("room", areaM2, { x0: 0.18, y0: 0.08, x1: 0.98, y1: 0.62 });
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
    const racks = gridZones("rack", areaM2, area);
    const pathTemplate: Waypoint[] = [
      { x: 0.07, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.15 },
      { x: 0.5, y: 0.5 },
    ];
    return { kind, zones: [DOCK, ...racks], pathTemplate };
  }

  // other / generic
  const cells = gridZones("zone", areaM2, area);
  const pathTemplate: Waypoint[] = [
    { x: 0.07, y: 0.5 },
    { x: 0.55, y: 0.55 },
    { x: 0.85, y: 0.3 },
    { x: 0.55, y: 0.55 },
  ];
  return { kind, zones: [DOCK, ...cells], pathTemplate };
}
