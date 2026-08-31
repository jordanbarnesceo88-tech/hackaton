import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: false,
    // Playwright specs live in e2e/ and import @playwright/test (not vitest) — keep them out of
    // the unit run, which would otherwise pick up *.spec.ts and hard-fail on the import.
    exclude: [...configDefaults.exclude, "e2e/**"],
    // These are integration tests against a live Postgres via Prisma. Vitest does not
    // load .env the way Next.js does, and @prisma/client reads process.env directly, so
    // load .env before any test constructs the client — otherwise DATABASE_URL is
    // undefined and PrismaClient throws.
    setupFiles: ["dotenv/config"],
  },
});
