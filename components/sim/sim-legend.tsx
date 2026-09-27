import { ISO_LEGEND, SWATCH_H, SWATCH_W, isoSwatchMarkup, type IsoLegendItem } from "./iso-scene";
import { IsoStyles } from "./sim-iso-scene";

/**
 * Легенда изометрической схемы. Образцы — те же спрайты и материалы, что на схеме, в той же
 * палитре темы: робот с паллетой, без груза и на зарядке различаются и рисунком (коробки на
 * площадке, молния), и цветом полосы-индикатора, поэтому легенда читается и без цвета. Ворота
 * показаны в обоих состояниях: контур — свободны, заливка — у ворот работает робот.
 */
function Swatch({ item }: { item: IsoLegendItem }) {
  return (
    <svg
      className="iso-root shrink-0"
      width={SWATCH_W}
      height={SWATCH_H}
      viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: isoSwatchMarkup(item.swatch) }}
    />
  );
}

/** Легенда: список образцов с подписями. */
export function SimLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Легенда схемы"
      className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <IsoStyles />
      {ISO_LEGEND.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch item={item} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
