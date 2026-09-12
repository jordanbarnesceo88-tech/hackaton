import { describe, it, expect } from "vitest";
import { ASSUMPTION_JUSTIFICATIONS } from "./assumption-justifications";
import { DEFAULT_ASSUMPTIONS } from "./assumptions";
import type { AssumptionValues } from "./types";

const KEYS = Object.keys(DEFAULT_ASSUMPTIONS) as (keyof AssumptionValues)[];

describe("обоснования допущений", () => {
  it("есть у каждого допущения, и ни одно не пустое", () => {
    // Тип уже требует присутствия ключа, но не содержательности: `text: ""` компилируется.
    // Пустое обоснование — то же, что отсутствующее, и именно им были заняты 15 из 16.
    expect(Object.keys(ASSUMPTION_JUSTIFICATIONS).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) {
      expect(ASSUMPTION_JUSTIFICATIONS[k].text.trim().length, k).toBeGreaterThan(80);
    }
  });

  it("«источник» обязан быть проверяемым — ссылкой или указанием, где лежит вывод", () => {
    // Правило двух концов в миниатюре: пометка «источник» без способа его найти — это
    // выдуманная ссылка, а она хуже пустоты.
    for (const k of KEYS) {
      const j = ASSUMPTION_JUSTIFICATIONS[k];
      if (j.basis !== "источник") continue;
      const checkable = Boolean(j.sourceUrl) || j.text.includes("data-provenance.md");
      expect(checkable, `${k}: помечено «источник», но проверить нечем`).toBe(true);
    }
  });

  it("ссылка, если есть, выглядит как ссылка", () => {
    for (const k of KEYS) {
      const url = ASSUMPTION_JUSTIFICATIONS[k].sourceUrl;
      if (url) expect(url, k).toMatch(/^https:\/\//);
    }
  });

  it("допущения, которые движок больше не читает, говорят об этом прямо", () => {
    // Т-4: после удаления workerOutputPerYear() эти два числа не читает ни одна строка
    // движка, но оба остаются редактируемыми полями. Пока поле на экране, подпись обязана
    // предупреждать — иначе человек правит число и ждёт, что что-то изменится.
    for (const k of ["opsPerWorkerPerYear", "areaPerCleanerPerYear"] as const) {
      expect(ASSUMPTION_JUSTIFICATIONS[k].text.toLowerCase(), k).toMatch(/не читает/);
    }
  });
});
