import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../tz/types";
import {
  CHANGES_MAX,
  QUANTITY_MAX,
  sanitizeProjectName,
  validatePendingChanges,
  validateScenarioSpecs,
} from "./validate";

const PRODUCTS = ["ronavi-h1500", "dikom-dmr-carrier-p"];
const PROCESSES = ["pallet-transport", "storage", "cleaning"];
const PT = "pallet-transport";

function base(): ScenarioSpec[] {
  return [
    { key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "p1", name: "Покупка — Ronavi H1500", kind: "purchase", items: [{ process: PT, productSlug: "ronavi-h1500" }] },
    { key: "r1", name: "Услуга (RaaS) — Ronavi H1500", kind: "raas", items: [{ process: PT, productSlug: "ronavi-h1500" }] },
  ];
}

function check(specs: unknown) {
  return validateScenarioSpecs(specs, "warehouse", PRODUCTS, PROCESSES);
}

function errorsOf(specs: unknown): string {
  const r = check(specs);
  return r.ok ? "" : r.errors.join(" | ");
}

describe("validateScenarioSpecs", () => {
  it("принимает три сценария и собирает их заново только из известных полей", () => {
    const specs = base();
    specs[1]!.items[0]!.quantityOverride = 12;
    specs[1]!.normOverrides = { utilization: 0.8 };
    const r = check(specs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(specs);
      expect(r.value[1]).not.toBe(specs[1]);
    }
  });

  it("от 3 до 10 сценариев", () => {
    expect(errorsOf(base().slice(0, 2))).toMatch(/от 3 до 10 сценариев, сейчас 2/);
    const many = [
      ...base(),
      ...Array.from({ length: 8 }, (_, i) => ({ key: `x${i}`, name: `Сценарий ${i}`, kind: "purchase", items: [] })),
    ];
    expect(errorsOf(many)).toMatch(/сейчас 11/);
    expect(errorsOf("не список")).toMatch(/списком/);
  });

  it("ровно один «Как есть», и в нём нет позиций", () => {
    const two = [...base(), { key: "asis2", name: "Как есть 2", kind: "asis", items: [] }];
    expect(errorsOf(two)).toMatch(/ровно один сценарий «Как есть», сейчас 2/);
    const none = base().map((s) => (s.kind === "asis" ? { ...s, kind: "purchase" as const } : s));
    expect(errorsOf(none)).toMatch(/сейчас 0/);
    const withItems = base();
    withItems[0]!.items = [{ process: PT, productSlug: "ronavi-h1500" }];
    expect(errorsOf(withItems)).toMatch(/позиций быть не должно/);
  });

  it("ключи и названия: формат, длина и уникальность", () => {
    const badKey = base();
    badKey[1]!.key = "P 1";
    expect(errorsOf(badKey)).toMatch(/ключ должен состоять/);
    const dupKey = base();
    dupKey[2]!.key = "p1";
    expect(errorsOf(dupKey)).toMatch(/ключ «p1» повторяется/);
    const dupName = base();
    dupName[2]!.name = "  покупка —   Ronavi H1500 ";
    expect(errorsOf(dupName)).toMatch(/повторяется/);
    const longName = base();
    longName[1]!.name = "я".repeat(81);
    expect(errorsOf(longName)).toMatch(/название от 1 до 80/);
    const empty = base();
    empty[1]!.name = "   ";
    expect(errorsOf(empty)).toMatch(/название от 1 до 80/);
  });

  it("вид сценария, процесс и продукт — только известные", () => {
    const kind = base() as unknown as Record<string, unknown>[];
    kind[1]!.kind = "lease";
    expect(errorsOf(kind)).toMatch(/вид сценария/);
    const proc = base();
    proc[1]!.items[0]!.process = "baggage-transport";
    expect(errorsOf(proc)).toMatch(/не относится к этому типу объекта/);
    const prod = base();
    prod[1]!.items[0]!.productSlug = "нет-такого";
    expect(errorsOf(prod)).toMatch(/не найден в каталоге/);
  });

  it("не больше одной позиции на процесс", () => {
    const specs = base();
    specs[1]!.items.push({ process: PT, productSlug: "dikom-dmr-carrier-p" });
    expect(errorsOf(specs)).toMatch(/уже выбрано решение/);
    const two = base();
    two[1]!.items.push({ process: "cleaning", productSlug: "dikom-dmr-carrier-p" });
    expect(check(two).ok).toBe(true);
  });

  it("ручные значения: конечные и положительные, число роботов — целое от 1 до 500", () => {
    for (const q of [0, 2.5, QUANTITY_MAX + 1, Number.NaN, "10"]) {
      const s = base() as unknown as { items: Record<string, unknown>[] }[];
      s[1]!.items[0]!.quantityOverride = q;
      expect(errorsOf(s)).toMatch(/целым от 1 до 500/);
    }
    for (const key of ["priceRubOverride", "throughputPerHOverride", "raasRubMonthOverride"]) {
      for (const v of [0, -1, Number.POSITIVE_INFINITY]) {
        const s = base() as unknown as { items: Record<string, unknown>[] }[];
        s[1]!.items[0]![key] = v;
        expect(errorsOf(s)).toMatch(/больше нуля/);
      }
    }
    const service = base();
    service[1]!.items[0]!.serviceRubYearOverride = 0;
    expect(check(service).ok).toBe(true);
    service[1]!.items[0]!.serviceRubYearOverride = -5;
    expect(errorsOf(service)).toMatch(/не меньше нуля/);
  });

  it("ручное добавление требует причины; неизвестные поля отклоняются", () => {
    const manual = base();
    manual[1]!.items[0]!.manuallyAdded = true;
    expect(errorsOf(manual)).toMatch(/укажите причину/);
    manual[1]!.items[0]!.manualReason = "  Нужна проверка на пилоте ";
    const r = check(manual);
    expect(r.ok && r.value[1]!.items[0]!.manualReason).toBe("Нужна проверка на пилоте");
    const extra = base() as unknown as Record<string, unknown>[];
    extra[1]!.results = { npvRub: 1e9 };
    expect(errorsOf(extra)).toMatch(/неизвестные поля results/);
  });

  it("переопределения нормативов: только известные ключи с числами", () => {
    const s = base() as unknown as Record<string, unknown>[];
    s[1]!.normOverrides = { utilization: 0.8, magic: 2 };
    expect(errorsOf(s)).toMatch(/неизвестный норматив «magic»/);
    s[1]!.normOverrides = { utilization: "0.8" };
    expect(errorsOf(s)).toMatch(/норматив «Коэффициент загрузки робота» — укажите число/);
  });

  it("переопределение норматива вне допустимого диапазона отклоняется, а не прижимается молча", () => {
    const s = base();
    s[1]!.normOverrides = { utilization: 5 };
    expect(errorsOf(s)).toBe("Сценарий 2: норматив «Коэффициент загрузки робота» — укажите от 0,7 до 0,85 (доля), сейчас 5");
    s[1]!.normOverrides = { utilization: 0.6 };
    expect(errorsOf(s)).toMatch(/от 0,7 до 0,85/);
    // Границы включительно.
    s[1]!.normOverrides = { utilization: 0.85 };
    expect(check(s).ok).toBe(true);
    s[1]!.normOverrides = { utilization: 0.7 };
    expect(check(s).ok).toBe(true);
  });

  it("сообщения по-русски: подписи ручных значений, виды сценария, процесс и тип объекта", () => {
    const price = base() as unknown as { items: Record<string, unknown>[] }[];
    price[1]!.items[0]!.priceRubOverride = -1;
    expect(errorsOf(price)).toMatch(/цена робота, ₽ — укажите число больше нуля/);
    const flag = base() as unknown as { items: Record<string, unknown>[] }[];
    flag[1]!.items[0]!.raasFromEstimate = "да";
    expect(errorsOf(flag)).toMatch(/признак «ставка RaaS по оценке»/);
    const kind = base() as unknown as Record<string, unknown>[];
    kind[1]!.kind = "lease";
    expect(errorsOf(kind)).toMatch(/«Как есть».*«Покупка».*«Услуга \(RaaS\)»/);
    const dup = base();
    dup[1]!.items.push({ process: PT, productSlug: "dikom-dmr-carrier-p" });
    expect(errorsOf(dup)).toMatch(/на процесс «Перемещение паллет/);
    const none = validateScenarioSpecs(base(), "warehouse", PRODUCTS, []);
    expect(none.ok ? "" : none.errors.join(" | ")).toMatch(/Для типа объекта «Склад» не описаны процессы/);
    for (const text of [errorsOf(price), errorsOf(flag), errorsOf(kind)]) {
      expect(text).not.toMatch(/priceRubOverride|raasFromEstimate|manuallyAdded/);
    }
  });
});

