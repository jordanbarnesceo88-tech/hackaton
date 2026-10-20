import { pluralRu } from "../../format/plural";
import { LABOR_SHARE_SENSITIVITY_RANGE, normDef } from "../norms";
import type { ItemResult, ProductForCalc, Risk, ScenarioItem, ScenarioResult, ScenarioSpec, SensitivityRow } from "../types";
import { FACILITY_PARAM_KEYS, normsForSpec, optNum, type ScenarioContext } from "./context";
import { costPackageWarnings } from "./cost-package";
import { raasPackageDescription } from "./raas-package";
import { cleaningProfileDescription } from "./cleaning-profile";
import { deploymentLogisticsText } from "../deployment-logistics";
import { baseOutsideSourceRange } from "./sensitivity";
import { fx, mrub, q, rangeText, rub, share, unitShort } from "./text";

/**
 * Риски сценария (ТЗ §3.5.7: рекомендация — не только число, но и риски с интерпретацией).
 * Каждое правило — код, важность и текст по-русски с числами. Риски имитации (SIM_*)
 * добавляет сборка модели проекта (T2.2), когда есть результат имитации.
 */

const SEVERITY_ORDER: Readonly<Record<Risk["severity"], number>> = { high: 0, medium: 1, low: 2 };

/** Сортирует риски по важности (порядок внутри одной важности сохраняется). */
export function sortRisks(risks: readonly Risk[]): Risk[] {
  return risks
    .map((r, i) => ({ r, i }))
    .sort((a, b) => SEVERITY_ORDER[a.r.severity] - SEVERITY_ORDER[b.r.severity] || a.i - b.i)
    .map(({ r }) => r);
}

/** Порог «слишком большая доля CAPEX из оценок», доля. */
export const ESTIMATE_SHARE_LIMIT = 0.3;

/** Порог расхождения паспортной нормы и цикла, раз. */
export const NORM_VS_CYCLE_RATIO = 1.5;

/** Порог полноты карточки продукта, %. */
export const LOW_COMPLETENESS_PCT = 60;

/** «Да» в параметре наличия системы (у организатора «Да » с пробелом). */
function isYes(v: number | string | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v !== 0;
  const s = v.trim().toLowerCase();
  if (s === "") return null;
  return s.startsWith("да") || s === "yes" || s === "true" || s === "1";
}

type ItemView = { spec?: ScenarioItem; result?: ItemResult; product?: ProductForCalc; name: string };

function itemViews(ctx: ScenarioContext, result: ScenarioResult, spec?: ScenarioSpec): ItemView[] {
  const specItems = spec?.items ?? [];
  if (specItems.length > 0) {
    return specItems.map((it) => {
      const product = ctx.products[it.productSlug];
      return {
        spec: it,
        result: result.items.find((r) => r.process === it.process),
        product,
        name: product?.name ?? it.productSlug,
      };
    });
  }
  return result.items.map((r) => ({ result: r, product: ctx.products[r.productSlug], name: r.productName }));
}

/**
 * Риски сценария. `sensitivity` — строки чувствительности (для SIGN_FLIP); `spec` — описание
 * сценария (ручное добавление, оценка ставки RaaS, ручная цена). Для «Как есть» рисков нет.
 */
