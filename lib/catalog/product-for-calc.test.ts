import { describe, expect, it } from "vitest";
import { completenessPct } from "../tz/characteristics";
import type { CharValue, ProductSeed, Sourced } from "../tz/types";
import {
  asFlags,
  asHandlingClass,
  asLevel,
  asOrigin,
  asQualifier,
  asScope,
  asStatus,
  charGroupOf,
  charLabel,
  charStats,
  compareProcessSlugs,
  formatCharValue,
  fromCharacteristics,
  isCharKey,
  isCharPresent,
  isoDate,
  productForCalcFromSeed,
  sortProcessSlugs,
  sourcedToCharRow,
  usableThroughput,
} from "./product-for-calc";
import type { CharRow, ProductMeta } from "./product-for-calc";

/** ICU ставит неразрывный пробел между разрядами — сравниваем с обычным. */
const plain = (s: string) => s.replace(/\s/g, " ");

function row(key: string, patch: Partial<CharRow> = {}): CharRow {
  return {
    key,
    valueNum: null,
    valueMin: null,
    valueMax: null,
    qualifier: null,
    valueText: null,
    valueList: [],
    unit: null,
    scope: null,
    origin: "research",
    sourceUrl: "https://example.test/spec.pdf",
    sourceRef: null,
    verifiedAt: "2026-09-23",
    confirmed: false,
    ...patch,
  };
}

const META: ProductMeta = {
  slug: "ronavi-h1500",
  name: "Ronavi H1500",
  manufacturer: "Ronavi Robotics",
  solutionTypeSlug: "pallet-amr",
  handlingClass: "jacking",
  mobile: true,
  status: "operation",
  level: "enriched",
  flags: ["duplicate-merged"],
  excluded: false,
  excludedReason: null,
  processes: ["pallet-transport"],
  facilityTypes: ["warehouse"],
  completenessPct: 74,
  confirmedSharePct: 40,
};

/** Характеристики в духе H1500 — вымышленные для теста, кроме формы значений. */
const H1500_CHARS: CharRow[] = [
  row("priceRub", { valueNum: 2_700_000, unit: "₽", origin: "organizer", sourceUrl: null, sourceRef: "каталог", confirmed: false }),
  row("throughput", { valueNum: 90, valueMin: 80, valueMax: 100, unit: "паллет/ч", scope: "per-robot", origin: "organizer", confirmed: true }),
  row("raasRubMonth", { valueNum: 100_000, qualifier: "от", unit: "₽/мес", confirmed: false }),
  row("payloadKg", { valueNum: 1500, unit: "кг", confirmed: true }),
  row("speedMps", { valueNum: 1.5, unit: "м/с" }),
  row("autonomyH", { valueNum: 6, unit: "ч" }),
  row("chargeMin", { valueNum: 18, unit: "мин" }),
  row("implementationRub", { valueNum: 1_250_000, valueMin: 500_000, valueMax: 2_000_000, unit: "₽", origin: "estimate" }),
  row("navigation", { valueList: ["лидар", "QR-коды"] }),
  row("cases", { valueText: "Восток-Сервис" }),
];