describe("validatePendingChanges", () => {
  it("принимает поля из белого списка и нормализует пустые значения", () => {
    const r = validatePendingChanges([
      { field: "param:forkliftSalaryRubMonth", auto: 120000, old: 120000, new: 150000, unit: "₽/мес" },
      { scenarioKey: "p1", field: "item:pallet-transport:quantity", auto: 11, old: null, new: 12, reason: " принят парк по имитации " },
      { field: "norm:utilization", auto: 0.775, old: 0.775, new: 0.8 },
      { scenarioKey: "p3", field: "scenario:add", auto: null, old: null, new: { name: "Покупка — X" } },
      { scenarioKey: "p2", field: "scenario:remove", auto: null, old: "Покупка — Y", new: undefined },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(5);
      expect(r.value[1]?.reason).toBe("принят парк по имитации");
      expect(r.value[4]?.new).toBeNull();
    }
    expect(validatePendingChanges(undefined)).toEqual({ ok: true, value: [] });
  });

  it("отклоняет неизвестные поля, нормативы, ключи и не-JSON значения", () => {
    const bad = (c: unknown) => {
      const r = validatePendingChanges([c]);
      return r.ok ? "" : r.errors.join(" | ");
    };
    expect(bad({ field: "results", auto: 1, old: 1, new: 2 })).toMatch(/не поддерживается журналом/);
    expect(bad({ field: "item:pallet-transport:price", auto: 1, old: 1, new: 2 })).toMatch(/укажите ключ сценария/);
    expect(bad({ field: "norm:magic", auto: 1, old: 1, new: 2 })).toMatch(/неизвестный норматив/);
    expect(bad({ scenarioKey: "P 1", field: "scenario:add", auto: null, old: null, new: null })).toMatch(/ключ сценария/);
    expect(bad({ field: "param:x", auto: 1, old: Number.NaN, new: 2 })).toMatch(/не записывается в журнал/);
    expect(bad({ field: "param:x", auto: 1, old: 1, new: "я".repeat(5000) })).toMatch(/не записывается/);
    expect(bad({ field: "param:x", auto: 1, old: 1, new: 2, extra: true })).toMatch(/неизвестные поля extra/);
    expect(validatePendingChanges("нет").ok).toBe(false);
    const many = Array.from({ length: CHANGES_MAX + 1 }, () => ({ field: "param:x", auto: null, old: 1, new: 2 }));
    expect(validatePendingChanges(many).ok).toBe(false);
  });
});

describe("sanitizeProjectName", () => {
  it("обрезает пробелы и проверяет длину 1–120", () => {
    expect(sanitizeProjectName("  РЦ   Подольск ")).toBe("РЦ Подольск");
    expect(sanitizeProjectName("")).toBeNull();
    expect(sanitizeProjectName("   ")).toBeNull();
    expect(sanitizeProjectName("я".repeat(121))).toBeNull();
    expect(sanitizeProjectName("я".repeat(120))).toHaveLength(120);
    expect(sanitizeProjectName(42)).toBeNull();
    expect(sanitizeProjectName(null)).toBeNull();
  });
});
