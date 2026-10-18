import { packPodRows } from "./pod-layout";
import { siteSegmentIsClear, validateSiteLayout } from "../../lib/sim/site-layout";
import type { SimLayout, SiteRect } from "../../lib/sim/types";

/** Designed demonstration site, not a surveyed customer building. All solids affect routing. */
export function complexSite(areaM2: number, chargers: number, mobileStorage = false): SimLayout {
  const scale = Math.sqrt(areaM2 / 10000);
  const podColumns = [6, 12, 18, 24, 30, 36, 42, 54, 60, 66, 72, 78, 84, 90, 96];
  const podRows = [46, 52, 58, 64, 70];
  const rect = (x: number, y: number, w: number, h: number, id: string, kind?: string): SiteRect => ({ x: x * scale, y: y * scale, w: w * scale, h: h * scale, id, kind });
  const walls = [
    rect(48, 0, 2, 12, "west-1"), rect(48, 20, 2, 36, "west-2"), rect(48, 64, 2, 16, "west-3"),
    rect(0, 38, 18, 2, "north-1"), rect(30, 38, 38, 2, "north-2"), rect(80, 38, 20, 2, "north-3"),
    rect(98, 0, 2, 18, "dispatch-1"), rect(98, 30, 2, 10, "dispatch-2"),
  ];
  const columns = [rect(47, 0, 4, 3, "column-1", "column"), rect(47, 77, 4, 3, "column-2", "column"), rect(97, 0, 4, 3, "column-3", "column")].map((r) => ({ ...r, heightM: 6 }));
  const racks = [
    rect(8, 46, 6, 22, "rack-1", "rack"), rect(28, 46, 6, 22, "rack-2", "rack"), rect(38, 46, 6, 22, "rack-3", "rack"),
    rect(56, 46, 6, 24, "rack-4", "rack"), rect(76, 46, 6, 24, "rack-5", "rack"), rect(86, 46, 6, 24, "rack-6", "rack"),
    rect(60, 8, 6, 4, "packing-table-1", "packing-table"), rect(76, 8, 6, 4, "packing-table-2", "packing-table"),
    rect(60, 28, 6, 4, "packing-table-3", "packing-table"), rect(76, 28, 6, 4, "packing-table-4", "packing-table"),
  ];
  const layout: SimLayout = {
    widthM: 150 * scale, heightM: 80 * scale,
    footprint: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 80 }, { x: 0, y: 80 }].map((p) => ({ x: p.x * scale, y: p.y * scale })),
    wallHeightM: 4.5,
    walls, columns, obstacles: mobileStorage ? racks.filter(r => r.kind !== "rack") : racks,
    doors: [
      { ...rect(48, 12, 2, 8, "door-west-south"), id: "door-west-south", label: "Проезд приёмка → комплектация" },
      { ...rect(48, 56, 2, 8, "door-west-north"), id: "door-west-north", label: "Межсекционный проезд" },
      { ...rect(18, 38, 12, 2, "door-storage-west"), id: "door-storage-west", label: "Приёмка → хранение" },
      { ...rect(68, 38, 12, 2, "door-storage-east"), id: "door-storage-east", label: "Хранение → комплектация" },
      { ...rect(98, 18, 2, 12, "door-dispatch"), id: "door-dispatch", label: "Комплектация → экспедиция" },
    ],
    compartments: [
      { ...rect(0, 0, 48, 38, "receiving"), id: "receiving", label: "Приёмка и контроль", kind: "receiving" },
      { ...rect(0, 40, 48, 40, "storage-west"), id: "storage-west", label: mobileStorage ? "Мобильные стеллажи А" : "Хранение А", kind: "storage" },
      { ...rect(50, 40, 50, 40, "storage-east"), id: "storage-east", label: mobileStorage ? "Мобильные стеллажи Б" : "Хранение Б", kind: "storage" },
      { ...rect(50, 0, 48, 38, "packing"), id: "packing", label: "Комплектация", kind: "packing" },
      { ...rect(100, 0, 50, 40, "shipping"), id: "shipping", label: "Экспедиция", kind: "shipping" },
    ],
    zones: [
      { ...rect(0, 0, 48, 38, "receiving"), kind: "receiving", label: "Приёмка" },
      { ...rect(0, 40, 100, 40, "storage"), kind: "storage", label: mobileStorage ? "Зоны мобильных стеллажей" : "Хранение" },
      { ...rect(100, 0, 50, 40, "shipping"), kind: "shipping", label: "Отгрузка" },
      { ...rect(0, 0, 28, 12, "charging"), kind: "charging", label: "Зарядная зона" },
    ],
    crossAislesY: [16, 24, 44, 74].map((v) => v * scale), rackAislesX: (mobileStorage ? podColumns : [22, 54, 64, 74, 94]).map((v) => v * scale),
    receiving: [{ id: "receiving-0", kind: "receiving", x: 6 * scale, y: 24 * scale }, { id: "receiving-1", kind: "receiving", x: 6 * scale, y: 34 * scale }],
    shipping: [{ id: "shipping-0", kind: "shipping", x: 144 * scale, y: 16 * scale }, { id: "shipping-1", kind: "shipping", x: 144 * scale, y: 24 * scale }],
    chargers: [], slots: [],
    routingGraph: { nodes: [], edges: [], clearanceM: 0.8 },
  };
  const xs = [...new Set([6, 12, 22, 24, 34, 44, 54, 64, 74, 84, 94, 104, 114, 124, 134, 144, ...(mobileStorage ? podColumns : [])])].sort((a,b)=>a-b);
  const ys = [...new Set([6, 16, 24, 34, 44, 54, 60, 70, 74, ...(mobileStorage ? podRows : [])])].sort((a,b)=>a-b);
  const graph = layout.routingGraph!;
  for (const x of xs) for (const y of ys) {
    const p = { id: `node-${x}-${y}`, x: x * scale, y: y * scale };
    if (siteSegmentIsClear(layout, p, p)) graph.nodes.push(p);
  }
  for (const axis of ["x", "y"] as const) {
    const other = axis === "x" ? "y" : "x";
    const rows = new Map<number, typeof graph.nodes>();
    for (const node of graph.nodes) rows.set(node[other], [...(rows.get(node[other]) ?? []), node]);
    for (const row of rows.values()) {
      row.sort((a, b) => a[axis] - b[axis]);
      for (let i = 1; i < row.length; i++) if (siteSegmentIsClear(layout, row[i - 1]!, row[i]!)) graph.edges.push({ from: row[i - 1]!.id, to: row[i]!.id });
    }
  }
  const chargingNodes = graph.nodes.filter((n) => n.y === 6 * scale && n.x <= 44 * scale);
  if (!Number.isInteger(chargers) || chargers < 1 || chargers > chargingNodes.length) throw new Error("Complex site has insufficient physical charging bays");
  layout.chargers = chargingNodes.slice(0, chargers).map((n, i) => ({ id: `charger-${i}`, kind: "charger", x: n.x, y: n.y }));
  layout.slots = graph.nodes.filter((n) => mobileStorage
    ? podColumns.some(x => n.x === x * scale) && podRows.some(y => n.y === y * scale)
    : n.y >= 54 * scale && n.y <= 70 * scale && [22, 54, 64, 74, 94].some((x) => n.x === x * scale)).map(({ x, y }) => ({ x, y }));
  layout.staging = [
    { ...rect(0, 20, 18, 18, "receiving-staging"), id: "receiving-staging", kind: "receiving", pointIds: layout.receiving.map((p) => p.id) },
    { ...rect(134, 8, 16, 26, "shipping-staging"), id: "shipping-staging", kind: "shipping", pointIds: layout.shipping.map((p) => p.id) },
    { ...rect(0, 0, 46, 12, "charging-staging"), id: "charging-staging", kind: "charger", pointIds: layout.chargers.map((p) => p.id) },
  ];
  const issues = validateSiteLayout(layout);
  if (issues.length) throw new Error(`Invalid complex demonstration map: ${issues.join("; ")}`);
  return mobileStorage ? packPodRows(layout).layout : layout;
}
