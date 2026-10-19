import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "./factory";

const spies = vi.hoisted(() => ({ adapter: vi.fn(), client: vi.fn() }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class { constructor(options: unknown) { spies.adapter(options); } } }));
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor(options: unknown) { spies.client(options); } } }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("role-specific database pools", () => {
  it("creates no implicit singleton and passes the worker's explicit two-connection limit", () => {
    expect(spies.client).not.toHaveBeenCalled();
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/isolated");
    createPrismaClient(2);
    expect(spies.adapter).toHaveBeenCalledExactlyOnceWith({ connectionString: "postgresql://test.invalid/isolated", max: 2 });
    expect(spies.client).toHaveBeenCalledTimes(1);
  });

  it("preserves the existing web pool defaults when no role limit was requested", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/isolated");
    createPrismaClient();
    expect(spies.adapter).toHaveBeenCalledExactlyOnceWith({ connectionString: "postgresql://test.invalid/isolated" });
  });
});
