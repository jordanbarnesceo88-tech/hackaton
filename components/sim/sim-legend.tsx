import type { ReactNode } from "react";
import {
  CHARGER_COLOR,
  DOCK_COLOR,
  LEGEND_ITEMS,
  ROUTE_COLOR,
  SCENE_BG,
  glyphColor,
  type LegendItem,
} from "./draw-scene";

/**
 * Легенда схемы имитации. Образцы нарисованы теми же цветами и формами, что на канве, и на
 * том же тёмном фоне: состояние робота различается и формой, и цветом (закрашенный квадрат — с
 * грузом, полый круг — без груза, молния — зарядка), поэтому легенда читается и без цвета.
 * Ворота показаны в обоих состояниях: полый квадрат — свободны, закрашенный — у ворот работает робот.
 */

/** Образец элемента легенды, 16 × 16. */
function Swatch({ item }: { item: LegendItem }) {
  const sw = item.swatch;
  let body: ReactNode;
  if (sw.kind === "robot") {
    const c = glyphColor(sw.glyph);
    body =
      sw.glyph === "loaded" ? (
        <rect x="4" y="4" width="8" height="8" fill={c} stroke={SCENE_BG} strokeWidth="1.5" />
      ) : sw.glyph === "empty" ? (
        <circle cx="8" cy="8" r="4" fill={SCENE_BG} stroke={c} strokeWidth="2" />
      ) : (
        <path d="M9.4 1.5 4.2 9h3.4L6.6 14.5 11.8 7H8.4z" fill={c} stroke={SCENE_BG} strokeWidth="1" />
      );
  } else if (sw.kind === "dock") {
    // Как на схеме: свободные ворота — полый квадрат, занятые (у ворот работает робот) — закрашенный.
    body = (
      <rect
        x="3.5"
        y="3.5"
        width="9"
        height="9"
        fill={sw.busy ? DOCK_COLOR : SCENE_BG}
        stroke={DOCK_COLOR}
        strokeWidth="1.5"
      />
    );
  } else if (sw.kind === "charger") {
    body = (
      <>
        <rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke={CHARGER_COLOR} strokeWidth="1.5" />
        <path d="M8.8 4 5.8 8.4h2l-.6 3.6 3-4.4h-2z" fill={CHARGER_COLOR} />
      </>
    );
  } else if (sw.kind === "route") {
    body = <line x1="1" y1="8" x2="15" y2="8" stroke={ROUTE_COLOR} strokeWidth="1.5" strokeDasharray="3 2" />;
  } else {
    body = (
      <rect x="1.5" y="4" width="13" height="8" fill={sw.color} fillOpacity="0.35" stroke={sw.color} strokeWidth="1" />
    );
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0 rounded-sm"
      style={{ background: SCENE_BG }}
    >
      {body}
    </svg>
  );
}

/** Легенда: список образцов с подписями. */
export function SimLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Легенда схемы"
      className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {LEGEND_ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch item={item} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
