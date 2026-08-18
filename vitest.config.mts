import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // These are integration tests against a live Postgres via Prisma. Vitest does not
    // load .env the way Next.js does, and @prisma/client reads process.env directly, so
    // load .env before any test constructs the client — otherwise DATABASE_URL is
    // undefined and PrismaClient throws.
    setupFiles: ["dotenv/config"],
  },
});
