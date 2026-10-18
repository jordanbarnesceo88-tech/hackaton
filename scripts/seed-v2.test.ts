import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ order: [] as string[], sync: vi.fn(), demo: vi.fn(), examples: vi.fn() }));
vi.mock("../lib/catalog/sync", () => ({
  syncOrganizerData: calls.sync, formatSyncReport: () => [], changedTotal: () => 0,
}));
vi.mock("../lib/auth/password", () => ({
  MAX_PASSWORD_BYTES: 72, passwordByteLength: (value: string) => Buffer.byteLength(value),
  hashPassword: async () => "test-hash", verifyPassword: async () => true,
}));
vi.mock("../lib/api/import", () => ({
  validateProductSeeds: (seeds: unknown) => ({ ok: true, seeds }),
  importProducts: async () => ({ failed: 0, refused: 0 }),
}));
vi.mock("./seed-demo", () => ({ seedDemoProject: calls.demo }));
vi.mock("./seed-business-examples", () => ({ seedBusinessExamples: calls.examples }));
const { seedV2, seedV2Data } = await import("./seed-v2");

beforeEach(() => {
  calls.order.length = 0;
  calls.sync.mockReset().mockImplementation(async () => { calls.order.push("data"); return { products: { failed: 0 } }; });
  calls.demo.mockReset().mockImplementation(async () => { calls.order.push("demo"); });
  calls.examples.mockReset().mockImplementation(async () => { calls.order.push("examples"); });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function accountDb() {
  return { user: {
    findUnique: vi.fn(async () => ({ id: "demo-account", role: "USER", passwordHash: "existing-hash" })),
    update: vi.fn(async () => { calls.order.push("account"); }),
  } } as unknown as Parameters<typeof seedV2>[0];
}

describe("deployment seed orchestration", () => {
  it("data/account synchronization does not create calculated demo projects", async () => {
    await seedV2Data(accountDb());
    expect(calls.order).toEqual(["data", "account"]);
    expect(calls.demo).not.toHaveBeenCalled();
    expect(calls.examples).not.toHaveBeenCalled();
  });

  it("every full seed calculates both demo groups after synchronization, including a repeated seed", async () => {
    const db = accountDb();
    await seedV2(db);
    await seedV2(db);
    expect(calls.order).toEqual(["data", "account", "demo", "examples", "data", "account", "demo", "examples"]);
    expect(calls.demo).toHaveBeenCalledTimes(2);
    expect(calls.examples).toHaveBeenCalledTimes(2);
    expect(calls.demo).toHaveBeenCalledWith(db);
    expect(calls.examples).toHaveBeenCalledWith(db);
  });

  it("does not calculate demos from an incompletely synchronized catalogue", async () => {
    calls.sync.mockResolvedValueOnce({ products: { failed: 1 } });
    await expect(seedV2(accountDb())).rejects.toThrow("Синхронизация не записала продуктов: 1");
    expect(calls.demo).not.toHaveBeenCalled();
    expect(calls.examples).not.toHaveBeenCalled();
  });
});
