-- Категория перестаёт принадлежать одному типу объекта и становится глобальным каталогом
-- видов решений; применимость переезжает в join-таблицу. Миграция написана вручную:
-- автогенерация удалила бы facilityTypeId вместе с информацией о применимости.

CREATE TABLE "FacilityTypeCategory" (
  "facilityTypeId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FacilityTypeCategory_pkey" PRIMARY KEY ("facilityTypeId","categoryId")
);

-- Канонической категорией для slug считаем строку с наименьшим id.
CREATE TEMP TABLE canon AS
  SELECT slug, MIN(id) AS canonical_id FROM "SolutionCategory" GROUP BY slug;

-- Слияние категорий может столкнуть два решения с одинаковым именем в одну категорию, а на
-- Solution висит @@unique([solutionCategoryId, name]). Проверяем ДО любых изменений: остановить
-- деплой честнее, чем молча потерять строку.
DO $$
DECLARE conflicts INT;
BEGIN
  SELECT count(*) INTO conflicts FROM (
    SELECT c.canonical_id, s.name
    FROM "Solution" s
    JOIN "SolutionCategory" sc ON sc.id = s."solutionCategoryId"
    JOIN canon c ON c.slug = sc.slug
    GROUP BY c.canonical_id, s.name
    HAVING count(*) > 1
  ) x;
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Слияние категорий даёт % конфликтов (категория, имя решения). Разрешите их отдельной миграцией данных до этой.', conflicts;
  END IF;
END $$;

-- Применимость переносится из старой колонки.
INSERT INTO "FacilityTypeCategory" ("facilityTypeId","categoryId")
  SELECT DISTINCT sc."facilityTypeId", c.canonical_id
  FROM "SolutionCategory" sc
  JOIN canon c ON c.slug = sc.slug;

-- Решения переезжают на канонические категории.
UPDATE "Solution" s
  SET "solutionCategoryId" = c.canonical_id
  FROM "SolutionCategory" sc
  JOIN canon c ON c.slug = sc.slug
  WHERE s."solutionCategoryId" = sc.id AND sc.id <> c.canonical_id;

DELETE FROM "SolutionCategory" sc
  USING canon c
  WHERE c.slug = sc.slug AND sc.id <> c.canonical_id;

ALTER TABLE "SolutionCategory" DROP CONSTRAINT "SolutionCategory_facilityTypeId_fkey";
DROP INDEX "SolutionCategory_facilityTypeId_slug_key";
ALTER TABLE "SolutionCategory" DROP COLUMN "facilityTypeId";
CREATE UNIQUE INDEX "SolutionCategory_slug_key" ON "SolutionCategory"("slug");

ALTER TABLE "FacilityTypeCategory"
  ADD CONSTRAINT "FacilityTypeCategory_facilityTypeId_fkey"
  FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE CASCADE;
ALTER TABLE "FacilityTypeCategory"
  ADD CONSTRAINT "FacilityTypeCategory_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SolutionCategory"("id") ON DELETE CASCADE;
CREATE INDEX "FacilityTypeCategory_categoryId_idx" ON "FacilityTypeCategory"("categoryId");
