CREATE TABLE "CalculationSubmission" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalculationSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalculationSubmission_ownerId_idempotencyKey_key" ON "CalculationSubmission"("ownerId", "idempotencyKey");
CREATE INDEX "CalculationSubmission_jobId_idx" ON "CalculationSubmission"("jobId");
ALTER TABLE "CalculationSubmission" ADD CONSTRAINT "CalculationSubmission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "CalculationSubmission" ("id", "ownerId", "idempotencyKey", "requestHash", "jobId", "createdAt")
SELECT 'submission-' || id, "ownerId", "idempotencyKey", "requestHash", id, "createdAt" FROM "CalculationJob";
