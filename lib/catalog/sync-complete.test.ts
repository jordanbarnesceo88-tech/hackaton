import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { syncOrganizerData } from "./sync";

function failedProductDatabase() {
  const model = () => ({ findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) });
  const db = { solutionType: model(), process: model(), facilityType: model(), facilityTypeProcess: model(), paramDefinition: model(), norm: model(), catalogProduct: model(), productCharacteristic: model(), dataRelease: model(), $transaction: vi.fn().mockRejectedValue(new Error("Synthetic product database failure")) };
  return { db, client: db as unknown as PrismaClient };
}

describe("strict deployment catalogue release publication", () => {
  it("does not publish a DataRelease after a product transaction failed", async () => {
    const { db, client } = failedProductDatabase();
    await expect(syncOrganizerData(client, { only: ["geoskan-201"], requireComplete: true })).rejects.toThrow("Runtime organizer catalogue synchronization was incomplete");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.dataRelease.createMany).not.toHaveBeenCalled();
  });
  it("keeps existing best-effort callers compatible while reporting the failure", async () => {
    const { db, client } = failedProductDatabase();
    const report = await syncOrganizerData(client, { only: ["geoskan-201"] });
    expect(report.products.failed).toBe(1);
    expect(db.dataRelease.createMany).toHaveBeenCalledTimes(1);
  });
});
