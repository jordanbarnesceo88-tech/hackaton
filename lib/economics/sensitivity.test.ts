import { describe, it, expect } from "vitest";
import { npvForScenario, sensitivity } from "./sensitivity";
import { makeAssumptions, makeCapacity, makeParams } from "./fixtures";

const a = makeAssumptions();
const cap = makeCapacity();
const params = makeParams();

describe("npvForScenario", () => {
  it("returns a finite NPV for an economical scenario", () => {
    const v = npvForScenario(cap, params, a);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!)).toBe(true);
    expect(v!).toBeGreaterThan(0);
  });
  it("returns a real NEGATIVE NPV when savings go negative (not truncated to 0)", () => {
    // Tiny displaceable workload -> savings < 0, but capex still incurred -> NPV < 0.
    const v = npvForScenario(cap, { ...params, opsPerDay: 20, staffCount: 1 }, a);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(0);
  });
  it("returns null for invalid inputs", () => {
    // Было: opsPerWorkerPerYear = 0. Движок это допущение больше не читает, поэтому
    // вырожденность переехала на норматив задачи — диаграмма обязана не строиться там, где
    // занятость неизвестна, а не показывать нули.
    expect(npvForScenario({ ...cap, workerOutputPerYear: null }, params, a)).toBeNull();
  });
});

describe("sensitivity", () => {
  it("returns bars sorted by swing descending, all with positive swing", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1]!.swing).toBeGreaterThanOrEqual(bars[i]!.swing);
    }
    expect(bars.every((b) => b.swing >= 0)).toBe(true);
  });
  it("does not perturb display-only usdToRub", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.some((b) => b.key === "usdToRub")).toBe(false);
  });
  it("labor cost is among the strongest levers", () => {
    const bars = sensitivity(cap, params, a);
    const top3 = bars.slice(0, 3).map((b) => b.key);
    expect(top3).toContain("laborCostPerHourUsd");
  });
  it("returns [] when the base case is invalid", () => {
    expect(sensitivity(cap, params, { ...a, assetLifeYears: 0 })).toEqual([]);
  });
});

describe("whole-year perturbation for the year-valued assumptions", () => {
  it("tags each bar with how it was actually perturbed", () => {
    const bars = sensitivity(cap, params, a);
    const byKey = Object.fromEntries(bars.map((b) => [b.key, b.kind]));
    expect(byKey.roiHorizonYears).toBe("whole-year");
    expect(byKey.assetLifeYears).toBe("whole-year");
    expect(byKey.laborCostPerHourUsd).toBe("percent");
    expect(byKey.discountRate).toBe("percent");
  });

  it("moves roiHorizonYears by exactly one year, not a floored 25%", () => {
    // ±25% of 5 gives 3.75 / 6.25, which projectFinance rounds to 4 / 6 — an actual -20%/+20%
    // (it floored to 3 / 6 until Ч-3, i.e. -40%/+20%). Either way the bar was measured on a
    // different ruler than its «±25%» label claimed; ±1 year survives the rounding intact.
    // ±1 year gives 4 / 6, which survive the floor intact.
    const bars = sensitivity(cap, params, a);
    const bar = bars.find((b) => b.key === "roiHorizonYears")!;
    expect(bar.lowNpv).toBe(npvForScenario(cap, params, { ...a, roiHorizonYears: 4 }));
    expect(bar.highNpv).toBe(npvForScenario(cap, params, { ...a, roiHorizonYears: 6 }));
  });

  it("gives assetLifeYears a real swing instead of an empty bar", () => {
    // At life 7 / horizon 5, ±25% floors to 5 and 8 — neither triggers re-CAPEX, so the old
    // bar was always 0. ±1 year reaches 6, which still does not, but the bar is now measured
    // on the same basis as its label claims.
    const bars = sensitivity(cap, params, a);
    const bar = bars.find((b) => b.key === "assetLifeYears")!;
    expect(bar.lowNpv).toBe(npvForScenario(cap, params, { ...a, assetLifeYears: 6 }));
    expect(bar.highNpv).toBe(npvForScenario(cap, params, { ...a, assetLifeYears: 8 }));
  });

  it("shows a non-zero assetLifeYears swing when re-CAPEX is actually in play", () => {
    // life 3 vs horizon 5: stepping to 2 adds a re-buy, so the bar carries real information.
    const shortLife = { ...a, assetLifeYears: 3 };
    const bar = sensitivity(cap, params, shortLife).find((b) => b.key === "assetLifeYears")!;
    expect(bar.swing).toBeGreaterThan(0);
  });

  it("still perturbs continuous assumptions multiplicatively", () => {
    const bars = sensitivity(cap, params, a);
    const bar = bars.find((b) => b.key === "laborCostPerHourUsd")!;
    expect(bar.lowNpv).toBe(
      npvForScenario(cap, params, { ...a, laborCostPerHourUsd: a.laborCostPerHourUsd * 0.75 })
    );
  });
});

