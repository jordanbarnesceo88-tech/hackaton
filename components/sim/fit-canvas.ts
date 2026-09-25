/**
 * Подгонка буфера канвы под её размер на экране и плотность пикселей устройства.
 *
 * Буфер фиксированного размера, растянутый CSS до ширины колонки, на ретине даёт мыло — а схема
 * склада и есть то изображение, по которому жюри проверяет имитацию. Поэтому буфер = CSS-размер ×
 * devicePixelRatio, а рисование идёт в логических (CSS) пикселях через `setTransform(dpr, …)`.
 *
 * Шаблон перенесён из components/facility-visualization.tsx (строки 134–147) копией: тот файл
 * заморожен вместе с моделью v1.
 */

/** Логический размер области рисования и плотность пикселей. */
export type CanvasBox = { W: number; H: number; dpr: number };

/**
 * Верхняя граница плотности пикселей. Буфер растёт квадратично: при dpr 4 канва шириной 1000 px
 * занимала бы 4000 × 2000 точек, а на глаз разницы с dpr 3 нет.
 */
export const MAX_DPR = 3;

/**
 * Размер буфера для логического размера `cssW` × `cssH`, соотношения сторон `aspect` (ширина /
 * высота) и плотности `dpr`. Высота берётся фактическая (рамка канвы съедает пару пикселей, и
 * буфер по W / aspect растягивался бы по вертикали); если её нет — W / aspect. Некорректные
 * значения заменяются безопасными: ширина — `fallbackW`, плотность — 1, соотношение — 2
 * (планировка склада имеет пропорции 2 : 1).
 */
export function bufferSize(
  cssW: number,
  cssH: number,
  aspect: number,
  dpr: number,
  fallbackW = 720,
): { W: number; H: number; dpr: number; bw: number; bh: number } {
  const W = Number.isFinite(cssW) && cssW > 0 ? cssW : fallbackW;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 2;
  const d = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, MAX_DPR) : 1;
  const H = Number.isFinite(cssH) && cssH > 0 ? cssH : Math.round(W / a);
  return { W, H, dpr: d, bw: Math.round(W * d), bh: Math.round(H * d) };
}

/**
 * Подгоняет буфер `canvas` под его CSS-размер и плотность пикселей и возвращает логический
 * размер. Размер буфера меняется только при расхождении: присваивание `width`/`height` очищает
 * канву, поэтому делать его на каждом кадре нельзя.
 */
export function fitCanvas(canvas: HTMLCanvasElement, aspect = 2): CanvasBox {
  const { W, H, dpr, bw, bh } = bufferSize(
    canvas.clientWidth,
    canvas.clientHeight,
    aspect,
    window.devicePixelRatio || 1,
  );
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  return { W, H, dpr };
}
