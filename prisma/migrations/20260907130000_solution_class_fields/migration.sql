-- Класс решения — обобщённый вид техники, а не конкретная модель: диапазоны вместо точных
-- значений. Колонки nullable, boolean с default — существующие строки не двигаются.
ALTER TABLE "Solution" ADD COLUMN "isClass" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Solution" ADD COLUMN "capacityLow" DOUBLE PRECISION;
ALTER TABLE "Solution" ADD COLUMN "capacityHigh" DOUBLE PRECISION;
