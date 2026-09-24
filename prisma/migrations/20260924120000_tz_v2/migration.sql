-- tz_v2: модель по методике ТЗ ФЦ БАС (tz-1.0.0) рядом с моделью v1.
--
-- Миграция только ДОБАВЛЯЕТ: 4 перечисления, колонку "User"."role" (DEFAULT 'USER', поэтому
-- существующие пользователи получают обычную роль без бэкфилла), 12 таблиц, их индексы и внешние
-- ключи. Ни одна существующая таблица, колонка или ограничение не удаляется и не меняется —
-- модель v1 работает как раньше.
--
-- SQL сгенерирован командой
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- (а не `migrate dev`, который предлагает reset базы) и вычитан вручную: допустимы только
-- CREATE TYPE / CREATE TABLE / CREATE [UNIQUE] INDEX / ADD COLUMN / ADD CONSTRAINT … FOREIGN KEY.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CharGroup" AS ENUM ('IDENTIFICATION', 'TECHNICAL', 'INFRASTRUCTURE', 'ECONOMICS', 'APPLICABILITY', 'DATA_QUALITY');

-- CreateEnum
CREATE TYPE "CatalogOrigin" AS ENUM ('ORGANIZER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScenarioKind" AS ENUM ('ASIS', 'PURCHASE', 'RAAS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "Process" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "demandUnit" TEXT NOT NULL,
    "demandFormula" TEXT NOT NULL,
    "throughputUnit" TEXT NOT NULL,
    "calcSupported" BOOLEAN NOT NULL DEFAULT false,
    "simSupported" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityTypeProcess" (
    "facilityTypeId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FacilityTypeProcess_pkey" PRIMARY KEY ("facilityTypeId","processId")
);

-- CreateTable
CREATE TABLE "SolutionType" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "handlingClass" TEXT NOT NULL,
    "mobile" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SolutionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organizerCatalogId" TEXT,
    "organizerRows" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "level" TEXT NOT NULL DEFAULT 'identification',
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "country" TEXT,
    "solutionTypeId" TEXT,
    "status" TEXT NOT NULL,
    "facilityTypeSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "priceRub" DOUBLE PRECISION,
    "raasRubMonth" DOUBLE PRECISION,
    "throughputPerH" DOUBLE PRECISION,
    "throughputUnit" TEXT,
    "payloadKg" DOUBLE PRECISION,
    "speedMps" DOUBLE PRECISION,
    "completenessPct" INTEGER NOT NULL DEFAULT 0,
    "confirmedSharePct" INTEGER NOT NULL DEFAULT 0,
    "needsVerification" BOOLEAN NOT NULL DEFAULT true,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "excludedReason" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'ORGANIZER',
    "editedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "dataVersion" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductProcess" (
    "productId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,

    CONSTRAINT "ProductProcess_pkey" PRIMARY KEY ("productId","processId")
);

-- CreateTable
CREATE TABLE "ProductCharacteristic" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "group" "CharGroup" NOT NULL,
    "valueNum" DOUBLE PRECISION,
    "valueMin" DOUBLE PRECISION,
    "valueMax" DOUBLE PRECISION,
    "qualifier" TEXT,
    "valueText" TEXT,
    "valueList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit" TEXT,
    "scope" TEXT,
    "origin" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceRef" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confidence" TEXT,
    "asInSource" TEXT,
    "basis" TEXT,
    "formula" TEXT,
    "note" TEXT,
    "granularity" TEXT NOT NULL DEFAULT 'field',
    "alternatives" JSONB,

    CONSTRAINT "ProductCharacteristic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParamDefinition" (
    "id" TEXT NOT NULL,
    "facilityTypeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT,
    "kind" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "baseNum" DOUBLE PRECISION,
    "baseText" TEXT,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "tzMinimum" TEXT,
    "usedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hint" TEXT NOT NULL DEFAULT '',
    "example" TEXT NOT NULL DEFAULT '',
    "organizerNote" TEXT,
    "origin" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sourceUrl" TEXT,
    "basis" TEXT,
    "formula" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "editedByAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ParamDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Norm" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "unit" TEXT,
    "origin" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sourceUrl" TEXT,
    "group" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "editedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Norm_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DataRelease" (
    "version" TEXT NOT NULL,
    "seededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizerVersion" JSONB NOT NULL,
    "note" TEXT,

    CONSTRAINT "DataRelease_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectName" TEXT,
    "facilityTypeSlug" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "paramsSource" JSONB NOT NULL,
    "results" JSONB,
    "modelVersion" TEXT,
    "dataVersion" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "copiedFromId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ScenarioKind" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "projectId" TEXT,
    "scenarioId" TEXT,
    "userId" TEXT,
    "field" TEXT NOT NULL,
    "autoValue" JSONB,
    "oldValue" JSONB,
    "newValue" JSONB,
    "unit" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Process_slug_key" ON "Process"("slug");

-- CreateIndex
CREATE INDEX "FacilityTypeProcess_processId_idx" ON "FacilityTypeProcess"("processId");

-- CreateIndex
CREATE UNIQUE INDEX "SolutionType_slug_key" ON "SolutionType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_slug_key" ON "CatalogProduct"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_organizerCatalogId_key" ON "CatalogProduct"("organizerCatalogId");

-- CreateIndex
CREATE INDEX "CatalogProduct_status_idx" ON "CatalogProduct"("status");

-- CreateIndex
CREATE INDEX "CatalogProduct_solutionTypeId_idx" ON "CatalogProduct"("solutionTypeId");

-- CreateIndex
CREATE INDEX "ProductProcess_processId_idx" ON "ProductProcess"("processId");

-- CreateIndex
CREATE INDEX "ProductCharacteristic_key_idx" ON "ProductCharacteristic"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCharacteristic_productId_key_key" ON "ProductCharacteristic"("productId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ParamDefinition_facilityTypeId_key_key" ON "ParamDefinition"("facilityTypeId", "key");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Scenario_projectId_idx" ON "Scenario"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_projectId_key_key" ON "Scenario"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_projectId_name_key" ON "Scenario"("projectId", "name");

-- CreateIndex
CREATE INDEX "ChangeLog_projectId_idx" ON "ChangeLog"("projectId");

-- CreateIndex
CREATE INDEX "ChangeLog_entity_entityId_idx" ON "ChangeLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "FacilityTypeProcess" ADD CONSTRAINT "FacilityTypeProcess_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityTypeProcess" ADD CONSTRAINT "FacilityTypeProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_solutionTypeId_fkey" FOREIGN KEY ("solutionTypeId") REFERENCES "SolutionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductProcess" ADD CONSTRAINT "ProductProcess_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductProcess" ADD CONSTRAINT "ProductProcess_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCharacteristic" ADD CONSTRAINT "ProductCharacteristic_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParamDefinition" ADD CONSTRAINT "ParamDefinition_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
