import { cleaningWorkingProfile } from "../data/cleaning-assumptions";
import { DEFAULT_PAYROLL_DRAFT, parsePayrollDraft } from "../tz/payroll-breakdown";
import { DEFAULT_NORMS } from "../tz/norms";
import type { ParamValues, ProductForCalc, ScenarioSpec } from "../tz/types";

export const CLEANING_EXAMPLE_ASSUMPTION = "Учебная уборка склада: 8 000 м² кафеля один раз в день, 8 сотрудников, 300 рабочих дней в году. Штатный ФОТ по примеру команды: 4 500 ₽ на руки за смену × 26 оплачиваемых смен в месяц, без наценки подрядчика. Профиль CC1: 550 м²/активный ч, работа/зарядка 2/2 ч, окно 8 ч, уход 15 мин. Роботизируется 50% труда; денежная реализация высвобождения — 100%, это изменяемое допущение. Покупка — 2 790 000 ₽ с НДС и доком; сервис — 112 000 ₽/год. RaaS — 250 000 ₽ первый месяц, затем 185 000 ₽; платформа 12 200 ₽/мес за робота и запуск 80 000 ₽ за объект приняты отдельными платежами. Расходники, ремонт и АКБ — оценки по общим нормативам, не цены поставщика; срок службы 3 года — оценка. Если запуск уже входит в повышенный первый месяц, исключите его отдельную оплату. Условия продления аренды приняты неизменными. Это рабочие данные команды от 19–20.10.2026, не гарантированный результат объекта.";

/** The editable scenario records every quoted or estimated input; catalogue facts stay unchanged. */
export function warehouseCleaningInputs(defaults: ParamValues, products: readonly ProductForCalc[]) {
  if (!products.some(product => product.slug === "pudu-cc1")) throw new Error("Для примера уборки нужен PUDU CC1 в действующем каталоге");
  const payroll = parsePayrollDraft({ ...DEFAULT_PAYROLL_DRAFT, contractor: false });
  if (!payroll.ok) throw new Error("Некорректный исходный пример ФОТ");
  const priceRub = 2_790_000;
  const source = "Рабочий пример по бэклогу команды от 19–20.10.2026: цены с НДС, док в комплекте; платформа и запуск отдельно — допущение. Расходники, ремонт и АКБ оценены по общим нормативам, а не по КП. Измените состав по вашему предложению.";
  const cleaningProfile = cleaningWorkingProfile("pudu-cc1")!;
  const params: ParamValues = { ...defaults, totalAreaM2: 10000, activeAreaM2: 8000,
    cleaningAreaM2: 8000, cleaningsPerDay: 1, cleanersCount: 8, workDaysPerYear: 300,
    cleanerSalaryRubMonth: payroll.breakdown.grossSalaryRubMonth, payrollTaxMultiplier: payroll.breakdown.payrollMultiplier };
  const common = {
    cashRealizationShare: 1,
    terminalResidualRub: 0,
    normOverrides: { serviceLifeYearsDefault: 3, batteryReplacementYears: 3 },
  };
  const scenarios: ScenarioSpec[] = [
    { key: "asis", name: "Как есть — уборка склада", kind: "asis", items: [] },
    { ...common, key: "purchase", name: "Покупка — PUDU CC1", kind: "purchase", items: [{
      process: "cleaning", productSlug: "pudu-cc1", cleaningProfile: structuredClone(cleaningProfile), priceRubOverride: priceRub, serviceRubYearOverride: 112000,
      costPackage: { softwareIncludedInIntegration: true, repairsIncludedInService: false, includedChargers: 0, allChargersIncluded: true,
        startup: { mode: "separate", amountRub: 80000, basis: "per-site" },
        platformMonthly: { mode: "separate", amountRub: 12200, basis: "per-robot" }, reason: source },
    }] },
    { ...common, key: "raas", name: "RaaS — PUDU CC1", kind: "raas", items: [{
      process: "cleaning", productSlug: "pudu-cc1", cleaningProfile: structuredClone(cleaningProfile), raasRubMonthOverride: 185000,
      raasPackage: { firstMonthRub: 250000, startup: { mode: "separate", amountRub: 80000, basis: "per-site" },
        platform: { mode: "separate", amountRub: 12200, basis: "per-robot" }, service: { mode: "included" },
        consumables: { mode: "separate", amountRub: priceRub * DEFAULT_NORMS.consumablesPctOfPriceYear, basis: "per-robot" },
        repair: { mode: "separate", amountRub: priceRub * DEFAULT_NORMS.repairPctOfPriceYear, basis: "per-robot" },
        battery: { mode: "separate", amountRub: priceRub * DEFAULT_NORMS.batteryCostPctOfPrice, basis: "per-robot", everyYears: 3 }, reason: source },
    }] },
  ];
  return { params, scenarios, assumption: CLEANING_EXAMPLE_ASSUMPTION };
}
