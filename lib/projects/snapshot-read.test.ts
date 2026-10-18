import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getOwnedProjectSnapshot } from "./queries";

describe("owned project and journal read snapshot", () => {
  it("reads both owned records through one RepeatableRead transaction", async () => {
    const at = new Date("2026-10-18T00:00:00Z");
    const tx = { project: { findFirst: vi.fn(async (args: { include?: unknown }) => args.include ? {
      id: "p", userId: "owner", revision: 1, name: "Old", facilityTypeSlug: "warehouse", params: {}, paramsSource: {}, results: null,
      createdAt: at, updatedAt: at, scenarios: [],
    } : { id: "p", facilityTypeSlug: "warehouse" }) },
    changeLog: { findMany: vi.fn(async () => []) }, paramDefinition: { findMany: vi.fn(async () => []) } };
    const transaction = vi.fn(async (read: (client: typeof tx) => unknown, options?: { isolationLevel: string }) => {
      expect(options).toEqual({ isolationLevel: "RepeatableRead" });
      return read(tx);
    });
    const db = { $transaction: transaction, project: { findFirst: vi.fn(() => { throw new Error("outside snapshot"); }) } } as unknown as PrismaClient;
    const result = await getOwnedProjectSnapshot(db, "p", "owner");
    expect(result?.project.revision).toBe(1); expect(result?.changes).toEqual([]);
    expect(transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(tx.project.findFirst).toHaveBeenCalledTimes(2);
    for (const [args] of tx.project.findFirst.mock.calls) expect(args).toMatchObject({ where: { id: "p", userId: "owner" } });
  });

  it("never reads a journal for an unknown or foreign project", async () => {
    const tx = { project: { findFirst: vi.fn(async () => null) }, changeLog: { findMany: vi.fn() } };
    const db = { $transaction: (read: (client: typeof tx) => unknown) => read(tx) } as unknown as PrismaClient;
    expect(await getOwnedProjectSnapshot(db, "foreign", "owner")).toBeNull();
    expect(tx.changeLog.findMany).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps journal parameter labels in the owned snapshot (metadata=%s)", async savedMetadata => {
    const at = new Date("2026-10-18T00:00:00Z");
    const results = {
      modelVersion: "saved", dataVersion: "saved", facility: "warehouse", results: [], scenarios: [],
      productSnapshots: {}, normsUsed: {}, paramsUsed: { forkliftOperatorsCount: 20 },
      ...(savedMetadata ? { runtime: { paramDefs: [{ key: "forkliftOperatorsCount", label: "Сохранённая численность" }] } } : {}),
    };
    const liveDefinitions = vi.fn(async () => [{ key: "forkliftOperatorsCount", label: "LIVE_ADMIN_RENAMED", options: [], usedBy: [] }]);
    const tx = {
      project: { findFirst: vi.fn(async (args: { include?: unknown }) => args.include ? {
        id: "p", userId: "owner", revision: 1, name: "Архив", facilityTypeSlug: "warehouse", params: {}, paramsSource: {}, results,
        createdAt: at, updatedAt: at, scenarios: [],
      } : { id: "p", facilityTypeSlug: "warehouse" }) },
      changeLog: { findMany: vi.fn(async () => [{ id: "change", createdAt: at, field: "param:forkliftOperatorsCount", autoValue: 10, oldValue: 10, newValue: 20 }]) },
      paramDefinition: { findMany: liveDefinitions },
    };
    const db = { $transaction: (read: (client: typeof tx) => unknown) => read(tx) } as unknown as PrismaClient;
    const snapshot = await getOwnedProjectSnapshot(db, "p", "owner");
    expect(snapshot?.changes[0]?.fieldLabel).toBe(`Параметр: ${savedMetadata ? "Сохранённая численность" : "forkliftOperatorsCount"}`);
    expect(liveDefinitions).not.toHaveBeenCalled();
  });
});
