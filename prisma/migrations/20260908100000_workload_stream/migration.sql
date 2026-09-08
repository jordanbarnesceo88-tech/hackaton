-- Поток нагрузки у вида решения. Написано руками: автогенерация не расставит потоки по
-- категориям, а именно эти два UPDATE и меняют выходные числа.
CREATE TYPE "WorkloadStream" AS ENUM ('OPERATION_FLOW', 'FLOOR_AREA');

ALTER TABLE "SolutionCategory"
  ADD COLUMN "workloadStream" "WorkloadStream" NOT NULL DEFAULT 'OPERATION_FLOW';

-- Единственные две категории, обслуживающие площадь, а не поток операций. До этой миграции
-- робот-уборщик считался против потока заказов склада и «замещал» весь его персонал.
UPDATE "SolutionCategory" SET "workloadStream" = 'FLOOR_AREA'
  WHERE slug IN ('class-cleaning', 'disinfection');
