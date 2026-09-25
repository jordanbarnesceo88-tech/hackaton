import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

/**
 * Remove the accounts, projects and rate-limit buckets an E2E run creates.
 *
 * Every run signs up at least one throwaway user, and nothing ever deleted them: a dev
 * database had 53 users, of which 51 were e2e leftovers, plus a RateLimit row per run keyed on
 * that run's synthetic X-Forwarded-For. Harmless individually, but it makes the data useless
 * for eyeballing and it grows without bound.
 *
 * Deletes only rows this suite is responsible for, matched on the prefixes the specs use:
 * - пользователи `e2e+…`, `e2e-parity+…` (auth-report.spec.ts, tz-admin-catalog.spec.ts),
 *   `ovr+…` (wizard.spec.ts) и `tzt-…` (остатки db-тестов vitest, если прогон оборвался);
 *   их SavedAnalysis и Project уходят каскадом (onDelete: Cascade), записи ChangeLog
 *   остаются без автора (SetNull);
 * - проекты демо-аккаунта demo@demo.local с названием на `e2e-` (tz-project.spec.ts создаёт
 *   `e2e-tz-…` и его копию `… (копия)`), кроме засеянного демо-проекта (isDemo) — его
 *   пересоздаёт только `npm run db:seed`;
 * - строки RateLimit с синтетическим IP прогона (`e2e-…`).
 * Everything else — the demo accounts themselves, the seeded demo project, catalog and norms —
 * is kept.
 *
 * Each deletion runs on its own: one failing (say, a foreign key a future table adds) must not
 * skip the rest.
 */

/** Префиксы почты пользователей, которых заводят тесты. */
const TEST_USER_PREFIXES = ["e2e+", "e2e-parity+", "ovr+", "tzt-"] as const;
/** Демо-аккаунт, в котором tz-project.spec.ts создаёт и копирует проекты. */
const DEMO_USER_EMAIL = "demo@demo.local";
/** Префикс названий проектов, которые создаёт e2e. */
const TEST_PROJECT_PREFIX = "e2e-";

export default async function globalTeardown() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const removed: string[] = [];
  const step = async (label: string, run: () => Promise<{ count: number }>) => {
    try {
      const { count } = await run();
      if (count > 0) removed.push(`${count} ${label}`);
    } catch (e) {
      // Never fail a green run on cleanup — the suite's result is what matters here.
      console.warn(`[e2e teardown] ${label}: cleanup skipped:`, e instanceof Error ? e.message : e);
    }
  };
  try {
    await step("test users", () =>
      prisma.user.deleteMany({
        where: { OR: TEST_USER_PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })) },
      }),
    );
    await step("demo-account test projects", () =>
      prisma.project.deleteMany({
        where: { isDemo: false, name: { startsWith: TEST_PROJECT_PREFIX }, user: { email: DEMO_USER_EMAIL } },
      }),
    );
    await step("rate-limit rows", () => prisma.rateLimit.deleteMany({ where: { key: { contains: "e2e-" } } }));
    if (removed.length > 0) console.log(`[e2e teardown] removed ${removed.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}
