import "dotenv/config";
import { createPrismaClient } from "../lib/db/factory";
import { CalculationQueueBusy, CalculationQueuePolicyError, parseQueueCap, setQueueCap } from "../lib/calculation-jobs/policy";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error("Использование: npm run queue:cap -- <целое число 1..100>");
  const maxActive = parseQueueCap(args[0]!);
  const db = createPrismaClient(1);
  try {
    const result = await setQueueCap(db, maxActive);
    console.info(`calculation_queue_policy_changed previousCap=${result.previousCap} globalCap=${result.maxActive} policy=database`);
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  if (error instanceof CalculationQueueBusy || error instanceof CalculationQueuePolicyError) {
    console.error(`calculation_queue_policy_not_changed code=${error.code}: ${error.message}`);
  } else if (error instanceof Error && (error.message.startsWith("Лимит очереди") || error.message.startsWith("Использование:"))) {
    console.error(error.message);
  } else {
    console.error("calculation_queue_policy_not_changed: проверьте подключение и миграции");
  }
  process.exitCode = 1;
});
