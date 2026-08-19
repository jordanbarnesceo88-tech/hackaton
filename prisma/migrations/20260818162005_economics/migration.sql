-- CreateEnum
CREATE TYPE "CapacityBasis" AS ENUM ('PER_HOUR_FLOW', 'PER_DAY_FLOW', 'CONCURRENT_STOCK');

-- AlterTable
ALTER TABLE "Solution" ADD COLUMN     "capacityBasis" "CapacityBasis" NOT NULL DEFAULT 'PER_DAY_FLOW';

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assumption_key_key" ON "Assumption"("key");
