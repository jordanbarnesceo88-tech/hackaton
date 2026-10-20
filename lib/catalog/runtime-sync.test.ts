import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importProducts, validateProductSeeds } from "../api/import";
import { CATALOG } from "../data/organizer/catalog";
import { PARAM_SPECS } from "../data/organizer/params";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { syncOrganizerData } from "./sync";
import { syncRuntimeCatalog } from "./runtime-sync";

vi.mock("./sync", () => ({ syncOrganizerData: vi.fn() }));
vi.mock("../api/import", async importOriginal => ({ ...await importOriginal<typeof import("../api/import")>(), importProducts: vi.fn() }));

function fixture(existing: string[] = []) {
  const tx = { catalogProduct: { findMany: vi.fn().mockResolvedValue(existing.map(slug => ({ slug }))) } };
  const db = {
    facilityType: { findMany: vi.fn().mockResolvedValue([...new Set(PARAM_SPECS.map(param => param.facility))].map(slug => ({ slug }))) },
    $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>, _options?: unknown) => { void _options; return work(tx); }),
  };
  return { db, client: db as unknown as PrismaClient, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(syncOrganizerData).mockResolvedValue({ dataVersion: "test-release", products: { created: 1, updated: 2, archived: 0, skippedAdmin: 3, failed: 0 }, characteristics: { rejected: 0 } } as Awaited<ReturnType<typeof syncOrganizerData>>);
  vi.mocked(importProducts).mockImplementation(async (_db, seeds) => ({ dryRun: false, total: seeds.length, created: seeds.length, updated: 0, unchanged: 0, refused: 0, failed: 0, valid: 0, items: [] }));
});

describe("production runtime catalogue synchronization", () => {
  it("validates real vendor seeds, respects organizer edits and imports all missing vendors transactionally", async () => {
    expect(validateProductSeeds(VENDOR_CLEANING_PRODUCTS).ok).toBe(true);
    const { db, client, tx } = fixture();
    const report = await syncRuntimeCatalog(client);
    expect(syncOrganizerData).toHaveBeenCalledWith(client, { respectAdminEdits: true, requireComplete: true, only: CATALOG.map(product => product.slug) });
    expect(importProducts).toHaveBeenCalledWith(tx, VENDOR_CLEANING_PRODUCTS);
    expect(db.$transaction.mock.calls[0]?.[1]).toMatchObject({ isolationLevel: "Serializable" });
    expect(report.vendors).toEqual({ created: 3, skippedExisting: 0 });
    expect(report.dataVersion).toBe("test-release");
  });
  it("never sends existing vendors to the importer, independently of origin or archived state", async () => {
    const { client, tx } = fixture(["pudu-cc1", "agibot-c5"]);
    expect((await syncRuntimeCatalog(client)).vendors).toEqual({ created: 1, skippedExisting: 2 });
    expect(importProducts).toHaveBeenCalledWith(tx, VENDOR_CLEANING_PRODUCTS.filter(product => product.slug === "viggo-sc80"));
  });
  it("is idempotent for a deployment whose three vendors already exist", async () => {
    const { client, tx } = fixture(VENDOR_CLEANING_PRODUCTS.map(product => product.slug));
    expect((await syncRuntimeCatalog(client)).vendors).toEqual({ created: 0, skippedExisting: 3 });
    expect(importProducts).toHaveBeenCalledWith(tx, []);
  });
  it.each(["products", "characteristics"] as const)("stops on incomplete organizer %s without importing vendors", async section => {
    const report = await vi.mocked(syncOrganizerData).getMockImplementation()!({} as PrismaClient);
    if (section === "products") report.products.failed = 1; else report.characteristics.rejected = 1;
    vi.mocked(syncOrganizerData).mockResolvedValue(report);
    await expect(syncRuntimeCatalog(fixture().client)).rejects.toThrow("organizer catalogue synchronization was incomplete");
    expect(importProducts).not.toHaveBeenCalled();
  });
  it.each(["failed", "refused", "updated", "unchanged"] as const)("rejects vendor %s outcomes rather than silently accepting a partial or overwriting import", async key => {
    vi.mocked(importProducts).mockResolvedValue({ dryRun: false, total: 3, created: 2, updated: 0, unchanged: 0, refused: 0, failed: 0, valid: 0, items: [], [key]: 1 });
    await expect(syncRuntimeCatalog(fixture().client)).rejects.toThrow("vendor catalogue synchronization was incomplete");
  });
  it("fails closed if a concurrent transaction causes serialization failure", async () => {
    const { db, client } = fixture();
    db.$transaction.mockRejectedValueOnce(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    await expect(syncRuntimeCatalog(client)).rejects.toMatchObject({ code: "DATABASE_ERROR", stage: "vendors", databaseCode: "P2034" });
  });
  it("does not start reference writes when the required pre-existing taxonomy is missing", async () => {
    const { db, client } = fixture(); db.facilityType.findMany.mockResolvedValueOnce([]);
    await expect(syncRuntimeCatalog(client)).rejects.toThrow("existing facility taxonomy");
    expect(syncOrganizerData).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
