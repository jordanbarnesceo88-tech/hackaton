import type { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../catalog/queries";
import { productForCalcFromSeed } from "../catalog/product-for-calc";
import { CATALOG } from "../data/organizer/catalog";
import { paramSpecsFor } from "../data/organizer/params";
import { buildDecision } from "../tz/decision";
import { resolveNorms } from "../tz/norms";
import type { ProjectResults } from "../tz/types";
import { buildBusinessExampleOffline } from "./business-example-offline";
import { buildBusinessExamplePreview } from "./business-example-model";
import { businessExampleProjectId, compatibleBusinessExampleSnapshot, readBusinessExampleSnapshot } from "./business-example-snapshot";

const live = { paramDefs: paramSpecsFor("warehouse"), products: CATALOG.map(productForCalcFromSeed), norms: resolveNorms(), paramDefsFrom: "code" as const };
let saved: ProjectResults;
beforeAll(() => { saved = buildBusinessExampleOffline(live, "steady-flow").results; });

describe("public prepared business examples", () => {
  it("reads a ready canonical example without recalculating it", async () => {
    const findFirst = vi.fn().mockResolvedValue({ results: saved });
    const snapshot = await readBusinessExampleSnapshot({ project: { findFirst } } as unknown as Db, live, "steady-flow");
    expect(snapshot?.results).toBe(saved);
    expect(snapshot?.model.scenarios[1]?.spatialEvidence?.assessment.status).toBe("OK");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "demo-example-steady-flow", isDemo: true, facilityTypeSlug: "warehouse", user: { email: "demo@demo.local" } },
      select: { results: true },
    });
  });
  it("cannot read arbitrary project IDs and returns no private fallback", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = { project: { findFirst } } as unknown as Db;
    expect(await readBusinessExampleSnapshot(db, live, "steady-flow")).toBeNull();
    await expect(readBusinessExampleSnapshot(db, live, "private-project" as "steady-flow")).rejects.toThrow();
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(() => businessExampleProjectId("private-project" as "steady-flow")).toThrow();
  });
  it.each([
    ["economic version", (v: ProjectResults) => { v.modelVersion = "old"; }],
    ["simulation version", (v: ProjectResults) => { v.simModelVersion = "old"; }],
    ["catalogue version", (v: ProjectResults) => { v.dataVersion = "old"; }],
    ["sample assumptions", (v: ProjectResults) => { v.paramsUsed.activeArea = 1; }],
    ["fleet selection", (v: ProjectResults) => { v.scenarios[1]!.items[0]!.quantityOverride = 60; }],
    ["unsupported proof", (v: ProjectResults) => { v.scenarios[1]!.spatialEvidence!.simModelVersion = "old"; }],
    ["unverified proof", (v: ProjectResults) => { v.scenarios[1]!.spatialEvidence!.assessment.status = "NOT_EVALUATED"; }],
    ["missing physical summary", (v: ProjectResults) => { v.sim.purchase = null; }],
    ["wrong physical input", (v: ProjectResults) => { v.runtime!.simInputs.purchase!.calculated!.robots.count = 60; }],
    ["missing calculation date", (v: ProjectResults) => { v.calculatedAt = "invalid"; }],
    ["missing saved runtime", (v: ProjectResults) => { delete v.runtime; }],
    ["non-finite input", (v: ProjectResults) => { v.paramsUsed.activeArea = Infinity; }],
  ] as const)("rejects stale %s", (_, mutate) => {
    const changed = structuredClone(saved); mutate(changed);
    expect(compatibleBusinessExampleSnapshot(live, "steady-flow", changed)).toBe(false);
  });
  it("rejects changed current catalogue and another example's workload", () => {
    const changedLive = structuredClone(live);
    const key = Object.keys(changedLive.norms)[0] as keyof typeof changedLive.norms;
    changedLive.norms[key] += 0.1;
    expect(compatibleBusinessExampleSnapshot(changedLive, "steady-flow", saved)).toBe(false);
    expect(compatibleBusinessExampleSnapshot(live, "peak-overload", saved)).toBe(false);
  });
  it("falls back on malformed stored data", async () => {
    const findFirst = vi.fn().mockResolvedValue({ results: { modelVersion: "old" } as Prisma.JsonValue });
    expect(await readBusinessExampleSnapshot({ project: { findFirst } } as unknown as Db, live, "steady-flow")).toBeNull();
  });
  it("financial preview has no invented physical confirmation", () => {
    const preview = buildBusinessExamplePreview(live, "steady-flow");
    expect(preview.model.scenarios.every(s => !s.spatialEvidence)).toBe(true);
    const decision = buildDecision(preview.model, "purchase", preview.model.simInputs.purchase?.calculated);
    expect(decision.spatial.state).not.toBe("fresh");
    expect(decision.status).not.toBe("suitable");
    const financial = saved.results.find(r => r.key === "purchase");
    if (financial?.status !== "ok") throw new Error("Expected financial result");
    expect(preview.model.results.find(r => r.key === "purchase")).toMatchObject({ status: "ok", npvRub: financial.npvRub });
  });
});
