import { describe, it, expect } from "vitest";
import { INDUSTRIES } from "./taxonomy";
import { CATEGORIES } from "./categories";
import { APPLICABILITY } from "./applicability";
import { VENDOR_SOLUTIONS } from "./vendor-solutions";
import { SOLUTION_CLASSES } from "./solution-classes";
import { INDUSTRIES as IND, TYPICAL_PARAMS } from "./taxonomy";

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

describe("масштаб таксономии", () => {
  it("отраслей и типов объектов достаточно, чтобы справочник перестал быть скудным", () => {
    expect(IND.length).toBeGreaterThanOrEqual(12);
    expect(IND.flatMap((i) => i.facilityTypes).length).toBeGreaterThanOrEqual(40);
  });

  it("у каждого типа объекта есть типовые параметры", () => {
    for (const t of IND.flatMap((i) => i.facilityTypes.map((f) => f.slug))) {
      const p = TYPICAL_PARAMS[t];
      expect(p, `нет типовых параметров для ${t}`).toBeDefined();
      expect(p!.areaM2).toBeGreaterThan(0);
      expect(p!.opsPerDay).toBeGreaterThan(0);
      expect(p!.staffCount).toBeGreaterThan(0);
    }
  });

  it("slug'и первых четырёх типов объектов не переименованы", () => {
    // SavedAnalysis.facilityTypeSlug — строка, а не внешний ключ. Переименование осиротит
    // уже сохранённые расчёты, и ничто, кроме этого теста, об этом не скажет.
    const types = new Set(IND.flatMap((i) => i.facilityTypes.map((f) => f.slug)));
    for (const s of ["warehouse", "airport", "medical", "other"]) {
      expect(types.has(s), `тип объекта ${s} переименован или удалён`).toBe(true);
    }
  });
});

describe("классы решений", () => {
  it("каждый класс ссылается на существующую категорию", () => {
    const cats = new Set(CATEGORIES.map((c) => c.slug));
    for (const c of SOLUTION_CLASSES) {
      expect(cats.has(c.categorySlug), `${c.slug}: нет категории ${c.categorySlug}`).toBe(true);
    }
  });

  it("у каждого класса оба конца обоих диапазонов и два источника", () => {
    // Правило, ради которого классов семь, а не двенадцать: недостающий конец диапазона не
    // достраивается «по смыслу». Цена и производительность — разные утверждения, и у каждого
    // свой источник.
    for (const c of SOLUTION_CLASSES) {
      expect(c.priceLowUsd, `${c.slug}: нет нижней цены`).toBeGreaterThan(0);
      expect(c.priceHighUsd).toBeGreaterThan(c.priceLowUsd);
      expect(c.capacityLow, `${c.slug}: нет нижней производительности`).toBeGreaterThan(0);
      expect(c.capacityHigh).toBeGreaterThanOrEqual(c.capacityLow);
      expect(c.sourceUrl, `${c.slug}: нет источника цены`).toMatch(/^https:\/\//);
      expect(c.capacitySourceUrl, `${c.slug}: нет источника производительности`).toMatch(/^https:\/\//);
      expect(Number.isFinite(new Date(c.lastVerified).getTime())).toBe(true);
    }
  });
});
