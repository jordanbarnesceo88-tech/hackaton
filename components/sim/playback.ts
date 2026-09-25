/**
 * Параметры проигрывания имитации на экране (ТЗ §3.6.3 — старт, стоп, перезапуск, скорость).
 *
 * Проигрывание — отдельный прогон с тем же зерном, что и прогон без анимации: движок
 * детерминирован, поэтому кадр за кадром он приходит ровно в то же конечное состояние и к той же
 * сводке. Хранить запись прогона не нужно.
 */

/** Скорости проигрывания. Базовая ×1 — одна модельная минута за секунду. */
export const SPEEDS = [1, 2, 4, 8, 16] as const;

/**
 * Скорость по умолчанию ×8: прогрев 15 мин и пик 120 мин (нормативы simWarmupMin, simPeakMin)
 * проигрываются примерно за 17 с — достаточно, чтобы увидеть очередь у ворот, и не утомительно.
 */
export const DEFAULT_SPEED = 8;

/** Модельных секунд за секунду при скорости ×1. */
export const SIM_SECONDS_PER_REAL_SECOND = 60;

/**
 * Предел длительности кадра, с. После сворачивания вкладки или долгой сборки мусора кадр мог бы
 * «съесть» минуты модели разом; ограничение превращает такой скачок в короткую паузу.
 */
export const MAX_FRAME_DT_S = 0.1;

/** Интервал отправки показателей в React при проигрывании, мс (не чаще 4 раз в секунду). */
export const KPI_PUSH_INTERVAL_MS = 250;

/**
 * Сколько шагов модели (по 1 с) сделать за кадр длительностью `frameDtS` секунд при скорости
 * `speed`: speed × 60 × frameDt, с переносом дробного остатка на следующий кадр (`carry`), чтобы
 * малые скорости при частых кадрах не теряли время. Кадр длиннее `MAX_FRAME_DT_S` урезается.
 */
export function stepsForFrame(speed: number, frameDtS: number, carry: number): { steps: number; carry: number } {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const dt = Number.isFinite(frameDtS) && frameDtS > 0 ? Math.min(frameDtS, MAX_FRAME_DT_S) : 0;
  const c = Number.isFinite(carry) && carry > 0 ? carry : 0;
  const total = c + s * SIM_SECONDS_PER_REAL_SECOND * dt;
  const steps = Math.floor(total);
  return { steps, carry: total - steps };
}