describe("fromCharacteristics", () => {
  const p = fromCharacteristics(META, H1500_CHARS);

  it("берёт числа из valueNum (typical диапазона) и сохраняет оговорки", () => {
    expect(p.priceRub).toBe(2_700_000);
    expect(p.throughputPerH).toBe(90);
    expect(p.throughputUnit).toBe("паллет/ч");
    expect(p.throughputScope).toBe("per-robot");
    expect(p.throughputQualifier).toBeNull();
    expect(p.implementationRub).toBe(1_250_000);
    expect(p.payloadKg).toBe(1500);
    expect(p.speedMps).toBe(1.5);
    expect(p.autonomyH).toBe(6);
    expect(p.chargeMin).toBe(18);
    expect(p.raasRubMonth).toBe(100_000);
    expect(p.raasQualifier).toBe("от");
    expect(p.raasOrigin).toBe("research");
  });

  it("признаки подтверждения — из флага confirmed характеристики", () => {
    expect(p.priceConfirmed).toBe(false);
    expect(p.priceOrigin).toBe("organizer");
    expect(p.throughputConfirmed).toBe(true);
  });

  it("непубликуемые значения — null, а не ноль", () => {
    expect(p.minAisleM).toBeNull();
    expect(p.serviceRubYear).toBeNull();
    expect(p.batteryCostRub).toBeNull();
    expect(p.tempMinC).toBeNull();
  });

  it("мета переносится, массивы копируются, а не разделяются с входом", () => {
    expect(p.slug).toBe("ronavi-h1500");
    expect(p.solutionType).toBe("pallet-amr");
    expect(p.handlingClass).toBe("jacking");
    expect(p.completenessPct).toBe(74);
    expect(p.confirmedSharePct).toBe(40);
    expect(p.flags).toEqual(["duplicate-merged"]);
    expect(p.flags).not.toBe(META.flags);
    expect(p.processes).not.toBe(META.processes);
    expect(p.hasCases).toBe(true);
  });

  it("производительность «до X» без нижней границы — предел, в расчёт не идёт", () => {
    const q = fromCharacteristics(META, [
      row("throughput", { valueNum: 1000, valueMax: 1000, qualifier: "до", unit: "м²/ч", confirmed: true }),
    ]);
    expect(q.throughputPerH).toBeNull();
    expect(q.throughputConfirmed).toBe(false);
    // Оговорка и единица остаются — по ним интерфейс объясняет, почему цифры нет в расчёте.
    expect(q.throughputQualifier).toBe("до");
    expect(q.throughputUnit).toBe("м²/ч");
  });

  it("«до X» с нижней границей — типичное значение идёт в расчёт", () => {
    const q = fromCharacteristics(META, [
      row("throughput", { valueNum: 90, valueMin: 80, valueMax: 100, qualifier: "до", unit: "паллет/ч" }),
    ]);
    expect(q.throughputPerH).toBe(90);
  });

  it("значение на весь парк размер парка не задаёт", () => {
    const q = fromCharacteristics(META, [
      row("throughput", { valueNum: 30_000, unit: "паллет/ч", scope: "per-fleet", confirmed: true }),
    ]);
    expect(q.throughputPerH).toBeNull();
    expect(q.throughputScope).toBe("per-fleet");
    expect(q.throughputConfirmed).toBe(false);
  });

  it("NaN и бесконечность не попадают в снимок", () => {
    const q = fromCharacteristics(META, [
      row("priceRub", { valueNum: Number.NaN, confirmed: true }),
      row("payloadKg", { valueNum: Number.POSITIVE_INFINITY }),
    ]);
    expect(q.priceRub).toBeNull();
    expect(q.priceConfirmed).toBe(false);
    expect(q.priceOrigin).toBeNull();
    expect(q.payloadKg).toBeNull();
  });

  it("без цены и ставки RaaS: null, не подтверждено, происхождения нет", () => {
    const q = fromCharacteristics(META, []);
    expect(q.priceRub).toBeNull();
    expect(q.priceConfirmed).toBe(false);
    expect(q.priceOrigin).toBeNull();
    expect(q.raasRubMonth).toBeNull();
    expect(q.raasQualifier).toBeNull();
    expect(q.raasOrigin).toBeNull();
    expect(q.hasCases).toBe(false);
    expect(q.sources).toEqual([]);
  });

  it("sources: все характеристики в порядке словаря, с подписью по-русски и значением", () => {
    const keys = p.sources.map((s) => s.key);
    expect(keys).toEqual([
      "payloadKg",
      "speedMps",
      "throughput",
      "autonomyH",
      "navigation",
      "chargeMin",
      "priceRub",
      "implementationRub",
      "raasRubMonth",
      "cases",
    ]);
    const price = p.sources.find((s) => s.key === "priceRub")!;
    expect(price.label).toBe("Цена оборудования");
    expect(plain(price.value)).toBe("2 700 000 ₽");
    expect(price.origin).toBe("organizer");
    expect(price.sourceRef).toBe("каталог");
    expect(price.date).toBe("2026-09-23");
    expect(price.confirmed).toBe(false);
    const thr = p.sources.find((s) => s.key === "throughput")!;
    expect(thr.label).toBe("Производительность");
    expect(thr.value).toBe("80–100 паллет/ч (на робота)");
    expect(p.sources.find((s) => s.key === "navigation")!.value).toBe("лидар, QR-коды");
    expect(plain(p.sources.find((s) => s.key === "raasRubMonth")!.value)).toBe("от 100 000 ₽/мес");
  });

  it("ключ вне словаря — в конце, подпись — сам ключ; неизвестное происхождение — оценка", () => {
    const q = fromCharacteristics(META, [
      row("zzzCustom", { valueText: "что-то", origin: "legacy" }),
      row("payloadKg", { valueNum: 600, unit: "кг" }),
    ]);
    expect(q.sources.map((s) => s.key)).toEqual(["payloadKg", "zzzCustom"]);
    expect(q.sources[1]!.label).toBe("zzzCustom");
    expect(q.sources[1]!.origin).toBe("estimate");
  });
});

