import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { enqueueCalculation } from "./service";

describe("durable calculation request admission", () => {
  const db = { $transaction: vi.fn(() => { throw new Error("Admission must reject before accessing DB"); }) } as unknown as PrismaClient;

  it("rejects a missing owner, forged extra fields and malformed idempotency keys before snapshot work", async () => {
    await expect(enqueueCalculation(db, "", { operation: "CALCULATE", facility: "warehouse" }, "key")).rejects.toMatchObject({ status: 401 });
    await expect(enqueueCalculation(db, "owner", { operation: "CALCULATE", facility: "warehouse", ownerId: "other" }, "key")).rejects.toMatchObject({ status: 422 });
    await expect(enqueueCalculation(db, "owner", { operation: "CALCULATE", facility: "warehouse" }, "bad key")).rejects.toMatchObject({ status: 422 });
  });

  it("rejects oversized UTF-8 data before opening the catalogue transaction", async () => {
    const request = { operation: "CREATE", facility: "warehouse", name: "я".repeat(2_100_000) };
    expect(JSON.stringify(request).length).toBeLessThan(4 * 1024 * 1024);
    await expect(enqueueCalculation(db, "owner", request, "large-input")).rejects.toMatchObject({ status: 413 });
  });
});
