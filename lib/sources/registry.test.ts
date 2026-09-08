import { describe, it, expect } from "vitest";
import { ALL_CITATIONS, citationAgeDays } from "./registry";
import { WAREHOUSE_REAL } from "@/scripts/parse-sources/warehouse-real";
import { SOLUTION_CLASSES } from "@/scripts/seed-data/solution-classes";

describe("реестр источников", () => {
  it("собран из модулей сева, а не переписан руками", () => {
    // Страница про честность, чей список источников разошёлся с данными, — худший из
    // возможных экспонатов. Этот тест и есть причина, по которой список выводится.
    const urls = new Set(ALL_CITATIONS.map((c) => c.url));
    for (const s of WAREHOUSE_REAL) {
      expect(urls.has(s.sourceUrl), `нет источника для ${s.name}`).toBe(true);
    }
    for (const c of SOLUTION_CLASSES) {
      expect(urls.has(c.sourceUrl), `нет источника цены для ${c.slug}`).toBe(true);
      expect(urls.has(c.capacitySourceUrl), `нет источника производительности для ${c.slug}`).toBe(true);
    }
  });

  it("у класса ровно два утверждения: цена и производительность", () => {
    for (const c of SOLUTION_CLASSES) {
      const mine = ALL_CITATIONS.filter((x) => x.label === c.name);
      expect(mine.map((x) => x.kind).sort()).toEqual(["capacity", "price"]);
    }
  });

  it("непарсящаяся дата считается худшим случаем, а не пропускается", () => {
    expect(citationAgeDays({ label: "x", kind: "price", url: "u", lastVerified: "не дата" })).toBeNull();
  });

  it("все ссылки — https", () => {
    for (const c of ALL_CITATIONS) expect(c.url).toMatch(/^https:\/\//);
  });
});
