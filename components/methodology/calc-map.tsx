import { Illustration } from "@/components/illustration";
import map from "@/public/methodology/00-map.json";

/**
 * Карта расчёта в начале методики: рисунок-маршрут от параметров объекта до NPV, и каждая
 * станция на нём — ссылка на свой раздел страницы. Ссылки лежат поверх картинки в процентах от её
 * размеров, поэтому попадают в таблички при любой ширине; координаты пишет сборка рисунка
 * (scripts/illustrations/scenes/methodology/00-map.mjs → 00-map.json) — руками их не правят.
 *
 * На телефоне карта не сжимается до нечитаемого: она прокручивается вбок внутри своей рамки, а
 * станции остаются достаточно крупными, чтобы в них попасть пальцем.
 */
export function CalcMap() {
  const { width, height, hotspots } = map;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg">
        <div className="relative min-w-[44rem]">
          <Illustration
            src="/methodology/00-map.svg"
            alt="Карта расчёта: человечек на дрезине везёт вагончик нормативов от параметров объекта через станции «спрос», «парк», «труд», «CAPEX», «OPEX» к станции «эффект · NPV»; от станции «парк» отходит петля имитации"
            width={width}
            height={height}
          />
          {hotspots.map((h) => (
            <a
              key={h.id}
              href={h.href}
              aria-label={h.label}
              title={h.label}
              className="absolute rounded-md transition-colors hover:bg-primary/10 hover:ring-2 hover:ring-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
              style={{ left: pct(h.x, width), top: pct(h.y, height), width: pct(h.w, width), height: pct(h.h, height) }}
            />
          ))}
        </div>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        Нажмите на станцию — откроется её раздел: формулы шага, нормативы или имитация.
        <span className="sm:hidden"> Карта прокручивается вбок.</span>
      </figcaption>
    </figure>
  );
}
