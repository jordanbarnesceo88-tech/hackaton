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

  it("ссылки — https там, где они есть", () => {
    for (const c of ALL_CITATIONS) {
      if (c.url !== null) expect(c.url).toMatch(/^https:\/\//);
    }
  });

  it("утверждение без ссылки обязано объяснять, на чём оно основано", () => {
    // Отсутствие ссылки — это факт, а не пропуск: цены на промышленных роботов не
    // публикуются. Но «источника нет» без объяснения читается как небрежность, поэтому
    // такая строка обязана нести basis.
    for (const c of ALL_CITATIONS) {
      if (c.url === null) {
        expect(c.basis, `${c.label} (${c.kind}): нет ни ссылки, ни обоснования`).toBeTruthy();
      }
    }
  });

  it("страница продукта числится источником производительности, а не цены", () => {
    // Находка ревью: sourceUrl вендорского решения цитирует тоты в час, а регистрировался
    // как источник цены — то есть странице приписывалось утверждение, которого она не
    // делает, и ровно на той странице, что существует ради различения этих утверждений.
    for (const s of WAREHOUSE_REAL) {
      const byUrl = ALL_CITATIONS.filter((c) => c.url === s.sourceUrl);
      expect(byUrl.length, `${s.name}: ссылка не зарегистрирована`).toBeGreaterThan(0);
      for (const c of byUrl) expect(c.kind).toBe("capacity");
    }
  });

  it("дата из будущего не считается свежей", () => {
    // Опечатка в годе или дата, сдвинутая вперёд перед демонстрацией, давала отрицательный
    // возраст, и гейт свежести молча отключался для источника навсегда.
    expect(citationAgeDays({ label: "x", kind: "price", url: null, basis: "b", lastVerified: "2099-01-01" })).toBeNull();
  });

  it("не-ISO дата отвергается, а не разбирается наугад", () => {
    // new Date разбирает «07.09.2026» как 9 июля — правдоподобный, но неверный возраст.
    expect(citationAgeDays({ label: "x", kind: "price", url: null, basis: "b", lastVerified: "07.09.2026" })).toBeNull();
  });
});
