import { describe, it, expect } from "vitest";
import { SIM_MODEL_VERSION, TZ_MODEL_VERSION, dataVersionOf, fnv1a32, stableJson } from "./version";

describe("версии моделей", () => {
  it("зафиксированы в контракте", () => {
    expect(TZ_MODEL_VERSION).toBe("tz-1.0.0");
    expect(SIM_MODEL_VERSION).toBe("sim-1.0.0");
  });
});

describe("fnv1a32", () => {
  it("совпадает с опубликованными тестовыми векторами FNV-1a 32", () => {
    expect(fnv1a32("")).toBe("811c9dc5");
    expect(fnv1a32("a")).toBe("e40c292c");
    expect(fnv1a32("foobar")).toBe("bf9cf968");
  });

  it("всегда 8 шестнадцатеричных символов в нижнем регистре", () => {
    for (const s of ["", "x", "склад", "🚚 паллета", "a".repeat(1000)]) {
      expect(fnv1a32(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("хэширует байты UTF-8: закреплённые векторы, посчитанные через TextEncoder", () => {
    // Реализация на младших байтах UTF-16 дала бы «bff3a13f» и «2df5d3f6».
    expect(fnv1a32("склад")).toBe("44fcfb18");
    expect(fnv1a32("🚚")).toBe("65a761ec");
  });

  it("совпадает с эталоном на TextEncoder, включая одиночные суррогаты и границы диапазонов", () => {
    const reference = (s: string): string => {
      let h = 0x811c9dc5;
      for (const b of new TextEncoder().encode(s)) {
        h ^= b;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, "0");
    };
    const samples = [
      "",
      "a",
      "склад",
      "🚚 паллета",
      "€",
      "𝄞",
      "\u007f\u0080\u07ff\u0800\uffff", // границы 1-, 2- и 3-байтовых последовательностей
      "\ud800x", // одиночный старший суррогат → U+FFFD
      "a\udc00", // одиночный младший суррогат → U+FFFD
    ];
    for (const s of samples) expect(fnv1a32(s), JSON.stringify(s)).toBe(reference(s));
  });
});

describe("stableJson", () => {
  it("сортирует ключи на всех уровнях и сохраняет порядок массивов", () => {
    expect(stableJson({ b: 1, a: { d: [3, 1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
  });

  it("пропускает undefined в объектах и заменяет на null в массивах", () => {
    expect(stableJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableJson([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("«дыры» разреженного массива становятся null, как в JSON.stringify", () => {
    // Разреженный массив без литерала [1, , 3], который запрещает правило no-sparse-arrays.
    const sparse = new Array<number>(3);
    sparse[0] = 1;
    sparse[2] = 3;
    expect(1 in sparse).toBe(false);
    expect(stableJson(sparse)).toBe("[1,null,3]");
    expect(stableJson(sparse)).toBe(JSON.stringify(sparse));
    expect(stableJson({ a: new Array(2) })).toBe('{"a":[null,null]}');
  });

  it("бросает ошибку на NaN и бесконечности", () => {
    expect(() => stableJson({ a: NaN })).toThrow();
    expect(() => stableJson([Infinity])).toThrow();
    expect(() => stableJson(-Infinity)).toThrow();
  });

  it("бросает ошибку на циклической ссылке, Map и BigInt", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => stableJson(cyclic)).toThrow();
    expect(() => stableJson(new Map([["a", 1]]))).toThrow();
    expect(() => stableJson({ n: BigInt(1) })).toThrow();
  });

  it("повторяющийся (не циклический) объект сериализуется в каждом месте", () => {
    const shared = { x: 1 };
    expect(stableJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it("совпадает с JSON.stringify для уже упорядоченного объекта", () => {
    const v = { a: 1, b: "текст «в кавычках»\n", c: [true, false, null], d: { e: -2.5 } };
    expect(stableJson(v)).toBe(JSON.stringify(v));
  });
});

describe("dataVersionOf", () => {
  const snapshot = {
    normsUsed: { utilization: 0.775, reservePct: 0.175 },
    productSnapshots: { "ronavi-h1500": { priceRub: 2_700_000, throughputPerH: 90 } },
    ORGANIZER_DATA_VERSION: { datasets: "2026-09-22#4be0fac8" },
  };

  it("порядок ключей не влияет на хэш", () => {
    const reordered = {
      ORGANIZER_DATA_VERSION: { datasets: "2026-09-22#4be0fac8" },
      productSnapshots: { "ronavi-h1500": { throughputPerH: 90, priceRub: 2_700_000 } },
      normsUsed: { reservePct: 0.175, utilization: 0.775 },
    };
    expect(dataVersionOf(reordered)).toBe(dataVersionOf(snapshot));
  });

  it("любое изменение значения меняет хэш", () => {
    const base = dataVersionOf(snapshot);
    const changedNorm = { ...snapshot, normsUsed: { ...snapshot.normsUsed, utilization: 0.78 } };
    const changedPrice = {
      ...snapshot,
      productSnapshots: { "ronavi-h1500": { priceRub: 2_700_001, throughputPerH: 90 } },
    };
    const changedVersion = { ...snapshot, ORGANIZER_DATA_VERSION: { datasets: "2026-09-23#4be0fac8" } };
    expect(dataVersionOf(changedNorm)).not.toBe(base);
    expect(dataVersionOf(changedPrice)).not.toBe(base);
    expect(dataVersionOf(changedVersion)).not.toBe(base);
  });

  it("NaN во входе — ошибка, а не тихая подмена на null", () => {
    expect(() => dataVersionOf({ normsUsed: { utilization: NaN } })).toThrow();
  });
});
