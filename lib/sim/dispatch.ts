import { route, routeLengthBetween, routeLengthM } from "./routing";
import type { SimEngineState, SimRobot } from "./state";

/**
 * Диспетчеризация: зарядка и выдача заданий свободным роботам. Правила простые и
 * детерминированные, как у типовой системы управления парком:
 * - свободный робот с зарядом ниже порога ухода (норматив chargeStartSoc) едет на зарядку;
 * - задания выдаются строго по очереди поступления (FIFO);
 * - задание получает ближайший по маршруту свободный робот, при равенстве — с меньшим id.
 * Случайность здесь не используется: поток заданий при одном зерне одинаков для любого
 * размера парка, поэтому прогоны с разным числом роботов сравнимы (перебор парка монотонен).
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
export function assignTasks(s: SimEngineState): void {
  for (const r of s.robots) {
    if (r.phase === "idle" && needsCharge(s, r)) sendToCharger(s, r);
  }
  if (s.head >= s.tasks.length) return;

  const idle: SimRobot[] = [];
  for (const r of s.robots) {
    if (r.phase === "idle") idle.push(r);
  }

  while (s.head < s.tasks.length && idle.length > 0) {
    const task = s.tasks[s.head]!;
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let i = 0; i < idle.length; i++) {
      const r = idle[i]!;
      const len = routeLengthBetween(s.layout, r.x, r.y, task.fromX, task.fromY);
      // Строгое «меньше»: при равенстве остаётся робот с меньшим id (список idle идёт по id).
      if (len < bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    const robot = idle.splice(bestIdx, 1)[0]!;
    s.head++;
    task.startS = s.tS;
    robot.task = task;
    robot.phase = "toPickup";
    setPath(s, robot, task.fromX, task.fromY);
  }
}
