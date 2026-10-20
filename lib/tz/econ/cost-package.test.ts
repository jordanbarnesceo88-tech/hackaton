import { describe, expect, it } from "vitest";
import { DEFAULT_NORMS } from "../norms";
import type { CostPackage, ScenarioItem, ScenarioOk, ScenarioSpec } from "../types";
import { computeScenariosCore } from "./core";
import { costPackageForItem, costPackageRepairIncluded, costPackageWarnings, parseCostPackage } from "./cost-package";
import { FIXTURE_H1500, fixtureContext, fixtureSpecs } from "./fixtures";

const packageInput: CostPackage = { softwareIncludedInIntegration: true, repairsIncludedInService: true, includedChargers: 1, reason: "Условие предложения: лицензия в интеграции, ремонт в сервисе и одна комплектная станция" };

function purchase(item: Partial<ScenarioItem> = {}): ScenarioSpec {
  return { key: "package", name: "Проверка состава поставки", kind: "purchase", items: [{ process: "pallet-transport", productSlug: FIXTURE_H1500.slug, quantityOverride: 10, chargersOverride: 2, ...item }] };
}
function calculate(spec: ScenarioSpec): ScenarioOk {
  const result = computeScenariosCore(fixtureContext(20), [spec])[0];
  if (!result || result.status !== "ok") throw new Error(`Ожидался расчёт: ${JSON.stringify(result)}`);
  return result;
}
function amount(result: ScenarioOk, key: string, group: "capex" | "opex" = "capex") {
  const row = (group === "capex" ? result.capexLines : result.opexLines).find(r => r.key === key);
  if (!row) throw new Error(`Нет статьи ${key}`);
  return row.valueRub;
}

