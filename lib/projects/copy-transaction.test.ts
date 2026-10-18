import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), create: vi.fn(), transaction: vi.fn(), refresh: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
const { copyProjectAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  mocks.transaction.mockImplementation(async read => read({ project: { findFirst: mocks.read, create: mocks.create } }));
});

describe("copy reads one owned source revision", () => {
  it("keeps source, scenarios and copied result inside RepeatableRead", async () => {
    const source = { id: "source", name: "Архив", objectName: null, facilityTypeSlug: "warehouse", params: { activeAreaM2: 5000 },
      paramsSource: { kind: "demo" }, results: { modelVersion: "historical", captured: 42 }, modelVersion: "historical", dataVersion: "old",
      calculatedAt: new Date("2026-10-18T00:00:00Z"), scenarios: [{ key: "p1", name: "Покупка", kind: "PURCHASE", order: 0, spec: { items: [] } }] };
    mocks.read.mockResolvedValue(source); mocks.create.mockResolvedValue({ id: "copy" });
    await expect(copyProjectAction("source")).rejects.toThrow("redirect /projects/copy");
    expect(mocks.transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(mocks.read).toHaveBeenCalledWith({ where: { id: "source", userId: "owner" }, include: { scenarios: true } });
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({ userId: "owner", name: "Архив (копия)", results: source.results,
      modelVersion: "historical", copiedFromId: "source", isDemo: false, scenarios: { create: source.scenarios } });
  });

  it("never creates a copy of a foreign/missing source", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await copyProjectAction("foreign")).toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