export function scenarioRisks(
  ctx: ScenarioContext,
  result: ScenarioResult,
  sensitivity: readonly SensitivityRow[],
  spec?: ScenarioSpec,
): Risk[] {
  if (result.kind === "asis") return [];
  const risks: Risk[] = [];
  const add = (code: string, severity: Risk["severity"], text: string) => {
    if (!risks.some((r) => r.code === code && r.text === text)) risks.push({ code, severity, text });
  };
  const norms = spec ? normsForSpec(ctx, spec) : ctx.norms;
  const views = itemViews(ctx, result, spec);
  const ok = result.status === "ok" ? result : null;
  add(spec?.logistics ? "LOGISTICS_ASSUMPTION" : "LOGISTICS_NOT_ASSESSED", "medium", deploymentLogisticsText(spec?.logistics));
  if (ok?.operationsStaffing) {
    const staffing = ok.operationsStaffing;
    add("OPERATIONS_STAFFING_ASSUMPTION", "medium", `Дополнительные расходы на эксплуатационный персонал площадки: ${rub(staffing.annualCostRub)} в год, режим ${staffing.mode}. Основание: ${staffing.reason}. ${staffing.includedInService ? "Включение в оплачиваемый сервис — допущение, не подтверждённое договором; проверьте состав услуг" : "Оценка дополнительных расходов, не полная стоимость существующего сотрудника; подтвердите фактическую нагрузку и оплату"}`);
  }
  if (spec?.cashRealizationShare !== undefined) {
    add("CASH_REALIZATION_ASSUMPTION", "medium", `Денежная реализация высвобождаемого ФОТ принята ${share(spec.cashRealizationShare)}: это оценочное допущение, а не автоматическое сокращение штата; высвобождаемая трудоёмкость считается отдельно`);
  }
  if ((spec?.terminalResidualRub ?? 0) > 0) {
    add("RESIDUAL_VALUE_ASSUMPTION", ok && spec!.terminalResidualRub! > ok.capexRub ? "high" : "medium", `Остаточная стоимость ${rub(spec!.terminalResidualRub!)} принята как чистое поступление от собственных активов после ${ok?.tcoYears ?? "периода TCO"} лет. Это ручная оценка после налогов, демонтажа и вывоза; цена продажи не подтверждена${ok && spec!.terminalResidualRub! > ok.capexRub ? "; оценка выше исходного CAPEX — проверьте её обоснование" : ""}`);
  }

  for (const v of views) {
    if (v.spec?.automationCoverageOverride !== undefined) {
      add("ANNUAL_COVERAGE_ASSUMPTION", "medium", `Годовой охват ${q(v.name)} ограничен оценкой ${share(v.spec.automationCoverageOverride)} и аналитической мощностью парка; короткий 3D-прогон не доказывает годовой охват`);
    }
    const p = v.product;
    if (v.spec?.cleaningProfile) {
      let text = "Некорректный эксплуатационный профиль уборки — см. причину отказа";
      try { text = cleaningProfileDescription(v.spec.cleaningProfile); } catch { /* Refused input must not crash risk presentation. */ }
      add("CLEANING_PROFILE_ASSUMPTION", "medium", `${text} Ежедневный уход уменьшает высвобождаемый труд существующих уборщиков один раз; дополнительные расходы эксплуатации задаются отдельно. Это финансовая оценка, не подтверждение 2D/3D или успешного пилота.`);
    }
    if (result.kind === "raas") {
      let scopeText = "Некорректный состав услуги RaaS — см. причину отказа расчёта";
      if (v.spec?.raasPackage) {
        try { scopeText = raasPackageDescription(v.spec.raasPackage); } catch { /* Invalid input remains a refusal, never a fabricated scope. */ }
      }
      add(v.spec?.raasPackage ? "RAAS_PACKAGE_ASSUMPTION" : "RAAS_PACKAGE_UNCONFIRMED", "medium", v.spec?.raasPackage
        ? `${q(v.name)}: ${scopeText}. Оборудование, зарядки, разовое ПО и инфраструктура пока приняты включёнными по прежнему допущению модели — подтвердите отдельно`
        : `${q(v.name)}: состав RaaS не задан. Прежняя модель предполагает включение ТО, лицензий, расходников, ремонта, АКБ, оборудования, зарядок, пусконаладки и инфраструктуры в подписку; это неподтверждённое допущение, не условие договора. Первый месяц принят равным регулярному; отдельная плата за платформу не оценена. Задайте явный состав услуг`);
    }
    if (result.kind === "purchase" && p && v.spec) {
      for (const warning of costPackageWarnings(p, v.spec, norms)) add("COST_PACKAGE_SCOPE_UNCONFIRMED", "medium", `${q(v.name)}: ${warning}`);
    }
    const r = v.result;
    if (r?.thrEvidence) add(r.thrEvidence.applied ? "FIELD_OBSERVATION_APPLIED" : "FIELD_OBSERVATION_NOT_APPLIED", r.thrEvidence.applied ? "low" : "medium", `${q(v.name)}: ${r.thrEvidence.reason}${r.thrEvidence.applied ? " Наблюдение ограничивает расчётную выработку; это не подтверждение других объектов или режимов." : " Полевой факт не подтверждает этот расчёт; исходный паспорт или цикл остаётся модельным допущением."}`);
    const process = r ? ctx.processes[r.process] : v.spec ? ctx.processes[v.spec.process] : undefined;
    const unit = unitShort(process?.throughputUnit ?? "ед./ч");

    if (v.spec?.manuallyAdded) {
      const reason = v.spec.manualReason ?? p?.excludedReason ?? null;
      add("MANUAL_ADD", "high", `${q(v.name)} добавлен вручную, хотя подбор его исключил${reason ? `: ${reason}` : ""}`);
    }
    if (r && r.thrSource === "цикл" && r.thrNorm !== null && r.thrCycle !== null && r.thrNorm > NORM_VS_CYCLE_RATIO * r.thrCycle) {
      const k = r.thrNorm / r.thrCycle;
      const leg = r.routeLoadedM !== null ? `при плече ≈${fx(r.routeLoadedM, 0)} м` : "при плече по планировке";
      add(
        "NORM_VS_CYCLE",
        "high",
        `Паспортная норма ${fx(r.thrNorm)} ${unit} в ${fx(k, 1)} раза выше расчётной по циклу на вашем объекте (${fx(r.thrCycle, 1)} ${unit} ${leg}, оценка по планировке); принято меньшее значение`,
      );
    }
    if (p && result.kind === "raas" && v.spec?.raasFromEstimate) {
      const rate = v.spec.raasRubMonthOverride;
      add(
        "RAAS_ESTIMATE",
        "high",
        `Ставка RaaS ${q(v.name)} — оценка ${share(norms.raasMonthlyPctOfPrice)} цены в месяц${rate !== undefined ? ` (${rub(rate)}/мес)` : ""}, а не тариф производителя: запросите коммерческое предложение`,
      );
    }
    if (p && result.kind === "purchase" && v.spec?.priceRubOverride === undefined && p.priceRub !== null && !p.priceConfirmed) {
      add(
        "PRICE_UNCONFIRMED",
        "medium",
        `Цена ${q(v.name)} ${rub(p.priceRub)} не подтверждена производителем — уточните её по коммерческому предложению`,
      );
    }
    if (p && r && r.thrSource === "норма" && r.thrEff !== null && !p.throughputConfirmed) {
      add(
        "THROUGHPUT_UNCONFIRMED",
        "medium",
        `Производительность ${q(v.name)} ${fx(r.thrEff)} ${unit} взята из паспортных данных и не подтверждена производителем — проверьте её имитацией или на пилоте`,
      );
    }
    if (p && result.kind === "raas" && v.spec?.raasRubMonthOverride === undefined && p.raasQualifier === "от" && p.raasRubMonth !== null) {
      add(
        "RAAS_LOWER_BOUND",
        "medium",
        `Ставка RaaS — нижняя граница «от»: ${rub(p.raasRubMonth)}/мес за робота ${q(v.name)}; фактическая ставка может быть выше`,
      );
    }
    if (p && p.status === "piloting") {
      add("PILOTING", "medium", `${q(v.name)} в пилотной эксплуатации — серийных внедрений мало, характеристики могут измениться`);
    }
    if (p && p.completenessPct < LOW_COMPLETENESS_PCT) {
      add(
        "LOW_COMPLETENESS",
        "medium",
        `Полнота карточки ${q(v.name)} ${fx(p.completenessPct, 0)} % (меньше ${LOW_COMPLETENESS_PCT} %) — часть характеристик не опубликована, результат требует проверки`,
      );
    }
  }

  if (ok && result.kind === "raas") {
    add("RAAS_ROI_UNINFORMATIVE", "low", "ROI неинформативен при малом CAPEX — сравнивайте NPV и TCO");
  }

  if (ok) {
    if (ok.capexRub > 0) {
      const estimate = ok.capexLines.filter((l) => l.origin === "estimate").reduce((a, l) => a + l.valueRub, 0);
      const s = estimate / ok.capexRub;
      if (s > ESTIMATE_SHARE_LIMIT) {
        const labels = ok.capexLines.filter((l) => l.origin === "estimate" && l.valueRub > 0).map((l) => l.label);
        add(
          "ESTIMATE_SHARE",
          "medium",
          `${fx(s * 100, 0)} % CAPEX (${rub(estimate)}) — оценки без опубликованного источника: уточните статьи ${labels.map(q).join(", ")}`,
        );
      }
    }
    for (const row of sensitivity) {
      if (!row.signFlip || row.npvLow === null || row.npvHigh === null) continue;
      const outside = baseOutsideSourceRange(row)
        ? ` (текущее значение вне ${row.boundsSource === "организатор" ? "типового диапазона" : "диапазона норматива"} — диапазон расширен до него)`
        : "";
      add(
        "SIGN_FLIP",
        "medium",
        `NPV меняет знак в пределах диапазона ${q(row.label)} ${rangeText(row.low, row.high, row.unit)}${outside}: от ${mrub(row.npvLow)} до ${mrub(row.npvHigh)}`,
      );
    }
    const budget = optNum(ctx.params, FACILITY_PARAM_KEYS.capexBudgetMRub);
    if (budget !== null && budget > 0 && ok.capexRub > budget * 1_000_000) {
      add("CAPEX_OVER_BUDGET", "medium", `CAPEX ${mrub(ok.capexRub)} превышает планируемый бюджет ${fx(budget)} млн ₽`);
    }
  }

  const wms = isYes(ctx.params[FACILITY_PARAM_KEYS.hasWms]);
  if (wms === false) {
    add(
      "NO_WMS",
      "medium",
      "На объекте нет WMS — интеграция парка с учётной системой потребует доработки сверх типовой статьи «Интеграция с WMS/ERP»",
    );
  }
  const floors = optNum(ctx.params, FACILITY_PARAM_KEYS.floorsCount);
  if (floors !== null && floors > 1 && views.some((v) => v.product?.mobile)) {
    const n = Math.round(floors);
    add("MULTI_FLOOR", "medium", `Объект в ${n} ${pluralRu(n, ["этаж", "этажа", "этажей"])} — лифты и межэтажный транспорт в CAPEX не включены`);
  }
  const power =
    optNum(ctx.params, FACILITY_PARAM_KEYS.availablePowerKw) ?? optNum(ctx.params, FACILITY_PARAM_KEYS.chargingPowerKw);
  const chargers = result.items.reduce((a, r) => a + r.chargers, 0);
  const need = chargers * norms.chargerPowerKw;
  if (power !== null && chargers > 0 && need > power) {
    add(
      "POWER",
      "medium",
      `Зарядные станции: ${chargers} × ${fx(norms.chargerPowerKw)} кВт = ${fx(need)} кВт — больше доступной мощности ${fx(power)} кВт`,
    );
  }

  if (ok) {
    const ls = norms.laborShareAutomatable;
    const d = normDef("laborShareAutomatable");
    if (d.origin === "estimate") {
      add(
        "LABOR_SHARE_ESTIMATE",
        "low",
        `Доля труда до исключения нестандартных грузов (${share(ls, 0)}) — оценка: в исходных данных её нет. Нестандарт исключается отдельно; уже очищенная доля роботизируемого времени сюда не подставляется. Типовой оценочный диапазон ${rangeText(...LABOR_SHARE_SENSITIVITY_RANGE, "доля")} входит в анализ чувствительности; при выборе базы вне диапазона он расширяется до неё. Допустимость 0–100 % не означает измеренную неопределённость`,
      );
    }
    const leg = ok.items.find((r) => r.thrCycle !== null && r.routeLoadedM !== null);
    if (leg && leg.routeLoadedM !== null) {
      add(
        "ROUTE_ESTIMATE",
        "low",
        spec?.siteLayout
          ? `Плечо перевозки ≈${fx(leg.routeLoadedM, 0)} м рассчитано по явной планировке и графу сценария; источник и геометрические допущения плана требуют отдельного подтверждения`
          : `Плечо перевозки ≈${fx(leg.routeLoadedM, 0)} м оценено по типовой планировке из площади и ширины проходов, а не по чертежу объекта`,
      );
    }
    const pallets = ok.items.some((r) => r.process === "pallet-transport");
    add(
      "FLEET_COST_MISSING",
      "low",
      pallets
        ? "Стоимость существующего парка погрузчиков в исходных данных не задана — эффект занижен, оценка консервативна"
        : "Стоимость существующего оборудования процесса в исходных данных не задана — эффект занижен, оценка консервативна",
    );
    const F = ok.items.reduce((a, r) => a + r.releasedFte, 0);
    if (F > 0) {
      add("STAFF_REDUCTION", "low", `Высвобождается ставок: ${fx(F, 1)} — учтите трудовые и социальные обязательства`);
    }
  }
  return sortRisks(risks);
}
