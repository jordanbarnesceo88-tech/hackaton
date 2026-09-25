import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CatalogCharacteristic, CatalogListItem, CatalogProductDetail } from "@/lib/catalog/queries";
import { CHAR_GROUP_LABELS, REQUIRED_CHARACTERISTIC_KEYS } from "@/lib/tz/characteristics";
import type { CharGroup } from "@/lib/tz/characteristics";
import { Breadcrumb, buildTrails, HIERARCHY_LEVELS } from "./breadcrumb";
import { CatalogTable, priceText, processesText, throughputText } from "./catalog-table";
import { checkedOnText, quoteText } from "./characteristic-row";
import { clampPct } from "./chips";
import { CompareForm } from "./compare-form";
import { CompareTable, compareRowKeys } from "./compare-table";
import { CHAR_GROUP_ORDER, GroupSection, groupStats, requiredKeysOf } from "./group-section";
import { buildHierarchy, CatalogHierarchy } from "./hierarchy";
import { confidenceLabel, NO_DATA } from "./labels";
import { pageNumbers } from "./pagination";
import {
  cardVerificationReasons,
  DataQualitySummary,
  DemoLinks,
  demoLinkText,
  descriptionSourceRef,
  participationSummary,
  requiredFilled,
  selectionParticipation,
  throughputCalcNote,
} from "./product-card";
import {
  catalogHref,
  compareHref,
  EMPTY_QUERY,
  hasActiveFilters,
  MAX_COMPARE,
  parseCatalogQuery,
  parseCompareIds,
  toCatalogFilters,
} from "./search-params";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * Публичный каталог (T3.3): разбор адреса, ссылки, дерево иерархии, «хлебные крошки», полнота
 * групп, причины «требует проверки» и отрисовка серверных компонентов на фикстурах. Тесты
 * чистые — без БД; страницы с БД проверяет e2e на шлюзе W3.
 */

/** Подписи, которые e2e v1 ищут строго: в новых текстах их быть не должно (план, раздел 6). */
const FORBIDDEN = [
  "Рассчитать",
  "Далее",
  "Сохранить расчёт",
  "Сохранено",
  "Открыть отчёт",
  "Отчёт ROI",
  "не оферта",
  "Проверить свой объект",
  "Посмотреть на готовом примере",
  "Откуда цифры",
];

function expectNoForbidden(html: string) {
  for (const s of FORBIDDEN) expect(html, `в разметке не должно быть «${s}»`).not.toContain(s);
  expect(html).not.toContain("<h1");
}

function char(p: Partial<CatalogCharacteristic> & Pick<CatalogCharacteristic, "key" | "group">): CatalogCharacteristic {
  return {
    label: p.key,
    display: "—",
    valueNum: null,
    valueMin: null,
    valueMax: null,
    qualifier: null,
    valueText: null,
    valueList: [],
    unit: null,
    scope: null,
    origin: "organizer",
    sourceType: "organizer:catalog",
    sourceUrl: null,
    sourceRef: "каталог › №1",
    verifiedAt: "2026-09-22",
    confirmed: false,
    confidence: null,
    asInSource: null,
    basis: null,
    formula: null,
    note: null,
    granularity: "field",
    alternatives: [],
    hasConflict: false,
    ...p,
  };
}

function emptyGroups(): Record<CharGroup, CatalogCharacteristic[]> {
  return Object.fromEntries(CHAR_GROUP_ORDER.map((g) => [g, []])) as unknown as Record<CharGroup, CatalogCharacteristic[]>;
}

const PRICE = char({
  key: "priceRub",
  group: "ECONOMICS",
  label: "Цена оборудования",
  display: "2 700 000 ₽",
  valueNum: 2_700_000,
  unit: "₽",
  confirmed: false,
});

