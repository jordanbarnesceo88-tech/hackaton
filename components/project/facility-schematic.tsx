import { SWATCH_H, SWATCH_W, isoSchematicSvg, isoSwatchMarkup, isoZoneSwatchMarkup } from "@/components/sim/iso-scene";
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
 * Рисуется той же изометрией, что схема склада (components/sim/iso-scene): зоны — коробками,
 * маршрут — бегущим пунктиром, на первом плече — робот; палитра следует теме страницы.
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
  const kinds = [...new Set(layout.zones.map((z) => z.kind))];
  // Подпись вида в легенде — как на самой схеме (у коридора больницы — «Коридор», а не «Зона»).
  const legend = kinds.map((k) => ({ kind: k, label: legendLabel(k, layout.zones.find((z) => z.kind === k)) }));
  // Подпись — у зоны со своей подписью и у первой зоны каждого вида сетки, если зона не узкая.
  const labelled = new Set<string>();
  const svg = isoSchematicSvg(layout, {
    label: `Условная схема объекта «${facilityLabel}»: ${legend.map((l) => l.label).join(", ")}; пунктир — типовой маршрут робота`,
    className: "h-auto w-full",
    labelFor: (z) => {
      const show = z.label !== undefined || !labelled.has(z.kind);
      labelled.add(z.kind);
      return show && z.w > 0.06 ? zoneLabel(z) : null;
    },
  });
  const areaText = typeof areaM2 === "number" && Number.isFinite(areaM2) && areaM2 > 0 ? `${formatNum(areaM2)} м²` : null;

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      {badge && (
        <p data-tone="warn" className="callout callout--sm w-fit">
          {badge}
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <div
        className="w-full max-w-4xl overflow-hidden rounded-panel border border-border bg-[radial-gradient(ellipse_80%_70%_at_55%_45%,var(--card),transparent_72%)]"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="flex flex-col gap-2 text-xs text-muted-foreground">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Обозначения схемы">
          {legend.map((l) => (
            <li key={l.kind} className="inline-flex items-center gap-1.5">
              <svg
                className="iso-root shrink-0"
                width={SWATCH_W}
                height={SWATCH_H}
                viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: isoZoneSwatchMarkup(l.kind) }}
              />
              {l.label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <svg
              className="iso-root shrink-0"
              width={SWATCH_W}
              height={SWATCH_H}
              viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: isoSwatchMarkup({ kind: "route", route: "loaded" }) }}
            />
            типовой маршрут робота
          </li>
          <li className="inline-flex items-center gap-1.5">
            <svg
              className="iso-root shrink-0"
              width={SWATCH_W}
              height={SWATCH_H}
              viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: isoSwatchMarkup({ kind: "pad", busy: false }) }}
            />
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
