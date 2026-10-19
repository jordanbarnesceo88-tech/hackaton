import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Keep role-specific pools separate without importing the web singleton into a worker.
export function createPrismaClient(maxConnections?: number): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ...(maxConnections === undefined ? {} : { max: maxConnections }),
  });
  return new PrismaClient({ adapter });
}
