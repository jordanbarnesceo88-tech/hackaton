CREATE TABLE "CalculationRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "reservedProjectId" TEXT,
    "operation" TEXT NOT NULL,
    "baseRevision" INTEGER,
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "engineRelease" TEXT NOT NULL,
    "results" JSONB,
    "publicationState" TEXT NOT NULL DEFAULT 'NONE',
    "publishedRevision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "CalculationRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CalculationRun_publication_check" CHECK ("publicationState" IN ('NONE','PUBLISHED','STALE'))
);

CREATE TABLE "CalculationJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" DOUBLE PRECISION,
    "diagnosticCode" TEXT,
    "safeMessage" TEXT NOT NULL DEFAULT 'Расчёт принят и ожидает выполнения',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "CalculationJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CalculationJob_state_check" CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
    CONSTRAINT "CalculationJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10),
    CONSTRAINT "CalculationJob_progress_check" CHECK ("progress" IS NULL OR ("progress" >= 0 AND "progress" <= 100))
);

CREATE UNIQUE INDEX "CalculationJob_runId_key" ON "CalculationJob"("runId");
CREATE UNIQUE INDEX "CalculationJob_ownerId_idempotencyKey_key" ON "CalculationJob"("ownerId", "idempotencyKey");
CREATE INDEX "CalculationJob_status_nextAttemptAt_createdAt_idx" ON "CalculationJob"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "CalculationJob_status_leaseUntil_idx" ON "CalculationJob"("status", "leaseUntil");
CREATE INDEX "CalculationJob_ownerId_createdAt_idx" ON "CalculationJob"("ownerId", "createdAt");
CREATE INDEX "CalculationRun_ownerId_createdAt_idx" ON "CalculationRun"("ownerId", "createdAt");
CREATE INDEX "CalculationRun_projectId_createdAt_idx" ON "CalculationRun"("projectId", "createdAt");
ALTER TABLE "CalculationRun" ADD CONSTRAINT "CalculationRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalculationRun" ADD CONSTRAINT "CalculationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalculationJob" ADD CONSTRAINT "CalculationJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CalculationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
