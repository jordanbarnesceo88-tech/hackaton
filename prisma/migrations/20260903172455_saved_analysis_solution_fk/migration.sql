-- CreateIndex
CREATE INDEX "SavedAnalysis_solutionId_idx" ON "SavedAnalysis"("solutionId");

-- AddForeignKey
ALTER TABLE "SavedAnalysis" ADD CONSTRAINT "SavedAnalysis_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "Solution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