describe("явный состав ценового пакета позиции", () => {
  it("без пакета сохраняет исходные статьи, а явное раздельное начисление ничего не обнуляет", () => {
    const legacy = calculate(purchase());
    const separate = calculate(purchase({ costPackage: { softwareIncludedInIntegration: false, repairsIncludedInService: false, includedChargers: 0, reason: "Все статьи оплачиваются отдельно" } }));
    expect(separate.capexLines).toEqual(legacy.capexLines);
    expect(separate.opexLines).toEqual(legacy.opexLines);
    expect(legacy.capexRub).toBe(35_750_000);
    expect(amount(legacy, "software")).toBe(1_000_000);
    expect(amount(legacy, "chargers")).toBe(600_000);
    expect(amount(legacy, "repair", "opex")).toBe(540_000);
  });

  it("считает только одну дополнительную станцию из двух, не умножая включённую станцию на N", () => {
    const spec = purchase({ costPackage: packageInput });
    const original = structuredClone(spec);
    const base = calculate(purchase());
    const result = calculate(spec);
    expect(result.items[0]?.chargers).toBe(2);
    expect(amount(result, "chargers")).toBe(300_000);
    expect(amount(result, "software")).toBe(0);
    expect(amount(result, "integration")).toBe(amount(base, "integration"));
    expect(amount(base, "reserve") - amount(result, "reserve")).toBe(130_000);
    expect(base.capexRub - result.capexRub).toBe(1_430_000);
    expect(result.capexLines.find(r => r.key === "software")?.originNote).toContain(packageInput.reason);
    expect(result.capexLines.find(r => r.key === "chargers")?.substituted).toContain("2 требуется − 1 включено");
    expect(spec).toEqual(original);
  });

  it("весь требуемый комплект зарядок даёт нулевую дополнительную закупку и корректный резерв", () => {
    const base = calculate(purchase());
    const result = calculate(purchase({ costPackage: { ...packageInput, includedChargers: 2 } }));
    expect(amount(result, "chargers")).toBe(0);
    expect(base.capexRub - result.capexRub).toBe(1_760_000);
    expect(amount(base, "reserve") - amount(result, "reserve")).toBe(160_000);
  });

  it("не переносит общий ориентир производителя в автоматическое включение", () => {
    const legacy = calculate(purchase());
    const warnings = costPackageWarnings(FIXTURE_H1500, {}, DEFAULT_NORMS);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toContain("не подтверждённый двойной счёт");
    expect(amount(legacy, "software")).toBe(1_000_000);
    expect(amount(legacy, "repair", "opex")).toBe(540_000);
    expect(costPackageWarnings(FIXTURE_H1500, { costPackage: packageInput }, DEFAULT_NORMS)).toEqual([]);
  });

  it("отклоняет пакет с избытком включённых станций вместо скрытого обрезания", () => {
    const spec = purchase({ costPackage: { ...packageInput, includedChargers: 3 } });
    const result = computeScenariosCore(fixtureContext(20), [spec])[0];
    expect(result?.status).toBe("refused");
    if (result?.status === "refused") expect(result.refusal.message).toContain("требуется 2");
    expect(() => costPackageForItem(spec.items[0]!, { kind: "purchase", chargers: 2 })).toThrow("требуется 2");
  });

  it("не игнорирует пакет покупки в сценарии RaaS", () => {
    const result = computeScenariosCore(fixtureContext(20), [{ ...purchase({ costPackage: packageInput }), kind: "raas" }])[0];
    expect(result?.status).toBe("refused");
  });

  it("ремонт включён только при явно оплачиваемом сервисе", () => {
    expect(costPackageRepairIncluded({}, 300_000)).toBe(false);
    expect(costPackageRepairIncluded({ costPackage: packageInput }, 300_000)).toBe(true);
    expect(() => costPackageRepairIncluded({ costPackage: packageInput }, 0)).toThrow("без положительной стоимости сервиса");
    expect(() => costPackageRepairIncluded({ costPackage: packageInput }, Number.NaN)).toThrow();
  });

  it("полный денежный расчёт убирает только отдельный ремонт, сохраняя сервис, FTE и АКБ", () => {
    const base = calculate(purchase());
    const result = calculate(purchase({ costPackage: packageInput }));
    expect(amount(result, "repair", "opex")).toBe(0);
    expect(amount(result, "service", "opex")).toBe(amount(base, "service", "opex"));
    expect(base.opexYearRub - result.opexYearRub).toBe(540_000);
    expect(result.effectYearRub - base.effectYearRub).toBe(540_000);
    expect(result.items[0]?.releasedFte).toBe(base.items[0]?.releasedFte);
    expect(result.cashflows.map(row => row.batteryRub)).toEqual(base.cashflows.map(row => row.batteryRub));
    const refused = computeScenariosCore(fixtureContext(20), [purchase({ costPackage: packageInput, serviceRubYearOverride: 0 })])[0];
    expect(refused?.status).toBe("refused");
    if (refused?.status === "refused") expect(refused.refusal.message).toContain("без положительной стоимости сервиса");
    expect(calculate(purchase({ costPackage: { ...packageInput, repairsIncludedInService: false }, serviceRubYearOverride: 0 })).status).toBe("ok");
  });

  it.each([
    null,
    {},
    { ...packageInput, softwareIncludedInIntegration: "true" },
    { ...packageInput, repairsIncludedInService: null },
    { ...packageInput, includedChargers: -1 },
    { ...packageInput, includedChargers: 0.5 },
    { ...packageInput, includedChargers: Number.POSITIVE_INFINITY },
    { ...packageInput, includedChargers: 2001 },
    { ...packageInput, reason: "  " },
    { ...packageInput, reason: "x".repeat(1001) },
    { ...packageInput, extra: true },
  ])("не ремонтирует неизвестные или некорректные условия пакета: %j", value => {
    expect(() => parseCostPackage(value)).toThrow();
  });

  it("нормализует только основание и не меняет входной объект", () => {
    const input = { ...packageInput, reason: "  договор №1  " };
    expect(parseCostPackage(input)).toEqual({ ...packageInput, reason: "договор №1" });
    expect(input.reason).toBe("  договор №1  ");
    expect(fixtureSpecs()[1]?.items[0]?.costPackage).toBeUndefined();
  });
  it("supports a finite startup package, monthly per-robot/site platform and included docks as N changes", () => {
    const priceScope: CostPackage = { ...packageInput, includedChargers: 0, allChargersIncluded: true,
      startup: { mode: "separate", amountRub: 80000, basis: "per-site" }, platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-robot" } };
    const before = structuredClone(priceScope);
    for (const fleet of [1, 3]) {
      const result = calculate(purchase({ quantityOverride: fleet, chargersOverride: fleet, costPackage: priceScope }));
      expect(amount(result, "equipment")).toBe(fleet * 2700000);
      expect(amount(result, "chargers")).toBe(0);
      expect(amount(result, "startup")).toBe(80000);
      expect(result.capexLines.some(row => ["integration", "commissioning", "training"].includes(row.key))).toBe(false);
      expect(amount(result, "licences", "opex")).toBe(12 * 12200 * fleet);
      expect(result.cashflows[1]!.opexRub).toBeCloseTo(result.opexYearRub - amount(result, "battery", "opex"));
      const site = calculate(purchase({ quantityOverride: fleet, chargersOverride: fleet, costPackage: { ...priceScope, platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-site" } } }));
      expect(amount(site, "licences", "opex")).toBe(146400);
    }
    expect(priceScope).toEqual(before);
    expect(parseCostPackage(priceScope)).toEqual(priceScope);
    expect(() => parseCostPackage({ ...priceScope, includedChargers: 1 })).toThrow(/две базы/);
    expect(() => parseCostPackage({ ...priceScope, platformMonthly: { mode: "included", amountRub: 999 } })).toThrow();
    for (const field of ["startup", "platformMonthly"] as const) {
      const refused = computeScenariosCore(fixtureContext(), [purchase({ costPackage: { ...priceScope, [field]: { mode: "unassessed" } } })])[0]!;
      expect(refused.status).toBe("refused");
    }
  });
});
