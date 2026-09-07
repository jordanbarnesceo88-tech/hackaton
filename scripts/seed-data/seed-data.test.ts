import { describe, it, expect } from "vitest";
import { INDUSTRIES } from "./taxonomy";
import { CATEGORIES } from "./categories";
import { APPLICABILITY } from "./applicability";
import { VENDOR_SOLUTIONS } from "./vendor-solutions";

// Посевные данные — это отдельный источник правды, не связанный с моделью типами: строки в
// одном модуле ссылаются на строки в другом по slug'у. Компилятор такую ссылку не проверяет,
// поэтому её проверяют эти тесты. Опечатка здесь роняет сев на середине, уже записав часть.
describe("целостность посевных данных", () => {
  const facilityTypes = new Set(INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug)));
  const categories = new Set(CATEGORIES.map((c) => c.slug));

  it("каждая связь применимости ссылается на существующие тип объекта и категорию", () => {
    for (const link of APPLICABILITY) {
      expect(facilityTypes.has(link.facilityType), `нет типа объекта ${link.facilityType}`).toBe(true);
      for (const c of link.categories) {
        expect(categories.has(c), `нет категории ${c} (объект ${link.facilityType})`).toBe(true);
      }
    }
  });

  it("каждое решение ссылается на существующую категорию", () => {
    for (const s of VENDOR_SOLUTIONS) {
      expect(categories.has(s.categorySlug), `${s.name}: нет категории ${s.categorySlug}`).toBe(true);
    }
  });

  it("slug'и типов объектов, категорий и отраслей уникальны", () => {
    const types = INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug));
    expect(new Set(types).size, "дубли среди типов объектов").toBe(types.length);
    const cats = CATEGORIES.map((c) => c.slug);
    expect(new Set(cats).size, "дубли среди категорий").toBe(cats.length);
    const inds = INDUSTRIES.map((i) => i.slug);
    expect(new Set(inds).size, "дубли среди отраслей").toBe(inds.length);
  });

  it("у каждого типа объекта есть хотя бы одна применимая категория", () => {
    const covered = new Set(APPLICABILITY.filter((a) => a.categories.length > 0).map((a) => a.facilityType));
    const uncovered = [...facilityTypes].filter((t) => !covered.has(t));
    expect(uncovered, `типы объектов, ведущие в пустой экран: ${uncovered.join(", ")}`).toEqual([]);
  });
});
