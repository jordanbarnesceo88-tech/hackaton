import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

/**
 * Remove the accounts and rate-limit buckets an E2E run creates.
 *
 * Every run signs up at least one throwaway user, and nothing ever deleted them: a dev
 * database had 53 users, of which 51 were e2e leftovers, plus a RateLimit row per run keyed on
 * that run's synthetic X-Forwarded-For. Harmless individually, but it makes the data useless
 * for eyeballing and it grows without bound.
 *
 * Deletes only rows this suite is responsible for, matched on the prefixes the specs use.
 * SavedAnalysis rows go with their owner via the onDelete: Cascade already on the relation.
 */
export default async function globalTeardown() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const users = await prisma.user.deleteMany({
      where: { OR: [{ email: { startsWith: "e2e+" } }, { email: { startsWith: "e2e-parity+" } }] },
    });
    const limits = await prisma.rateLimit.deleteMany({ where: { key: { contains: "e2e-" } } });
    if (users.count || limits.count) {
      console.log(`[e2e teardown] removed ${users.count} test users, ${limits.count} rate-limit rows`);
    }
  } catch (e) {
    // Never fail a green run on cleanup — the suite's result is what matters here.
    console.warn("[e2e teardown] cleanup skipped:", e instanceof Error ? e.message : e);
  } finally {
    await prisma.$disconnect();
  }
}
