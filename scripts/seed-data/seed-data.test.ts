import { describe, it, expect } from "vitest";
import { INDUSTRIES } from "./taxonomy";
import { CATEGORIES } from "./categories";
import { APPLICABILITY } from "./applicability";
import { VENDOR_SOLUTIONS } from "./vendor-solutions";
import { SOLUTION_CLASSES } from "./solution-classes";
import { WAREHOUSE_REAL } from "../parse-sources/warehouse-real";
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

  it("у каждой категории есть название-задача, и оно не скопировано из названия техники", () => {
    for (const c of CATEGORIES) {
      expect(c.taskLabel, `${c.slug}: нет taskLabel`).toBeTruthy();
      // Название задачи описывает работу, а не железо: человек выбирает «Паллетирование
      // коробок», а не «Роботы-паллетайзеры». Совпадение с name означает, что поле заполнили
      // копированием, и экран сравнения задач снова заговорит на языке каталога техники.
      expect(c.taskLabel, `${c.slug}: taskLabel скопирован из name`).not.toBe(c.name);
    }
  });

  it("норматив выработки заводится только вместе со ссылкой", () => {
    // То же правило двух концов, что у классов и вендорских строк. Норматив входит в
    // предзаполнение занятости, а занятость — в КАЖДОЕ число этой задачи; число без
    // источника здесь неотличимо от выдуманного.
    for (const c of CATEGORIES) {
      if (c.workerOutputPerYear === undefined) continue;
      expect(c.workerOutputPerYear, `${c.slug}: норматив должен быть положительным`).toBeGreaterThan(0);
      expect(c.workerOutputSourceUrl, `${c.slug}: норматив без источника`).toMatch(/^https:\/\//);
    }
  });

  it("задачи без найденного норматива не получают его тайком", () => {
    // Задача 1 плана A: по паллетированию, инспекции и доставке открытой нормы
    // производительности человека не нашлось (docs/data-provenance.md). Пока она не найдена,
    // поле обязано оставаться пустым — предзаполнение правдоподобной цифрой и есть тот способ
    // соврать, который здесь запрещён.
    const withoutNorm = ["class-palletizer", "class-ai-inspection", "class-service-delivery"];
    for (const slug of withoutNorm) {
      const c = CATEGORIES.find((x) => x.slug === slug);
      expect(c, `нет категории ${slug}`).toBeDefined();
      expect(
        c!.workerOutputPerYear,
        `${slug}: норматив появился — если он найден, обнови docs/data-provenance.md и этот список`
      ).toBeUndefined();
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

  it("каждая категория достижима хотя бы из одного типа объекта", () => {
    // Обратная сторона проверки ниже, и она не декоративная: решение в недостижимой
    // категории имеет пустое множество применимых типов объекта, поэтому проверка на пути
    // сохранения не может быть выполнена НИКОГДА — любое сохранение такого решения падает
    // с общей «Ошибкой сохранения» без объяснения. Сегодня сирот нет; одна новая категория
    // без строки применимости включает это молча.
    const linked = new Set(APPLICABILITY.flatMap((a) => a.categories));
    const orphans = CATEGORIES.map((c) => c.slug).filter((slug) => !linked.has(slug));
    expect(orphans, `категории, недостижимые ни из одного объекта: ${orphans.join(", ")}`).toEqual([]);
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

describe("поток нагрузки согласован с единицами решений", () => {
  // Находка ревью: категория «дезинфекция» была помечена потоком площади, а оба её решения
  // считают «помещений/день». Движок сравнивал помещения с квадратными метрами и делил на
  // выработку уборщика в м² — решение из экономичного становилось убыточным на ровном месте.
  //
  // Сорок семь типов объектов и пятнадцать категорий — это столько же возможностей ошибиться
  // в базисе, и глазами такое не ловится: числа остаются правдоподобными.
  // Оба списка вместе: единственная категория потока площади — это класс уборки, которого в
  // VENDOR_SOLUTIONS нет, и проверка только по вендорским решениям проходила бы вхолостую.
  const ALL = [
    ...VENDOR_SOLUTIONS.map((s) => ({ name: s.name, categorySlug: s.categorySlug, capacityUnit: s.capacityUnit })),
    ...SOLUTION_CLASSES.map((c) => ({ name: c.name, categorySlug: c.categorySlug, capacityUnit: c.capacityUnit })),
  ];

  it("решения категории потока площади измеряются в площади", () => {
    const areaCats = new Set(
      CATEGORIES.filter((c) => c.workloadStream === "FLOOR_AREA").map((c) => c.slug)
    );
    const checked = ALL.filter((s) => areaCats.has(s.categorySlug));
    // Страховка от вакуумности: если категорий площади не осталось, проверять нечего, и
    // зелёный тест означал бы «не нашлось», а не «всё согласовано».
    expect(checked.length, "нет ни одного решения потока площади — тест ничего не проверяет")
      .toBeGreaterThan(0);
    for (const s of checked) {
      expect(
        /м²|кв\.?\s*м/i.test(s.capacityUnit),
        `${s.name}: категория ${s.categorySlug} считает площадь, а решение — «${s.capacityUnit}»`
      ).toBe(true);
    }
  });

  it("решения категории потока операций НЕ измеряются в площади", () => {
    const flowCats = new Set(
      CATEGORIES.filter((c) => c.workloadStream === "OPERATION_FLOW").map((c) => c.slug)
    );
    for (const s of ALL) {
      if (!flowCats.has(s.categorySlug)) continue;
      expect(
        /м²|кв\.?\s*м/i.test(s.capacityUnit),
        `${s.name}: категория ${s.categorySlug} считает поток, а решение — «${s.capacityUnit}»`
      ).toBe(false);
    }
  });
});

describe("в каталоге не может быть заглушек", () => {
  // Половина каталога была демонстрационными строками с выдуманным вендором, выдуманной ценой
  // и без единой ссылки. Судья, открывший такую вертикаль, видел макет, а не продукт. Этот
  // тест — механизм, не дающий им вернуться: он падает на первой же строке без источника.
  it("у каждого вендорского решения есть источник характеристик и источник цены", () => {
    for (const s of VENDOR_SOLUTIONS) {
      expect(s.sourceUrl, `${s.name}: нет источника характеристик`).toMatch(/^https:\/\//);
      expect(s.priceSourceUrl, `${s.name}: нет источника цены`).toMatch(/^https:\/\//);
      expect(s.lastVerified, `${s.name}: нет даты проверки`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("вендор не выглядит заглушкой", () => {
    // «Demo», «Placeholder», «Test» в имени вендора — верный признак, что строка осталась от
    // каркаса и никем не проверялась.
    for (const s of VENDOR_SOLUTIONS) {
      expect(
        /demo|placeholder|test|sample|пример/i.test(s.vendor),
        `${s.name}: вендор «${s.vendor}» похож на заглушку`
      ).toBe(false);
    }
  });
});

describe("сев на НЕПУСТОЙ базе", () => {
  // Эти правила проверяют не данные как таковые, а то, переживёт ли их сев на базе, где уже
  // что-то лежит. Личность решения для upsert — пара (категория, имя), а для чистки — ОДНО
  // ИМЯ; пока обе стороны согласованы, повторный сев идемпотентен. Как только источник
  // нарушает согласованность, база расходится молча, и заметно это только запросом.
  const ALL = [
    ...VENDOR_SOLUTIONS.map((s) => ({ name: s.name, categorySlug: s.categorySlug, from: "VENDOR_SOLUTIONS" })),
    ...SOLUTION_CLASSES.map((c) => ({ name: c.name, categorySlug: c.categorySlug, from: "SOLUTION_CLASSES" })),
    ...WAREHOUSE_REAL.map((s) => ({ name: s.name, categorySlug: s.categorySlug, from: "WAREHOUSE_REAL" })),
  ];

  it("никакая пара (категория, имя) не объявлена дважды", () => {
    // Второй upsert по тому же ключу перезаписал бы первый, а solutionCount посчитал бы обе:
    // сев напечатал бы «посеяно N решений», которых в базе N−1.
    const seen = new Map<string, string>();
    for (const s of ALL) {
      const key = `${s.categorySlug} / ${s.name}`;
      expect(seen.has(key), `${key} объявлена и в ${seen.get(key)}, и в ${s.from}`).toBe(false);
      seen.set(key, s.from);
    }
  });

  it("одно имя не лежит в двух разных категориях", () => {
    // Чистка отбирает строки условием `name notIn [все имена источников]`, без категории. Имя,
    // живущее в двух категориях, делает её решение неоднозначным: строку в ЛЮБОЙ категории она
    // считает объявленной, включая ту, которую источник туда не клал (М-2).
    const byName = new Map<string, Set<string>>();
    for (const s of ALL) {
      if (!byName.has(s.name)) byName.set(s.name, new Set());
      byName.get(s.name)!.add(s.categorySlug);
    }
    for (const [name, cats] of byName) {
      expect([...cats], `«${name}» объявлено сразу в нескольких категориях`).toHaveLength(1);
    }
  });

  it("складские решения ссылаются на существующую категорию", () => {
    // Единственный из трёх источников, у которого этой проверки не было. В севе пропуск был
    // молчаливым `continue`, и отсутствие категории всплывало итоговой проверкой с догадкой
    // «скорее всего, их удалила чистка» — не там, где причина.
    const cats = new Set(CATEGORIES.map((c) => c.slug));
    for (const s of WAREHOUSE_REAL) {
      expect(cats.has(s.categorySlug), `${s.name}: нет категории ${s.categorySlug}`).toBe(true);
    }
  });

  it("slug'и классов уникальны", () => {
    // Пока не используется севом (upsert идёт по имени — это и есть М-2), но именно он станет
    // ключом, когда М-2 закроют, и задним числом уникальность уже не навести: дубликат slug'а
    // к тому моменту будет означать две строки, слитые в одну.
    const slugs = SOLUTION_CLASSES.map((c) => c.slug);
    expect(new Set(slugs).size, "дубли среди slug'ов классов").toBe(slugs.length);
  });
});
