import { describe, it, expect } from "vitest";
import { ASSUMPTION_JUSTIFICATIONS } from "../economics/assumption-justifications";
import {
  CHARGE_SOC_MIN_GAP,
  DEFAULT_NORMS,
  NORM_DEFS,
  SCORE_WEIGHT_KEYS,
  isNormKey,
  normDef,
  resolveNorms,
  type NormDef,
} from "./norms";

const defs: readonly NormDef[] = NORM_DEFS;

/** Пары [ключ, описание] для it.each — ключ попадает в имя теста. */
function cases(pred: (d: NormDef) => boolean): [string, NormDef][] {
  return defs.filter(pred).map((d): [string, NormDef] => [d.key, d]);
}

describe("NORM_DEFS: правила происхождения (ТЗ §3.5.1 — без недокументированных коэффициентов)", () => {
  it("ключи уникальны", () => {
    const keys = defs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(cases((d) => ["estimate", "derived", "choice"].includes(d.origin)))(
    "%s: у оценки, расчёта и выбора обоснование не короче 40 символов",
    (_key, d) => {
      expect(d.basis.trim().length).toBeGreaterThanOrEqual(40);
    },
  );

  it.each(cases((d) => d.origin === "derived"))(
    "%s: у расчётного норматива есть формула",
    (_key, d) => {
      expect(d.formula?.trim()).toBeTruthy();
    },
  );

  it.each(cases((d) => d.origin === "research"))(
    "%s: у открытого источника https-ссылка или отсылка к docs/data-provenance.md",
    (_key, d) => {
      const hasUrl = typeof d.sourceUrl === "string" && d.sourceUrl.startsWith("https://");
      expect(hasUrl || d.basis.includes("docs/data-provenance.md")).toBe(true);
    },
  );

  it.each(cases((d) => d.origin === "organizer" || d.origin === "tz"))(
    "%s: у норматива организатора или ТЗ указано, где именно он взят",
    (_key, d) => {
      expect(d.sourceRef?.trim()).toBeTruthy();
    },
  );

  it("у каждого норматива есть подпись, единица и обоснование", () => {
    for (const d of defs) {
      expect(d.label.trim(), d.key).toBeTruthy();
      expect(d.unit.trim(), d.key).toBeTruthy();
      expect(d.basis.trim(), d.key).toBeTruthy();
    }
  });

  it("значение по умолчанию лежит в [min, max], а min ≤ max", () => {
    for (const d of defs) {
      expect(Number.isFinite(d.value), d.key).toBe(true);
      if (d.min !== null) expect(d.value, `${d.key} ≥ min`).toBeGreaterThanOrEqual(d.min);
      if (d.max !== null) expect(d.value, `${d.key} ≤ max`).toBeLessThanOrEqual(d.max);
      if (d.min !== null && d.max !== null) expect(d.min, d.key).toBeLessThanOrEqual(d.max);
    }
  });

  it("веса балла подбора в сумме дают 1", () => {
    const sum =
      DEFAULT_NORMS.scoreWeightEcon +
      DEFAULT_NORMS.scoreWeightData +
      DEFAULT_NORMS.scoreWeightMaturity +
      DEFAULT_NORMS.scoreWeightMargin +
      DEFAULT_NORMS.scoreWeightCases;
    expect(sum).toBeCloseTo(1, 12);
  });

  it("ставка RaaS по умолчанию — медиана четырёх тарифов из формулы", () => {
    const ratios = [100_000 / 2_700_000, 100_000 / 1_900_000, 100_000 / 1_500_000, 120_000 / 2_310_000].sort(
      (a, b) => a - b,
    );
    const median = (ratios[1]! + ratios[2]!) / 2;
    const d = normDef("raasMonthlyPctOfPrice");
    expect(d.value).toBeCloseTo(median, 3);
    expect(d.min).toBeCloseTo(ratios[0]!, 3);
    expect(d.max).toBeCloseTo(ratios[3]!, 3);
  });

  it("ставка дисконтирования обоснована дословно тем же текстом, что в v1", () => {
    // Текст продублирован, а не импортирован в norms.ts, чтобы новая модель не зависела от v1
    // во время выполнения; тест ловит расхождение двух моделей в объяснении одного числа.
    expect(normDef("discountRate").basis).toBe(ASSUMPTION_JUSTIFICATIONS.discountRate.text);
    expect(normDef("discountRate").value).toBe(0.12);
  });

  it("нормативы контрольного примера совпадают с утверждённым планом", () => {
    // Эти значения зашиты в эталон экономики (T1.2): CAPEX 35 420 000, персонал эксплуатации
    // 7 630 657 и т. д. Изменение любого из них — «МЕНЯЕТ ЧИСЛА».
    // toEqual, а не toMatchObject: новый норматив без записи здесь тоже роняет тест.
    expect({ ...DEFAULT_NORMS }).toEqual({
      payrollMultiplier: 1.302,
      utilization: 0.775,
      availability: 1,
      reservePct: 0.175,
      capexReservePct: 0.1,
      batteryReplacementYears: 4,
      batteryCostPctOfPrice: 0.1,
      servicePctOfPriceYear: 0.12,
      repairPctOfPriceYear: 0.02,
      consumablesPctOfPriceYear: 0.01,
      softwareRubPerSite: 1_000_000,
      integrationRubPerSite: 1_250_000,
      commissioningRubPerUnit: 100_000,
      trainingRubPerSite: 150_000,
      chargerRub: 300_000,
      chargerSafetyFactor: 1.5,
      robotsPerChargerDefault: 5,
      chargerPowerKw: 3,
      siteInfraRubPerM2: 150,
      robotAvgPowerKw: 0.4,
      electricityRubPerKwh: 9,
      connectivityRubPerUnitYear: 12_000,
      robotsPerOperatorPost: 20,
      annualHoursPerFte: 1973,
      laborShareAutomatable: 0.5,
      loadedSpeedFactor: 0.8,
      handlingSecJacking: 20,
      handlingSecFork: 45,
      handlingSecTug: 30,
      discountRate: 0.12,
      serviceLifeYearsDefault: 7,
      raasMonthlyPctOfPrice: 0.052,
      paybackBandFastYears: 3,
      paybackBandSlowYears: 5,
      tcoMinYears: 5,
      sensitivityDeltaPct: 0.2,
      simServedShareMin: 0.97,
      simP95WaitMaxMin: 10,
      simOversizedIdleShare: 0.4,
      simWarmupMin: 15,
      simPeakMin: 120,
      chargeStartSoc: 0.2,
      chargeStopSoc: 0.9,
      scoreWeightEcon: 0.4,
      scoreWeightData: 0.2,
      scoreWeightMaturity: 0.15,
      scoreWeightMargin: 0.15,
      scoreWeightCases: 0.1,
    });
  });
});

describe("resolveNorms", () => {
  it("без аргументов возвращает умолчания, но не сам замороженный объект", () => {
    const n = resolveNorms();
    expect(n).toEqual(DEFAULT_NORMS);
    expect(n).not.toBe(DEFAULT_NORMS);
    n.utilization = 0.8;
    expect(DEFAULT_NORMS.utilization).toBe(0.775);
  });

  it("прижимает значение из БД к [min, max]", () => {
    expect(resolveNorms([{ key: "utilization", value: 0.99 }]).utilization).toBe(0.85);
    expect(resolveNorms([{ key: "utilization", value: 0.1 }]).utilization).toBe(0.7);
    expect(resolveNorms([{ key: "payrollMultiplier", value: 1.3 }]).payrollMultiplier).toBe(1.302);
  });

  it("цена зарядной станции прижимается к опубликованному диапазону Ronavi 200–400 тыс. ₽", () => {
    expect(resolveNorms([{ key: "chargerRub", value: -5 }]).chargerRub).toBe(200_000);
    expect(resolveNorms([{ key: "chargerRub", value: 900_000 }]).chargerRub).toBe(400_000);
    expect(resolveNorms([{ key: "chargerRub", value: 360_000 }]).chargerRub).toBe(360_000);
  });

  it("естественная граница не пускает отрицательные суммы, верхней границы нет", () => {
    expect(normDef("trainingRubPerSite").min).toBe(0);
    expect(normDef("trainingRubPerSite").max).toBeNull();
    expect(resolveNorms([{ key: "trainingRubPerSite", value: -5 }]).trainingRubPerSite).toBe(0);
    expect(resolveNorms([{ key: "trainingRubPerSite", value: 5_000_000 }]).trainingRubPerSite).toBe(5_000_000);
    expect(resolveNorms([{ key: "siteInfraRubPerM2", value: -1 }]).siteInfraRubPerM2).toBe(0);
  });

  it("минимальный горизонт TCO нельзя опустить ниже требования ТЗ", () => {
    expect(resolveNorms([{ key: "tcoMinYears", value: 3 }]).tcoMinYears).toBe(5);
  });

  it("строки БД перекрывают код, переопределения — строки БД", () => {
    const n = resolveNorms([{ key: "discountRate", value: 0.15 }], { discountRate: 0.1 });
    expect(n.discountRate).toBe(0.1);
    expect(resolveNorms([{ key: "discountRate", value: 0.15 }]).discountRate).toBe(0.15);
  });

  it("переопределение тоже прижимается к границам", () => {
    expect(resolveNorms(undefined, { reservePct: 0.5 }).reservePct).toBe(0.2);
  });

  it("игнорирует неизвестные ключи и нечисловые значения", () => {
    const n = resolveNorms(
      [
        { key: "unknownNorm", value: 1 },
        { key: "utilization", value: NaN },
        { key: "reservePct", value: Infinity },
      ],
      { discountRate: Number.NaN },
    );
    expect(n).toEqual(DEFAULT_NORMS);
    expect(Object.keys(n)).not.toContain("unknownNorm");
  });
});

describe("resolveNorms: взаимные ограничения", () => {
  const weightSum = (n: Record<(typeof SCORE_WEIGHT_KEYS)[number], number>) =>
    SCORE_WEIGHT_KEYS.reduce((acc, key) => acc + n[key], 0);

  it("умолчания уже согласованы: проход ограничений их не меняет ни в одном знаке", () => {
    expect(DEFAULT_NORMS.paybackBandSlowYears).toBeGreaterThanOrEqual(DEFAULT_NORMS.paybackBandFastYears);
    expect(DEFAULT_NORMS.chargeStopSoc).toBeGreaterThanOrEqual(
      DEFAULT_NORMS.chargeStartSoc + CHARGE_SOC_MIN_GAP,
    );
    const n = resolveNorms();
    for (const key of SCORE_WEIGHT_KEYS) expect(n[key], key).toBe(DEFAULT_NORMS[key]);
  });

  it("после правки веса администратором сумма весов снова равна 1, пропорции сохраняются", () => {
    const n = resolveNorms([{ key: "scoreWeightEcon", value: 1 }]);
    expect(weightSum(n)).toBeCloseTo(1, 12);
    // Сумма до нормировки: 1 + 0,2 + 0,15 + 0,15 + 0,1 = 1,6.
    expect(n.scoreWeightEcon).toBeCloseTo(1 / 1.6, 12);
    expect(n.scoreWeightData).toBeCloseTo(0.2 / 1.6, 12);
    expect(n.scoreWeightCases).toBeCloseTo(0.1 / 1.6, 12);
    for (const key of SCORE_WEIGHT_KEYS) {
      expect(n[key], key).toBeGreaterThanOrEqual(0);
      expect(n[key], key).toBeLessThanOrEqual(1);
    }
  });

  it("сумма весов меньше 1 тоже нормируется (переопределение сценария)", () => {
    const n = resolveNorms(undefined, { scoreWeightEcon: 0, scoreWeightData: 0.1 });
    expect(weightSum(n)).toBeCloseTo(1, 12);
    expect(n.scoreWeightEcon).toBe(0);
  });

  it("если все веса обнулены, берутся веса по умолчанию", () => {
    const n = resolveNorms(SCORE_WEIGHT_KEYS.map((key) => ({ key, value: 0 })));
    for (const key of SCORE_WEIGHT_KEYS) expect(n[key], key).toBe(DEFAULT_NORMS[key]);
    expect(weightSum(n)).toBeCloseTo(1, 12);
  });

  it("перевёрнутые пороги заряда: возврат поднимается до порога ухода + 5 п.п.", () => {
    const n = resolveNorms([
      { key: "chargeStartSoc", value: 0.9 },
      { key: "chargeStopSoc", value: 0.1 },
    ]);
    expect(n.chargeStartSoc).toBe(0.9);
    expect(n.chargeStopSoc).toBe(0.95);
  });

  it("порог возврата вплотную к порогу ухода тоже поднимается, без хвоста двоичной арифметики", () => {
    const n = resolveNorms(undefined, { chargeStartSoc: 0.1, chargeStopSoc: 0.12 });
    expect(n.chargeStopSoc).toBe(0.15);
  });

  it("порог ухода на верхней границе 0,95 даёт возврат ровно при 100 %", () => {
    const n = resolveNorms(undefined, { chargeStartSoc: 0.99, chargeStopSoc: 0.5 });
    expect(n.chargeStartSoc).toBe(0.95);
    expect(n.chargeStopSoc).toBe(1);
  });

  it("достаточный зазор порогов заряда не трогается", () => {
    const n = resolveNorms(undefined, { chargeStartSoc: 0.3, chargeStopSoc: 0.8 });
    expect(n.chargeStartSoc).toBe(0.3);
    expect(n.chargeStopSoc).toBe(0.8);
  });

  it("перевёрнутые интервалы окупаемости: «долгая» граница поднимается до «быстрой»", () => {
    const n = resolveNorms([
      { key: "paybackBandFastYears", value: 8 },
      { key: "paybackBandSlowYears", value: 5 },
    ]);
    expect(n.paybackBandFastYears).toBe(8);
    expect(n.paybackBandSlowYears).toBe(8);
  });

  it("согласованные интервалы окупаемости не трогаются", () => {
    const n = resolveNorms(undefined, { paybackBandFastYears: 2, paybackBandSlowYears: 6 });
    expect(n.paybackBandFastYears).toBe(2);
    expect(n.paybackBandSlowYears).toBe(6);
  });
});

describe("normDef и isNormKey", () => {
  it("возвращают описание известного норматива", () => {
    expect(normDef("utilization").origin).toBe("organizer");
    expect(isNormKey("utilization")).toBe(true);
    expect(isNormKey("nope")).toBe(false);
  });
});
