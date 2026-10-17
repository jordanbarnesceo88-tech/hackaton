import { afterEach, describe, expect, it, vi } from "vitest";
import { engineRelease } from "./types";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";

vi.mock("node:fs", () => ({ readFileSync: vi.fn(() => { throw new Error("No development manifest"); }) }));

afterEach(() => vi.unstubAllEnvs());

describe("calculation engine release identity", () => {
  it("always retains the compiled source fingerprint when a deployment label is set", () => {
    const hash = `alfa-robot/sha256:${"a".repeat(64)}`;
    vi.stubEnv("CALCULATION_ENGINE_FINGERPRINT", hash);
    vi.stubEnv("CALCULATION_ENGINE_RELEASE", "release-42");
    expect(engineRelease()).toBe(`${hash}/release-42`);
  });

  it("fails closed in production if only a human release label is supplied", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALCULATION_ENGINE_FINGERPRINT", undefined);
    vi.stubEnv("CALCULATION_ENGINE_RELEASE", "release-42");
    expect(engineRelease).toThrow("встроенного fingerprint");
  });

  it("rejects malformed compiled identities", () => {
    vi.stubEnv("CALCULATION_ENGINE_FINGERPRINT", "current-engine");
    expect(engineRelease).toThrow("fingerprint");
  });

  it("explicitly marks source development mode and includes the spatial model", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CALCULATION_ENGINE_FINGERPRINT", undefined);
    vi.stubEnv("CALCULATION_ENGINE_RELEASE", undefined);
    expect(engineRelease()).toContain(`${SPATIAL_MODEL_VERSION}/development`);
  });
});
