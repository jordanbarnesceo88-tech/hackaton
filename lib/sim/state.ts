import type { RngState } from "./rng";
import type { Waypoint } from "./routing";
import type { OpPoint, RobotPhase, SimLayout, SimState } from "./types";

/**
 * Внутреннее состояние движка имитации. Контракт `SimState` в types.ts заморожен после W0 и
 * объявляет только `input` и `tS`; полное состояние расширяет его здесь, в файлах T1.3, не
 * трогая контракт. Визуализация (components/sim) читает отсюда планировку, роботов и точки.
 *
 * Состояние — простые данные без замыканий: генератор хранится числом (`RngState`), задания и
 * роботы — обычными объектами. Поэтому два прогона с одним входом можно сравнить целиком, а
 * проигрывание на экране, созданное с тем же зерном, приходит ровно в то же конечное
 * состояние, что и прогон на сервере.
 */

/** Задание на перемещение паллеты. */
export type SimTask = {
  id: number;
  /** inbound — ворота приёмки → место хранения; outbound — место хранения → ворота отгрузки. */
  kind: "inbound" | "outbound";
  /** Индекс точки погрузки в `SimEngineState.points`; −1 — место хранения (без очереди). */
  fromPoint: number;
  fromX: number;
  fromY: number;
  /** Индекс точки выгрузки в `SimEngineState.points`; −1 — место хранения (без очереди). */
  toPoint: number;
  toX: number;
  toY: number;
  /** Модельное время поступления, с. */
  arrivalS: number;
  /** Модельное время, когда задание взял робот, с; null — ещё в очереди. */
  startS: number | null;
  /** Модельное время завершения (конец шага выгрузки), с; null — не завершено. */
  doneS: number | null;
};

/** Робот парка. Позиция и фаза читаются визуализацией на каждом кадре. */
export type SimRobot = {
  id: number;
  phase: RobotPhase;
  x: number;
  y: number;
  /** Уровень заряда, доля 0–1. */
  soc: number;
  /** Робот везёт паллету (для формы значка: с грузом — закрашенный квадрат). */
  loaded: boolean;
  task: SimTask | null;
  /** Текущий маршрут (фазы toPickup, toDrop, toCharger). */
  path: Waypoint[];
  pathLenM: number;
  /** Пройдено по текущему маршруту, м. */
  distM: number;
  /** Остаток погрузки или выгрузки, с. */
  timerS: number;
  /** Точка (индекс в `points`), у которой робот стоит в очереди или работает; −1 — нет. */
  pointIdx: number;
};

/** Точка операции в прогоне: занятость одним роботом и очередь FIFO. */
export type SimPointState = OpPoint & {
  /** Id робота, занимающего точку; null — свободна. */
  holder: number | null;
  /** Id роботов в очереди к точке в порядке прибытия (у зарядки — в порядке решения). */
  queue: number[];
  /** Время занятости за пиковое окно, с. */
  busyS: number;
};

/**
 * Накопители метрик. Всё, кроме `queueAtPeakStart`, считается только внутри пикового окна
 * [warmupS; endS).
 */
export type SimAccumulators = {
  /** Время парка по видам, робото-секунды. */
  loadedS: number;
  emptyS: number;
  handlingS: number;
  waitPointS: number;
  /** Путь к зарядке, ожидание станции и сама зарядка. */
  chargingS: number;
  /** Часть `chargingS`: ожидание свободной станции. */
  chargerWaitS: number;
  idleS: number;
  /** Робото-секунды с нулевым зарядом: робот разрядился, не дождавшись станции. */
  socFloorS: number;
  queueMax: number;
  /** Длина очереди заданий в момент начала пикового окна; null — окно ещё не началось. */
  queueAtPeakStart: number | null;
  /** Завершено заданий за окно. */
  doneInPeak: number;
  /** Поступило и завершено заданий по пятиминутным корзинам окна. */
  bucketArrivals: number[];
  bucketDone: number[];
};

/**
 * Результат предварительной проверки входа: ok — прогон выполняется; payload — робот не
 * поднимает груз объекта (прогон не выполняется, вердикт «не подтверждён», узкое место
 * «грузоподъёмность»); invalid — вход не позволяет моделировать (нет роботов, скорость не
 * положительна, пороги зарядки вне 0 ≤ ухода < возврата ≤ 1, вход за защитными пределами) —
 * вердикт NOT_SUPPORTED. При payload и invalid прогона нет: доли времени, загрузка и ожидание в
 * сводке — нули, которые означают «не применимо», а не «простой 0 %» (см. `simWasRun`).
 */
export type SimPrecheck = "ok" | "payload" | "invalid";

/** Полное состояние прогона. */
export interface SimEngineState extends SimState {
  readonly layout: SimLayout;
  /** Начало пикового окна (конец прогрева), с. */
  readonly warmupS: number;
  /** Конец прогона, с. */
  readonly endS: number;
  /** Зарядка моделируется: заданы и автономность, и время зарядки. */
  readonly chargeModelled: boolean;
  readonly precheck: SimPrecheck;
  rng: RngState;
  robots: SimRobot[];
  /** Все поступившие задания в порядке поступления. Очередь — хвост с индекса `head`. */
  tasks: SimTask[];
  /** Индекс первого невзятого задания: задания выдаются строго по порядку (FIFO). */
  head: number;
  /** Завершено заданий с начала прогона. */
  doneCount: number;
  /** Ворота приёмки, затем ворота отгрузки, затем зарядные станции. */
  points: SimPointState[];
  acc: SimAccumulators;
}

/** Длина очереди заданий (поступили, но ещё не взяты роботом). */
export function queueLength(s: SimEngineState): number {
  return s.tasks.length - s.head;
}
