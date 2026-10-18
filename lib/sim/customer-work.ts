import type { SimTask } from "./state";
import type { SimInput } from "./types";

const same = (a: number, b: number) => Math.abs(a - b) < 1e-7;

/**
 * Customer intake starts when a robot accepts real work for that request. In the
 * closed-pod workflow this can be its bound carrier prefetch, before the delivery
 * leg is assignable. Operational task timestamps and completion stay unchanged.
 * Build once per observation; callers can then read each customer in O(1).
 */
export function customerWorkStarts(
  input: Pick<SimInput, "transportWorkflow">,
  tasks: readonly SimTask[],
  observedAtS: number,
): Map<number, number | null> {
  const customers = new Map(tasks.filter(task => task.countsTowardDemand !== false).map(task => [task.id, task]));
  const starts = new Map([...customers].map(([id, task]) => [id, task.startS]));
  if (input.transportWorkflow !== "closed-pod-1") return starts;

  for (const task of tasks) {
    if (task.countsTowardDemand !== false || task.operation !== "prefetch-pod" || task.parentTaskId === undefined) continue;
    const parent = customers.get(task.parentTaskId);
    if (!parent || parent.kind !== "inbound" || task.kind !== "inbound" || !parent.podId || task.podId !== parent.podId) continue;
    if (task.startS === null || !Number.isFinite(task.startS) || task.startS < task.arrivalS ||
      task.arrivalS < parent.arrivalS || task.startS > observedAtS) continue;
    if (!same(task.fromX, parent.toX) || !same(task.fromY, parent.toY) ||
      !same(task.toX, parent.fromX) || !same(task.toY, parent.fromY) || task.toPoint !== parent.fromPoint) continue;
    const previous = starts.get(parent.id);
    if (previous === null || previous === undefined || task.startS < previous) starts.set(parent.id, task.startS);
  }
  return starts;
}

/** Customer queue excludes work already accepted; it is not the unfinished backlog. */
export function customerQueueLength(tasks: readonly SimTask[], starts: ReadonlyMap<number, number | null>): number {
  let count = 0;
  for (const task of tasks) {
    if (task.countsTowardDemand !== false && task.doneS === null && starts.get(task.id) === null) count++;
  }
  return count;
}
