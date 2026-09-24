import { describe, expect, it } from "vitest";
import { REQUIRED_CHARACTERISTIC_KEYS } from "../tz/characteristics";
import { FLAG_NOTES } from "../tz/selection/missing";
import { usableThroughput } from "./product-for-calc";
import type { CharRow } from "./product-for-calc";
import {
  ALTERNATIVE_AGREEMENT_TOLERANCE,
  NEEDS_VERIFICATION_COMPLETENESS_PCT,
  hasConflictingAlternatives,
  promoteColumns,
  verificationReasons,
} from "./promote";

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
    confirmed: true,
    ...patch,
  };
}

const NUMERIC: Record<string, Partial<CharRow>> = {
  priceRub: { valueNum: 2_700_000, unit: "₽" },
  throughput: { valueNum: 90, valueMin: 80, valueMax: 100, unit: "паллет/ч", scope: "per-robot" },
  payloadKg: { valueNum: 1500, unit: "кг" },
  speedMps: { valueNum: 1.5, unit: "м/с" },
};

/**
 * Полная карточка: все 31 обязательный ключ заполнен и подтверждён, плюс ставка RaaS.
 * `count` оставляет только первые N обязательных ключей (цена и производительность — всегда).
 */
function fullCard(count = REQUIRED_CHARACTERISTIC_KEYS.length): CharRow[] {
  const keys = REQUIRED_CHARACTERISTIC_KEYS.filter((k) => k !== "priceRub" && k !== "throughput").slice(0, count - 2);
  return [
    row("priceRub", NUMERIC.priceRub),
    row("throughput", NUMERIC.throughput),
    ...keys.map((k) => row(k, NUMERIC[k] ?? { valueText: "значение" })),
    row("raasRubMonth", { valueNum: 100_000, qualifier: "от", unit: "₽/мес", confirmed: false }),
  ];
}

/** Продукт без пометок качества. */
const NO_FLAGS = { flags: [] } as const;

/** ICU ставит неразрывный пробел между разрядами — сравниваем с обычным. */
const plain = (s: string) => s.replace(/\s/g, " ");

/** Полная подтверждённая карточка, в которой производительность заменена на данную. */
function withThroughput(patch: Partial<CharRow>): CharRow[] {
  return fullCard().map((c) => (c.key === "throughput" ? row("throughput", patch) : c));
}

describe("promoteColumns", () => {
  it("выносит числа расчёта и считает полноту по 31 обязательному ключу", () => {
    const cols = promoteColumns(fullCard(), NO_FLAGS);
    expect(cols).toEqual({
      priceRub: 2_700_000,
      raasRubMonth: 100_000,
      throughputPerH: 90,
      throughputUnit: "паллет/ч",
      payloadKg: 1500,
      speedMps: 1.5,
      completenessPct: 100,
      // Подтверждены все, кроме ставки RaaS: 31 из 32.
      confirmedSharePct: 97,
      needsVerification: false,
    });
  });

  it("пустая карточка: всё null, полнота 0 %, требует проверки", () => {
    expect(promoteColumns([], NO_FLAGS)).toEqual({
      priceRub: null,
      raasRubMonth: null,
      throughputPerH: null,
      throughputUnit: null,
      payloadKg: null,
      speedMps: null,
      completenessPct: 0,
      confirmedSharePct: 0,
      needsVerification: true,
    });
  });

  it("производительность «до X» и «на весь парк» не выносится — как и в расчёт", () => {
    const upTo = fullCard().map((c) =>
      c.key === "throughput" ? row("throughput", { valueNum: 1000, valueMax: 1000, qualifier: "до", unit: "м²/ч" }) : c,
    );
    const cols = promoteColumns(upTo, NO_FLAGS);
    expect(cols.throughputPerH).toBeNull();
    expect(cols.throughputUnit).toBeNull();
    expect(cols.needsVerification).toBe(true);

    const fleet = fullCard().map((c) =>
      c.key === "throughput" ? row("throughput", { valueNum: 30_000, unit: "паллет/ч", scope: "per-fleet" }) : c,
    );
    expect(promoteColumns(fleet, NO_FLAGS).throughputPerH).toBeNull();
  });

  it("пустые строки не повышают полноту", () => {
    const withBlanks = [...fullCard(10), row("purpose", { valueText: " " }), row("limitations", { valueList: [""] })];
    expect(promoteColumns(withBlanks, NO_FLAGS).completenessPct).toBe(promoteColumns(fullCard(10), NO_FLAGS).completenessPct);
  });

  it("при повторе ключа берётся первая строка", () => {
    const cols = promoteColumns([row("priceRub", { valueNum: 1 }), row("priceRub", { valueNum: 2 })], NO_FLAGS);
    expect(cols.priceRub).toBe(1);
  });
});

