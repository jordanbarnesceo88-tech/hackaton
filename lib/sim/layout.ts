import type { OpPoint, SimLayout, SimLayoutParams } from "./types";

/**
 * Планировка склада для имитации и для расчёта плеча перевозки (ТЗ §3.6.1: типовые зоны,
 * маршруты, точки операций, зарядка). Одна и та же планировка рисуется на экране, служит
 * имитации и даёт аналитическое среднее плечо (`analytic.expectedLegsM`), по которому
 * экономика считает производительность робота по циклу, — поэтому схема не может разойтись с
 * расчётом (§3.6.2).
 *
 * Размеры планировки: прямоугольник 2 : 1 площадью A — ширина W = √(2A), глубина H = √(A/2),
 * W × H = A. Корень считается методом Ньютона на одной арифметике (`sqrtNewton`): в имитации
 * `Math.sqrt` запрещён договорённостью (см. eslint.config.mjs).
 *
 * Вдоль левой стены — полоса приёмки с воротами, в её нижнем углу — зарядка; вдоль правой —
 * полоса отгрузки; между ними хранение: три поперечных (главных) проезда и вертикальные
 * стеллажные проходы. Места хранения — точки на осях стеллажных проходов.
 */

/**
 * Константы типовой планировки. Площадь, ширина проездов и число ворот берутся из параметров
 * объекта; всё остальное здесь — допущения модели с обоснованием. Они влияют на среднее
 * плечо, поэтому перечислены в методике и во фрагменте CHANGELOG задачи T1.3.
 */
export const LAYOUT_ASSUMPTIONS = {
  /**
   * Ширина полосы приёмки и полосы отгрузки вдоль стен, м. Оценка: буферная зона у ворот, где
   * паллеты ждут размещения или погрузки; реальная ширина зависит от объекта.
   */
  dockStripM: 8,
  /** Сторона угла зарядки (левый нижний угол), м. Оценка: несколько станций с подъездом. */
  chargingCornerM: 8,
  /**
   * Отступ первого и последнего стеллажного прохода от стены, м. Оценка: полоса ворот (8 м)
   * плюс проезд вдоль неё.
   */
  rackMarginM: 12,
  /**
   * Глубина двойного ряда стеллажей между соседними проходами, м: два ряда «спина к спине»
   * по 1,2 м — длина европаллеты 1200 мм (датасет организатора, «Средние габариты паллеты
   * 1200×800×1600 мм»). Шаг проходов = ширина прохода + 2,4 м.
   */
  rackRowDepthM: 2.4,
  /**
   * Шаг мест хранения вдоль прохода, м. Выбор модели: места — представительные точки, а не
   * каждое паллетоместо; среднее плечо от шага почти не зависит, а число пар в расчёте
   * среднего остаётся небольшим.
   */
  slotPitchM: 4,
} as const;

/**
 * Квадратный корень методом Ньютона только на сложении, умножении и делении — чтобы Node и
 * браузер давали одинаковый результат без `Math.sqrt`.
 *
 * Аргумент сначала масштабируется степенями четвёрки в [0,25; 4] (деление и умножение на
 * степень двойки в двоичной арифметике точны), затем выполняются ровно 30 итераций
 * g ← (g + m/g) / 2 от g = 1 — на этом отрезке их с запасом хватает, чтобы остановиться не
 * дальше 1 ulp от точного корня (относительная ошибка ≤ 2,3e−16). Число итераций фиксировано,
 * а каждая операция по IEEE 754 округляется однозначно, поэтому результат детерминирован.
 *
 * Для x ≤ 0 и NaN возвращает 0 (длина стороны не бывает отрицательной), для +∞ — +∞.
 */
export function sqrtNewton(x: number): number {
  if (x === Infinity) return Infinity;
  if (!(x > 0)) return 0;
  let m = x;
  let scale = 1;
  while (m > 4) {
    m = m / 4;
    scale = scale * 2;
  }
  while (m < 0.25) {
    m = m * 4;
    scale = scale / 2;
  }
  let g = 1;
  for (let i = 0; i < 30; i++) g = 0.5 * (g + m / g);
  return g * scale;
}

/**
 * Защитные пределы планировки. Это не нормативы, а предохранитель от заведомо ошибочного ввода
 * (например, площадь в квадратных сантиметрах через API): без него построение планировки и
 * расчёт среднего плеча на сервере растут квадратично и могут занять минуты.
 * - Площадь активной зоны — не больше 1 000 000 м², в 20 раз больше максимума датасета
 *   организатора (50 000 м²).
 * - Ворот каждого вида и зарядных станций — не больше 2000.
 * Адаптер (`toSimInput`) сообщает о выходе за пределы явно; здесь значения прижимаются, чтобы
 * функция оставалась тотальной для прямых вызовов.
 */
export const LAYOUT_LIMITS = {
  maxActiveAreaM2: 1_000_000,
  maxPointsPerKind: 2000,
} as const;

/** Положительное конечное число, прижатое к `max`, или запасное значение. */
function positiveOr(v: number, fallback: number, max = Infinity): number {
  if (!(Number.isFinite(v) && v > 0)) return fallback;
  return v > max ? max : v;
}

/** Целое число в [min; max] (дробное округляется). */
function intBetween(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const r = Math.round(v);
  return r < min ? min : r > max ? max : r;
}

/** Точки операций, равномерно распределённые по вертикали на отрезке [y0, y1] при x. */
function spreadY(kind: OpPoint["kind"], prefix: string, n: number, x: number, y0: number, y1: number): OpPoint[] {
  const out: OpPoint[] = [];
  const step = (y1 - y0) / (n + 1);
  for (let i = 0; i < n; i++) out.push({ id: `${prefix}${i + 1}`, kind, x, y: y0 + (i + 1) * step });
  return out;
}