const THROUGHPUT = char({
  key: "throughput",
  group: "TECHNICAL",
  label: "Производительность",
  display: "80–100 паллет/ч (на робота)",
  valueNum: 90,
  valueMin: 80,
  valueMax: 100,
  unit: "паллет/ч",
  scope: "per-robot",
  origin: "organizer",
  sourceType: "organizer:examples",
  asInSource: "80–100 паллет/час",
  confirmed: false,
});

const AUTONOMY = char({
  key: "autonomyH",
  group: "TECHNICAL",
  label: "Автономность",
  display: "6 ч",
  valueNum: 6,
  unit: "ч",
  origin: "research",
  sourceType: "manufacturer",
  sourceUrl: "https://example.org/h1500",
  confirmed: true,
  confidence: "high",
  hasConflict: true,
  alternatives: [
    {
      value: "10 ч",
      origin: "research",
      sourceType: "dealer",
      sourceUrl: "https://dealer.example.org/h1500",
      sourceRef: null,
      date: "2026-09-23",
      confirmed: false,
      confidence: "medium",
      asInSource: "до 10 часов",
    },
  ],
});

function product(p: Partial<CatalogProductDetail> = {}): CatalogProductDetail {
  const characteristics = emptyGroups();
  characteristics.ECONOMICS.push(PRICE);
  characteristics.TECHNICAL.push(THROUGHPUT, AUTONOMY);
  characteristics.IDENTIFICATION.push(
    char({ key: "manufacturer", group: "IDENTIFICATION", label: "Производитель", display: "Ронави", valueText: "Ронави" }),
  );
  return {
    slug: "ronavi-h1500",
    name: "Ronavi H1500",
    manufacturer: "Ронави",
    country: "Россия",
    level: "enriched",
    status: "operation",
    origin: "ORGANIZER",
    description: "Автономный мобильный робот для паллет.",
    priceRub: 2_700_000,
    raasRubMonth: 100_000,
    throughputPerH: 90,
    throughputUnit: "паллет/ч",
    payloadKg: 1500,
    speedMps: 1.5,
    completenessPct: 94,
    confirmedSharePct: 26,
    needsVerification: true,
    excluded: false,
    excludedReason: null,
    flags: ["duplicate-merged"],
    organizerCatalogId: "abc",
    organizerRows: [21, 22],
    industries: [],
    archived: false,
    editedByAdmin: false,
    dataVersion: "72eb7f93",
    updatedAt: new Date("2026-09-25T00:00:00Z"),
    solutionType: { slug: "pallet-amr", name: "AMR паллетный", purpose: "", handlingClass: "jacking", mobile: true },
    processes: [{ slug: "pallet-transport", name: "Перемещение паллет", order: 1 }],
    facilityTypes: [{ slug: "warehouse", name: "Склад", industry: { slug: "retail", name: "Торговля" } }],
    characteristics,
    ...p,
  };
}

function listItem(p: Partial<CatalogListItem> = {}): CatalogListItem {
  return {
    slug: "ronavi-h1500",
    name: "Ronavi H1500",
    manufacturer: "Ронави",
    country: "Россия",
    level: "enriched",
    status: "operation",
    origin: "ORGANIZER",
    solutionType: { slug: "pallet-amr", name: "AMR паллетный" },
    processes: [{ slug: "pallet-transport", name: "Перемещение паллет" }],
    facilityTypes: ["warehouse"],
    description: "",
    priceRub: 2_700_000,
    raasRubMonth: 100_000,
    throughputPerH: 90,
    throughputUnit: "паллет/ч",
    payloadKg: 1500,
    speedMps: 1.5,
    completenessPct: 94,
    confirmedSharePct: 26,
    needsVerification: true,
    excluded: false,
    excludedReason: null,
    flags: [],
    ...p,
  };
}

