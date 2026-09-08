import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity, coverageOf, demandPerYear, workerOutputPerYear } from "./normalize";
import { projectFinance } from "./finance";

export type BaseEconomics = {
  quantity: number;
  displacedFte: number;
  capexUsd: number;
  opexAnnualUsd: number;
  baselineAnnualUsd: number;
  annualSavingsUsd: number;
};

/**
 * Shared core: quantity + capex/opex + A1/A2 savings, with all invalid_inputs guards. Returns
 * null for degenerate inputs. Used by computeEconomics and by the sensitivity engine.
 */
export function baseEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): BaseEconomics | null {
  const computedQuantity = computeQuantity(cap, params, a);

  // Переопределение принимается только целым и положительным: двух с половиной роботов не
  // бывает, а молча округлять чужой ввод — значит показать число, которого человек не вводил.
  // Негодное значение игнорируется, а не роняет расчёт: это ввод, а не поломка.
  const override = params.quantityOverride;
  const quantityOverridden =
    typeof override === "number" && Number.isInteger(override) && override >= 1;
  const quantity = quantityOverridden ? override : computedQuantity;
  // Делитель предела замещения зависит от потока, поэтому проверяется тот, который реально
  // используется. Общая проверка opsPerWorkerPerYear роняла бы решение потока площади в
  // invalid_inputs из-за допущения, которого оно не касается.
  const perWorker = workerOutputPerYear(a, cap.workloadStream);
  if (
    quantity === null ||
    !(perWorker > 0) ||
    !(a.roiHorizonYears >= 1) ||
    !(a.assetLifeYears >= 1) ||
    !(a.discountRate > -1)
  ) {
    return null;
  }

  // Покрытие: какую долю работы объекта закрывает этот парк. При расчётном количестве оно
  // равно единице, и всё ниже вырождается в прежнюю формулу — числа без переопределения не
  // меняются ни на знак.
  const coverage = coverageOf(cap, params, a, quantity);
  if (coverage === null) return null;

  const annualLaborCostPerFteUsd = a.laborCostPerHourUsd * a.hoursPerYear;
  // A1 не переделан — он всё это время работал исправно и получал не ту нагрузку. Спрос и
  // делитель теперь берутся по потоку решения, и абсурд («уборщик замещает сорок кладовщиков»)
  // исчезает сам, без отдельного запрета.
  const maxDisplaceableFte =
    (demandPerYear(params, a, cap.workloadStream) * coverage) / perWorker;
  const displacedFte = Math.max(0, Math.min(params.staffCount, maxDisplaceableFte));
  const baselineAnnualUsd = displacedFte * annualLaborCostPerFteUsd;

  // Цена за единицу переопределяется отдельно и меняет ТОЛЬКО CAPEX: сколько стоит машина и
  // сколько работы она делает — разные утверждения, и цена не должна двигать второе.
  const priceOverride = params.capexPerUnitUsdOverride;
  const priceUsd =
    typeof priceOverride === "number" && Number.isFinite(priceOverride) && priceOverride > 0
      ? priceOverride
      : cap.priceUsd;
  const capexUsd = quantity * priceUsd * (1 + a.installPctOfCapex);
  const opexAnnualUsd =
    quantity *
    (cap.maintenanceUsdYear + cap.energyUsdYear * a.energyCostFactor + cap.licensingUsdYear);
  const annualSavingsUsd =
    baselineAnnualUsd * a.laborReplacementPct * (1 - a.residualSupervisionPct) - opexAnnualUsd;

  const finite =
    Number.isFinite(displacedFte) &&
    Number.isFinite(capexUsd) &&
    Number.isFinite(opexAnnualUsd) &&
    Number.isFinite(baselineAnnualUsd) &&
    Number.isFinite(annualSavingsUsd);
  if (!finite || capexUsd <= 0) return null;

  return { quantity, displacedFte, capexUsd, opexAnnualUsd, baselineAnnualUsd, annualSavingsUsd };
}

export function computeEconomics(
  cap: SolutionCapacity,
  params: FacilityParams,
  a: AssumptionValues
): EconomicsResult {
  const base = baseEconomics(cap, params, a);
  if (base === null) return { economical: false, reason: "invalid_inputs" };

  if (base.annualSavingsUsd <= 0) {
    return { economical: false, reason: "no_savings", ...base };
  }

  const fin = projectFinance(base.annualSavingsUsd, base.capexUsd, a);
  return { economical: true, ...base, ...fin };
}
