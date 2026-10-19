import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CalculationQueuePolicyError, parseQueueCap, readQueuePolicy, setQueueCap } from "./policy";

describe("shared calculation queue policy", () => {
  it.each(["1", "2", "12", "100"])("accepts the explicit bounded integer %s", value => {
    expect(parseQueueCap(value)).toBe(Number(value));
  });

  it.each(["", "0", "-1", "101", "1.5", "NaN", "Infinity", "12x", " 12", "12 ", "12\n", "12\r", "012", "1e1"])("rejects malformed CLI cap %j", value => {
    expect(() => parseQueueCap(value)).toThrow("от 1 до 100");
  });

  it.each([NaN, Infinity, -1, 0, 1.5, 101])("rejects invalid numeric cap %s before opening a transaction", async maxActive => {
    const transaction = vi.fn();
    await expect(setQueueCap({ $transaction: transaction } as unknown as PrismaClient, maxActive)).rejects.toThrow("от 1 до 100");
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [], code: "QUEUE_POLICY_MISSING" },
    { rows: [{ id: 2, maxActive: 2 }], code: "QUEUE_POLICY_INVALID" },
    { rows: [{ id: 1, maxActive: 0 }], code: "QUEUE_POLICY_INVALID" },
    { rows: [{ id: 1, maxActive: 101 }], code: "QUEUE_POLICY_INVALID" },
    { rows: [{ id: 1, maxActive: 1.5 }], code: "QUEUE_POLICY_INVALID" },
    { rows: [{ id: 1, maxActive: "12" }], code: "QUEUE_POLICY_INVALID" },
    { rows: [{ id: 1, maxActive: 2 }, { id: 1, maxActive: 12 }], code: "QUEUE_POLICY_INVALID" },
  ])("fails closed on missing or invalid stored policy: $code / $rows", async ({ rows, code }) => {
    const db = { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient;
    await expect(readQueuePolicy(db)).rejects.toBeInstanceOf(CalculationQueuePolicyError);
    await expect(readQueuePolicy(db)).rejects.toMatchObject({ code });
  });

  it("reads the current policy again instead of caching a process-local limit", async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 1, maxActive: 2 }]).mockResolvedValueOnce([{ id: 1, maxActive: 12 }]);
    const db = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    expect(await readQueuePolicy(db)).toEqual({ maxActive: 2 });
    expect(await readQueuePolicy(db)).toEqual({ maxActive: 12 });
  });
});
