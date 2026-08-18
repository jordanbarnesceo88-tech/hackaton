-- CreateEnum
CREATE TYPE "SolutionSource" AS ENUM ('SEED', 'ORGANIZER', 'PARSED');

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityType" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "industryId" TEXT NOT NULL,

    CONSTRAINT "FacilityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolutionCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "facilityTypeId" TEXT NOT NULL,

    CONSTRAINT "SolutionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Solution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "solutionCategoryId" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "capacityPerUnit" DOUBLE PRECISION NOT NULL,
    "capacityUnit" TEXT NOT NULL,
    "maintenanceUsdYear" DOUBLE PRECISION NOT NULL,
    "energyUsdYear" DOUBLE PRECISION NOT NULL,
    "licensingUsdYear" DOUBLE PRECISION NOT NULL,
    "specs" JSONB NOT NULL,
    "source" "SolutionSource" NOT NULL DEFAULT 'SEED',
    "sourceUrl" TEXT,
    "lastVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Solution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityExample" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityTypeId" TEXT NOT NULL,
    "params" JSONB NOT NULL,

    CONSTRAINT "FacilityExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Industry_slug_key" ON "Industry"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityType_slug_key" ON "FacilityType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SolutionCategory_facilityTypeId_slug_key" ON "SolutionCategory"("facilityTypeId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Solution_solutionCategoryId_name_key" ON "Solution"("solutionCategoryId", "name");

-- AddForeignKey
ALTER TABLE "FacilityType" ADD CONSTRAINT "FacilityType_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolutionCategory" ADD CONSTRAINT "SolutionCategory_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Solution" ADD CONSTRAINT "Solution_solutionCategoryId_fkey" FOREIGN KEY ("solutionCategoryId") REFERENCES "SolutionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityExample" ADD CONSTRAINT "FacilityExample_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
