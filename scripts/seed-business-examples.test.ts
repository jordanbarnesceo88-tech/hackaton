import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CATALOG } from "../lib/data/organizer/catalog";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { paramSpecsFor } from "../lib/data/organizer/params";
import { resolveNorms } from "../lib/tz/norms";
import { BUSINESS_EXAMPLES } from "../lib/projects/business-examples";

vi.mock("../lib/projects/recalc", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/projects/recalc")>(),
  loadLiveInputs: async () => ({ paramDefs: paramSpecsFor("warehouse"), products: CATALOG.map(productForCalcFromSeed), norms: resolveNorms(), paramDefsFrom: "code" }),
}));
const { seedBusinessExamples } = await import("./seed-business-examples");

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
  it("persists all three completed examples, with public owner and demonstration flags", async () => {
    const { db, project, transaction } = database(null);
    await seedBusinessExamples(db);
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(project.create).toHaveBeenCalledTimes(3);
    for (const [index, call] of project.create.mock.calls.entries()) {
      expect(call[0].data).toMatchObject({
        id: `demo-example-${BUSINESS_EXAMPLES[index]!.id}`, userId: "demo-owner", isDemo: true,
      });
      expect(call[0].data.results.scenarios[1].spatialEvidence.assessment.status).not.toBe("NOT_EVALUATED");
      expect(call[0].data.results.sim.purchase).toBeTruthy();
    }
  });
  it("refreshes snapshots without deleting their project identity or copiedFrom references", async () => {
    const { db, project, scenario } = database({ userId: "demo-owner", isDemo: true, results: null });
    await seedBusinessExamples(db);
    expect(project.deleteMany).not.toHaveBeenCalled();
    expect(project.create).not.toHaveBeenCalled();
    expect(scenario.deleteMany).toHaveBeenCalledTimes(3);
    expect(project.update).toHaveBeenCalledTimes(3);
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
