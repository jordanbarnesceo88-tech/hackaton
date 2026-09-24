import { routeLengthBetween } from "./routing";
import type { SimLayout } from "./types";

/**
 * Аналитическое среднее плечо и производительность робота по циклу на планировке объекта.
 *
 * Это мост между имитацией и экономикой (ТЗ §3.6.2): экономика (lib/tz/econ) получает
 * производительность по циклу `thrCycle` именно отсюда — на той же планировке и по тем же
 * маршрутам, по которым потом едут роботы в имитации. Поэтому один робот при непрерывном
 * потоке заданий в имитации даёт ту же производительность, что и формула (проверяется тестом).
 */

/** Среднее плечо цикла, м: с грузом и порожнее. */
export type ExpectedLegs = { loadedM: number; emptyM: number };

type Pt = { x: number; y: number };

/** Среднее по всем упорядоченным парам (a из A, b из B) длины маршрута a → b, м. */
function avgRoute(layout: SimLayout, from: readonly Pt[], to: readonly Pt[]): number {
  if (from.length === 0 || to.length === 0) return 0;
  let sum = 0;
  for (const a of from) {
    for (const b of to) sum += routeLengthBetween(layout, a.x, a.y, b.x, b.y);
  }
  return sum / (from.length * to.length);
}

/**
 * Среднее по всем упорядоченным парам мест хранения — тот же результат, что `avgRoute(K, K)`,
 * но без перебора всех пар мест. Маршрут между местами раскладывается на горизонталь
 * |xa − xb| и вертикаль: в одном проходе |ya − yb|, в разных — min по проездам
 * |ya − c| + |yb − c|. Места группируются по проходу (X), вертикальные суммы считаются один
 * раз на пару различных наборов Y (в типовой планировке набор один на все проходы). Так
 * сложность — квадрат числа проходов плюс квадрат числа мест в проходе, а не квадрат числа
 * мест: на 50 000 м² это миллисекунды вместо сотен миллисекунд.
 */
function avgSlotToSlot(layout: SimLayout): number {
  const K = layout.slots;
  if (K.length === 0) return 0;
  const byX = new Map<number, number[]>();
  for (const s of K) {
    const list = byX.get(s.x);
    if (list) list.push(s.y);
    else byX.set(s.x, [s.y]);
  }
  const xs = [...byX.keys()];
  const ys = xs.map((x) => byX.get(x)!);
  const keys = ys.map((list) => list.join(","));

  const sameCache = new Map<string, number>();
  const crossCache = new Map<string, number>();
  const sumSame = (i: number): number => {
    const cached = sameCache.get(keys[i]!);
    if (cached !== undefined) return cached;
    const list = ys[i]!;
    let sum = 0;
    for (const a of list) for (const b of list) sum += Math.abs(a - b);
    sameCache.set(keys[i]!, sum);
    return sum;
  };
  const sumCross = (i: number, j: number): number => {
    const key = `${keys[i]}|${keys[j]}`;
    const cached = crossCache.get(key);
    if (cached !== undefined) return cached;
    let sum = 0;
    for (const a of ys[i]!) {
      for (const b of ys[j]!) {
        let best = Infinity;
        for (const c of layout.crossAislesY) {
          const len = Math.abs(a - c) + Math.abs(b - c);
          if (len < best) best = len;
        }
        sum += best;
      }
    }
    crossCache.set(key, sum);
    return sum;
  };

  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < xs.length; j++) {
      total += Math.abs(xs[i]! - xs[j]!) * ys[i]!.length * ys[j]!.length;
      total += i === j ? sumSame(i) : sumCross(i, j);
    }
  }
  return total / (K.length * K.length);
}

/**
 * Точные средние длины плеч для смеси заданий 50/50: приёмка (ворота приёмки R → место
 * хранения K) и отгрузка (место K → ворота отгрузки S). Ворота и места выбираются равномерно
 * — так же, как в имитации.
 *
 * - С грузом: 0,5 × avg(R→K) + 0,5 × avg(K→S).
 * - Порожнее плечо — от конца предыдущего задания до начала следующего; предыдущее кончилось
 *   на месте (приёмка) или у ворот отгрузки (отгрузка), следующее начинается у ворот приёмки
 *   или на месте, каждое сочетание с вероятностью 0,25:
 *   0,25 × [avg(K→R) + avg(K→K) + avg(S→R) + avg(S→K)].
 *
 * Средние считаются по всем парам, без выборки (пары мест хранения — через разложение по
 * проходам, см. `avgSlotToSlot`), поэтому результат точный и детерминированный.
 */
export function expectedLegsM(layout: SimLayout): ExpectedLegs {
  const R = layout.receiving;
  const S = layout.shipping;
  const K = layout.slots;
  const loadedM = 0.5 * avgRoute(layout, R, K) + 0.5 * avgRoute(layout, K, S);
  const emptyM =
    0.25 * (avgRoute(layout, K, R) + avgSlotToSlot(layout) + avgRoute(layout, S, R) + avgRoute(layout, S, K));
  return { loadedM, emptyM };
}

/** Вход формулы цикла. */
export type CycleInputs = {
  /** Среднее плечо с грузом, м. */
  loadedM: number;
  /** Среднее порожнее плечо, м. */
  emptyM: number;
  /** Паспортная скорость робота, м/с. */
  speedMps: number;
  /** Доля скорости при движении с грузом (норматив loadedSpeedFactor). */
  loadedSpeedFactor: number;
  /** Время захвата или постановки груза, с (норматив по классу погрузки); в цикле дважды. */
  handlingSec: number;
};

/**
 * Длительность одного цикла, с: emptyM / v + loadedM / (v × f) + 2 × handlingSec.
 * null — цикл не определён (скорость или доля скорости не положительны, числа не конечны).
 */
export function expectedCycleS(c: CycleInputs): number | null {
  const { loadedM, emptyM, speedMps: v, loadedSpeedFactor: f, handlingSec } = c;
  if (!(v > 0) || !(f > 0) || !Number.isFinite(v) || !Number.isFinite(f)) return null;
  if (!(loadedM >= 0) || !(emptyM >= 0) || !(handlingSec >= 0)) return null;
  const cycle = emptyM / v + loadedM / (v * f) + 2 * handlingSec;
  if (!(cycle > 0) || !Number.isFinite(cycle)) return null;
  return cycle;
}

/**
 * Производительность одного робота по циклу, заданий (паллет) в час:
 * 3600 / (emptyM / v + loadedM / (v × f) + 2 × handlingSec).
 *
 * Это `thrCycle` экономики (ТЗ §3.5.2: парк = пиковая потребность / эффективная
 * производительность). null — цикл не определён (см. `expectedCycleS`); экономика тогда
 * опирается только на паспортную норму.
 */
export function cycleThroughputPerH(c: CycleInputs): number | null {
  const cycle = expectedCycleS(c);
  return cycle === null ? null : 3600 / cycle;
}
