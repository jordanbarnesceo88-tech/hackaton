import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobHttpError } from "./http";
import { engineRelease } from "./types";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([
  { code: "P2021" }, { code: "P2022" },
  { code: "P2010", meta: { code: "42P01" } },
  { code: "P2010", meta: { code: "42703" } },
])("exposes only a safe migration diagnostic for a recognized schema failure: %j", async diagnostic => {
  const response = jobHttpError(Object.assign(new Error("private table / DSN / SQL"), diagnostic));
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.details).toEqual({ code: "CALCULATION_SCHEMA_UNAVAILABLE" });
  expect(body.error).toContain("миграции");
  expect(JSON.stringify(body)).not.toMatch(/private|DSN|SQL/);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private|DSN|SQL/);
});

it.each([undefined, "invalid-private-fingerprint"])("classifies the actual production fingerprint refusal safely: %s", async fingerprint => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CALCULATION_ENGINE_FINGERPRINT", fingerprint);
  let error: unknown;
  try { engineRelease(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  const response = jobHttpError(error);
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.details).toEqual({ code: "CALCULATION_ENGINE_UNAVAILABLE" });
  expect(body.error).toContain("сборку");
  expect(JSON.stringify(body)).not.toContain("private");
});

it.each([
  Object.assign(new Error("private SQL"), { code: "P2010", meta: { code: "23505" } }),
  Object.assign(new Error("private schema"), { code: "P9999" }),
  new Error("private fingerprint failure"),
])("does not guess a schema or engine cause for unrelated errors", async error => {
  const response = jobHttpError(error);
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.details).toBeUndefined();
  expect(body.error).toContain("тем же ключом");
  expect(JSON.stringify(body)).not.toContain("private");
});
