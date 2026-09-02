import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 removed inline `datasource.url` from schema.prisma; the connection
// string now lives here instead. Value is unchanged from the original spec:
// DATABASE_URL from .env (postgresql://rrp:rrp_dev_password@localhost:5433/robotization_roi).
// The Prisma config loader does not auto-load .env before evaluating this file,
// so it's loaded explicitly here via the already-installed `dotenv` package.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Deliberately NOT prisma/config's `env()` helper: it throws PrismaConfigEnvError while the
    // config file is being LOADED, before Prisma knows which command was asked for. `prisma
    // generate` needs no database — it only reads the schema — but it still loads this file, so
    // `env()` made `npm ci` (which now runs generate via postinstall) fail anywhere DATABASE_URL
    // is absent: the Dockerfile's deps stage, and a fresh clone before .env exists.
    // Falling back to "" keeps config load pure; commands that really do connect (migrate, seed,
    // studio) still fail, with Prisma's own connection error instead of a load-time throw.
    url: process.env.DATABASE_URL ?? "",
  },
});
