import { readFileSync, readdirSync } from "node:fs";
import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { migrationConnection, redactBuildOutput, runVercelBuild, verifyMigrationBaseline } from "./vercel-build.mjs";

const pg = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({ default: { Client: class { query = pg.query; connect = pg.connect; end = pg.end; } } }));

const environment = { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: "postgresql://runtime:runtime-secret@pooler.example/db", DIRECT_URL: "postgresql://migration:direct-secret@direct.example/db" };
const success = (...args: [string?, string[]?, NodeJS.ProcessEnv?]): SpawnSyncReturns<string> => {
  void args;
  return { status: 0, stdout: "ok", stderr: "", pid: 1, output: [], signal: null };
};

describe("Vercel production migration build", () => {
  it("uses the standard integration direct variables before the pooled runtime URL", () => {
    const urls = ["postgresql://u:a@direct.example/one", "postgresql://u:b@direct.example/two", "postgresql://u:c@direct.example/three", "postgresql://u:d@direct.example/four"];
    const keys = ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"];
    for (let index = 0; index < keys.length; index++) {
      const env = Object.fromEntries(keys.map((key, position) => [key, position >= index ? urls[position] : "  "]));
      expect(migrationConnection(env)).toBe(urls[index]);
    }
    expect(() => migrationConnection({ DIRECT_URL: "not-a-url", DATABASE_URL_UNPOOLED: urls[1] })).toThrow();
  });
  it("derives only Neon's documented direct endpoint without changing its credentials, database or TLS settings", () => {
    const pooled = "postgresql://role:escaped%40password@ep-example-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&schema=public&channel_binding=require&pgbouncer=true";
    const direct = new URL(migrationConnection({ DATABASE_URL: pooled }));
    expect(direct.hostname).toBe("ep-example-123.us-east-2.aws.neon.tech");
    expect(direct.username).toBe("role"); expect(direct.password).toBe("escaped%40password"); expect(direct.pathname).toBe("/neondb");
    for (const key of ["sslmode", "schema", "channel_binding"]) expect(direct.searchParams.get(key)).toBe(new URL(pooled).searchParams.get(key));
    expect(direct.searchParams.has("pgbouncer")).toBe(false);
    expect(pooled).toContain("-pooler.");
    for (const host of ["ep-example-pooler.us.aws.neon.tech.evil", "aws-0.pooler.supabase.com", "db-pooler.example"]) expect(() => migrationConnection({ DATABASE_URL: `postgresql://u:pw@${host}/db` })).toThrow();
  });
  it("redacts direct integration variables and their decoded passwords", () => {
    const env = { DATABASE_URL_UNPOOLED: "postgresql://u:unpooled%40password@direct.example/db", POSTGRES_URL_NON_POOLING: "postgresql://u:other-password@direct.example/db" };
    const output = redactBuildOutput(`${env.DATABASE_URL_UNPOOLED} unpooled@password unpooled%40password ${env.POSTGRES_URL_NON_POOLING} other-password`, env);
    expect(output).not.toMatch(/unpooled|other-password|postgresql/);
  });
  it("is the actual configured build entrypoint", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    expect(config.buildCommand).toBe("node scripts/vercel-build.mjs");
  });
  it("checks historical baseline, migrates first using DIRECT_URL, then builds with unchanged runtime env", async () => {
    const order: string[] = [], original = structuredClone(environment);
    const run = vi.fn((command: string, args: string[], env: NodeJS.ProcessEnv) => {
      if (args.includes("deploy")) { order.push("migrate"); expect(env.DATABASE_URL).toBe(environment.DIRECT_URL); expect(args.slice(1)).toEqual(["migrate", "deploy"]); }
      else { order.push("build"); expect(args).toEqual(["run", "build"]); expect(env.DATABASE_URL).toBe(environment.DATABASE_URL); }
      return success();
    });
    await runVercelBuild(environment, { run, verifyBaseline: async connection => { expect(connection).toBe(environment.DIRECT_URL); order.push("preflight"); }, log: vi.fn() });
    expect(order).toEqual(["preflight", "migrate", "build"]); expect(environment).toEqual(original);
  });
  it.each(["preview", "development"])("never connects or performs DDL in %s, even with production credentials present", async VERCEL_ENV => {
    const run = vi.fn(success), verifyBaseline = vi.fn();
    await runVercelBuild({ ...environment, VERCEL_ENV }, { run, verifyBaseline, log: vi.fn() });
    expect(verifyBaseline).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledTimes(1); expect(run.mock.calls[0]?.[1]).toEqual(["run", "build"]);
  });
  it("uses direct DATABASE_URL fallback only for the migration child", async () => {
    const env = { ...environment, DIRECT_URL: "", DATABASE_URL: "postgresql://user:password@direct.example/db" }, run = vi.fn(success);
    await runVercelBuild(env, { run, verifyBaseline: async () => {}, log: vi.fn() });
    expect(run.mock.calls[0]?.[2]?.DATABASE_URL).toBe(env.DATABASE_URL); expect(run).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { VERCEL: "1", VERCEL_ENV: "staging" }, { VERCEL: "0", VERCEL_ENV: "production" }])("fails closed for an unknown build environment", async env => {
    const run = vi.fn(success), verifyBaseline = vi.fn();
    await expect(runVercelBuild(env, { run, verifyBaseline, log: vi.fn() })).rejects.toThrow("Unknown Vercel environment");
    expect(run).not.toHaveBeenCalled(); expect(verifyBaseline).not.toHaveBeenCalled();
  });
  it("stops before migrate/build when a populated historical baseline is unsafe or inaccessible", async () => {
    const run = vi.fn(success);
    await expect(runVercelBuild(environment, { run, verifyBaseline: async () => { throw new Error(environment.DIRECT_URL); }, log: vi.fn() })).rejects.toThrow("preflight failed");
    expect(run).not.toHaveBeenCalled();
  });
  it("never builds or leaks connection details after a failed migration", async () => {
    const run = vi.fn(() => ({ ...success(), status: 1, stdout: environment.DIRECT_URL, stderr: `P3009 password direct-secret ${environment.DATABASE_URL}` })), log = vi.fn();
    await expect(runVercelBuild(environment, { run, verifyBaseline: async () => {}, log })).rejects.toThrow("Prisma migration failed (P3009)");
    expect(run).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
  it("rejects missing, malformed, non-PostgreSQL and explicitly pooled migration endpoints without echoing them", () => {
    for (const DIRECT_URL of ["", "not-a-url-secret", "https://user:secret@example.com/db", "postgresql://user:secret@db-pooler.example/db", "postgresql://user:secret@direct.example/db?pgbouncer=true"]) {
      expect(() => migrationConnection({ DIRECT_URL })).toThrow();
    }
  });
  it("redacts URLs and supplied secrets from build output and propagates build failure", async () => {
    const env = { ...environment, AI_API_KEY: "provider-secret", AUTH_SECRET: "auth-secret" }, log = vi.fn();
    expect(redactBuildOutput(`${environment.DIRECT_URL} direct-secret provider-secret auth-secret`, env)).not.toContain("secret");
    const run = vi.fn((command: string, args: string[]) => args.includes("deploy") ? success() : ({ ...success(), status: 1, stdout: env.AI_API_KEY, stderr: env.DIRECT_URL }));
    await expect(runVercelBuild(env, { run, verifyBaseline: async () => {}, log })).rejects.toThrow("Application build failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("allows an empty default schema after a read-only check, without touching any other schema", async () => {
    pg.query.mockReset().mockResolvedValueOnce({ rows: [] });
    await verifyMigrationBaseline(environment.DIRECT_URL);
    expect(pg.query).toHaveBeenCalledTimes(1); expect(pg.query.mock.calls[0]?.[1]).toEqual(["public"]);
    expect(pg.end).toHaveBeenCalled();
  });
  it("checks migration history in the explicit Prisma schema using only SELECT statements", async () => {
    const names = readdirSync(new URL("../prisma/migrations/", import.meta.url)).filter(name => /^\d{14}_/.test(name));
    pg.query.mockReset().mockResolvedValueOnce({ rows: [{ table_name: "Project" }, { table_name: "_prisma_migrations" }] }).mockResolvedValueOnce({ rows: names.map(migration_name => ({ migration_name })) });
    await verifyMigrationBaseline(`${environment.DIRECT_URL}?schema=isolated_review`);
    expect(pg.query.mock.calls[0]?.[1]).toEqual(["isolated_review"]);
    expect(pg.query.mock.calls[1]?.[0]).toContain('"isolated_review"."_prisma_migrations"');
    expect(pg.query.mock.calls.every(call => String(call[0]).startsWith("SELECT "))).toBe(true);
  });
  it("refuses populated databases without migration history and incomplete historical baselines", async () => {
    pg.query.mockReset().mockResolvedValueOnce({ rows: [{ table_name: "Project" }] });
    await expect(verifyMigrationBaseline(environment.DIRECT_URL)).rejects.toThrow("baseline is missing");
    pg.query.mockReset().mockResolvedValueOnce({ rows: [{ table_name: "Project" }, { table_name: "_prisma_migrations" }] }).mockResolvedValueOnce({ rows: [{ migration_name: "20260924120000_tz_v2" }] });
    await expect(verifyMigrationBaseline(environment.DIRECT_URL)).rejects.toThrow("baseline is incomplete");
  });
});
