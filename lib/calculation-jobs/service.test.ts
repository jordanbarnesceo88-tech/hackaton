import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { enqueueCalculation } from "./service";
import { jobHttpError } from "./http";

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

  it("returns the blank-name validation error even when the database would fail", async () => {
    const transaction = vi.fn(() => { throw Object.assign(new Error("private database failure"), { code: "P2021" }); });
    const failingDb = { $transaction: transaction } as unknown as PrismaClient;
    const error = await enqueueCalculation(failingDb, "owner", { operation: "CREATE", name: "  ", facility: "warehouse" }, "blank-name")
      .catch((error: unknown) => error);
    const response = jobHttpError(error);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Название проекта — от 1 до 120 символов" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    { name: undefined }, { name: null }, { name: 42 }, { name: "" }, { name: "x".repeat(121) },
    { objectName: 42 }, { objectName: [] }, { objectName: "x".repeat(201) },
    { facility: undefined }, { facility: [] }, { facility: "unknown" },
    { paramsSource: null }, { paramsSource: [] }, { paramsSource: "demo" },
    { paramsSource: { kind: "unknown" } }, { paramsSource: { kind: ["demo"] } },
    { paramsSource: { kind: "demo", extra: true } },
    { paramsSource: { kind: "upload", fileName: 42 } },
    { paramsSource: { kind: "upload", fileName: "x".repeat(256) } },
  ])("rejects malformed CREATE metadata before any database call: %j", async patch => {
    const transaction = vi.fn(() => { throw new Error("Database must not be called"); });
    await expect(enqueueCalculation({ $transaction: transaction } as unknown as PrismaClient, "owner",
      { operation: "CREATE", name: "Склад", facility: "warehouse", ...patch }, "invalid-create"))
      .rejects.toMatchObject({ status: 422 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
