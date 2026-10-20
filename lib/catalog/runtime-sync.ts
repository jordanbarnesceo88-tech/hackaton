import { Prisma, type PrismaClient } from "@prisma/client";
import { importProducts, validateProductSeeds } from "../api/import";
import { CATALOG } from "../data/organizer/catalog";
import { PARAM_SPECS } from "../data/organizer/params";
import { VENDOR_CLEANING_PRODUCTS } from "../data/vendor-cleaning";
import { syncOrganizerData } from "./sync";

type SyncStage = "validation" | "taxonomy" | "organizer" | "vendors";
export class RuntimeCatalogSyncError extends Error {
  constructor(public readonly code: "INVALID_VENDOR_SEEDS" | "MISSING_FACILITY_TAXONOMY" | "INCOMPLETE_ORGANIZER" | "INCOMPLETE_VENDORS" | "DATABASE_ERROR", public readonly stage: SyncStage, message: string, public readonly databaseCode?: string) {
    super(message);
    this.name = "RuntimeCatalogSyncError";
  }
}

/** Deployment updates reference data, never accounts, projects or existing vendor cards. */
export async function syncRuntimeCatalog(db: PrismaClient) {
  let stage: SyncStage = "validation";
  try {
    const checked = validateProductSeeds(VENDOR_CLEANING_PRODUCTS);
    if (!checked.ok) throw new RuntimeCatalogSyncError("INVALID_VENDOR_SEEDS", stage, "Runtime vendor catalogue validation failed.");
    stage = "taxonomy";
    const required = [...new Set(PARAM_SPECS.map(param => param.facility))];
    const facilities = await db.facilityType.findMany({ where: { slug: { in: required } }, select: { slug: true } });
    if (required.some(slug => !facilities.some(row => row.slug === slug))) {
      throw new RuntimeCatalogSyncError("MISSING_FACILITY_TAXONOMY", stage, "Runtime catalogue requires the existing facility taxonomy; full seed was not run.");
    }
    // Limit archive candidates to current organizer slugs: even an old ORGANIZER vendor stays untouched.
    stage = "organizer";
    const organizer = await syncOrganizerData(db, { respectAdminEdits: true, requireComplete: true, only: CATALOG.map(product => product.slug) });
    if (organizer.products.failed || organizer.characteristics.rejected) {
      throw new RuntimeCatalogSyncError("INCOMPLETE_ORGANIZER", stage, "Runtime organizer catalogue synchronization was incomplete.");
    }
    // A concurrent insert must abort instead of turning a previously missing vendor into an update.
    stage = "vendors";
    const vendors = await db.$transaction(async tx => {
      const existing = await tx.catalogProduct.findMany({ where: { slug: { in: checked.seeds.map(product => product.slug) } }, select: { slug: true } });
      const missing = checked.seeds.filter(product => !existing.some(row => row.slug === product.slug));
      const report = await importProducts(tx, missing);
      if (report.failed || report.refused || report.updated || report.unchanged || report.created !== missing.length) {
        throw new RuntimeCatalogSyncError("INCOMPLETE_VENDORS", stage, "Runtime vendor catalogue synchronization was incomplete.");
      }
      return { created: report.created, skippedExisting: existing.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
    return { dataVersion: organizer.dataVersion, organizer: organizer.products, characteristics: organizer.characteristics, vendors };
  } catch (error) {
    if (error instanceof RuntimeCatalogSyncError) throw error;
    if (stage === "organizer" && error instanceof Error && error.message === "Runtime organizer catalogue synchronization was incomplete.") {
      throw new RuntimeCatalogSyncError("INCOMPLETE_ORGANIZER", stage, error.message);
    }
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : undefined;
    throw new RuntimeCatalogSyncError("DATABASE_ERROR", stage, "Runtime catalogue database operation failed.", code);
  }
}