describe("адрес каталога", () => {
  it("берёт только строки, отбрасывает массивы и неизвестные значения", () => {
    const q = parseCatalogQuery({
      q: "  Ronavi ",
      facility: ["warehouse", "airport"],
      status: "unknown",
      level: "enriched",
      sort: "bogus",
      page: "-3",
      confirmed: "1",
      raas: "yes",
    });
    expect(q).toEqual({
      ...EMPTY_QUERY,
      q: "Ronavi",
      level: "enriched",
      confirmed: true,
    });
  });

  it("номер страницы — целое не меньше 1", () => {
    expect(parseCatalogQuery({ page: "3" }).page).toBe(3);
    expect(parseCatalogQuery({ page: "0" }).page).toBe(1);
    expect(parseCatalogQuery({ page: "2.5" }).page).toBe(1);
  });

  it("фильтры для запроса не содержат пустых значений", () => {
    expect(toCatalogFilters(EMPTY_QUERY)).toEqual({ sort: "name", page: 1 });
    const q = parseCatalogQuery({ facility: "warehouse", process: "pallet-transport", raas: "1", sort: "price" });
    expect(toCatalogFilters(q)).toEqual({ facility: "warehouse", process: "pallet-transport", raas: true, sort: "price", page: 1 });
    expect(hasActiveFilters(q)).toBe(true);
    expect(hasActiveFilters(parseCatalogQuery({ sort: "price", page: "2" }))).toBe(false);
  });

  it("ссылка без умолчаний и разбирается обратно в то же состояние", () => {
    expect(catalogHref()).toBe("/catalog");
    expect(catalogHref({ facility: "warehouse", process: "pallet-transport" })).toBe(
      "/catalog?facility=warehouse&process=pallet-transport",
    );
    const q = parseCatalogQuery({ q: "тягач ё", facility: "warehouse", confirmed: "1", sort: "throughput", page: "2" });
    const href = catalogHref({}, q);
    const sp = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseCatalogQuery(sp)).toEqual(q);
    expect(catalogHref({ page: 1 }, q)).not.toContain("page=");
  });

  it("сравнение: обе формы ids, без повторов, не больше четырёх", () => {
    expect(parseCompareIds("a,b, a ,,c")).toEqual({ slugs: ["a", "b", "c"], overflow: 0 });
    expect(parseCompareIds(["a", "b,c"])).toEqual({ slugs: ["a", "b", "c"], overflow: 0 });
    expect(parseCompareIds(undefined)).toEqual({ slugs: [], overflow: 0 });
    const many = parseCompareIds("a,b,c,d,e,f");
    expect(many.slugs).toHaveLength(MAX_COMPARE);
    expect(many.overflow).toBe(2);
    expect(compareHref(["ronavi-h1500", "dikom-dmr-carrier-p"])).toBe("/catalog/compare?ids=ronavi-h1500,dikom-dmr-carrier-p");
    expect(compareHref([])).toBe("/catalog/compare");
  });
});