describe("formatCharValue", () => {
  const f = (patch: Partial<CharRow>) => plain(formatCharValue(row("x", patch)));

  it("числа в ru-RU без лишних нулей", () => {
    expect(f({ valueNum: 1.5, unit: "м/с" })).toBe("1,5 м/с");
    expect(f({ valueNum: 0.75, unit: "м" })).toBe("0,75 м");
    expect(f({ valueNum: 2_700_000, unit: "₽" })).toBe("2 700 000 ₽");
    expect(f({ valueNum: 1 / 3 })).toBe("0,333");
  });

  it("диапазон, оговорки и область", () => {
    expect(f({ valueNum: 90, valueMin: 80, valueMax: 100, unit: "паллет/ч", scope: "per-robot" })).toBe(
      "80–100 паллет/ч (на робота)",
    );
    expect(f({ valueNum: 10, valueMax: 10, qualifier: "до", unit: "кг" })).toBe("до 10 кг");
    expect(f({ valueNum: 3, qualifier: "≈", unit: "ч" })).toBe("≈ 3 ч");
    expect(f({ valueMin: 100_000, unit: "₽" })).toBe("от 100 000 ₽");
    expect(f({ valueMax: 5, unit: "ч" })).toBe("до 5 ч");
    expect(f({ valueNum: 5, valueMin: 5, valueMax: 5 })).toBe("5");
    expect(f({ valueNum: 8000, unit: "паллет/сут", scope: "per-fleet" })).toBe("8 000 паллет/сут (на весь парк)");
  });

  it("текст, перечень и пустое значение", () => {
    expect(f({ valueText: "  Россия " })).toBe("Россия");
    expect(f({ valueList: ["Wi-Fi", " ", "4G"] })).toBe("Wi-Fi, 4G");
    expect(f({})).toBe("—");
    expect(f({ valueText: "   ", valueList: [""] })).toBe("—");
  });
});

describe("правила значений", () => {
  it("isCharPresent: пустые строки и пустые списки не считаются заполненными", () => {
    expect(isCharPresent(undefined)).toBe(false);
    expect(isCharPresent(row("a"))).toBe(false);
    expect(isCharPresent(row("a", { valueText: " " }))).toBe(false);
    expect(isCharPresent(row("a", { valueList: [" "] }))).toBe(false);
    expect(isCharPresent(row("a", { valueNum: 0 }))).toBe(true);
    expect(isCharPresent(row("a", { valueMax: 10 }))).toBe(true);
    expect(isCharPresent(row("a", { valueList: ["x"] }))).toBe(true);
  });

  it("usableThroughput: типичное значение, кроме «до» без минимума и значения на парк", () => {
    expect(usableThroughput(undefined)).toBeNull();
    expect(usableThroughput(row("throughput", { valueNum: 50 }))).toBe(50);
    expect(usableThroughput(row("throughput", { valueNum: 50, qualifier: "от" }))).toBe(50);
    expect(usableThroughput(row("throughput", { valueNum: 50, qualifier: "до" }))).toBeNull();
    expect(usableThroughput(row("throughput", { valueNum: 50, scope: "per-fleet" }))).toBeNull();
    expect(usableThroughput(row("throughput", { valueNum: 50, scope: "per-station" }))).toBe(50);
  });

  it("charStats: полнота по заполненным обязательным ключам, доля подтверждённых — по заполненным", () => {
    const stats = charStats([
      row("manufacturer", { valueText: "Ronavi", confirmed: true }),
      row("payloadKg", { valueNum: 1500, confirmed: false }),
      row("liftHeightMm", { valueNum: 100, confirmed: true }),
      row("purpose", { valueText: "", confirmed: true }),
    ]);
    expect(stats.completenessPct).toBe(completenessPct(["manufacturer", "payloadKg"]));
    // Заполнено 3 (пустое «Назначение» не считается), подтверждено 2.
    expect(stats.confirmedSharePct).toBe(67);
  });
});

