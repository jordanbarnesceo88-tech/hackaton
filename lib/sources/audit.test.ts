import { describe, it, expect } from "vitest";
import {
  ALL_CITATIONS,
  DEFAULT_MAX_AGE_DAYS,
  auditSources,
  citationTimeliness,
  resolveMaxAgeDays,
  type Citation,
} from "./registry";
import { SOLUTION_CLASSES } from "@/scripts/seed-data/solution-classes";
import { VENDOR_SOLUTIONS } from "@/scripts/seed-data/vendor-solutions";
import { WAREHOUSE_REAL } from "@/scripts/parse-sources/warehouse-real";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-12T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString().slice(0, 10);

const citation = (over: Partial<Citation> = {}): Citation => ({
  label: "тестовое утверждение",
  kind: "price",
  url: "https://example.test/page",
  lastVerified: daysAgo(1),
  ...over,
});

describe("бакеты свежести", () => {
  it("каждая цитата реестра классифицирована ЯВНО", () => {
    // Умолчание `must-stay-current` существует как страховка от забывчивости, а не как
    // способ не решать. В самом реестре решение должно быть записано словом: иначе
    // читатель registry.ts не отличит «обдумано и строго» от «просто не заполнили».
    for (const c of ALL_CITATIONS) {
      expect(c.timeliness, `${c.label} (${c.kind}): бакет не проставлен`).toBeDefined();
    }
  });

  it("бакеты покрывают весь реестр и не пересекаются", () => {
    const audit = auditSources({ now: NOW });
    expect(audit.gated.length + audit.snapshots.length).toBe(ALL_CITATIONS.length);
    const inTwoBuckets = audit.gated.filter((g) =>
      audit.snapshots.some((s) => s.citation === g.citation)
    );
    expect(inTwoBuckets).toEqual([]);
  });

  it("ни одно утверждение о ПРОИЗВОДИТЕЛЬНОСТИ не выведено из-под гейта", () => {
    // Снимок оправдан для цены: «$95 880 на витрине 9 сентября» остаётся правдой про девятое
    // сентября. Производительность мы предъявляем иначе — как то, на что техника способна
    // СЕГОДНЯ, — и спека, переписанная вместе с ревизией машины, делает такую цитату ложной
    // без единой правки у нас. Если этот тест однажды придётся менять, менять придётся и
    // формулировку на /methodology.
    for (const c of ALL_CITATIONS) {
      if (c.kind === "capacity") {
        expect(citationTimeliness(c), `${c.label}: спека ушла в снимки`).toBe("must-stay-current");
      }
    }
  });

  it("цена класса — снимок, производительность класса — под гейтом", () => {
    for (const c of SOLUTION_CLASSES) {
      const price = ALL_CITATIONS.find((x) => x.label === c.name && x.kind === "price");
      const capacity = ALL_CITATIONS.find((x) => x.label === c.name && x.kind === "capacity");
      expect(price && citationTimeliness(price), c.slug).toBe("market-snapshot");
      expect(capacity && citationTimeliness(capacity), c.slug).toBe("must-stay-current");
    }
  });

  it("цена с витрины дистрибьютора — снимок, спека производителя — под гейтом", () => {
    for (const s of VENDOR_SOLUTIONS) {
      const byUrl = (url: string) => ALL_CITATIONS.find((c) => c.url === url);
      expect(byUrl(s.priceSourceUrl) && citationTimeliness(byUrl(s.priceSourceUrl)!)).toBe(
        "market-snapshot"
      );
      expect(byUrl(s.sourceUrl) && citationTimeliness(byUrl(s.sourceUrl)!)).toBe(
        "must-stay-current"
      );
    }
  });

  it("оценка цены без страницы остаётся под гейтом", () => {
    // Складские цены — оценки третьей стороны, названные словами и без ссылки. По природе это
    // тоже наблюдение за рынком, но снимок держится на том, что дату можно предъявить вместе
    // со страницей; здесь предъявлять нечего, и истечение срока — единственное, что заставит
    // разыскать оценку заново. Консервативно и намеренно.
    for (const s of WAREHOUSE_REAL) {
      const price = ALL_CITATIONS.find((c) => c.label === s.name && c.kind === "price");
      expect(price?.url, `${s.name}: у складской цены появилась ссылка`).toBeNull();
      expect(price && citationTimeliness(price)).toBe("must-stay-current");
    }
  });
});

