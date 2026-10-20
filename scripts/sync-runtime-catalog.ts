import "dotenv/config";
import { RuntimeCatalogSyncError, syncRuntimeCatalog } from "../lib/catalog/runtime-sync";
import { createPrismaClient } from "../lib/db/factory";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("missing_connection");
  const db = createPrismaClient(1);
  // Existing importer diagnostics include raw database errors; deployment logs must not expose them.
  const originalError = console.error;
  console.error = () => process.stderr.write("Runtime catalogue database operation failed; details omitted.\n");
  try {
    const report = await syncRuntimeCatalog(db);
    console.log(JSON.stringify({ event: "runtime_catalogue_synchronized", ...report }));
  } finally {
    try { await db.$disconnect(); } finally { console.error = originalError; }
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: "runtime_catalogue_sync_failed", name: error instanceof RuntimeCatalogSyncError ? error.name : "Error", code: error instanceof RuntimeCatalogSyncError ? error.code : "CONNECTION_OR_UNEXPECTED_ERROR", stage: error instanceof RuntimeCatalogSyncError ? error.stage : "connection", ...(error instanceof RuntimeCatalogSyncError && error.databaseCode ? { databaseCode: error.databaseCode } : {}) }));
  process.exitCode = 1;
});
