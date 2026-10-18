import { customerQueueLength, customerWorkStarts } from "./customer-work";
import { assignTasks, setPath, type SimDispatchGate } from "./dispatch";
import { buildWarehouseLayout } from "./layout";
import { bernoulliArrivals, createRng, nextRandom } from "./rng";
import { positionAlong } from "./routing";
import { validateSiteLayout } from "./site-layout";
import { queueLength } from "./state";
import type { SimEngineState, SimPointState, SimPrecheck, SimRobot, SimTask } from "./state";
import type { SimInput } from "./types";
import { demandMixOf, validDemandMix } from "./demand-mix";

/** Optional caller-owned motion reservation. Omitted by the production calculation. */
export type SimMovementGate = (state: SimEngineState, robot: SimRobot, nextDistM: number) => boolean | number;
/** Optional demo fault gate: a held robot neither moves nor completes handling/charging. */
export type SimRobotStepGate = (state: SimEngineState, robot: SimRobot) => boolean;
export type SimHandlingGate = (state: SimEngineState, robot: SimRobot, dtS: number) => boolean;

/**
 * Движок имитации склада: дискретное время с шагом 1 с, детерминированный (ТЗ §2.1.4 —
 * проверка достижимости производительности, загрузки, простоев и узких мест; §3.6.2 —
 * визуализация подтверждает расчёт).
 *
 * За шаг: поступают задания (испытания Бернулли от сидируемого генератора) → диспетчер
 * отправляет разряженных свободных роботов на зарядку и раздаёт задания по очереди → каждый
 * робот в порядке id проходит свой шаг конечного автомата:
 *   idle → toPickup → [waitPoint] → loading → toDrop → [waitPoint] → unloading → idle,
 *   idle → toCharger → waitCharger → charging → idle.
 * Ожидание у точки бывает только у ворот (одна машина за раз); у места хранения очереди нет.
 *
 * Поток: `warmupMin` минут на среднем потоке, затем `peakMin` минут на пиковом. Метрики
 * считаются только по пиковому окну. Разъезды роботов и заторы в проходах не моделируются.
 */

/** Длина корзины ряда для графика «требуется / достигнуто», с. */
export const BUCKET_S = 300;

/**
 * Защитные пределы прогона — предохранитель от заведомо ошибочного ввода, а не нормативы:
 * прогон с миллионами заданий или тысячами роботов на сервере занял бы минуты и гигабайты
 * памяти. Вход за пределами получает предварительную проверку `invalid` (вердикт
 * NOT_SUPPORTED); адаптер `toSimInput` сообщает об этом заранее, с подсказкой.
 * - Роботов — не больше 2000 (ручной парк проекта ограничен 500).
 * - Ожидаемое число заданий за прогон (средний поток × прогрев + пиковый × окно) — не больше
 *   1 000 000; максимум датасета организатора (5000 + 5000 паллет/сут, пик 2,5) — около 20 000.
 */
export const SIM_LIMITS = {
  maxRobots: 2000,
  maxExpectedTasks: 1_000_000,
} as const;

/** Ожидаемое число заданий за прогон: λavg × прогрев + λpk × пиковое окно (отрицательные — 0). */
export function expectedTasks(demand: SimInput["demand"]): number {
  const pos = (v: number) => (v > 0 ? v : 0);
  if (demand.offered) return pos(demand.offered.perH) * (pos(demand.warmupMin) + pos(demand.peakMin)) / 60;
  return (pos(demand.avgPerH) * pos(demand.warmupMin)) / 60 + (pos(demand.peakPerH) * pos(demand.peakMin)) / 60;
}

/** Допуск завершения погрузки: таймер считается истёкшим, если остаток не больше этого, с. */
const TIMER_EPS = 1e-9;

function isPositive(v: number | null): v is number {
  return v !== null && Number.isFinite(v) && v > 0;
}