/**
 * Строит планировку склада по параметрам объекта.
 *
 * - Размеры: W = √(2A), H = √(A/2).
 * - Зоны: приёмка — полоса x ∈ [0; 8] над углом зарядки; зарядка — угол 8 × 8 м слева внизу;
 *   отгрузка — полоса x ∈ [W − 8; W]; хранение — между полосами. Для очень малых площадей
 *   полосы сужаются до четверти ширины, а угол — до половины глубины.
 * - Поперечные проезды: y = main/2, H/2, H − main/2.
 * - Стеллажные проходы: x = 12 + k × (ширина прохода + 2,4), пока x < W − 12 (не меньше одного —
 *   по центру, если планировка слишком узкая).
 * - Места хранения: на каждом стеллажном проходе через 4 м (y = 2, 6, 10 …), кроме полос
 *   ±main/2 вокруг поперечных проездов.
 * - Ворота приёмки и отгрузки распределены равномерно по высоте своих полос (не меньше одних),
 *   зарядные станции — сеткой в углу зарядки (0 станций — зарядка не предусмотрена).
 *
 * Функция тотальная: неположительные или нечисловые размеры заменяются минимальными
 * допустимыми, счётчики округляются, заведомо ошибочные величины прижимаются к
 * `LAYOUT_LIMITS`. Входные параметры проверяет вызывающий код (адаптер).
 */
export function buildWarehouseLayout(p: SimLayoutParams): SimLayout {
  const maxPts = LAYOUT_LIMITS.maxPointsPerKind;
  const area = positiveOr(p.activeAreaM2, 1, LAYOUT_LIMITS.maxActiveAreaM2);
  const main = positiveOr(p.mainAisleWidthM, 1);
  const rackAisle = positiveOr(p.rackAisleWidthM, 1);
  const nReceiving = intBetween(p.receivingDocksCount, 1, maxPts);
  const nShipping = intBetween(p.shippingDocksCount, 1, maxPts);
  const nChargers = intBetween(p.chargers, 0, maxPts);

  const W = sqrtNewton(2 * area);
  const H = sqrtNewton(area / 2);

  const strip = Math.min(LAYOUT_ASSUMPTIONS.dockStripM, W / 4);
  const corner = Math.min(LAYOUT_ASSUMPTIONS.chargingCornerM, H / 2);
  const margin = Math.min(LAYOUT_ASSUMPTIONS.rackMarginM, W / 4);

  const zones: SimLayout["zones"] = [
    { kind: "receiving", label: "Приёмка", x: 0, y: corner, w: strip, h: H - corner },
    { kind: "charging", label: "Зарядка", x: 0, y: 0, w: strip, h: corner },
    { kind: "storage", label: "Хранение", x: strip, y: 0, w: W - 2 * strip, h: H },
    { kind: "shipping", label: "Отгрузка", x: W - strip, y: 0, w: strip, h: H },
  ];

  const crossAislesY = [main / 2, H / 2, H - main / 2];

  const pitch = rackAisle + LAYOUT_ASSUMPTIONS.rackRowDepthM;
  const rackAislesX: number[] = [];
  for (let k = 0; ; k++) {
    const x = margin + k * pitch;
    if (!(x < W - margin)) break;
    rackAislesX.push(x);
  }
  if (rackAislesX.length === 0) rackAislesX.push(W / 2);

  const slotYs: number[] = [];
  const half = LAYOUT_ASSUMPTIONS.slotPitchM / 2;
  for (let k = 0; ; k++) {
    const y = half + k * LAYOUT_ASSUMPTIONS.slotPitchM;
    if (!(y < H)) break;
    let inCrossAisle = false;
    for (const c of crossAislesY) {
      if (Math.abs(y - c) <= main / 2) inCrossAisle = true;
    }
    if (!inCrossAisle) slotYs.push(y);
  }
  // Проезды шире шага мест съели все места — ставим одно место на четверти глубины (между
  // нижним и средним проездом).
  if (slotYs.length === 0) slotYs.push(H / 4);

  const slots: SimLayout["slots"] = [];
  for (const x of rackAislesX) {
    for (const y of slotYs) slots.push({ x, y });
  }

  const receiving = spreadY("receiving", "R", nReceiving, strip / 2, corner, H);
  const shipping = spreadY("shipping", "S", nShipping, W - strip / 2, 0, H);

  const chargers: OpPoint[] = [];
  if (nChargers > 0) {
    let cols = 1;
    while (cols * cols < nChargers) cols++;
    const rows = Math.ceil(nChargers / cols);
    for (let i = 0; i < nChargers; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      chargers.push({
        id: `C${i + 1}`,
        kind: "charger",
        x: ((col + 0.5) * strip) / cols,
        y: ((row + 0.5) * corner) / rows,
      });
    }
  }

  return { widthM: W, heightM: H, zones, crossAislesY, rackAislesX, slots, receiving, shipping, chargers };
}

/**
 * Типы объектов, для которых доступна имитация склада: сам склад и складоподобные объекты
 * таксономии (scripts/seed-data/taxonomy.ts). Остальным показывается схема-иллюстрация.
 */
const WAREHOUSE_LIKE = new Set([
  "warehouse",
  "fulfillment",
  "darkstore",
  "cold-storage",
  "distribution-center",
  "parcel-hub",
  "pharmacy-warehouse",
  "pharma-warehouse",
  "mine-warehouse",
]);

/** Складоподобный ли тип объекта (для него есть планировка и имитация). */
export function isWarehouseLike(slug: string): boolean {
  return WAREHOUSE_LIKE.has(slug);
}
