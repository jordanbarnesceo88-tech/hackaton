CREATE TABLE "CalculationQueuePolicy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxActive" INTEGER NOT NULL DEFAULT 2,
    CONSTRAINT "CalculationQueuePolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CalculationQueuePolicy_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "CalculationQueuePolicy_cap_check" CHECK ("maxActive" BETWEEN 1 AND 100)
);

INSERT INTO "CalculationQueuePolicy" ("id", "maxActive") VALUES (1, 2);
