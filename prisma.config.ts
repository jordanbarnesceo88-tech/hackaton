import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 removed inline `datasource.url` from schema.prisma; the connection
// string now lives here instead. Value is unchanged from the original spec:
// DATABASE_URL from .env (postgresql://rrp:rrp_dev_password@localhost:5433/robotization_roi).
// The Prisma config loader does not auto-load .env before evaluating this file,
// so it's loaded explicitly here via the already-installed `dotenv` package.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