describe("needsVerification", () => {
  it(`порог полноты ${NEEDS_VERIFICATION_COMPLETENESS_PCT} %: 19 из 31 — достаточно, 18 — нет`, () => {
    const c19 = promoteColumns(fullCard(19), NO_FLAGS);
    expect(c19.completenessPct).toBe(61);
    expect(c19.needsVerification).toBe(false);
    const c18 = promoteColumns(fullCard(18), NO_FLAGS);
    expect(c18.completenessPct).toBe(58);
    expect(c18.needsVerification).toBe(true);
    expect(verificationReasons(fullCard(18), NO_FLAGS).join("; ")).toContain("полнота карточки 58 % — ниже 60 %");
  });

  it("любая пометка качества включает проверку — с текстом по-русски, как в подборе", () => {
    expect(promoteColumns(fullCard(), { flags: ["duplicate-merged"] }).needsVerification).toBe(true);
    expect(verificationReasons(fullCard(), { flags: ["price-placeholder", "duplicate-merged"] })).toEqual([
      FLAG_NOTES["price-placeholder"],
      FLAG_NOTES["duplicate-merged"],
    ]);
    expect(FLAG_NOTES["price-placeholder"]).toBe("цена похожа на условную (типовое значение каталога)");
  });

  it("неизвестная пометка отбрасывается и не включает проверку без видимой причины", () => {
    expect(promoteColumns(fullCard(), { flags: ["not-a-flag", ""] }).needsVerification).toBe(false);
    expect(verificationReasons(fullCard(), { flags: ["not-a-flag"] })).toEqual([]);
  });

  it("причины не повторяются: пометка «нет цены» и отсутствующая цена — одна причина", () => {
    const missing = fullCard().filter((c) => c.key !== "priceRub");
    const reasons = verificationReasons(missing, { flags: ["no-price"] });
    expect(reasons.filter((r) => r === "цена не опубликована")).toHaveLength(1);
  });

  it("неподтверждённая или отсутствующая цена включает проверку", () => {
    const unconfirmed = fullCard().map((c) => (c.key === "priceRub" ? { ...c, confirmed: false } : c));
    expect(verificationReasons(unconfirmed, NO_FLAGS)).toEqual(["цена не подтверждена первоисточником"]);
    const missing = fullCard().filter((c) => c.key !== "priceRub");
    expect(verificationReasons(missing, NO_FLAGS)).toContain("цена не опубликована");
  });

  it("неподтверждённая или отсутствующая производительность включает проверку", () => {
    const unconfirmed = fullCard().map((c) => (c.key === "throughput" ? { ...c, confirmed: false } : c));
    expect(verificationReasons(unconfirmed, NO_FLAGS)).toEqual(["производительность не подтверждена первоисточником"]);
    const missing = fullCard().filter((c) => c.key !== "throughput");
    expect(verificationReasons(missing, NO_FLAGS)).toContain("производительность не опубликована");
    const blank = withThroughput({ valueText: "  " });
    expect(verificationReasons(blank, NO_FLAGS)).toContain("производительность не опубликована");
  });

  describe("почему паспортная производительность не идёт в расчёт — причина по случаю", () => {
    const reasonsFor = (patch: Partial<CharRow>) => verificationReasons(withThroughput(patch), NO_FLAGS).map(plain);

    it("только текст (как «2400-6000 м²/ч» или «высокоскоростная сортировка» у организатора)", () => {
      expect(reasonsFor({ valueText: "2400-6000 м²/ч" })).toEqual([
        "производительность указана только текстом, числа для расчёта нет",
      ]);
      expect(reasonsFor({ valueText: "высокоскоростная сортировка" })).toEqual([
        "производительность указана только текстом, числа для расчёта нет",
      ]);
    });

    it("границы без типичного значения", () => {
      expect(reasonsFor({ valueMin: 1000, valueMax: 2500, unit: "м²/ч" })).toEqual([
        "производительность указана без типичного значения («1 000–2 500 м²/ч») — числа для расчёта нет",
      ]);
    });

    it("только предел «до X»", () => {
      expect(reasonsFor({ valueNum: 1000, valueMax: 1000, qualifier: "до", unit: "м²/ч", scope: "per-robot" })).toEqual([
        "указан только предел производительности («до 1 000 м²/ч (на робота)»), а не типичное значение — в расчёт не идёт",
      ]);
    });

    it("значение на весь парк", () => {
      expect(reasonsFor({ valueNum: 30_000, unit: "паллет/ч", scope: "per-fleet" })).toEqual([
        "производительность указана на весь парк, а не на одного робота — в расчёт не идёт",
      ]);
    });

    it("причина есть ровно тогда, когда значение не идёт в расчёт (согласовано с usableThroughput)", () => {
      const cases: Partial<CharRow>[] = [
        { valueText: "текст" },
        { valueList: ["a"] },
        { valueMin: 5 },
        { valueMax: 5 },
        { valueNum: 5 },
        { valueNum: 5, qualifier: "до" },
        { valueNum: 5, qualifier: "до", valueMin: 4 },
        { valueNum: 5, qualifier: "от" },
        { valueNum: 5, qualifier: "≈", scope: "per-fleet" },
        { valueNum: 5, scope: "per-station" },
        { valueNum: 5, scope: "per-channel" },
        { valueNum: Number.NaN, valueText: "x" },
      ];
      for (const patch of cases) {
        const thr = row("throughput", patch);
        const reasons = verificationReasons(withThroughput(patch), NO_FLAGS);
        const explained = reasons.some((r) => r !== "производительность не подтверждена первоисточником" && r.includes("производительност"));
        expect(explained, JSON.stringify(patch)).toBe(usableThroughput(thr) === null);
      }
    });
  });

  it("расхождение источников включает проверку и называет характеристику по-русски", () => {
    const conflicting = fullCard().map((c) => {
      if (c.key === "priceRub") return { ...c, alternatives: [{ value: 3_000_000, unit: "₽", origin: "research" }] };
      if (c.key === "payloadKg") return { ...c, alternatives: [{ value: 2000, unit: "кг", origin: "research" }] };
      return c;
    });
    expect(promoteColumns(conflicting, NO_FLAGS).needsVerification).toBe(true);
    expect(verificationReasons(conflicting, NO_FLAGS)).toEqual(["источники расходятся: Грузоподъёмность, Цена оборудования"]);
  });
});

