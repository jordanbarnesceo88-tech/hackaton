import { describe, expect, it } from "vitest";
import { assignTasks, type SimDispatchGate } from "./dispatch";
import { createSim } from "./engine";
import { warehouseBaseInput } from "./fixtures";
import { queueLength, type SimTask } from "./state";

function fixture() {
  const input = warehouseBaseInput(2); input.demand.avgPerH = 0; input.demand.peakPerH = 0;
  const s = createSim(input), [a, b] = s.layout.receiving, to = s.layout.slots[0]!;
  s.robots.forEach((r, i) => { Object.assign(r, i ? b! : a!); r.id = i; r.soc = 1; });
  const task = (id: number, p = a!): SimTask => ({ id, kind: "inbound", arrivalS: id, fromPoint: id % 2, fromX: p.x, fromY: p.y, toPoint: -1, toX: to.x, toY: to.y, startS: null, doneS: null });
  s.tasks = [task(0), task(1, b!)];
  return { s, task };
}

describe("optional oldest-feasible dispatch", () => {
  it("keeps normal order and can recover an eligible unblocking task beyond the lookahead exactly once",()=>{
    const {s,task}=fixture();s.tasks=Array.from({length:18},(_,i)=>task(i));
    const assigned:number[]=[];
    const gate:SimDispatchGate=Object.assign(((_s,_r,t)=>t?.id===16) as SimDispatchGate,{policy:{pendingLookahead:16,isUnblockingTask:(_s:unknown,t:SimTask)=>t.id===16},onAssigned:(_s:unknown,_r:unknown,t:SimTask|null)=>{if(t)assigned.push(t.id);}});
    assignTasks(s,gate);
    expect(assigned).toEqual([16]);expect(s.head).toBe(1);expect(s.tasks[16]!.startS).toBe(0);expect(s.tasks[17]!.startS).toBeNull();
    expect(s.dispatchQueue!.indices).toHaveLength(17);
  });

  it("preserves legacy FIFO without the policy hook", () => {
    const { s } = fixture();
    assignTasks(s, (_s, _r, t) => t?.id !== 0);
    expect(s.head).toBe(0); expect(s.tasks.every(t => t.startS === null)).toBe(true);
    expect(s.dispatchQueue).toBeUndefined(); expect(queueLength(s)).toBe(2);
  });

  it("retains a blocked head and creation order, commits only the nearest selected robot and resumes exactly after serialization", () => {
    const { s, task } = fixture(), unchanged = structuredClone(s.robots[0]);
    const selected: number[] = [];
    const gate: SimDispatchGate = Object.assign(((_s, _r, t) => t?.id !== 0) as SimDispatchGate,
      { policy: { pendingLookahead: 16 }, onAssigned: (_s: unknown, r: { id: number }) => selected.push(r.id) });
    assignTasks(s, gate);
    expect(selected).toEqual([1]); expect(s.robots[0]).toEqual(unchanged);
    expect(s.head).toBe(1); expect(queueLength(s)).toBe(1);
    expect(s.tasks.map(t => [t.id, t.arrivalS, t.startS])).toEqual([[0, 0, null], [1, 1, 0]]);
    expect(s.dispatchQueue).toEqual({ indices: [0], enqueuedThrough: 2 });
    s.tasks.push(task(2)); assignTasks(s, Object.assign((() => false) as SimDispatchGate, { policy: { pendingLookahead: 16 } }));
    assignTasks(s, Object.assign((() => false) as SimDispatchGate, { policy: { pendingLookahead: 16 } }));
    expect(s.dispatchQueue!.indices).toEqual([0, 2]); expect(queueLength(s)).toBe(2);
    const cloned = structuredClone(s);
    const open = Object.assign((() => true) as SimDispatchGate, { policy: { pendingLookahead: 16 } });
    for (const state of [s, cloned]) { state.tS = 20; assignTasks(state, open); }
    expect(cloned).toEqual(s); expect(s.tasks[0]!.startS).toBe(20);
    expect(s.tasks[2]!.startS).toBeNull(); expect(queueLength(s)).toBe(1);
    expect(s.dispatchQueue!.indices).toEqual([2]);
    expect(() => assignTasks(s)).toThrow(/cannot change to legacy/);
  });

  it("safely waits when the first bounded pending window is blocked rather than dropping work to reach an open seventeenth task", () => {
    const { s, task } = fixture(); s.tasks = Array.from({ length: 17 }, (_, i) => task(i));
    const gate = Object.assign(((_s, _r, t) => t?.id === 16) as SimDispatchGate, { policy: { pendingLookahead: 16 } });
    assignTasks(s, gate);
    expect(s.head).toBe(0); expect(queueLength(s)).toBe(17);
    expect(s.dispatchQueue!.indices).toHaveLength(17);
    expect(s.tasks.every(t => t.startS === null)).toBe(true);
  });
});
