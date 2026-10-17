import "dotenv/config";
import { prisma } from "../lib/db/client";
import { runCalculationWorker } from "../lib/calculation-jobs/worker";
import { engineRelease } from "../lib/calculation-jobs/types";

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

async function main() {
  // Fail fast on missing migrations rather than advertise an idle, unusable worker.
  await prisma.calculationJob.count();
  console.info(`calculation_worker_started engine=${engineRelease()} concurrency=1`);
  await runCalculationWorker(prisma, controller.signal);
}

main().catch(() => {
  console.error("calculation_worker_start_failed: проверьте подключение и миграции");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
