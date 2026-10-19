import "dotenv/config";
import { hostname } from "node:os";
import { createPrismaClient } from "../lib/db/factory";
import { runCalculationWorker } from "../lib/calculation-jobs/worker";
import { engineRelease } from "../lib/calculation-jobs/types";
import { CalculationQueuePolicyError, readQueuePolicy } from "../lib/calculation-jobs/policy";

const prisma = createPrismaClient(2);

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

async function main() {
  // Fail fast on missing migrations rather than advertise an idle, unusable worker.
  await prisma.calculationJob.count();
  const policy = await readQueuePolicy(prisma);
  console.info(`calculation_worker_started engine=${engineRelease()} instance=${hostname()}:${process.pid} concurrency=1 globalCap=${policy.maxActive} dbPoolMax=2 policy=database`);
  await runCalculationWorker(prisma, controller.signal);
}

main().catch(error => {
  if (error instanceof CalculationQueuePolicyError) console.error(`calculation_worker_policy_failed code=${error.code}`);
  else console.error("calculation_worker_start_failed: проверьте подключение и миграции");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