describe("hasConflictingAlternatives", () => {
  const primary = (alternatives: unknown, patch: Partial<CharRow> = {}) =>
    hasConflictingAlternatives({ valueNum: 2_700_000, unit: "₽", alternatives, ...patch });

  it(`согласие в пределах ${ALTERNATIVE_AGREEMENT_TOLERANCE * 100} % — не расхождение`, () => {
    expect(primary([{ value: 2_800_000, unit: "₽" }])).toBe(false);
    expect(primary([{ value: 2_970_000 }])).toBe(false);
    expect(primary([{ value: { typical: 2_600_000, min: 2_500_000, max: 2_700_000 } }])).toBe(false);
  });

  it("отличие больше допуска или другая единица — расхождение", () => {
    expect(primary([{ value: 3_000_000 }])).toBe(true);
    expect(primary([{ value: { typical: 2_000_000 } }])).toBe(true);
    expect(primary([{ value: 2_700_000, unit: "₽/мес" }])).toBe(true);
    expect(hasConflictingAlternatives({ valueNum: 0, unit: null, alternatives: [{ value: 1 }] })).toBe(true);
    expect(hasConflictingAlternatives({ valueNum: 0, unit: null, alternatives: [{ value: 0 }] })).toBe(false);
  });

  it("текстовые альтернативы и мусор в JSON не считаются расхождением и не роняют разбор", () => {
    expect(primary([{ value: "около трёх миллионов" }, { value: ["a"] }])).toBe(false);
    expect(primary(null)).toBe(false);
    expect(primary("строка")).toBe(false);
    expect(primary([null, 5, "x", { value: null }, { unit: "₽" }])).toBe(false);
    expect(primary([{ value: 3_000_000 }], { valueNum: null })).toBe(false);
  });
});
