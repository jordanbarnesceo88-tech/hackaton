import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const s = await p.solution.findFirst({ where: { solutionCategory: { facilityType: { slug: "other" } } }, select: { id: true } });
console.log(s?.id);
await p.$disconnect();
