import { describe, expect, it } from "vitest";
import { cancelDockRequest, createDockAccess, dockPathAllowed, releaseDockAfterClear, requestDock } from "./dock-access";

const point = (x: number, y: number) => ({ x, y });
const dock = (robotId: number, key: string, y = 56.9, tS = 0) => ({ robotId, key, center: point(8.9, y), entry: point(6.9, y), tS });

describe("local physical underlift dock access", () => {
  it("reserves adjacent 1.2m-pitch approaches before either body reaches the late mutual-blocking pose", () => {
    const access = createDockAccess(1.95);
    const bodies = [{ id: 2, ...point(6.9, 60) }, { id: 3, ...point(6.9, 53.6) }];
    expect(requestDock(access, dock(2, "home-36"), bodies)).toBe(true);
    expect(requestDock(access, dock(3, "home-35", 55.7, 1), bodies)).toBe(false);
    expect(dockPathAllowed(access, 3, [point(6.9, 58.9), point(6.9, 55.7)])).toBe(false);
    expect(dockPathAllowed(access, 2, [point(8.9, 56.9), point(6.9, 56.9)])).toBe(true);
  });

  it("rejects late ownership when another real body already occupies the conflicting entry", () => {
    const access = createDockAccess(1.95);
    expect(requestDock(access, dock(2, "home-36"), [
      { id: 2, ...point(8.6, 56.9) }, { id: 3, ...point(6.9, 55.7) },
    ])).toBe(false);
    expect(access.grants).toHaveLength(0);
  });

  it("retains source ownership at the aisle centre and releases only after the full body clears the spur", () => {
    const access = createDockAccess(1.95);
    requestDock(access, dock(2, "source"), [{ id: 2, ...point(8.9, 56.9) }]);
    for (const pose of [point(8.9, 56.9), point(7.9, 56.9), point(6.9, 56.9), point(6.9, 58.84)]) {
      releaseDockAfterClear(access, 2, pose);
      expect(access.grants).toHaveLength(1);
    }
    releaseDockAfterClear(access, 2, point(6.9, 58.85));
    expect(access.grants).toHaveLength(0);
  });

  it("lets the clearing owner move despite an older conflicting waiter", () => {
    const access = createDockAccess(1.95);
    requestDock(access, dock(2, "source"), [{ id: 2, ...point(8.9, 56.9) }]);
    expect(requestDock(access, dock(3, "waiting", 55.7, 1), [
      { id: 2, ...point(8.9, 56.9) }, { id: 3, ...point(6.9, 52) },
    ])).toBe(false);
    expect(dockPathAllowed(access, 2, [point(8.9, 56.9), point(6.9, 56.9), point(6.9, 59)])).toBe(true);
  });

  it("checks the entire ordinary, yield or floor trajectory instead of just its endpoints", () => {
    const access = createDockAccess(1.95);
    requestDock(access, dock(2, "handling"), [{ id: 2, ...point(8.9, 56.9) }]);
    expect(dockPathAllowed(access, 3, [point(7, 53), point(7, 61)])).toBe(false);
    expect(dockPathAllowed(access, 3, [point(4, 53), point(4, 61)])).toBe(true);
  });

  it("does not serialize independent aisles while another dock is handled", () => {
    const access = createDockAccess(1.95);
    requestDock(access, dock(2, "handling"), [{ id: 2, ...point(8.9, 56.9) }]);
    expect(requestDock(access, { ...dock(3, "other-aisle"), center: point(14.5, 56.9), entry: point(12.5, 56.9) }, [
      { id: 2, ...point(8.9, 56.9) }, { id: 3, ...point(12.5, 60) },
    ])).toBe(true);
    expect(access.grants).toHaveLength(2);
    expect(dockPathAllowed(access, 4, [point(18, 52), point(18, 62)])).toBe(true);
  });

  it("waiters alone do not reserve distant future geometry or stop a current clearing body", () => {
    const access = createDockAccess(1.95);
    expect(requestDock(access, dock(3, "blocked"), [
      { id: 3, ...point(6.9, 60) }, { id: 2, ...point(6.9, 56.9) },
    ])).toBe(false);
    expect(access.grants).toHaveLength(0);
    expect(dockPathAllowed(access, 2, [point(6.9, 56.9), point(6.9, 60)])).toBe(true);
  });

  it("ages actual nearby requests locally without letting a later retry overtake", () => {
    const access = createDockAccess(1.95);
    requestDock(access, dock(0, "owner"), [{ id: 0, ...point(8.9, 56.9) }]);
    const bodies = [{ id: 1, ...point(6.9, 54.8) }, { id: 2, ...point(6.9, 59) }];
    expect(requestDock(access, dock(1, "first", 56.9, 1), bodies)).toBe(false);
    expect(requestDock(access, dock(2, "later", 56.9, 2), bodies)).toBe(false);
    releaseDockAfterClear(access, 0, point(6.9, 64));
    expect(requestDock(access, dock(2, "later", 56.9, 3), bodies)).toBe(false);
    expect(requestDock(access, dock(1, "first", 56.9, 3), bodies)).toBe(true);
  });

  it("cancels an abandoned request without dropping an owner's physical protection", () => {
    const access = createDockAccess(1.95);
    requestDock(access, dock(0, "owner"), [{ id: 0, ...point(8.9, 56.9) }]);
    const bodies = [{ id: 1, ...point(6.9, 54.8) }, { id: 2, ...point(6.9, 59) }];
    requestDock(access, dock(1, "abandoned", 56.9, 1), bodies);
    requestDock(access, dock(2, "live", 56.9, 2), bodies);
    cancelDockRequest(access, 1);
    cancelDockRequest(access, 0);
    expect(access.grants.map(g => g.robotId)).toEqual([0]);
    expect(dockPathAllowed(access, 2, [point(6.9, 59), point(6.9, 56.9)])).toBe(false);
    releaseDockAfterClear(access, 0, point(6.9, 64));
    expect(requestDock(access, dock(2, "live", 56.9, 3), bodies)).toBe(true);
    expect(access.waiters.some(w => w.robotId === 1)).toBe(false);
  });

  it("allows an existing owner to finish an adjacent local transition without waiting on its own release", () => {
    const access = createDockAccess(1.95);
    const bodies = [{ id: 0, ...point(8.9, 56.9) }, { id: 1, ...point(6.9, 52) }];
    requestDock(access, dock(0, "first"), bodies);
    expect(requestDock(access, dock(1, "waiting", 55.7, 1), bodies)).toBe(false);
    expect(requestDock(access, dock(0, "adjacent-transition", 55.7, 2), bodies)).toBe(true);
    expect(access.grants.filter(g => g.robotId === 0)).toHaveLength(2);
  });

  it("releases old source ownership independently of a still-occupied destination spur", () => {
    const access = createDockAccess(1.95);
    const bodies = [{ id: 0, ...point(8.9, 56.9) }];
    requestDock(access, dock(0, "source"), bodies);
    requestDock(access, { ...dock(0, "destination"), center: point(18.9, 56.9), entry: point(16.9, 56.9) }, bodies);
    releaseDockAfterClear(access, 0, point(17.9, 56.9));
    expect(access.grants.map(g => g.key)).toEqual(["destination"]);
  });
});
