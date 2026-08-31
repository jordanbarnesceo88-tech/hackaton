-- AlterTable
ALTER TABLE "Solution" ADD COLUMN     "priceBasis" TEXT,
ADD COLUMN     "priceEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceHighUsd" DOUBLE PRECISION,
ADD COLUMN     "priceLowUsd" DOUBLE PRECISION;
