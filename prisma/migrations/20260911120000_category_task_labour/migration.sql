-- Три колонки на SolutionCategory: категория перестаёт быть видом техники и становится задачей.
--
-- taskLabel с DEFAULT '' и NOT NULL — чтобы существующие пятнадцать строк не потребовали
-- backfill в той же транзакции. Настоящие значения проставляет сев, и он же падает, если
-- после него осталась хоть одна пустая: DEFAULT здесь для миграции, а не для авторов данных.
--
-- Норматив nullable по смыслу: его отсутствие — инструкция «спроси у человека», а не
-- пропущенные данные. Три задачи из шести остаются без норматива намеренно.
ALTER TABLE "SolutionCategory" ADD COLUMN "taskLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SolutionCategory" ADD COLUMN "workerOutputPerYear" DOUBLE PRECISION;
ALTER TABLE "SolutionCategory" ADD COLUMN "workerOutputSourceUrl" TEXT;
