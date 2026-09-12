import { describe, it, expect } from "vitest";
import { GLOSSARY, GLOSSARY_GROUP_ORDER } from "./glossary";

describe("словарь терминов", () => {
  it("не пуст", () => {
    // Страница /glossary существует ради содержимого этого массива: опустев, она станет
    // ссылкой в подвале, ведущей на пустой экран, — хуже, чем отсутствие ссылки.
    expect(GLOSSARY.length).toBeGreaterThan(0);
  });

  it("не объясняет один термин дважды", () => {
    // Два определения одного слова — это два ответа на один вопрос, и человек не знает,
    // какому верить. Сравнение без учёта регистра и пробелов: «CAPEX» и «capex » — один
    // термин, а не два.
    const seen = GLOSSARY.map((e) => e.term.trim().toLowerCase());
    expect(new Set(seen).size, `дубли: ${seen.filter((t, i) => seen.indexOf(t) !== i)}`).toBe(
      seen.length
    );
  });

  it("каждое объяснение содержательно, а не заглушка", () => {
    // Тип требует присутствия поля, но не смысла: `body: ""` и `body: "TODO"` компилируются.
    // Заглушка в словаре хуже пропуска — она обещает объяснение и не даёт его.
    for (const e of GLOSSARY) {
      expect(e.term.trim().length, e.term).toBeGreaterThan(1);
      expect(e.body.trim().length, e.term).toBeGreaterThan(80);
      expect(e.body.toLowerCase(), e.term).not.toMatch(/todo|tbd|заглушка|дописать/);
      // Расшифровки может не быть (не всякий термин — аббревиатура), но пустой она быть
      // не может: пустая строка отрендерит скобки без содержимого.
      if (e.expansion !== undefined) expect(e.expansion.trim().length, e.term).toBeGreaterThan(2);
    }
  });

  it("объяснение остаётся объяснением, а не статьёй", () => {
    // Словарь читают, наткнувшись на непонятое слово, а не садясь за него. Три предложения —
    // граница, за которой запись перестаёт отвечать на вопрос и начинает излагать методику;
    // для методики есть /methodology.
    for (const e of GLOSSARY) {
      const sentences = e.body.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
      expect(sentences.length, `${e.term}: ${sentences.length} предложений`).toBeLessThanOrEqual(3);
    }
  });

  it("разделы страницы и разделы записей — одно и то же множество", () => {
    // Страница рендерит заголовки по GLOSSARY_GROUP_ORDER, а записи раскладывает по своему
    // полю group. Раздел без записей даёт пустой заголовок, запись с разделом вне порядка
    // не отображается вовсе — и то и другое молча.
    const used = new Set(GLOSSARY.map((e) => e.group));
    expect([...used].sort()).toEqual([...GLOSSARY_GROUP_ORDER].sort());
  });

  it("объясняет термины, которыми продукт показывает результат", () => {
    // Именно эти слова стоят на панели расчёта и в отчёте, то есть встречаются человеку
    // раньше любого объяснения. Список — не украшение: удалив отсюда запись, легко не
    // заметить, что экран снова разговаривает словами, которых не вводил.
    const required = [
      "AMR",
      "AS/RS",
      "CAPEX",
      "OPEX",
      "ЭПЗ",
      "NPV",
      "Дисконтированная окупаемость",
      "Покрытие",
      "Замещение труда",
    ];
    const terms = GLOSSARY.map((e) => e.term.toLowerCase());
    for (const r of required) expect(terms, r).toContain(r.toLowerCase());
  });
});