describe("иерархия", () => {
  const facilities = [
    {
      slug: "warehouse",
      name: "Склад",
      industry: { slug: "retail", name: "Торговля" },
      processes: [
        { slug: "pallet-transport", name: "Перемещение паллет" },
        { slug: "cleaning", name: "Уборка склада" },
      ],
    },
    { slug: "airport", name: "Аэропорт", industry: { slug: "logistics", name: "Логистика" }, processes: [] },
  ];
  const amr = { slug: "pallet-amr", name: "AMR паллетный" };
  const fmr = { slug: "fmr", name: "Штабелёр" };

  it("числа звеньев считаются по тем же правилам, что фильтры списка", () => {
    const tree = buildHierarchy(facilities, [
      { facilityTypeSlugs: ["warehouse"], processSlugs: ["pallet-transport"], solutionType: amr },
      { facilityTypeSlugs: ["warehouse"], processSlugs: ["pallet-transport"], solutionType: amr },
      { facilityTypeSlugs: ["warehouse"], processSlugs: ["pallet-transport"], solutionType: fmr },
      { facilityTypeSlugs: ["warehouse"], processSlugs: ["pallet-transport"], solutionType: null },
      // Процесс склада, но продукт к складу не привязан — в число склада не входит (как в фильтре).
      { facilityTypeSlugs: [], processSlugs: ["pallet-transport"], solutionType: amr },
      { facilityTypeSlugs: ["airport"], processSlugs: [], solutionType: null },
    ]);
    expect(tree).toHaveLength(2);
    const wh = tree[0]!.facilities[0]!;
    expect(wh.count).toBe(4);
    expect(wh.processes[0]).toMatchObject({ slug: "pallet-transport", count: 4 });
    expect(wh.processes[0]!.solutionTypes).toEqual([
      { slug: "pallet-amr", name: "AMR паллетный", count: 2 },
      { slug: "fmr", name: "Штабелёр", count: 1 },
    ]);
    expect(wh.processes[1]).toMatchObject({ slug: "cleaning", count: 0, solutionTypes: [] });
    expect(tree[1]!.facilities[0]!.count).toBe(1);

    const html = renderToStaticMarkup(createElement(CatalogHierarchy, { tree, unassigned: 3, open: true }));
    expect(html).toContain('href="/catalog?facility=warehouse&amp;process=pallet-transport&amp;solutionType=pallet-amr"');
    expect(html).toContain("Не привязаны к типу объекта: 3 продукта");
    expectNoForbidden(html);
  });

  it("хлебные крошки: отрасль → объект → процесс → тип решения → продукт", () => {
    const trails = buildTrails(product(), new Map([["pallet-transport", ["warehouse"]]]));
    expect(trails).toEqual([
      {
        industry: "Торговля",
        facility: { slug: "warehouse", name: "Склад", href: "/catalog?facility=warehouse" },
        process: {
          slug: "pallet-transport",
          name: "Перемещение паллет",
          href: "/catalog?facility=warehouse&process=pallet-transport",
        },
        solutionType: {
          slug: "pallet-amr",
          name: "AMR паллетный",
          href: "/catalog?facility=warehouse&process=pallet-transport&solutionType=pallet-amr",
        },
        product: "Ronavi H1500",
      },
    ]);
    const html = renderToStaticMarkup(createElement(Breadcrumb, { trails }));
    expect(html).toContain(HIERARCHY_LEVELS.join(" → "));
    expect(html).toContain('aria-current="page"');
    expectNoForbidden(html);
  });

  it("продукт без объекта и процесса — путь с пометкой «не указан»", () => {
    const p = product({ facilityTypes: [], processes: [], solutionType: null });
    const trails = buildTrails(p, new Map());
    expect(trails).toEqual([{ industry: null, facility: null, process: null, solutionType: null, product: "Ronavi H1500" }]);
    expect(renderToStaticMarkup(createElement(Breadcrumb, { trails }))).toContain("не указан");
  });

  it("процесс чужого объекта — отдельный путь без отрасли", () => {
    const p = product({ processes: [{ slug: "pallet-transport", name: "Перемещение паллет", order: 1 }, { slug: "baggage-transport", name: "Багаж", order: 1 }] });
    const trails = buildTrails(p, new Map([["pallet-transport", ["warehouse"]], ["baggage-transport", ["airport"]]]));
    expect(trails).toHaveLength(2);
    expect(trails[1]).toMatchObject({ industry: null, facility: null, process: { slug: "baggage-transport" } });
  });
});

