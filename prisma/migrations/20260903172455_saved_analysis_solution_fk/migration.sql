-- CreateIndex
CREATE INDEX "SavedAnalysis_solutionId_idx" ON "SavedAnalysis"("solutionId");

-- Drop rows that already point at a deleted Solution, BEFORE the constraint is validated.
--
-- Without this the ALTER below aborts on any database carrying one, taking the whole deploy
-- with it. Such rows can exist: until this constraint, seed.ts's prune could delete a renamed
-- product and leave the reference dangling — which is the failure this migration exists to
-- prevent from recurring.
--
-- Deleting rather than preserving is deliberate. A SavedAnalysis whose solutionId resolves to
-- nothing cannot be rendered at all — getSolutionForCalc returns null and both the report and
-- the calculator call notFound() — so it is already unreachable data, not something a user can
-- open. Keeping it would only trade an unopenable row for a failed deploy.
DELETE FROM "SavedAnalysis"
WHERE "solutionId" NOT IN (SELECT "id" FROM "Solution");

-- AddForeignKey
ALTER TABLE "SavedAnalysis" ADD CONSTRAINT "SavedAnalysis_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "Solution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