function nonNegative(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Дробная часть: x − ⌊x⌋. */
function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * Число роботов, запрошенное входом: целая часть `robots.count`, не меньше 0 (не число — 0).
 * Сводка показывает именно его, даже если прогон не выполнялся.
 */
export function requestedFleet(input: SimInput): number {
  const c = input.robots.count;
  return Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
}

/**
 * Пороги зарядки допустимы: оба конечные и 0 ≤ ухода < возврата ≤ 1. `resolveNorms`
 * гарантирует это для нормативов; проверка защищает от прямого вызова с порогами в процентах
 * (20 и 90 вместо 0,2 и 0,9) или перепутанными местами — иначе заряд вышел бы за 1, а робот
 * метался бы между зарядкой и простоем каждый шаг.
 */
export function chargeThresholdsValid(charge: SimInput["charge"]): boolean {
  const { startSoc, stopSoc } = charge;
  return (
    Number.isFinite(startSoc) && Number.isFinite(stopSoc) && startSoc >= 0 && startSoc < stopSoc && stopSoc <= 1
  );
}

/** Результат предварительной проверки входа (см. `SimPrecheck`). */
function precheckOf(input: SimInput, count: number, chargeModelled: boolean): SimPrecheck {
  const rb = input.robots;
  const d = input.demand;
  const demandOk =
    Number.isFinite(d.avgPerH) &&
    d.avgPerH >= 0 &&
    Number.isFinite(d.peakPerH) &&
    d.peakPerH >= 0 &&
    Number.isFinite(d.warmupMin) &&
    // Пустое пиковое окно подтвердило бы что угодно: заданий нет — «всё обслужено».
    Number.isFinite(d.peakMin) &&
    Math.round(d.peakMin * 60) > 0 &&
    !(expectedTasks(d) > SIM_LIMITS.maxExpectedTasks) &&
    (d.mix === undefined || validDemandMix(d.mix)) &&
    (d.storageVacancyShare === undefined || Number.isFinite(d.storageVacancyShare) && d.storageVacancyShare >= 0 && d.storageVacancyShare <= 0.9) &&
    (d.offered === undefined || d.offered !== null && d.offered.protocol === "periodic-capacity-1" && Number.isFinite(d.offered.perH) && d.offered.perH > 0 && Object.keys(d.offered).every(k => k === "protocol" || k === "perH"));
  if (
    count < 1 ||
    count > SIM_LIMITS.maxRobots ||
    !isPositive(rb.speedMps) ||
    !isPositive(rb.loadedSpeedFactor) ||
    !(Number.isFinite(rb.handlingSec) && rb.handlingSec >= 0) ||
    // Пороги зарядки проверяются, только когда зарядка моделируется: иначе они не используются.
    (chargeModelled && !chargeThresholdsValid(input.charge)) ||
    !demandOk
  ) {
    return "invalid";
  }
  if (rb.payloadKg !== null && input.loadMassKg !== null && rb.payloadKg < input.loadMassKg) return "payload";
  return "ok";
}

/**
 * Создаёт прогон по входу. Роботы стартуют свободными, распределёнными по местам хранения
 * равномерно по номеру (как в установившемся режиме), с зарядом 0,3 + 0,7 × frac(id × 0,618) —
 * детерминированный разброс, чтобы роботы не уходили на зарядку одновременно. Без
 * моделирования зарядки заряд равен 1 и не расходуется.
 *
 * Если робот не поднимает груз объекта (грузоподъёмность < массы паллеты), прогон не
 * выполняется: `isDone` сразу истинно, а сводка даёт «не подтверждён: грузоподъёмность».
 */
export function createSim(input: SimInput): SimEngineState {
  const invalidSite = input.siteLayout !== undefined && validateSiteLayout(input.siteLayout).length > 0;
  const layout = input.siteLayout && !invalidSite ? input.siteLayout : buildWarehouseLayout(input.layout);
  const warmupS = Math.round(nonNegative(input.demand.warmupMin) * 60);
  const endS = warmupS + Math.round(nonNegative(input.demand.peakMin) * 60);
  const count = requestedFleet(input);
  const chargeModelled = isPositive(input.robots.autonomyH) && isPositive(input.robots.chargeMin);
  const precheck = invalidSite || demandMixOf(input.demand).internal > 0 && layout.slots.length < 2
    ? "invalid" : precheckOf(input, count, chargeModelled);

  const points: SimPointState[] = [...layout.receiving, ...layout.shipping, ...layout.chargers].map((p) => ({
    ...p,
    holder: null,
    queue: [],
    busyS: 0,
  }));

  const robots: SimRobot[] = [];
  const slots = layout.slots;
  const nRobots = precheck === "invalid" ? 0 : count;
  for (let id = 0; id < nRobots; id++) {
    const start = slots[Math.floor((id * slots.length) / nRobots)] ?? { x: 0, y: 0 };
    robots.push({
      id,
      phase: "idle",
      x: start.x,
      y: start.y,
      soc: chargeModelled ? 0.3 + 0.7 * frac(id * 0.618) : 1,
      loaded: false,
      task: null,
      path: [],
      pathLenM: 0,
      distM: 0,
      timerS: 0,
      pointIdx: -1,
    });
  }

  const nBuckets = Math.ceil((endS - warmupS) / BUCKET_S);
  return {
    input,
    tS: 0,
    layout,
    warmupS,
    endS,
    chargeModelled,
    precheck,
    rng: createRng(input.seed),
    robots,
    tasks: [],
    head: 0,
    doneCount: 0,
    points,
    acc: {
      loadedS: 0,
      emptyS: 0,
      handlingS: 0,
      waitPointS: 0,
      chargingS: 0,
      chargerWaitS: 0,
      idleS: 0,
      socFloorS: 0,
      queueMax: 0,
      queueAtPeakStart: null,
      doneInPeak: 0,
      bucketArrivals: new Array<number>(nBuckets).fill(0),
      bucketDone: new Array<number>(nBuckets).fill(0),
    },
  };
}

/** Прогон окончен: пиковое окно пройдено или прогон не выполнялся (предварительная проверка). */
export function isDone(s: SimEngineState): boolean {
  return s.precheck !== "ok" || s.tS >= s.endS;
}

/** Индекс пятиминутной корзины для момента t пикового окна. */
function bucketOf(s: SimEngineState, t: number): number {
  return Math.floor((t - s.warmupS) / BUCKET_S);
}

/** Three draws preserve legacy balanced seeds; new inputs carry the customer's actual mix. */
function addTask(s: SimEngineState, rand: () => number, t: number, inWin: boolean): void {
  const { slots, receiving, shipping } = s.layout;
  const mix = demandMixOf(s.input.demand), kindDraw = rand();
  const kind = kindDraw < mix.inbound ? "inbound" : kindDraw < mix.inbound + mix.outbound ? "outbound" : "internal";
  const homes = s.storageCarriers ?? slots;
  const slotIndex = Math.floor(rand() * homes.length), slot = homes[slotIndex]!;
  const dockDraw = rand();
  let task: SimTask;
  const taskId = s.nextDemandTaskId === undefined ? s.tasks.length : s.nextDemandTaskId++;
  if (kind === "inbound") {
    const di = Math.floor(dockDraw * receiving.length);
    const dock = s.points[di]!;
    task = {
      id: taskId,
      kind: "inbound",
      fromPoint: di,
      fromX: dock.x,
      fromY: dock.y,
      toPoint: -1,
      toX: slot.x,
      toY: slot.y,
      arrivalS: t,
      startS: null,
      doneS: null,
    };
  } else if (kind === "outbound") {
    const di = receiving.length + Math.floor(dockDraw * shipping.length);
    const dock = s.points[di]!;
    task = {
      id: taskId,
      kind: "outbound",
      fromPoint: -1,
      fromX: slot.x,
      fromY: slot.y,
      toPoint: di,
      toX: dock.x,
      toY: dock.y,
      arrivalS: t,
      startS: null,
      doneS: null,
    };
  } else {
    const sourceIndex = slots.findIndex(p => p.x === slot.x && p.y === slot.y);
    const targetIndex = Math.floor(dockDraw * (slots.length - 1));
    const target = slots[targetIndex >= sourceIndex ? targetIndex + 1 : targetIndex]!;
    task = { id: taskId, kind: "internal", fromPoint: -1, fromX: slot.x, fromY: slot.y,
      toPoint: -1, toX: target.x, toY: target.y, storageDestinationDraw: dockDraw,
      arrivalS: t, startS: null, doneS: null };
  }
  if ("podId" in slot && typeof slot.podId === "string") task.podId = slot.podId;
  s.tasks.push(task);
  if (inWin) {
    const b = bucketOf(s, t);
    if (b < s.acc.bucketArrivals.length) s.acc.bucketArrivals[b]! += 1;
  }
}

/** Встать в очередь к точке (ворота) и ждать её. */
function queueAtPoint(s: SimEngineState, r: SimRobot, idx: number): void {
  s.points[idx]!.queue.push(r.id);
  r.pointIdx = idx;
  r.phase = "waitPoint";
}

/** Робот доехал до конца маршрута: следующая фаза начнётся со следующего шага. */
function arrive(s: SimEngineState, r: SimRobot): void {
  const task = r.task;
  if (r.phase === "toPickup" && task) {
    if (task.fromPoint >= 0) queueAtPoint(s, r, task.fromPoint);
    else {
      r.phase = "loading";
      r.timerS = s.input.robots.handlingSec;
    }
  } else if (r.phase === "toDrop" && task) {
    if (task.toPoint >= 0) queueAtPoint(s, r, task.toPoint);
    else {
      r.phase = "unloading";
      r.timerS = s.input.robots.handlingSec;
    }
  } else if (r.phase === "toCharger") {
    r.phase = "waitCharger";
  }
}

/** Проехать `dist` м по маршруту; при прибытии — переход к следующей фазе. */
function move(s: SimEngineState, r: SimRobot, dist: number, movementGate?: SimMovementGate): boolean {
  if (movementGate) {
    const decision = movementGate(s, r, Math.min(r.pathLenM, r.distM + dist));
    if (decision === false) return false;
    if (typeof decision === "number") dist = Math.max(0, Math.min(dist, decision - r.distM));
  }
  r.distM += dist;
  if (r.distM >= r.pathLenM) {
    r.distM = r.pathLenM;
    const end = r.path[r.path.length - 1];
    if (end) {
      r.x = end.x;
      r.y = end.y;
    }
    arrive(s, r);
    return true;
  }
  const p = positionAlong(r.path, r.distM);
  r.x = p.x;
  r.y = p.y;
  return true;
}

/** Освободить точку, которую занимает робот. */
function releasePoint(s: SimEngineState, r: SimRobot): void {
  if (r.pointIdx >= 0) {
    const p = s.points[r.pointIdx]!;
    if (p.holder === r.id) p.holder = null;
  }
  r.pointIdx = -1;
}

/** Шаг погрузки или выгрузки. */
function handle(s: SimEngineState, r: SimRobot, dt: number, inWin: boolean, handlingGate?: SimHandlingGate): boolean {
  if (handlingGate && !handlingGate(s, r, dt)) return false;
  r.timerS -= dt;
  if (inWin && r.pointIdx >= 0) s.points[r.pointIdx]!.busyS += dt;
  if (r.timerS > TIMER_EPS) return true;
  const task = r.task!;
  releasePoint(s, r);
  if (r.phase === "loading") {
    r.loaded = true;
    r.phase = "toDrop";
    setPath(s, r, task.toX, task.toY);
    return true;
  }
  r.loaded = false;
  task.doneS = s.tS + dt;
  if (s.physicalDoneCount !== undefined) s.physicalDoneCount++;
  if (task.countsTowardDemand !== false) s.doneCount++;
  if (inWin && task.countsTowardDemand !== false) {
    s.acc.doneInPeak++;
    const b = bucketOf(s, s.tS);
    if (b < s.acc.bucketDone.length) s.acc.bucketDone[b]! += 1;
  }
  r.task = null;
  r.phase = "idle";
  return true;
}

/** Шаг зарядки: заряд растёт линейно, полный заряд 0 → 100 % занимает `chargeMin` минут. */
function charge(s: SimEngineState, r: SimRobot, dt: number, inWin: boolean): void {
  r.soc += dt / (s.input.robots.chargeMin! * 60);
  // Заряд — доля 0–1 (её читает визуализация); пороги проверены в `precheckOf`, это страховка.
  if (r.soc > 1) r.soc = 1;
  if (inWin && r.pointIdx >= 0) s.points[r.pointIdx]!.busyS += dt;
  if (r.soc >= s.input.charge.stopSoc) {
    releasePoint(s, r);
    r.phase = "idle";
  }
}

/** Вид времени робота за шаг — для разложения времени парка. */
type TimeKind = "loaded" | "empty" | "handling" | "waitPoint" | "charging" | "idle";

function stepRobot(s: SimEngineState, r: SimRobot, dt: number, inWin: boolean, movementGate?: SimMovementGate, handlingGate?: SimHandlingGate): void {
  const rb = s.input.robots;
  const acc = s.acc;

  if (s.chargeModelled && r.phase !== "charging") {
    r.soc -= dt / (rb.autonomyH! * 3600);
    if (r.soc <= 0) {
      r.soc = 0;
      if (inWin) acc.socFloorS += dt;
    }
  }

  // Маршрут нулевой длины (робот уже на месте): прибытие без затраты шага.
  if ((r.phase === "toPickup" || r.phase === "toDrop" || r.phase === "toCharger") && r.distM >= r.pathLenM) {
    arrive(s, r);
  }

  let kind: TimeKind;
  switch (r.phase) {
    case "idle":
      kind = "idle";
      break;
    case "toPickup":
      kind = move(s, r, rb.speedMps * dt, movementGate) ? "empty" : "waitPoint";
      break;
    case "toDrop":
      kind = move(s, r, rb.speedMps * rb.loadedSpeedFactor * dt, movementGate) ? "loaded" : "waitPoint";
      break;
    case "toCharger":
      kind = move(s, r, rb.speedMps * dt, movementGate) ? "charging" : "waitPoint";
      break;
    case "waitPoint": {
      const p = s.points[r.pointIdx]!;
      if (p.holder === null && p.queue[0] === r.id) {
        p.queue.shift();
        p.holder = r.id;
        r.phase = r.loaded ? "unloading" : "loading";
        r.timerS = rb.handlingSec;
        kind = handle(s, r, dt, inWin, handlingGate) ? "handling" : "waitPoint";
      } else {
        kind = "waitPoint";
      }
      break;
    }
    case "loading":
    case "unloading":
      kind = handle(s, r, dt, inWin, handlingGate) ? "handling" : "waitPoint";
      break;
    case "waitCharger": {
      const p = r.pointIdx >= 0 ? s.points[r.pointIdx] : undefined;
      if (p && p.holder === null && p.queue[0] === r.id) {
        p.queue.shift();
        p.holder = r.id;
        r.phase = "charging";
        charge(s, r, dt, inWin);
      } else if (inWin) {
        acc.chargerWaitS += dt;
      }
      kind = "charging";
      break;
    }
    case "charging":
      charge(s, r, dt, inWin);
      kind = "charging";
      break;
  }

  if (!inWin) return;
  switch (kind) {
    case "loaded":
      acc.loadedS += dt;
      break;
    case "empty":
      acc.emptyS += dt;
      break;
    case "handling":
      acc.handlingS += dt;
      break;
    case "waitPoint":
      acc.waitPointS += dt;
      break;
    case "charging":
      acc.chargingS += dt;
      break;
    case "idle":
      acc.idleS += dt;
      break;
  }
}

/**
 * Один шаг модели длиной `dtS` секунд. МЕНЯЕТ `state` НА МЕСТЕ (без копирования — так
 * проигрывание на экране делает сотни шагов за кадр без мусора в памяти). После окончания
 * прогона вызов ничего не делает, поэтому проигрывание не может «перебежать» конец и разойтись
 * с сохранённой сводкой.
 *
 * Вердикт и сохраняемая сводка считаются при dt = 1 с; другой шаг допустим, но даёт другие
 * числа (дискретизация движения и поступления заданий).
 */
export function stepSim(state: SimEngineState, dtS = 1, movementGate?: SimMovementGate, dispatchGate?: SimDispatchGate, robotStepGate?: SimRobotStepGate, handlingGate?: SimHandlingGate): void {
  if (isDone(state)) return;
  const dt = Number.isFinite(dtS) && dtS > 0 ? dtS : 1;
  const s = state;
  const t = s.tS;
  const inWin = t >= s.warmupS && t < s.endS;
  const demandQueueLength = () => s.input.transportWorkflow === "closed-pod-1"
    ? customerQueueLength(s.tasks, customerWorkStarts(s.input, s.tasks, s.tS))
    : s.nextDemandTaskId === undefined ? queueLength(s) : s.tasks.filter(task => task.startS === null && task.countsTowardDemand !== false).length;
  if (inWin && s.acc.queueAtPeakStart === null) s.acc.queueAtPeakStart = demandQueueLength();

  const perH = t < s.warmupS ? s.input.demand.avgPerH : s.input.demand.peakPerH;
  const rand = () => nextRandom(s.rng);
  if (s.input.demand.offered) {
    const rate = s.input.demand.offered.perH / 3600;
    // Event n occurs at n/rate, admitted on its ceiling clock; no initial burst or RNG arrival draw.
    const first = Math.max(1, Math.floor((t - 1) * rate) + 1);
    const last = Math.floor((Math.min(t + dt, s.endS) - 1) * rate);
    for (let n = first; n <= last; n++) {
      const arrivalS = Math.ceil(n / rate);
      addTask(s, rand, arrivalS, arrivalS >= s.warmupS && arrivalS < s.endS);
    }
  } else {
    const arrivals = bernoulliArrivals(rand, perH / 3600, dt);
    for (let i = 0; i < arrivals; i++) addTask(s, rand, t, inWin);
  }

  assignTasks(s, dispatchGate);
  if (inWin) {
    const q = demandQueueLength();
    if (q > s.acc.queueMax) s.acc.queueMax = q;
  }

  for (const r of s.robots) {
    if (robotStepGate && !robotStepGate(s, r)) {
      if (s.chargeModelled) { r.soc = Math.max(0, r.soc - dt / (s.input.robots.autonomyH! * 3600)); if (inWin && r.soc === 0) s.acc.socFloorS += dt; }
      if (inWin) s.acc.waitPointS += dt;
    } else stepRobot(s, r, dt, inWin, movementGate, handlingGate);
  }
  s.tS = t + dt;
}
