import { route, routeLengthBetween, routeLengthM } from "./routing";
import type { SimEngineState, SimRobot, SimTask } from "./state";
import { initialVacantStorageCount } from "./demand-mix";

/** Optional experiment admission policy; absent in the production calculation. Null task means charging. */
export type SimDispatchGate = ((state: SimEngineState, robot: SimRobot, task: SimTask | null) => boolean) & {
  policy?: { pendingLookahead: number; isUnblockingTask?: (state:SimEngineState,task:SimTask)=>boolean };
  onAssigned?: (state: SimEngineState, robot: SimRobot, task: SimTask | null) => void;
};

/**
 * Диспетчеризация: зарядка и выдача заданий свободным роботам. Правила простые и
 * детерминированные, как у типовой системы управления парком:
 * - свободный робот с зарядом ниже порога ухода (норматив chargeStartSoc) едет на зарядку;
 * - без policy задания выдаются строго по очереди поступления (FIFO); policy выбирает
 *   самое старое допустимое задание в ограниченном окне ожидания;
 * - задание получает ближайший по маршруту свободный робот, при равенстве — с меньшим id.
 * Случайность здесь не используется: поток заданий при одном зерне одинаков для любого
 * размера парка. Это делает поток сравнимым, но не гарантирует монотонность результата парка.
 */

/** Назначает роботу маршрут из текущей позиции в точку (tx, ty). */
export function setPath(s: SimEngineState, r: SimRobot, tx: number, ty: number): void {
  r.path = route(s.layout, { x: r.x, y: r.y }, { x: tx, y: ty });
  r.pathLenM = routeLengthM(r.path);
  r.distM = 0;
}

/**
 * Зарядная станция для робота: наименее загруженная (занята + очередь), при равенстве — ближняя
 * по маршруту, затем с меньшим номером. −1 — станций нет.
 */
export function chooseCharger(s: SimEngineState, r: SimRobot): number {
  let best = -1;
  let bestLoad = Infinity;
  let bestLen = Infinity;
  for (let i = 0; i < s.points.length; i++) {
    const p = s.points[i]!;
    if (p.kind !== "charger") continue;
    const load = (p.holder === null ? 0 : 1) + p.queue.length;
    const len = routeLengthBetween(s.layout, r.x, r.y, p.x, p.y);
    if (load < bestLoad || (load === bestLoad && len < bestLen)) {
      best = i;
      bestLoad = load;
      bestLen = len;
    }
  }
  return best;
}

/**
 * Отправляет робота на зарядку: выбирает станцию, сразу встаёт в её очередь (бронь) и едет к
 * ней. Если станций нет, робот остаётся ждать — это видно как узкое место «зарядка».
 */
export function sendToCharger(s: SimEngineState, r: SimRobot): void {
  const idx = chooseCharger(s, r);
  r.pointIdx = idx;
  if (idx < 0) {
    r.phase = "waitCharger";
    return;
  }
  const p = s.points[idx]!;
  p.queue.push(r.id);
  r.phase = "toCharger";
  setPath(s, r, p.x, p.y);
}

/** Робот должен ехать на зарядку: зарядка моделируется и заряд ниже порога ухода. */
export function needsCharge(s: SimEngineState, r: SimRobot): boolean {
  return s.chargeModelled && r.soc < s.input.charge.startSoc;
}

/**
 * Один проход диспетчера в начале шага: сначала свободные роботы с низким зарядом уходят на
 * зарядку, затем задания из очереди по порядку раздаются ближайшим свободным роботам.
 */
export function assignTasks(s: SimEngineState, dispatchGate?: SimDispatchGate): void {
  for (const r of s.robots) {
    if (r.phase === "idle" && needsCharge(s, r) && (!dispatchGate || dispatchGate(s, r, null))) {
      dispatchGate?.onAssigned?.(s, r, null);
      sendToCharger(s, r);
    }
  }
  if (s.head >= s.tasks.length) return;

  const idle: SimRobot[] = [];
  for (const r of s.robots) {
    if (r.phase === "idle") idle.push(r);
  }

  const policy = dispatchGate?.policy;
  if (policy && (!Number.isInteger(policy.pendingLookahead) || policy.pendingLookahead < 1 || policy.pendingLookahead > 64)) throw new Error("Dispatch lookahead must be an integer from 1 to 64");
  if (!policy && s.dispatchQueue) throw new Error("A policy run cannot change to legacy FIFO mid-run");
  if (policy) {
    const queue = s.dispatchQueue ??= { indices: [], enqueuedThrough: 0 };
    for (let i = queue.enqueuedThrough; i < s.tasks.length; i++) if (s.tasks[i]!.startS === null) queue.indices.push(i);
    queue.enqueuedThrough = s.tasks.length;
    queue.indices.sort((a, b) => Number(s.tasks[a]!.countsTowardDemand !== false) - Number(s.tasks[b]!.countsTowardDemand !== false) || a - b);
  }
  while (s.head < s.tasks.length && idle.length > 0) {
    const candidates = policy ? [...new Set([...s.dispatchQueue!.indices.filter(i => s.tasks[i]!.countsTowardDemand === false), ...s.dispatchQueue!.indices.filter(i => s.tasks[i]!.countsTowardDemand !== false).slice(0, policy.pendingLookahead),...s.dispatchQueue!.indices.filter(i=>policy.isUnblockingTask?.(s,s.tasks[i]!))])] : [s.head];
    let task: SimTask | undefined;
    let selectedQueueIndex = -1;
    let bestIdx = -1;
    for (const [queueIndex, taskIndex] of candidates.entries()) {
      const candidate = s.tasks[taskIndex]!;
      if (candidate.kind === "internal" && candidate.countsTowardDemand !== false && initialVacantStorageCount(s.layout.slots.length, s.input.demand) === 0) continue;
      let bestLen = Infinity;
      for (let i = 0; i < idle.length; i++) {
        const r = idle[i]!;
        if (dispatchGate && !dispatchGate(s, r, candidate)) continue;
        const len = routeLengthBetween(s.layout, r.x, r.y, candidate.fromX, candidate.fromY);
        // Stable robot id breaks equal-distance ties; pending jobs retain arrival priority.
        if (len < bestLen) { bestLen = len; bestIdx = i; }
      }
      if (bestIdx >= 0) { task = candidate; selectedQueueIndex = queueIndex; break; }
    }
    if (bestIdx < 0 || !task) break;
    const robot = idle.splice(bestIdx, 1)[0]!;
    if (policy) s.dispatchQueue!.indices.splice(s.dispatchQueue!.indices.indexOf(candidates[selectedQueueIndex]!), 1);
    s.head++;
    dispatchGate?.onAssigned?.(s, robot, task);
    task.startS = s.tS;
    robot.task = task;
    robot.phase = "toPickup";
    setPath(s, robot, task.fromX, task.fromY);
  }
}