describe("карточка продукта", () => {
  it("группа считает обязательные ключи и показывает недостающие строками", () => {
    const p = product();
    const tech = groupStats("TECHNICAL", p.characteristics.TECHNICAL);
    expect(tech.required).toBe(requiredKeysOf("TECHNICAL").length);
    expect(tech.filled).toBe(2);
    expect(tech.absentKeys).not.toContain("throughput");
    expect(tech.absentKeys).toContain("payloadKg");
    expect(requiredFilled(p)).toEqual({ filled: 4, required: REQUIRED_CHARACTERISTIC_KEYS.length });
  });

  it("шесть групп с заголовками h2, бейджами источника и признаком подтверждения", () => {
    const p = product();
    const html = CHAR_GROUP_ORDER.map((g) =>
      renderToStaticMarkup(createElement(GroupSection, { group: g, rows: p.characteristics[g] })),
    ).join("");
    for (const g of CHAR_GROUP_ORDER) expect(html).toContain(`>${CHAR_GROUP_LABELS[g]}</h2>`);
    expect((html.match(/<h2/g) ?? []).length).toBe(6);
    expect(html).toContain("Организатор");
    expect(html).toContain("Открытый источник");
    expect(html).toContain("«80–100 паллет/час»");
    expect(html).toContain("проверено 22.09.2026");
    expect(html).toContain("есть расхождения (1)");
    expect(html).toContain("https://dealer.example.org/h1500");
    expect(html).toContain("подтверждено первоисточником");
    expect(html).toContain(NO_DATA);
    expectNoForbidden(html);
  });

  it("причины «требует проверки» — по правилам синхронизации плюс расхождения источников", () => {
    const reasons = cardVerificationReasons(product());
    expect(reasons).toContain("карточка собрана из нескольких строк каталога организатора");
    expect(reasons).toContain("цена не подтверждена первоисточником");
    expect(reasons).toContain("производительность не подтверждена первоисточником");
    expect(reasons).toContain("источники расходятся: Автономность");
    expect(reasons.some((r) => r.startsWith("полнота карточки"))).toBe(true);
  });

  it("производительность: паспортная норма, а не число расчёта — в расчёте меньшее из нормы и цикла", () => {
    const p = product();
    expect(throughputCalcNote(p, THROUGHPUT)).toBe(
      "норма для расчёта парка: 90 паллет/ч на робота; в расчёте берётся меньшее из нормы и цикла по планировке объекта",
    );
    expect(throughputCalcNote(p, THROUGHPUT)).not.toContain("в расчёт:");

    // Немобильная станция в процессе с имитацией: цикла по планировке нет, парк — по норме.
    const station = char({ ...THROUGHPUT, scope: "per-station" });
    const stationary = product({ solutionType: { slug: "pallet-shuttle", name: "Шаттл", purpose: "", handlingClass: "shuttle", mobile: false } });
    expect(throughputCalcNote(stationary, station)).toBe(
      "норма для расчёта парка: 90 паллет/ч на станцию; цикл по планировке для него не считается, парк считается по норме",
    );

    // Значение на канал движок не принимает (normThroughput) — карточка говорит то же.
    const channel = char({ ...THROUGHPUT, scope: "per-channel" });
    expect(throughputCalcNote(product({ throughputPerH: 100 }), channel)).toBe(
      "в расчёт парка не идёт: паспортная цифра не отнесена к одному роботу или станции",
    );

    // Процесс без экономики в tz-1.0.0 (прототип, ТЗ §5.7).
    const cleaner = product({
      throughputPerH: 950,
      throughputUnit: "м²/ч",
      processes: [{ slug: "cleaning", name: "Уборка склада", order: 5 }],
    });
    const cleaning = char({ ...THROUGHPUT, valueNum: 950, valueMin: null, valueMax: null, unit: "м²/ч" });
    expect(throughputCalcNote(cleaner, cleaning)).toMatch(/^в расчёт парка не идёт: экономика процесса «.+» в прототипе не рассчитывается$/);

    const none = product({ throughputPerH: null, throughputUnit: null });
    const upTo = char({ key: "throughput", group: "TECHNICAL", display: "до 1 000 м²/ч", valueNum: 1000, valueMax: 1000, qualifier: "до" });
    expect(throughputCalcNote(none, upTo)).toContain("только предел «до»");
    const fleet = char({ key: "throughput", group: "TECHNICAL", display: "500", valueNum: 500, scope: "per-fleet" });
    expect(throughputCalcNote(none, fleet)).toContain("на весь парк");
    expect(throughputCalcNote(none, undefined)).toBeNull();
  });

  it("пояснения к производительности нет у продукта вне подбора", () => {
    expect(throughputCalcNote(product({ processes: [] }), THROUGHPUT)).toBeNull();
    expect(throughputCalcNote(product({ excluded: true, excludedReason: "НИОКР" }), THROUGHPUT)).toBeNull();
    expect(throughputCalcNote(product({ archived: true }), THROUGHPUT)).toBeNull();
    expect(throughputCalcNote(product({ level: "identification" }), THROUGHPUT)).toBeNull();
  });

  it("участие в подборе — по условиям getCalcProducts, а не по глубине описания", () => {
    expect(selectionParticipation(product())).toEqual({ ok: true, reason: null, text: "да" });
    // Enriched без привязки к процессам (как amt-6x6): в подбор не попадает.
    expect(selectionParticipation(product({ processes: [] }))).toEqual({
      ok: false,
      reason: "не привязан ни к одному процессу модели",
      text: "нет: не привязан ни к одному процессу модели",
    });
    // Исключённый enriched (как 168robotics-bro-3-0): причина исключения без точки в конце.
    expect(selectionParticipation(product({ excluded: true, excludedReason: "Статус «НИОКР» — опытный образец." })).text).toBe(
      "нет: Статус «НИОКР» — опытный образец",
    );
    expect(selectionParticipation(product({ excluded: true, excludedReason: null })).text).toBe("нет: исключён, причина не указана");
    expect(selectionParticipation(product({ archived: true, excluded: true, excludedReason: "x" })).text).toBe("нет: в архиве");
    expect(selectionParticipation(product({ level: "identification" })).text).toMatch(/^нет: только идентификация/);
  });

  it("сводка качества не обещает участие в подборе там, где его нет", () => {
    for (const p of [
      product({ processes: [] }),
      product({ excluded: true, excludedReason: "Статус «НИОКР» — опытный образец" }),
      product({ level: "identification" }),
      product({ level: "examples", archived: true }),
    ]) {
      const html = renderToStaticMarkup(createElement(DataQualitySummary, { product: p }));
      expect(html).toContain("Участие в подборе");
      expect(html).toContain(`нет: ${selectionParticipation(p).reason}`);
      expect(html).not.toContain("участвует в подборе");
      expect(html).not.toContain("да — входит в подбор");
      expectNoForbidden(html);

      const links = renderToStaticMarkup(createElement(DemoLinks, { product: p }));
      expect(links).not.toContain('href="/demo');
      expect(links).toContain(`В подбор демо-расчёта продукт не входит: ${selectionParticipation(p).reason}.`);
    }
    expect(participationSummary(product())).toBe(
      "да — входит в подбор для процесса «Перемещение паллет»; подходит ли продукт объекту, решает подбор по параметрам объекта",
    );
    const links = renderToStaticMarkup(createElement(DemoLinks, { product: product() }));
    expect(links).toContain('href="/demo?facility=warehouse"');
    expectNoForbidden(links);
  });

  it("подписи источника описания и ссылок в демо", () => {
    expect(descriptionSourceRef({ origin: "ORGANIZER", organizerCatalogId: "abc" })).toBe("каталог организатора › id abc");
    expect(descriptionSourceRef({ origin: "ORGANIZER", organizerCatalogId: null })).toBe("каталог организатора");
    expect(descriptionSourceRef({ origin: "ADMIN", organizerCatalogId: null })).toBe("добавлено администратором");
    expect(demoLinkText("warehouse", "Склад")).toBe("Открыть в демо-расчёте склада");
    expect(demoLinkText("airport", "Аэропорт")).toBe("Открыть демо для объекта «Аэропорт»");
  });

  it("мелкие форматтеры", () => {
    expect(quoteText("  до 10 ч ")).toBe("«до 10 ч»");
    expect(quoteText("")).toBeNull();
    expect(checkedOnText("2026-09-22")).toBe("проверено 22.09.2026");
    expect(checkedOnText(null)).toBeNull();
    expect(confidenceLabel("medium")).toBe("средняя");
    expect(confidenceLabel("странная")).toBe("странная");
    expect(confidenceLabel("constructor")).toBe("constructor");
    expect(confidenceLabel(null)).toBeNull();
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(140)).toBe(100);
  });
});

