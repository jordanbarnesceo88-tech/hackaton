import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "./types";
import { computeQuantity, coverageOf, demandPerYear, workerOutputPerYear } from "./normalize";
import { resolveTaskFte } from "./task-labour";
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
  if (
    quantity === null ||
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

  // Предел замещения больше НЕ выводится из спроса. Он выводился делением спроса на одно
  // глобальное число на все задачи — 12 500 операций в год, то есть 6 операций в час. Для
  // отбора заказов отраслевой бенчмарк 80–120 в час, для укладки коробок 200–400: допущение
  // занижено в 13–50 раз, и всегда в сторону завышения замещаемого персонала. На пищевом
  // производстве это давало «паллетайзер за $12 143 замещает весь штат комбината» и
  // дисконтированную окупаемость 0,029 года — одиннадцать дней.
  //
  // Теперь занятость называет владелец объекта, а покрытие её масштабирует: парк, который
  // закрывает половину работы, освобождает половину людей. Потолок штата остаётся: заявить
  // больше людей, чем есть на объекте, нельзя.
  const taskFte = resolveTaskFte({
    declared: params.taskStaffing?.[cap.categorySlug],
    demandPerYear: demandPerYear(params, a, cap.workloadStream),
    workerOutputPerYear: cap.workerOutputPerYear,
    staffCount: params.staffCount,
  });
  if (taskFte === null) return null;
  const displacedFte = Math.max(0, Math.min(params.staffCount, taskFte * coverage));
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
  // Два отказа различаются намеренно: вырожденный ввод человек снять не может, а отсутствующую
  // занятость — может, введя число. Слить их в invalid_inputs значило бы оставить его без
  // подсказки, что именно требуется.
  //
  // Условие — ровно «человек может это починить, введя число», а НЕ «resolveTaskFte вернул
  // null». Второе шире: null там означает и «норматива нет», и «спрос вырожден». По второму
  // поводу движок отвечал «введите занятость» на отрицательном opsPerDay — то есть просил
  // человека починить не то, что сломано.
  const declared = params.taskStaffing?.[cap.categorySlug];
  const hasDeclared = typeof declared === "number" && Number.isFinite(declared) && declared >= 0;
  const hasNorm = cap.workerOutputPerYear !== null && cap.workerOutputPerYear > 0;
  const base = baseEconomics(cap, params, a);
  if (base === null) {
    return {
      economical: false,
      reason: !hasDeclared && !hasNorm ? "staffing_required" : "invalid_inputs",
    };
  }

  if (base.annualSavingsUsd <= 0) {
    return { economical: false, reason: "no_savings", ...base };
  }

  const fin = projectFinance(base.annualSavingsUsd, base.capexUsd, a);
  return { economical: true, ...base, ...fin };
}