describe("each bar records the perturbation it was measured at", () => {
  // The chart used to have «±25%» typed into its caption and its per-bar tooltip while this is
  // a parameter with a default. Carrying it on the bar is what keeps the label and the maths
  // the same number.
  it("carries the default deltaPct on percent bars and null on whole-year ones", () => {
    const bars = sensitivity(cap, params, a);
    expect(bars.find((b) => b.key === "laborCostPerHourUsd")!.deltaPct).toBe(0.25);
    expect(bars.find((b) => b.key === "roiHorizonYears")!.deltaPct).toBeNull();
  });

  it("carries a caller-supplied deltaPct, and the bar is measured at it", () => {
    const bars = sensitivity(cap, params, a, 0.1);
    const bar = bars.find((b) => b.key === "laborCostPerHourUsd")!;
    expect(bar.deltaPct).toBe(0.1);
    expect(bar.lowNpv).toBe(
      npvForScenario(cap, params, { ...a, laborCostPerHourUsd: a.laborCostPerHourUsd * 0.9 })
    );
  });
});

describe("возмущение упирается в границу, а не роняет столбец", () => {
  it("горизонт ROI в один год не исчезает из диаграммы", () => {
    // Находка ревью: «минус один год» от границы 1 давало 0, baseEconomics возвращал null, и
    // столбец молча пропадал — пользователь видел торнадо без рычага, которым только что
    // двигал, и ничто не говорило, что его пропустили.
    const atBound = makeAssumptions({ roiHorizonYears: 1 });
    const bars = sensitivity(cap, params, atBound);
    expect(bars.map((b) => b.key)).toContain("roiHorizonYears");
  });
});

describe("занятость задачей — рычаг диаграммы (остаток A-7)", () => {
  // A-7 назвал это первым пунктом, и он оставался незакрытым: занятость — со-доминирующий
  // рычаг модели (замещение считается прямо от неё), но в диаграмму не попадала вовсе, потому
  // что лежит в параметрах, а `sensitivity()` возмущал только допущения. Торнадо заявляет, что
  // ранжирует рычаги, двигающие NPV, и ранжировал неполный набор — умалчивая ровно о том
  // числе, которое человек только что ввёл сам.
  const params = makeParams({ staffCount: 40, taskStaffing: { "test-task": 8 } });

  it("столбец занятости есть и он не пустой", () => {
    const bar = sensitivity(cap, params, a).find((b) => b.key === "taskStaffing");
    expect(bar, "занятости нет в диаграмме").toBeDefined();
    expect(bar!.swing).toBeGreaterThan(0);
  });

  it("плечи двигают заявленную занятость, а не что-то другое", () => {
    const bar = sensitivity(cap, params, a).find((b) => b.key === "taskStaffing")!;
    expect(bar.baseValue).toBe(8);
    expect(bar.lowValue).toBeCloseTo(6, 9);
    expect(bar.highValue).toBeCloseTo(10, 9);
  });

  it("верхнее плечо упирается в штат объекта — потолок движка, а не выдуманный", () => {
    // `resolveTaskFte` зажимает занятость штатом. Плечо, ушедшее выше, мерило бы сценарий,
    // которого движок не считает, — ровно ошибка Т-1, только с другой стороны.
    const atCap = makeParams({ staffCount: 10, taskStaffing: { "test-task": 10 } });
    const bar = sensitivity(cap, atCap, a).find((b) => b.key === "taskStaffing")!;
    expect(bar.highValue).toBe(10);
    expect(bar.clampedHigh).toBe(true);
  });

  it("когда занятость не заявлена, рычагом становится норматив категории", () => {
    // Движок в этом случае считает от норматива, и двигать надо ровно то, от чего он считает.
    const byNorm = makeParams({ staffCount: 40 });
    const bar = sensitivity(cap, byNorm, a).find((b) => b.key === "taskStaffing")!;
    expect(bar.baseValue).toBeGreaterThan(0);
    expect(bar.swing).toBeGreaterThan(0);
  });

  it("занятость сопоставима по силе со ставкой труда", () => {
    // Не «должна быть первой» — это зависело бы от сценария. Но обе входят в базовые затраты
    // множителями, поэтому размах у них одного порядка, и если занятость вдруг окажется на
    // порядок слабее, значит её возмущают не там.
    const bars = sensitivity(cap, params, a);
    const staffing = bars.find((b) => b.key === "taskStaffing")!;
    const labour = bars.find((b) => b.key === "laborCostPerHourUsd")!;
    expect(staffing.swing).toBeGreaterThan(labour.swing / 10);
  });
});