describe("список и сравнение", () => {
  it("строка списка: «нет данных» вместо нуля, единица производительности, пометки", () => {
    expect(priceText(null)).toBe(NO_DATA);
    expect(throughputText(null, "паллет/ч")).toBe(NO_DATA);
    expect(throughputText(90, "паллет/ч")).toBe("90 паллет/ч");
    expect(processesText([{ name: "А" }, { name: "Б" }, { name: "В" }])).toBe("А; Б и ещё 1");
    expect(processesText([])).toBeNull();

    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        caption: "Каталог",
        items: [
          listItem(),
          listItem({
            slug: "id-only",
            name: "Только идентификация",
            level: "identification",
            priceRub: null,
            raasRubMonth: null,
            throughputPerH: null,
            throughputUnit: null,
            excluded: true,
            completenessPct: 20,
          }),
        ],
      }),
    );
    expect(html).toContain('name="ids" value="ronavi-h1500"');
    expect(html).toContain('href="/catalog/ronavi-h1500"');
    expect(html).toContain("90 паллет/ч");
    expect(html).toContain("требует проверки");
    expect(html).toContain("только идентификация");
    expect(html).toContain("не участвует в подборе");
    expect(html).toContain(NO_DATA);
    expect(html).toContain("в эксплуатации");
    expectNoForbidden(html);
  });

  it("строки сравнения: обязательные и заполненные хотя бы у одного продукта", () => {
    const a = product();
    const b = product({ slug: "other", name: "Другой", characteristics: emptyGroups() });
    const keys = compareRowKeys("TECHNICAL", [a, b]);
    expect(keys).toEqual(expect.arrayContaining([...requiredKeysOf("TECHNICAL")]));
    expect(keys.indexOf("throughput")).toBeLessThan(keys.indexOf("autonomyH"));

    const html = renderToStaticMarkup(createElement(CompareTable, { products: [a, b] }));
    expect(html).toContain('href="/catalog/compare?ids=other"');
    expect(html).toContain('href="/catalog/compare?ids=ronavi-h1500"');
    expect(html).toContain("есть расхождения — см. карточку");
    for (const g of CHAR_GROUP_ORDER) expect(html).toContain(CHAR_GROUP_LABELS[g]);
    expectNoForbidden(html);
  });

  it("сравнение: архивный и не привязанный к процессам продукт помечены, «участвует» — нет", () => {
    const archived = product({ slug: "old", name: "Старый", archived: true });
    const orphan = product({ slug: "orphan", name: "Без процесса", processes: [] });
    const html = renderToStaticMarkup(createElement(CompareTable, { products: [product(), archived, orphan] }));
    expect((html.match(/>в архиве</g) ?? []).length).toBe(1);
    expect(html).toContain("нет: в архиве");
    expect(html).toContain("нет: не привязан ни к одному процессу модели");
    const row = /Участвует в подборе<\/th>(.*?)<\/tr>/.exec(html)?.[1] ?? "";
    expect((row.match(/<td/g) ?? []).length).toBe(3);
    expect((row.match(/>да</g) ?? []).length).toBe(1);
  });

  it("форма сравнения работает и без JavaScript: GET на /catalog/compare", () => {
    const html = renderToStaticMarkup(
      createElement(CompareForm, null, createElement(CatalogTable, { caption: "Каталог", items: [listItem()] })),
    );
    const formTag = /<form[^>]*>/.exec(html)?.[0] ?? "";
    expect(formTag).toContain('method="get"');
    expect(formTag).toContain('action="/catalog/compare"');
    expect(html).toContain("Сравнить выбранные");
    expect(html).toContain(`Выбрано для сравнения: 0 из ${MAX_COMPARE}`);
    expectNoForbidden(html);
  });

  it("номера страниц с пропусками", () => {
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
  });
});
