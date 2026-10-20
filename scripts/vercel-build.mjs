import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const historicalBaseline = "20260924120000_tz_v2";
const migrationVariables = ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"];

export function migrationConnection(environment) {
  const value = migrationVariables.map(name => environment[name]?.trim()).find(Boolean);
  if (!value) throw new Error("Production migration requires a PostgreSQL connection.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Migration connection must be a valid direct PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error("Migration connection must be a valid direct PostgreSQL URL.");
  // Neon documents the same endpoint without '-pooler' as its direct migration connection.
  if (/^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.neon\.tech$/i.test(url.hostname)) {
    url.hostname = url.hostname.replace(/-pooler\./i, ".");
    url.searchParams.delete("pgbouncer");
    return url.toString();
  }
  if (/(?:^|[.-])(?:pooler|pgbouncer)(?:[.-]|$)/i.test(url.hostname) || url.searchParams.get("pgbouncer") === "true") throw new Error("Migrations require a direct PostgreSQL connection, not a transaction pooler.");
  return value;
}

/** Prevent this web build from blindly applying legacy destructive migrations to an untracked populated database. */
export async function verifyMigrationBaseline(connection) {
  const { default: pg } = await import("pg");
  const schema = new URL(connection).searchParams.get("schema") || "public";
  const client = new pg.Client({ connectionString: connection, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
  try {
    await client.connect();
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'", [schema]);
    if (!tables.rows.length) return; // Empty schema: the initial migration chain has no existing data to remove.
    if (!tables.rows.some(row => row.table_name === "_prisma_migrations")) throw new Error("Historical migration baseline is missing; run the manual deployment preflight.");
    const escaped = schema.replaceAll('"', '""');
    const history = await client.query(`SELECT migration_name FROM "${escaped}"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    const applied = new Set(history.rows.map(row => row.migration_name));
    const required = (await readdir(new URL("../prisma/migrations/", import.meta.url))).filter(name => /^\d{14}_/.test(name) && name <= historicalBaseline);
    if (required.some(name => !applied.has(name))) throw new Error("Historical migration baseline is incomplete; run the manual deployment preflight.");
  } finally { await client.end(); }
}

export function redactBuildOutput(output, environment) {
  let safe = String(output ?? "").replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[REDACTED_DATABASE_URL]");
  const secrets = Object.entries(environment).filter(([key, value]) => (/(?:URL|PASSWORD|SECRET|TOKEN|KEY)$/.test(key) || migrationVariables.includes(key)) && typeof value === "string" && value.length >= 4).map(([, value]) => value);
  for (const value of migrationVariables.map(name => environment[name])) {
    try { const url = new URL(value); if (url.password) secrets.push(url.password, decodeURIComponent(url.password)); } catch { /* Invalid input is never echoed. */ }
  }
  for (const secret of secrets.sort((a, b) => b.length - a.length)) safe = safe.split(secret).join("[REDACTED]");
  return safe;
}

function execute(command, args, environment) {
  return spawnSync(command, args, { cwd: root, env: environment, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" && command === "npm.cmd" });
}

export async function runVercelBuild(environment, { run = execute, verifyBaseline = verifyMigrationBaseline, log = console.log } = {}) {
  if (environment.VERCEL !== "1" || !["production", "preview", "development"].includes(environment.VERCEL_ENV)) throw new Error("Unknown Vercel environment; no migration or build was started.");
  if (environment.VERCEL_ENV === "production") {
    if (!environment.DATABASE_URL?.trim()) throw new Error("Production requires DATABASE_URL for the web runtime.");
    const connection = migrationConnection(environment);
    try { await verifyBaseline(connection); } catch { throw new Error("Production migration preflight failed; check direct connectivity and the historical migration baseline. No migration/build was started."); }
    log("Production: applying pending Prisma migrations (no seed or reset).");
    const migration = run(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { ...environment, DATABASE_URL: connection });
    if (migration.error || migration.status !== 0) {
      const code = /\bP\d{4}\b/.exec(`${migration.stdout ?? ""}\n${migration.stderr ?? ""}`)?.[0];
      throw new Error(`Prisma migration failed${code ? ` (${code})` : ""}; application build was not started. Connection details are omitted.`);
    }
    log("Production migrations completed.");
    const sync = run(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), resolve(root, "scripts/sync-runtime-catalog.ts")], { ...environment, DATABASE_URL: connection });
    for (const output of [sync.stdout, sync.stderr]) if (output) log(redactBuildOutput(output, environment));
    if (sync.error || sync.status !== 0) throw new Error("Runtime catalogue synchronization failed; application build was not started. Connection details are omitted.");
    log("Production reference catalogue synchronized (administrator edits preserved; no full seed).");
  } else log(`${environment.VERCEL_ENV}: database migrations are disabled.`);
  // Direct connection is confined to migration/catalogue children; build/runtime keeps DATABASE_URL unchanged.
  const build = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { ...environment });
  for (const output of [build.stdout, build.stderr]) if (output) log(redactBuildOutput(output, environment));
  if (build.error || build.status !== 0) throw new Error("Application build failed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVercelBuild(process.env).catch(error => { console.error(error.message); process.exitCode = 1; });
}
