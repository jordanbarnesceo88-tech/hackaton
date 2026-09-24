import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

// Файлы из DB_TESTS ходят в НАСТОЯЩИЙ Postgres (и считают настоящий bcrypt); все остальные
// чистые. Пока они бежали одним набором, зелёный результат был невоспроизводим: измерено
// 3 падения из 5 прогонов, причём в разных тестах, а добавление постороннего файла в
// lib/economics/ меняло исход. Общий Postgres на параллельных файлах — единственное состояние,
// которое они делят, поэтому наборы разведены: unit — всё, кроме DB_TESTS, параллельно;
// db — только DB_TESTS, последовательно.
//
// Смысл разделения не в скорости, а в доверии: зелёный гейт по обоим наборам решает, можно ли
// мержить (В-1), и мигающий гейт заставляет перезапускать до зелёного вместо того, чтобы читать
// результат. Числа файлов и тестов здесь намеренно не пишутся: они устаревают с каждым новым
// тестом, а источник правды — сам список ниже и вывод vitest.
//
// Тест, который создаёт PrismaClient, ОБЯЗАН попасть в этот список, иначе он побежит в
// unit-наборе параллельно с остальными и без .env. Пути, которых ещё нет, ничему не
// соответствуют и безвредны: список заранее содержит БД-тесты модели по методике ТЗ.
const DB_TESTS = [
  "lib/auth/rate-limit.test.ts",
  "lib/auth/actions.test.ts",
  "lib/analyses/actions.test.ts",
  "lib/db/queries.test.ts",
  // Модель по методике ТЗ (tz-1.0.0).
  "lib/catalog/queries.test.ts",
  "lib/catalog/sync.test.ts",
  "lib/projects/actions.test.ts",
  "lib/admin/actions.test.ts",
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
          // Один Postgres на все файлы набора: параллельный запуск означает, что они
          // наступают друг другу на состояние.
          fileParallelism: false,
        },
      },
    ],
  },
});
