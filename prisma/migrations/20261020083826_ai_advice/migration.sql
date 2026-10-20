-- CreateTable
CREATE TABLE "AiAdvice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "factsHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAdvice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAdvice_projectId_createdAt_idx" ON "AiAdvice"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAdvice_projectId_factsHash_key" ON "AiAdvice"("projectId", "factsHash");

-- AddForeignKey
ALTER TABLE "AiAdvice" ADD CONSTRAINT "AiAdvice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