describe("сужение строк из БД", () => {
  it("известные значения проходят, неизвестные — осторожное умолчание", () => {
    expect(asOrigin("research")).toBe("research");
    expect(asOrigin("mystery")).toBe("estimate");
    expect(asOrigin(null)).toBe("estimate");
    expect(asScope("per-channel")).toBe("per-channel");
    expect(asScope("per-day")).toBeNull();
    expect(asQualifier("от")).toBe("от");
    expect(asQualifier("около")).toBeNull();
    expect(asStatus("rnd")).toBe("rnd");
    expect(asStatus("unknown")).toBe("piloting");
    expect(asLevel("examples")).toBe("examples");
    expect(asLevel("full")).toBe("identification");
    expect(asHandlingClass("fork")).toBe("fork");
    expect(asHandlingClass(undefined)).toBe("other");
    expect(asFlags(["no-price", "bogus", "no-price", "price-disputed"])).toEqual(["no-price", "price-disputed"]);
  });

  it("ключи словаря: собственные свойства, а не прототип объекта", () => {
    expect(isCharKey("priceRub")).toBe(true);
    expect(isCharKey("constructor")).toBe(false);
    expect(isCharKey("toString")).toBe(false);
    expect(charLabel("constructor")).toBe("constructor");
    expect(charGroupOf("minAisleM")).toBe("INFRASTRUCTURE");
    expect(charGroupOf("toString")).toBeNull();
  });

  it("isoDate: YYYY-MM-DD или null", () => {
    expect(isoDate(new Date("2026-09-23T15:00:00Z"))).toBe("2026-09-23");
    expect(isoDate(null)).toBeNull();
    expect(isoDate(new Date("не дата"))).toBeNull();
  });
});

// ——————————————————————————— Адаптер данных организатора ———————————————————————————

function sourced<T extends CharValue>(value: T, patch: Partial<Sourced<CharValue>> = {}): Sourced<CharValue> {
  return {
    value,
    origin: "research",
    sourceType: "manufacturer",
    sourceUrl: "https://example.test/spec",
    date: "2026-09-23",
    confirmed: true,
    asInSource: "как в источнике",
    ...patch,
  };
}

const SEED: ProductSeed = {
  slug: "ronavi-h1500",
  organizerCatalogId: "00000000-0000-0000-0000-000000000000",
  organizerRows: [21, 22],
  level: "enriched",
  name: "Ronavi H1500",
  manufacturer: "Ronavi Robotics",
  country: "Россия",
  solutionType: "pallet-amr",
  status: "operation",
  processes: ["pallet-transport"],
  facilityTypes: ["warehouse"],
  industries: ["Логистика"],
  description: "Паллетный AMR",
  characteristics: {
    manufacturer: sourced("Ronavi Robotics"),
    priceRub: sourced(2_700_000, {
      unit: "₽",
      origin: "organizer",
      sourceType: "organizer:catalog",
      sourceUrl: null,
      sourceRef: "каталог организатора",
      confirmed: false,
      alternatives: [
        {
          value: 3_000_000,
          unit: "₽",
          origin: "research",
          sourceType: "dealer",
          sourceUrl: "https://example.test/dealer",
          date: "2026-09-20",
          confirmed: false,
        },
      ],
    }),
    throughput: sourced({ min: 80, max: 100, typical: 90 }, { unit: "паллет/ч", scope: "per-robot", origin: "organizer" }),
    raasRubMonth: sourced({ typical: 100_000, qualifier: "от" }, { unit: "₽/мес", confirmed: false }),
    navigation: sourced(["лидар"]),
    cases: sourced("Восток-Сервис"),
  },
  flags: ["duplicate-merged"],
  excludedReason: null,
};