describe("диаграмма не рисует рычагов, которых нет в модели", () => {
  // Инвариант прежний, а набор рычагов другой. Прошлая находка ревью: диаграмма рисовала
  // «Операций на сотрудника в год» с размахом 0 ₽ на потоке площади — допущение, которое
  // движок для этого потока не читал, — а настоящий делитель отсутствовал. Тогда делители
  // сделали зависимыми от потока.
  //
  // После подпроекта A движок не читает НИ ОДИН из них: замещение считается от занятости,
  // названной владельцем объекта, а норматив выработки живёт на категории и имеет ссылку.
  // Поэтому оба ушли из диаграммы целиком, а не переехали в другой поток (Т-4).
  it("делители замещения не показываются ни на одном потоке", () => {
    const opsKeys = sensitivity(cap, params, makeAssumptions()).map((b) => b.key);
    const areaKeys = sensitivity(
      { ...cap, workloadStream: "FLOOR_AREA" as const },
      params,
      makeAssumptions()
    ).map((b) => b.key);
    for (const keys of [opsKeys, areaKeys]) {
      expect(keys).not.toContain("opsPerWorkerPerYear");
      expect(keys).not.toContain("areaPerCleanerPerYear");
    }
  });

  it("живой рычаг потока площади на месте", () => {
    // cleaningsPerDay движок читает: он превращает площадь в поток работы.
    const areaKeys = sensitivity(
      { ...cap, workloadStream: "FLOOR_AREA" as const },
      params,
      makeAssumptions()
    ).map((b) => b.key);
    expect(areaKeys).toContain("cleaningsPerDay");
  });
});

describe("плечи измерены тем, что подставлено, а не тем, что запрошено", () => {
  it("верхнее плечо не выходит за границу допущения (Т-1)", () => {
    // laborReplacementPct = 1 — это её максимум: заместить больше 100 % труда нельзя.
    // Плечо уходило в 1,25, и размах ДОМИНИРУЮЩЕГО рычага получался вдвое больше настоящего.
    const atMax = makeAssumptions({ laborReplacementPct: 1 });
    const bar = sensitivity(cap, params, atMax).find((b) => b.key === "laborReplacementPct")!;
    expect(bar.highValue).toBe(1);
    expect(bar.clampedHigh).toBe(true);
    expect(bar.highNpv).toBe(bar.baseNpv);
  });

  it("нижнее плечо, упёршееся в границу, помечено (Т-3)", () => {
    // cleaningsPerDay по умолчанию 1 при минимуме 1: столбец односторонний.
    const areaCap = { ...cap, workloadStream: "FLOOR_AREA" as const };
    const bar = sensitivity(areaCap, params, makeAssumptions()).find(
      (b) => b.key === "cleaningsPerDay"
    )!;
    expect(bar.lowValue).toBe(1);
    expect(bar.clampedLow).toBe(true);
    expect(bar.clampedHigh).toBe(false);
  });

  it("нулевое допущение получает НЕнулевое возмущение (Т-2)", () => {
    // ±25 % от нуля — ноль, и рычаг выглядел мёртвым, не будучи им: при discountRate = 0
    // настоящий диапазон NPV это 437 500 против 299 373 при ставке 0,12.
    const atZero = makeAssumptions({ discountRate: 0 });
    const bar = sensitivity(cap, params, atZero).find((b) => b.key === "discountRate")!;
    expect(bar.baseValue).toBe(0);
    expect(bar.highValue).toBeGreaterThan(0);
    expect(bar.swing).toBeGreaterThan(0);
  });

  it("обычное плечо не зажато и мерится ровно запрошенной долей", () => {
    const bar = sensitivity(cap, params, a).find((b) => b.key === "laborCostPerHourUsd")!;
    expect(bar.clampedLow).toBe(false);
    expect(bar.clampedHigh).toBe(false);
    expect(bar.lowValue).toBeCloseTo(a.laborCostPerHourUsd * 0.75, 9);
    expect(bar.highValue).toBeCloseTo(a.laborCostPerHourUsd * 1.25, 9);
  });
});
