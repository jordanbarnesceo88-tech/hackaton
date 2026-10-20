import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "../lib/data/organizer/catalog";
import { VENDOR_CLEANING_PRODUCTS } from "../lib/data/vendor-cleaning";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { paramSpecsFor } from "../lib/data/organizer/params";
import { resolveNorms } from "../lib/tz/norms";
import { BUSINESS_EXAMPLES } from "../lib/projects/business-examples";
import type { LiveInputs } from "../lib/projects/recalc";
import type { BusinessExampleId } from "../lib/projects/business-examples";

vi.mock("../lib/projects/recalc", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/projects/recalc")>(),
  loadLiveInputs: async () => ({ paramDefs: paramSpecsFor("warehouse"), products: [...CATALOG, ...VENDOR_CLEANING_PRODUCTS].map(productForCalcFromSeed), norms: resolveNorms(), paramDefsFrom: "code" }),
}));
vi.mock("../lib/projects/business-example-offline", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/projects/business-example-offline")>();
  const completed = new Map<BusinessExampleId, ReturnType<typeof actual.buildBusinessExampleOffline>>();
  return { ...actual, buildBusinessExampleOffline: (live: LiveInputs, id: BusinessExampleId) => {
    if (!completed.has(id)) completed.set(id, actual.buildBusinessExampleOffline(live, id));
    return structuredClone(completed.get(id)!);
  } };
});
const { seedBusinessExamples } = await import("./seed-business-examples");
const { buildBusinessExampleOffline } = await import("../lib/projects/business-example-offline");
const live: LiveInputs = { paramDefs: paramSpecsFor("warehouse"), products: [...CATALOG, ...VENDOR_CLEANING_PRODUCTS].map(productForCalcFromSeed), norms: resolveNorms(), paramDefsFrom: "code" };
// Persistence tests reuse genuine completed calculations, not fabricated metrics.
// Warm once outside each test; every consumer receives an isolated clone.
for (const example of BUSINESS_EXAMPLES) buildBusinessExampleOffline(live, example.id);

function database(existing: { userId: string; isDemo: boolean; results?: unknown } | null) {
  const project = {
    findUnique: vi.fn().mockImplementation(async () => existing),
    create: vi.fn().mockImplementation(async ({ data }) => ({ id: data.id })),
    update: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn(),
  };
  const scenario = { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) };
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "demo-owner" }) }, project, scenario,
    $transaction: vi.fn().mockImplementation(async callback => callback({ project, scenario })),
  };
  return { db: db as unknown as PrismaClient, project, scenario, transaction: db.$transaction };
}

describe("prepared public demo seed", () => {
  it("isolates the genuine completed result for every persistence attempt", () => {
    const first = buildBusinessExampleOffline(live, "steady-flow"), before = structuredClone(first);
    first.results.scenarios[1]!.spatialEvidence!.summary.achievedPerH = -1;
    expect(buildBusinessExampleOffline(live, "steady-flow")).toEqual(before);
  });
  it("persists transport examples with physical evidence and cleaning with its explicit financial profile", async () => {
    const { db, project, transaction } = database(null);
    await seedBusinessExamples(db);
    expect(transaction).toHaveBeenCalledTimes(BUSINESS_EXAMPLES.length);
    expect(project.create).toHaveBeenCalledTimes(BUSINESS_EXAMPLES.length);
    for (const [index, call] of project.create.mock.calls.entries()) {
      expect(call[0].data).toMatchObject({
        id: `demo-example-${BUSINESS_EXAMPLES[index]!.id}`, userId: "demo-owner", isDemo: true,
      });
      if (BUSINESS_EXAMPLES[index]!.id === "warehouse-cleaning") {
        expect(call[0].data.results.scenarios[1].spatialEvidence).toBeUndefined();
        expect(call[0].data.results.scenarios[1].items[0].cleaningProfile.basis).toBe("active-hour");
        expect(call[0].data.results.results.find((row: { key: string }) => row.key === "purchase").status).toBe("ok");
        expect(call[0].data.results.sim.purchase).toBeFalsy();
      } else {
        expect(call[0].data.results.scenarios[1].spatialEvidence.assessment.status).not.toBe("NOT_EVALUATED");
        expect(call[0].data.results.sim.purchase).toBeTruthy();
      }
    }
  });
  it("refreshes snapshots without deleting their project identity or copiedFrom references", async () => {
    const { db, project, scenario } = database({ userId: "demo-owner", isDemo: true, results: null });
    await seedBusinessExamples(db);
    expect(project.deleteMany).not.toHaveBeenCalled();
    expect(project.create).not.toHaveBeenCalled();
    expect(scenario.deleteMany).toHaveBeenCalledTimes(BUSINESS_EXAMPLES.length);
    expect(project.update).toHaveBeenCalledTimes(BUSINESS_EXAMPLES.length);
    for (const call of project.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("copiedFromId");
      expect(call[0].data).not.toHaveProperty("createdAt");
    }
  });
  it.each([
    { userId: "private-owner", isDemo: true },
    { userId: "demo-owner", isDemo: false },
  ])("never overwrites a colliding private/non-demo project: %o", async existing => {
    const { db, project, transaction } = database(existing);
    await expect(seedBusinessExamples(db)).rejects.toThrow("ID учебного примера занят");
    expect(transaction).not.toHaveBeenCalled();
    expect(project.update).not.toHaveBeenCalled();
    expect(project.create).not.toHaveBeenCalled();
  });
});