describe("sourcedToCharRow", () => {
  it("число, диапазон, текст и перечень раскладываются по колонкам", () => {
    const price = sourcedToCharRow("priceRub", SEED.characteristics.priceRub!);
    expect(price).toMatchObject({
      key: "priceRub",
      group: "ECONOMICS",
      valueNum: 2_700_000,
      valueMin: null,
      unit: "₽",
      origin: "organizer",
      sourceType: "organizer:catalog",
      sourceRef: "каталог организатора",
      verifiedAt: "2026-09-23",
      confirmed: false,
      granularity: "field",
    });
    expect(price.alternatives).toHaveLength(1);

    const thr = sourcedToCharRow("throughput", SEED.characteristics.throughput!);
    expect(thr).toMatchObject({ valueNum: 90, valueMin: 80, valueMax: 100, qualifier: null, scope: "per-robot" });

    const raas = sourcedToCharRow("raasRubMonth", SEED.characteristics.raasRubMonth!);
    expect(raas).toMatchObject({ valueNum: 100_000, valueMin: null, valueMax: null, qualifier: "от" });

    expect(sourcedToCharRow("cases", SEED.characteristics.cases!)).toMatchObject({ valueText: "Восток-Сервис", valueNum: null });
    expect(sourcedToCharRow("navigation", SEED.characteristics.navigation!)).toMatchObject({ valueList: ["лидар"] });
  });

  it("ключ вне словаря — группа null; пустые альтернативы и дата — null", () => {
    const r = sourcedToCharRow("zzz", sourced(1, { alternatives: [], date: "" }));
    expect(r.group).toBeNull();
    expect(r.alternatives).toBeNull();
    expect(r.verifiedAt).toBeNull();
  });
});

describe("порядок процессов", () => {
  it("как в PROCESS_DEFS (склад → аэропорт → медучреждение), а не по номеру внутри объекта", () => {
    // Номера Process.order: уборка склада — 6, уборка терминала — 3, уборка больницы — 2.
    expect(sortProcessSlugs(["hospital-cleaning", "terminal-cleaning", "cleaning"])).toEqual([
      "cleaning",
      "terminal-cleaning",
      "hospital-cleaning",
    ]);
    expect(sortProcessSlugs(["cleaning", "pallet-transport"])).toEqual(["pallet-transport", "cleaning"]);
  });

  it("процессы вне кода — в конце по slug; вход не меняется", () => {
    const input = ["zz-custom", "patrol", "aa-custom", "storage"];
    expect(sortProcessSlugs(input)).toEqual(["storage", "patrol", "aa-custom", "zz-custom"]);
    expect(input).toEqual(["zz-custom", "patrol", "aa-custom", "storage"]);
    expect(compareProcessSlugs("storage", "storage")).toBe(0);
  });
});

describe("productForCalcFromSeed", () => {
  it("процессы продукта нескольких объектов — в общем порядке, как в снимке из БД", () => {
    const p = productForCalcFromSeed({
      ...SEED,
      solutionType: "cleaner",
      processes: ["hospital-cleaning", "cleaning", "terminal-cleaning"],
      facilityTypes: ["medical", "warehouse", "airport"],
    });
    expect(p.processes).toEqual(["cleaning", "terminal-cleaning", "hospital-cleaning"]);
    // Типы объектов — как в данных: их порядок снимок из БД берёт из той же колонки.
    expect(p.facilityTypes).toEqual(["medical", "warehouse", "airport"]);
  });

  it("тип решения даёт класс грузообработки и мобильность; неизвестный — other и мобильный", () => {
    const p = productForCalcFromSeed(SEED);
    expect(p.handlingClass).toBe("jacking");
    expect(p.mobile).toBe(true);
    expect(p.throughputPerH).toBe(90);
    expect(p.priceRub).toBe(2_700_000);
    expect(p.raasQualifier).toBe("от");
    expect(p.hasCases).toBe(true);

    const unknown = productForCalcFromSeed({ ...SEED, solutionType: "no-such-type" });
    expect(unknown.handlingClass).toBe("other");
    expect(unknown.mobile).toBe(true);
    expect(unknown.solutionType).toBe("no-such-type");
  });

  it("полнота и доля подтверждённых считаются по характеристикам", () => {
    const p = productForCalcFromSeed(SEED);
    // Обязательные из 31: manufacturer, priceRub, throughput, navigation, cases → 5 → 16 %.
    expect(p.completenessPct).toBe(completenessPct(["manufacturer", "priceRub", "throughput", "navigation", "cases"]));
    expect(p.completenessPct).toBe(16);
    // Подтверждено 4 из 6 (цена и ставка RaaS — нет).
    expect(p.confirmedSharePct).toBe(67);
  });

  it("причина исключения делает продукт исключённым; неизвестные пометки отбрасываются", () => {
    const p = productForCalcFromSeed({
      ...SEED,
      excludedReason: "Модель не найдена у производителя",
      flags: ["model-not-found", "nonsense" as never],
    });
    expect(p.excluded).toBe(true);
    expect(p.excludedReason).toBe("Модель не найдена у производителя");
    expect(p.flags).toEqual(["model-not-found"]);
  });
});
