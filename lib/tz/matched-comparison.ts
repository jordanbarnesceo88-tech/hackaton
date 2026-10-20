import { spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import { SPATIAL_MODEL_VERSION } from "../sim/spatial-bridge";
import { SIM_MODEL_VERSION } from "../sim/types";
import { SCENARIO_NAME_MAX } from "../projects/validate";
import { toCsv, type CsvCell } from "../files/csv";
import type { SimInput } from "../sim/types";
import { buildProjectModel, PROJECT_SIM_SEED, type BuildProjectModelInput } from "./model";
import { horizonOf, normsForSpec } from "./econ/context";
import type { OperationsStaffing, ParamValues, ProductForCalc, ScenarioItem, ScenarioResult, ScenarioSpec, SpatialEvidence } from "./types";
import type { NormValues } from "./norms";
import { TZ_MODEL_VERSION } from "./version";
import { deploymentLogisticsText } from "./deployment-logistics";

export type MatchedPhysicalState = {
  status: "confirmed" | "partial" | "failed" | "stale" | "not-checked" | "unavailable";
  reason: string;
  summary?: SpatialEvidence["summary"];
};
export type MatchedComparisonRow = {
  spec: ScenarioSpec;
  result: ScenarioResult;
  product: ProductForCalc;
  fleetBasis: "source-fixed" | "auto";
  chargersBasis: "source-fixed" | "fixed-site" | "auto";
  physical: MatchedPhysicalState;
  expectedInput: SimInput | null;
  canAdopt: boolean;
  costBasis: string[];
};
export type MatchedComparison = {
  sourceKey: string;
  versions: { finance: string; baseSim: string; spatial: string };
  paramsUsed: ParamValues;
  normsUsed: NormValues;
  reason?: string;
  assumptions: {
    annualCoverageShare: number | null;
    cashRealizationShare: number;
    cashRealizationExplicit: boolean;
    staffing: OperationsStaffing | null;
    layout: "explicit" | "typical";
    seed: number;
    terminalResidualRub: 0;
    horizonYears: number | null;
    discountRate: number;
    sourceProductOverrides: string[];
  };
  excludedProducts: number;
  additionalEligibleProducts: number;
  rows: MatchedComparisonRow[];
};

function physicalInputLimitation(input: SimInput | null | undefined, product: ProductForCalc): string | undefined {
  if (!input) return undefined;
  if (!(Number.isFinite(product.autonomyH) && (product.autonomyH ?? 0) > 0) || !(Number.isFinite(product.chargeMin) && (product.chargeMin ?? 0) > 0)) {
    return "Нет положительных данных автономности или времени зарядки. Расчётная пропорция зарядок не заменяет эти характеристики.";
  }
  if (input.robots.count > 60 || input.layout.activeAreaM2 > 50_000) {
    return "Состав выходит за пределы пространственной проверки: до 60 роботов и 50 000 м². Парк и геометрия не уменьшены автоматически.";
  }
  return undefined;
}

function physicalState(source: ScenarioSpec, productSlug: string, expected: SimInput | null, unavailable?: string): MatchedPhysicalState {
  if (!expected) return { status: "unavailable", reason: unavailable ?? "Нет поддерживаемого физического входа: заполните характеристики и параметры." };
  // A different catalog product never inherits another manufacturer's observation.
  if (productSlug !== source.items[0]?.productSlug || !source.spatialEvidence) {
    return { status: "not-checked", reason: "Экономика предварительная; этот состав и продукт ещё не проверены на исходном физическом входе." };
  }
  if (!spatialEvidenceMatchesInput(source.spatialEvidence, expected)) {
    return { status: "stale", reason: "Прежняя 3D-проверка относится к другому составу, входу или версии. Требуется новый прогон." };
  }
  const evidence = source.spatialEvidence;
  if (evidence.assessment.status === "NOT_EVALUATED") return { status: "not-checked", reason: evidence.assessment.headline };
  return {
    status: evidence.assessment.status === "OK" ? "confirmed" : evidence.assessment.status === "PARTIAL" ? "partial" : "failed",
    reason: evidence.assessment.headline,
    summary: structuredClone(evidence.summary),
  };
}

/**
 * A bounded financial comparison, not an optimizer or a batch of physical simulations.
 * Every row uses the existing money engine with identical object inputs and declared staffing.
 * Auto fleet sizing is product-specific. Exact source evidence is reusable only for its own product.
 */
export function buildMatchedComparison({ input, source, maxProducts = 3 }: {
  input: BuildProjectModelInput;
  source: ScenarioSpec;
  maxProducts?: number;
}): MatchedComparison {
  const original = structuredClone(source), sourceItem = original.items[0];
  const comparison: MatchedComparison = {
    sourceKey: original.key,
    versions: { finance: TZ_MODEL_VERSION, baseSim: SIM_MODEL_VERSION, spatial: SPATIAL_MODEL_VERSION },
    paramsUsed: structuredClone(input.params),
    normsUsed: structuredClone(normsForSpec({ norms: input.norms }, original)),
    assumptions: {
      annualCoverageShare: sourceItem?.automationCoverageOverride ?? null,
      cashRealizationShare: original.cashRealizationShare ?? 1,
      cashRealizationExplicit: original.cashRealizationShare !== undefined,
      staffing: original.operationsStaffing ? structuredClone(original.operationsStaffing) : null,
      layout: original.siteLayout ? "explicit" : "typical",
      seed: original.simSeed ?? PROJECT_SIM_SEED,
      terminalResidualRub: 0,
      horizonYears: null,
      discountRate: normsForSpec({ norms: input.norms }, original).discountRate,
      sourceProductOverrides: sourceItem ? Object.keys(sourceItem).filter(k => !["process", "productSlug", "quantityOverride", "chargersOverride", "automationCoverageOverride"].includes(k)) : [],
    },
    excludedProducts: 0, additionalEligibleProducts: 0, rows: [],
  };
  if (input.facility !== "warehouse" || original.kind === "asis" || original.items.length !== 1 || sourceItem?.process !== "pallet-transport") {
    comparison.reason = "Короткое сравнение доступно для одного процесса перевозки паллет на складе. Исходный сценарий не изменён.";
    return comparison;
  }
  if (!Number.isFinite(maxProducts) || maxProducts < 1) {
    comparison.reason = "Укажите от одной до трёх моделей для сравнения.";
    return comparison;
  }
  const bound = Math.min(3, Math.floor(maxProducts));
  if (original.siteLayout && sourceItem.chargersOverride !== undefined && sourceItem.chargersOverride !== original.siteLayout.chargers.length) {
    comparison.reason = "Число зарядок исходного сценария расходится с явным планом. Сначала согласуйте состав инфраструктуры.";
    return comparison;
  }
  // Drop incoming base-simulation receipts: generated keys must not accidentally reuse them.
  const cleanInput = { ...input, sims: undefined };
  const probe = buildProjectModel({ ...cleanInput, scenarios: [original] });
  comparison.paramsUsed = structuredClone(probe.paramsUsed);
  try { comparison.assumptions.horizonYears = horizonOf({ params: probe.paramsUsed }, normsForSpec({ norms: input.norms }, original)).H; }
  catch { /* A refused financial input never acquires an invented horizon. */ }
  const selections = probe.selection.filter(s => s.process === sourceItem.process);
  const eligible = selections.filter(s => s.status === "candidate" || s.status === "recommended");
  comparison.excludedProducts = selections.filter(s => s.status === "excluded").length;
  const eligibleSlugs = eligible.map(s => s.productSlug);
  const chosen = [sourceItem.productSlug, ...eligibleSlugs].filter((slug, index, all) => all.indexOf(slug) === index && eligibleSlugs.includes(slug)).slice(0, bound);
  comparison.additionalEligibleProducts = Math.max(0, eligible.length - chosen.length);
  if (!chosen.includes(sourceItem.productSlug)) comparison.reason = "Исходная модель не прошла подбор и не включена в автоматическое сравнение. Причины доступны на шаге подбора.";
  const bySlug = new Map(input.products.map(p => [p.slug, p]));
  const occupied = new Set(input.scenarios.map(s => s.key));
  const specs: ScenarioSpec[] = [];
  for (const [index, slug] of chosen.entries()) {
    const product = bySlug.get(slug);
    if (!product) continue;
    for (const kind of ["purchase", "raas"] as const) {
      const sameProduct = slug === sourceItem.productSlug;
      const item: ScenarioItem = sameProduct ? structuredClone(sourceItem) : {
        process: sourceItem.process, productSlug: slug,
        ...(sourceItem.automationCoverageOverride === undefined ? {} : { automationCoverageOverride: sourceItem.automationCoverageOverride }),
      };
      // Purchase contract terms cannot silently become a subscription package.
      if (kind === "raas") delete item.costPackage;
      if (kind === "purchase") delete item.raasPackage;
      if (original.siteLayout) item.chargersOverride = original.siteLayout.chargers.length;
      let suffix = 0, key = `match-${original.key.slice(0, 14)}-${index + 1}-${kind}`;
      while (occupied.has(key)) key = `match-${index + 1}-${kind}-${++suffix}`;
      occupied.add(key);
      const spec: ScenarioSpec = {
        ...structuredClone(original), key,
        name: `${kind === "purchase" ? "Покупка" : "RaaS"} · ${product.name.slice(0, SCENARIO_NAME_MAX - (kind === "purchase" ? "Покупка" : "RaaS").length - 7)} [${index + 1}]`,
        kind, items: [item], terminalResidualRub: 0,
      };
      delete spec.spatialEvidence;
      delete spec.pilotPlan;
      // A delivery quote for one product/acquisition cannot establish another supplier's terms.
      if (!sameProduct || kind !== original.kind) delete spec.logistics;
      specs.push(spec);
    }
  }
  let model = buildProjectModel({ ...cleanInput, scenarios: specs });
  let copiedEvidence = false;
  for (const spec of specs) {
    const expected = model.simInputs[spec.key]?.calculated;
    const product = bySlug.get(spec.items[0]!.productSlug)!;
    if (!physicalInputLimitation(expected, product) && spec.items[0]?.productSlug === sourceItem.productSlug && spatialEvidenceMatchesInput(original.spatialEvidence, expected)) {
      spec.spatialEvidence = structuredClone(original.spatialEvidence);
      copiedEvidence = true;
    }
  }
  if (copiedEvidence) model = buildProjectModel({ ...cleanInput, scenarios: specs });
  comparison.rows = model.scenarios.map((spec, index) => {
    const item = spec.items[0]!, product = bySlug.get(item.productSlug)!;
    const result = model.results[index]!;
    const sim = model.simInputs[spec.key];
    let expected = sim?.calculated ?? null;
    let unavailable = result.status === "refused" ? result.refusal.message : sim?.unavailableReason;
    // Base 2D permits a no-charge model; the matched physical shortlist requires actual charge data.
    const limitation = physicalInputLimitation(expected, product);
    if (limitation) {
      unavailable = limitation;
      expected = null;
    }
    const physical = physicalState(original, product.slug, expected, unavailable);
    const same = product.slug === sourceItem.productSlug;
    const costBasis = [
      same ? "Сохранены явные цены и коммерческие корректировки исходной модели." : "Используются собственные цены и характеристики карточки; корректировки и пакет исходного продукта не перенесены.",
      "Остаточная стоимость исключена у всех строк этого сравнения. Исходный сценарий сохранён без изменений.",
      "План и бюджет пилота задаются отдельно после выбора варианта.",
      deploymentLogisticsText(spec.logistics),
      "Проверьте совместимость паллет и грузоносителя, габариты и интервал SOC опубликованной зарядки. Числовое совпадение характеристик не подтверждает одинаковые условия измерения.",
    ];
    if (spec.kind === "raas") costBasis.push("Ставка из карточки либо явной корректировки исходной модели; неизвестная ставка автоматически не оценивается. Пакет покупки не переносится в RaaS.");
    if (spec.kind === "purchase" && sourceItem.raasPackage) costBasis.push("Состав услуг и платежей RaaS не перенесён в покупку.");
    return {
      spec: structuredClone(spec), result: structuredClone(result), product: structuredClone(product),
      fleetBasis: same && sourceItem.quantityOverride !== undefined ? "source-fixed" : "auto",
      chargersBasis: original.siteLayout ? "fixed-site" : same && sourceItem.chargersOverride !== undefined ? "source-fixed" : "auto",
      physical, expectedInput: expected ? structuredClone(expected) : null,
      canAdopt: result.status === "ok" && expected !== null && physical.status !== "failed",
      costBasis,
    };
  });
  return comparison;
}

/** Portable table data: shared geometry and product sources occur once, never once per row. */
export function matchedComparisonExport(comparison: MatchedComparison) {
  const products = [...new Map(comparison.rows.map(row => [row.product.slug, row.product])).values()];
  return {
    schemaVersion: "matched-comparison-1",
    sourceKey: comparison.sourceKey,
    versions: { ...comparison.versions },
    assumptions: structuredClone(comparison.assumptions),
    paramsUsed: structuredClone(comparison.paramsUsed), normsUsed: structuredClone(comparison.normsUsed),
    sharedSiteLayout: comparison.rows[0]?.spec.siteLayout ? structuredClone(comparison.rows[0].spec.siteLayout) : null,
    products: structuredClone(products),
    rows: comparison.rows.map(row => {
      const spec = structuredClone(row.spec);
      delete spec.siteLayout;
      delete spec.spatialEvidence;
      return {
        spec, result: structuredClone(row.result), productSlug: row.product.slug,
        layoutRef: row.spec.siteLayout ? "sharedSiteLayout" : "typical",
        fleetBasis: row.fleetBasis, chargersBasis: row.chargersBasis,
        physical: structuredClone(row.physical), costBasis: [...row.costBasis],
        physicalSourceInputKey: row.spec.spatialEvidence?.sourceInputKey ?? null,
        physicalExecutionInputKey: row.spec.spatialEvidence?.executionInputKey ?? null,
        physicalModelVersion: row.spec.spatialEvidence?.simModelVersion ?? null,
      };
    }),
    note: "Предварительное финансовое сравнение. Физический статус не заменяет проверку новой модели; JSON не является доверенным серверным подтверждением.",
  };
}

export function matchedComparisonCsv(comparison: MatchedComparison): string {
  const a = comparison.assumptions;
  const rows: CsvCell[][] = [
    ["Предварительное сравнение склада", comparison.sourceKey],
    ["Версии", comparison.versions.finance, comparison.versions.baseSim, comparison.versions.spatial],
    ["Горизонт NPV, лет", a.horizonYears, "Ставка дисконтирования", a.discountRate],
    ["Годовой охват", a.annualCoverageShare ?? "По аналитической мощности", "Денежная реализация труда", a.cashRealizationShare],
    ["План", a.layout === "explicit" ? "Один явный план, зарядки фиксированы" : "Один типовой план", "Зерно", a.seed],
    ["Персонал эксплуатации", a.staffing ? JSON.stringify(a.staffing) : "Норматив исходного сценария", "Остаточная стоимость, ₽", 0],
    ["Модель", "Способ приобретения", "N", "C", "Основание парка", "CAPEX, ₽", "OPEX/год, ₽", "NPV, ₽", "Окупаемость, лет", "Физический статус", "Завершено, пал./ч", "Нужно, пал./ч", "Очередь", "Причина / ограничения", "Основание затрат"],
  ];
  for (const row of comparison.rows) {
    const ok = row.result.status === "ok" ? row.result : null, item = row.result.items[0];
    rows.push([row.product.name, row.spec.kind === "purchase" ? "Покупка" : "RaaS", item?.n ?? null, item?.chargers ?? null,
      row.fleetBasis === "source-fixed" ? "Задан в исходном сценарии" : "По характеристикам модели",
      ok?.capexRub ?? null, ok?.opexYearRub ?? null, ok?.npvRub ?? null, ok?.paybackYears ?? null,
      row.physical.status, row.physical.summary?.achievedPerH ?? null, row.physical.summary?.requiredPerH ?? null, row.physical.summary?.queueEnd ?? null,
      row.result.status === "refused" ? row.result.refusal.message : row.physical.reason,
      row.costBasis.join(" ") + (ok ? " " + [...ok.capexLines, ...ok.opexLines].map(line => `${line.label}: ${line.origin}${line.originNote ? `; ${line.originNote}` : ""}`).join(" | ") : ""),
    ]);
  }
  rows.push(["NPV не подтверждает выполнение нагрузки; неизвестные цены и ставки не заменены нулями. Короткий список не доказывает глобальный оптимум."]);
  return toCsv(rows);
}
