import { DEFAULT_NORMS } from "../tz/norms";
import type { RobotSimParams, SimInput, SimLayoutParams } from "./types";

/**
 * Эталонные входы имитации для тестов и примеров: базовый склад организатора и робот
 * Ronavi H1500. Числа не выдуманы — у каждого указан источник; значения, которых в данных
 * нет, помечены как оценка.
 */

/**
 * Планировка базового склада. Площадь активной зоны 10 000 м², главные проезды 3,5 м, рабочие
 * проходы 2,8 м — датасет организатора, лист «Склад» (базовые значения). Ворот приёмки и
 * отгрузки по 4 — дополнение параметров T1.1 (оценка: в датасете числа ворот нет). Одна
 * зарядная станция — расчёт экономики для демо-парка H1500 из 11 роботов (парк по циклу на
 * этой планировке, см. demo.test.ts): ⌈11 × 18 / (6 × 60 + 18) × 1,5⌉ = ⌈0,79⌉ = 1.
 */
export const WAREHOUSE_BASE_LAYOUT: Readonly<SimLayoutParams> = Object.freeze({
  activeAreaM2: 10000,
  mainAisleWidthM: 3.5,
  rackAisleWidthM: 2.8,
  receivingDocksCount: 4,
  shippingDocksCount: 4,
  chargers: 1,
});

/**
 * Суточный объём перемещений базового склада, паллет/сут: (приёмка 1000 + отгрузка 1000 +
 * внутренние 0) × (1 − 5 % негабарита) = 1900 (датасет организатора, лист «Склад»).
 */
export const WAREHOUSE_BASE_PALLETS_PER_DAY = (1000 + 1000 + 0) * (1 - 5 / 100);

/** Часы работы в сутки: 2 смены × 11 ч (датасет организатора). */
export const WAREHOUSE_BASE_HOURS_PER_DAY = 2 * 11;

/** Средний поток, паллет/ч: 1900 / 22 ≈ 86,36. */
export const WAREHOUSE_BASE_AVG_PER_H = WAREHOUSE_BASE_PALLETS_PER_DAY / WAREHOUSE_BASE_HOURS_PER_DAY;

/** Пиковый поток, паллет/ч: средний × пиковый коэффициент 1,5 (датасет) ≈ 129,55. */
export const WAREHOUSE_BASE_PEAK_PER_H = WAREHOUSE_BASE_AVG_PER_H * 1.5;

/** Средняя масса паллеты, кг (датасет организатора, лист «Склад»). */
export const WAREHOUSE_BASE_PALLET_MASS_KG = 800;

/**
 * Ronavi H1500: 1,5 м/с, 6 ч работы, зарядка 18 мин, грузоподъёмность 1500 кг — «Примеры
 * решений» организатора. Время захвата 20 с и доля скорости с грузом 0,8 — нормативы-оценки
 * (handlingSecJacking, loadedSpeedFactor). Число роботов задаёт тест.
 */
export const H1500_ROBOT: Readonly<Omit<RobotSimParams, "count">> = Object.freeze({
  speedMps: 1.5,
  loadedSpeedFactor: DEFAULT_NORMS.loadedSpeedFactor,
  handlingSec: DEFAULT_NORMS.handlingSecJacking,
  autonomyH: 6,
  chargeMin: 18,
  payloadKg: 1500,
});

/**
 * Вход имитации базового склада с парком H1500 из `fleet` роботов и нормативами по умолчанию.
 * `patch` точечно заменяет части входа (глубокого слияния нет — передавайте часть целиком).
 */
export function warehouseBaseInput(fleet: number, patch: Partial<SimInput> = {}): SimInput {
  return {
    seed: 1,
    layout: { ...WAREHOUSE_BASE_LAYOUT },
    robots: { ...H1500_ROBOT, count: fleet },
    demand: {
      avgPerH: WAREHOUSE_BASE_AVG_PER_H,
      peakPerH: WAREHOUSE_BASE_PEAK_PER_H,
      warmupMin: DEFAULT_NORMS.simWarmupMin,
      peakMin: DEFAULT_NORMS.simPeakMin,
    },
    loadMassKg: WAREHOUSE_BASE_PALLET_MASS_KG,
    thresholds: {
      servedShareMin: DEFAULT_NORMS.simServedShareMin,
      p95WaitMaxMin: DEFAULT_NORMS.simP95WaitMaxMin,
      oversizedIdleShare: DEFAULT_NORMS.simOversizedIdleShare,
    },
    charge: { startSoc: DEFAULT_NORMS.chargeStartSoc, stopSoc: DEFAULT_NORMS.chargeStopSoc },
    ...patch,
  };
}