describe("разбор реестра по свежести", () => {
  it("старый снимок гейт не роняет", () => {
    // Ровно тот дефект, ради которого проверки разведены: цитата, верная про свой день, валила
    // сборку за то, что день стал дальше.
    const audit = auditSources({
      citations: [citation({ lastVerified: daysAgo(900), timeliness: "market-snapshot" })],
      now: NOW,
      maxAgeDays: 180,
    });
    expect(audit.overdue).toEqual([]);
    expect(audit.snapshots[0]?.ageDays).toBe(900);
    expect(audit.snapshots[0]?.overdue).toBe(false);
  });

  it("старая цитата строгого бакета гейт роняет", () => {
    const audit = auditSources({
      citations: [citation({ lastVerified: daysAgo(181), timeliness: "must-stay-current" })],
      now: NOW,
      maxAgeDays: 180,
    });
    expect(audit.overdue).toHaveLength(1);
  });

  it("ровно на пороге цитата ещё жива", () => {
    const audit = auditSources({
      citations: [citation({ lastVerified: daysAgo(180), timeliness: "must-stay-current" })],
      now: NOW,
      maxAgeDays: 180,
    });
    expect(audit.overdue).toEqual([]);
  });

  it("неклассифицированная цитата попадает в строгий бакет, а не мимо проверки", () => {
    const audit = auditSources({
      citations: [citation({ lastVerified: daysAgo(400) })],
      now: NOW,
      maxAgeDays: 180,
    });
    expect(audit.gated).toHaveLength(1);
    expect(audit.overdue).toHaveLength(1);
  });

  it("снимок с непригодной датой числится сломанным, хотя за возраст не отвечает", () => {
    // Право снимка не подчиняться порогу целиком держится на том, что дату можно назвать.
    // Непригодная дата это право отнимает, поэтому гейт роняют и такие строки.
    const audit = auditSources({
      citations: [citation({ lastVerified: "07.09.2026", timeliness: "market-snapshot" })],
      now: NOW,
      maxAgeDays: 180,
    });
    expect(audit.undated).toHaveLength(1);
    expect(audit.overdue).toEqual([]);
  });

  it("худшее сверху", () => {
    const audit = auditSources({
      citations: [
        citation({ label: "свежая", lastVerified: daysAgo(2) }),
        citation({ label: "сломанная", lastVerified: "не дата" }),
        citation({ label: "старая", lastVerified: daysAgo(100) }),
      ],
      now: NOW,
    });
    expect(audit.gated.map((a) => a.citation.label)).toEqual(["сломанная", "старая", "свежая"]);
  });
});

describe("порог", () => {
  it("умолчание — задокументированные 180 дней", () => {
    expect(resolveMaxAgeDays(undefined)).toBe(DEFAULT_MAX_AGE_DAYS);
    // Пустая переменная в .env — это «не задано», а не запрос на нулевой порог.
    expect(resolveMaxAgeDays("")).toBe(DEFAULT_MAX_AGE_DAYS);
  });

  it("мусор отвергается, а не превращается в NaN-порог", () => {
    // NaN в сравнении `age > NaN` даёт false, то есть гейт молча пропускал бы всё.
    expect(resolveMaxAgeDays("скоро")).toBeNull();
    expect(resolveMaxAgeDays("0")).toBeNull();
    expect(resolveMaxAgeDays("-30")).toBeNull();
  });

  it("страница и скрипт считают по одному порогу", () => {
    expect(auditSources({ now: NOW, maxAgeDays: 30 }).maxAgeDays).toBe(30);
    expect(resolveMaxAgeDays("30")).toBe(30);
  });
});
