import { formatNum } from "@/lib/format/rub";
import { generateLayout, mapKind } from "@/lib/scene/layout";
import type { Zone } from "@/lib/scene/types";
import { cn } from "@/lib/utils";

/**
 * Статичная схема объекта для типов, у которых в tz-1.0.0 нет имитации (ТЗ §5.5: аэропорт и
 * медучреждение показываются «на уровне выбора, входных параметров и доступных решений»;
 * §5.7: честная пометка «прототип»). Схема строится той же функцией `generateLayout`, что и
 * визуализация v1 (lib/scene/layout, только импорт): типовые зоны, условный маршрут робота и
 * точки операций на нём. Числа на схеме — только площадь объекта из его параметров; размеры
 * зон условные, и подпись под схемой говорит об этом прямо.
 *
 * Компонент без состояния и без "use client": его можно отрисовать и на сервере, и внутри
 * клиентской рабочей области.
 */

/** Бейдж прототипа по умолчанию (ТЗ §5.7). */
export const PROTOTYPE_BADGE = "Прототип: экономика и имитация реализованы для склада";

/** Подписи видов зон схемы по-русски. */
export const ZONE_KIND_LABELS: Readonly<Record<Zone["kind"], string>> = {
  // Док в планировке v1 — общая для всех типов объекта точка загрузки, с которой начинается
  // маршрут робота: подпись нейтральная, без складской «приёмки».
  dock: "Док — точка загрузки",
  rack: "Стеллажи",
  gate: "Выходы на посадку",
  belt: "Багажная лента",
  room: "Помещения",
  zone: "Зона",
};

/**
 * Подпись зоны на схеме: своя подпись зоны («Док», «Коридор»), иначе — по виду. Ленту
 * называем полностью («Багажная лента»): она широкая, а «Лента» без контекста непонятна.
 */
export function zoneLabel(z: Zone): string {
  if (z.kind === "belt") return ZONE_KIND_LABELS.belt;
  return z.label ?? ZONE_KIND_LABELS[z.kind];
}

/** Подпись вида в легенде: док — с пояснением, остальные — как на схеме. */
function legendLabel(kind: Zone["kind"], first: Zone | undefined): string {
  if (kind === "dock" || !first) return ZONE_KIND_LABELS[kind];
  return zoneLabel(first);
}

/** Цвет зоны по виду: токены темы, чтобы схема читалась и в светлой, и в тёмной теме. */
const ZONE_CLASS: Readonly<Record<Zone["kind"], string>> = {
  dock: "fill-chart-2/25 stroke-chart-2",
  rack: "fill-chart-1/15 stroke-chart-1/60",
  gate: "fill-chart-1/15 stroke-chart-1/60",
  belt: "fill-chart-4/25 stroke-chart-4",
  room: "fill-chart-3/15 stroke-chart-3/60",
  zone: "fill-muted stroke-border",
};

/** Размеры поля схемы в единицах viewBox (координаты планировки нормированы 0–1). */
const W = 1000;
const H = 560;

/** Площадь для схемы: положительное конечное число, иначе условные 1 000 м². */
export function schematicArea(areaM2: number | null | undefined): number {
  return typeof areaM2 === "number" && Number.isFinite(areaM2) && areaM2 > 0 ? areaM2 : 1000;
}

export type FacilitySchematicProps = {
  /** Slug типа объекта: warehouse, airport, medical. */
  facility: string;
  /** Подпись типа объекта: «Склад», «Аэропорт», «Медучреждение». */
  facilityLabel: string;
  /** Площадь объекта, м² (из параметров); нет — схема строится для условных 1 000 м². */
  areaM2: number | null;
  /** Бейдж над схемой; null — без бейджа. По умолчанию — бейдж прототипа. */
  badge?: string | null;
  /** Пояснение под бейджем (почему имитации нет). */
  note?: string;
  className?: string;
};

export function FacilitySchematic({
  facility,
  facilityLabel,
  areaM2,
  badge = PROTOTYPE_BADGE,
  note,
  className,
}: FacilitySchematicProps) {
  const area = schematicArea(areaM2);
  const layout = generateLayout(mapKind(facility), area);
  const route = layout.pathTemplate.map((p) => `${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`).join(" ");
  // Точки операций — концы плеч маршрута без повторов (маршрут идёт туда и обратно).
  const points = layout.pathTemplate.filter(
    (p, i, all) => all.findIndex((q) => q.x === p.x && q.y === p.y) === i,
  );
  const kinds = [...new Set(layout.zones.map((z) => z.kind))];
  // Подпись вида в легенде — как на самой схеме (у коридора больницы — «Коридор», а не «Зона»).
  const legend = kinds.map((k) => ({ kind: k, label: legendLabel(k, layout.zones.find((z) => z.kind === k)) }));
  const labelled = new Set<string>();
  const areaText = typeof areaM2 === "number" && Number.isFinite(areaM2) && areaM2 > 0 ? `${formatNum(areaM2)} м²` : null;

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      {badge && (
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-caution/50 bg-caution/10 px-3 py-1 text-sm font-medium">
          {badge}
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Условная схема объекта «${facilityLabel}»: ${legend.map((l) => l.label).join(", ")}; пунктир — типовой маршрут робота`}
        className="w-full max-w-4xl rounded-md border bg-card"
      >
        <title>{`Схема объекта «${facilityLabel}»`}</title>
        {layout.zones.map((z, i) => {
          const x = z.x * W;
          const y = z.y * H;
          const w = z.w * W;
          const h = z.h * H;
          // Подпись — у зоны со своей подписью и у первой зоны каждого вида сетки.
          const text = zoneLabel(z);
          const showText = z.label !== undefined || !labelled.has(z.kind);
          labelled.add(z.kind);
          return (
            <g key={`${z.kind}-${i}`}>
              <rect x={x} y={y} width={w} height={h} rx={4} className={cn("stroke-1", ZONE_CLASS[z.kind])} />
              {showText && w > 60 && (
                <text x={x + 6} y={y + 18} className="fill-foreground" style={{ fontSize: 15 }}>
                  {text}
                </text>
              )}
            </g>
          );
        })}
        <polyline
          points={route}
          fill="none"
          className="stroke-primary"
          strokeWidth={3}
          strokeDasharray="10 7"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x * W} cy={p.y * H} r={7} className="fill-background stroke-primary" strokeWidth={3} />
        ))}
      </svg>
      <figcaption className="flex flex-col gap-2 text-xs text-muted-foreground">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Обозначения схемы">
          {legend.map((l) => (
            <li key={l.kind} className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
                <rect x={1} y={1} width={12} height={12} rx={2} className={cn("stroke-1", ZONE_CLASS[l.kind])} />
              </svg>
              {l.label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 14" className="h-3.5 w-6" aria-hidden="true">
              <line x1={1} y1={7} x2={23} y2={7} className="stroke-primary" strokeWidth={2} strokeDasharray="4 3" />
            </svg>
            типовой маршрут робота
          </li>
          <li className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
              <circle cx={7} cy={7} r={4.5} className="fill-background stroke-primary" strokeWidth={2} />
            </svg>
            точка операции
          </li>
        </ul>
        <span>
          Схема условная: сетка зон построена по площади объекта
          {areaText ? ` (${areaText})` : " (площадь не задана — условные 1 000 м²)"}, а не по его планировке; маршрут
          показывает типовое плечо, а не расчёт.
        </span>
      </figcaption>
    </figure>
  );
}
