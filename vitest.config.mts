import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

// Четыре файла ходят в НАСТОЯЩИЙ Postgres и считают настоящий bcrypt; остальные двадцать семь
// чистые. Пока они бежали одним набором, зелёный результат был невоспроизводим: измерено
// 3 падения из 5 прогонов, причём в разных тестах, а добавление постороннего файла в
// lib/economics/ меняло исход. Общий Postgres на параллельных файлах — единственное состояние,
// которое они делят, поэтому наборы разведены, а БД-набор исполняется последовательно.
//
// Смысл разделения не в скорости, а в доверии: гейт «319 зелёные» решает, можно ли мержить в
// master (В-1), и мигающий гейт заставляет перезапускать до зелёного вместо того, чтобы читать
// результат.
const DB_TESTS = [
  "lib/auth/rate-limit.test.ts",
  "lib/auth/actions.test.ts",
  "lib/analyses/actions.test.ts",
  "lib/db/queries.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          globals: false,
          // Playwright specs live in e2e/ and import @playwright/test (not vitest) — keep them
          // out of the unit run, which would otherwise pick up *.spec.ts and hard-fail on the
          // import.
          exclude: [...configDefaults.exclude, "e2e/**", ...DB_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          globals: false,
          include: DB_TESTS,
          // Vitest does not load .env the way Next.js does, and @prisma/client reads
          // process.env directly, so load .env before any test constructs the client —
          // otherwise DATABASE_URL is undefined and PrismaClient throws.
          setupFiles: ["dotenv/config"],
          // Один Postgres на все четыре файла: параллельный запуск означает, что они
          // наступают друг другу на состояние.
          fileParallelism: false,
        },
      },
    ],
  },
});
