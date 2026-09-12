import { describe, it, expect } from "vitest";
import { FACILITY_DESCRIPTIONS, facilityDescriptionText } from "./facility-descriptions";
import { INDUSTRIES, TYPICAL_PARAMS } from "@/scripts/seed-data/taxonomy";

const TAXONOMY_SLUGS = INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => f.slug));
const NAMES = new Map(
  INDUSTRIES.flatMap((i) => i.facilityTypes.map((f) => [f.slug, f.name] as const)),
);

// Список типов объектов существует в рантайме — он приходит из посевных данных, а оттуда из
// базы, — поэтому «описано ли всё» компилятор проверить не может. Проверяет это здесь: без
// такого теста реестр тихо расходится с таксономией при первом же добавленном типе объекта, и
// расхождение всплывает не в CI, а пустой подписью на экране у судьи.
describe("описания типов объектов", () => {
  it("описан каждый тип объекта из таксономии, и ни одно описание не осиротело", () => {
    const described = Object.keys(FACILITY_DESCRIPTIONS).sort();
    expect(described).toEqual([...TAXONOMY_SLUGS].sort());
    // Второй конец той же проверки: TYPICAL_PARAMS — независимый список тех же slug'ов, и
    // разойтись он может первым, потому что правят обычно его.
    expect(described).toEqual(Object.keys(TYPICAL_PARAMS).sort());
  });

  it("обе половины описания непустые и содержательные", () => {
    // Тип требует наличия полей, но не смысла: `what: ""` компилируется. Пустая или
    // односложная подпись хуже отсутствующей — она выглядит как ответ, не будучи им.
    for (const slug of TAXONOMY_SLUGS) {
      const d = FACILITY_DESCRIPTIONS[slug]!;
      expect(d.what.trim().length, `${slug}: what`).toBeGreaterThan(80);
      expect(d.firstAutomated.trim().length, `${slug}: firstAutomated`).toBeGreaterThan(50);
      // Верхняя граница тоже нужна: подпись живёт мелким шрифтом под названием в списке из
      // сорока семи позиций, и абзац на этом месте перестают читать вовсе.
      expect(d.what.trim().length, `${slug}: what слишком длинный`).toBeLessThan(320);
      expect(d.firstAutomated.trim().length, `${slug}: firstAutomated слишком длинный`)
        .toBeLessThan(220);
    }
  });

  it("в описаниях нет ни одной цифры", () => {
    // Модуль намеренно не несёт чисел: у каждого числа в продукте есть источник и дата
    // проверки, а описание типа объекта источником быть не может. Доля, размер рынка или
    // «столько-то процентов операций» выглядели бы как данные и не были бы проверяемы —
    // и обесценили бы ссылки, расставленные у настоящих чисел.
    for (const slug of TAXONOMY_SLUGS) {
      const d = FACILITY_DESCRIPTIONS[slug]!;
      const text = `${d.what} ${d.firstAutomated}`;
      expect(text, `${slug}: в описании появилась цифра или процент`).not.toMatch(/[0-9%]/);
    }
  });

  it("описание не пересказывает название и не повторяет соседей", () => {
    // Два вида наполнителя, которые дешевле всего написать: развернуть название («объект для
    // хранения товаров» вместо «Склад») и скопировать соседнюю строку, поменяв слово.
    const seen = new Map<string, string>();
    for (const slug of TAXONOMY_SLUGS) {
      const d = FACILITY_DESCRIPTIONS[slug]!;
      const name = NAMES.get(slug)!;
      expect(d.what.trim(), `${slug}: описание — это само название`).not.toBe(name);
      const prev = seen.get(d.what);
      expect(prev, `${slug}: описание скопировано у ${prev}`).toBeUndefined();
      seen.set(d.what, slug);
    }
  });

  it("подпись собирается одной строкой, а неизвестный slug даёт null", () => {
    const text = facilityDescriptionText("warehouse");
    expect(text).toContain(FACILITY_DESCRIPTIONS["warehouse"]!.what);
    expect(text).toContain(FACILITY_DESCRIPTIONS["warehouse"]!.firstAutomated);
    // Не пустая строка и не заглушка: отсутствие описания — ошибка данных, а не состояние
    // интерфейса, и экран не должен изображать, будто ответ есть.
    expect(facilityDescriptionText("нет-такого-типа")).toBeNull();
  });
});
