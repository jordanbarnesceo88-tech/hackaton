import { assessOperatingEvidence, type OperatingEvidenceDecision } from "../catalog/operating-evidence";
import { cleaningWorkingProfile } from "../data/cleaning-assumptions";
import { computeScenariosCore } from "./econ/core";
import { cleaningDay, parseCleaningProfile } from "./econ/cleaning-profile";
import { processDemand } from "./econ/demand";
import { ceilSafe } from "./econ/fleet";
import { workHours, type ScenarioContext } from "./econ/context";
import type { NormValues } from "./norms";
import { PROCESS_DEFS, processDef } from "./processes";
import { checkConstraints } from "./selection/constraints";
import type { CleaningProfile, CostPackage, ParamSpec, ParamValues, ProductForCalc, RaasPackage, ScenarioItem, ScenarioResult, ScenarioSpec } from "./types";

export const CLEANING_SELECTION_SLUGS = ["pudu-cc1", "agibot-c5", "viggo-sc80"] as const;
export type CleaningSelectionQuote = {
  purchaseRub?: number; raasRubMonth?: number; source: string;
  costPackage?: CostPackage; raasPackage?: RaasPackage;
};
export type CleaningSelectionInput = {
  facility: string; params: ParamValues; products: readonly ProductForCalc[]; norms: NormValues;
  paramDefs?: readonly ParamSpec[]; scenarios?: readonly ScenarioSpec[];
  profiles?: Readonly<Record<string, CleaningProfile | undefined>>;
  quotes?: Readonly<Record<string, CleaningSelectionQuote | undefined>>;
  mode: string; asOf?: string;
  windowH?: number; automatableLabourShare?: number; cashRealizationShare?: number;
};
export type CleaningSelectionFinancial = {
  priceRub: number | null; result: ScenarioResult | null; rank: number | null; reason: string;
};
export type CleaningSelectionRow = {
  productSlug: string; productName: string; process: string; status: "candidate" | "excluded";
  reasons: string[]; warnings: string[]; profile: CleaningProfile | null;
  profileBasis: "working" | "evidence-capped"; evidence: OperatingEvidenceDecision;
  day: ReturnType<typeof cleaningDay> | null; demandM2PerDay: number | null;
  quantity: number | null; chargers: number | null; coverage: number | null; careFte: number | null;
  purchase: CleaningSelectionFinancial; raas: CleaningSelectionFinancial; specs: ScenarioSpec[];
};

export function cleaningProcessForFacility(facility: string): string | undefined {
  return ({ warehouse: "cleaning", airport: "terminal-cleaning", medical: "hospital-cleaning" } as Record<string, string>)[facility];
}

function reference(input: CleaningSelectionInput, slug: string, process: string, kind: "purchase" | "raas") {
  const matches = input.scenarios?.filter(spec => spec.kind === kind && spec.items.length === 1 && spec.items[0]?.productSlug === slug && spec.items[0]?.process === process) ?? [];
  return matches.find(spec => spec.key === `clean-${kind}-${slug}`) ?? (matches.length === 1 ? matches[0] : undefined);
}

/** All new RaaS options require explicit service scope; an unknown service is never free. */
function unassessedRaas(reason: string): RaasPackage {
  return { startup: { mode: "unassessed" }, platform: { mode: "unassessed" }, service: { mode: "unassessed" },
    consumables: { mode: "unassessed" }, repair: { mode: "unassessed" }, battery: { mode: "unassessed" }, reason };
}

function quoteReason(previous: string | undefined, source: string): string {
  const reason = !previous || previous === source ? source : `${previous}\nИзменённая цена/тариф: ${source}`;
  if (reason.length > 1000) throw new Error("Источник новой цены вместе с основанием состава превышает 1000 символов; сократите описание, не теряя условия предложения");
  return reason;
}

function specsFor(input: CleaningSelectionInput, product: ProductForCalc, process: string, profile: CleaningProfile): ScenarioSpec[] {
  const quote = input.quotes?.[product.slug];
  if (quote) {
    if (typeof quote.source !== "string" || !quote.source.trim() || quote.source.length > 1000) throw new Error("Укажите источник цен или основание рабочей оценки (до 1000 символов)");
    for (const price of [quote.purchaseRub, quote.raasRubMonth]) if (price !== undefined && (!Number.isFinite(price) || price <= 0 || price > 1e12)) throw new Error("Цена и тариф должны быть положительными числами; неизвестная цена не равна нулю");
  }
  return (["purchase", "raas"] as const).map(kind => {
    const ref = reference(input, product.slug, process, kind);
    const inherited = ref?.items[0];
    const item: ScenarioItem = { ...structuredClone(inherited ?? {}), process, productSlug: product.slug, operatingMode: input.mode, cleaningProfile: structuredClone(profile) };
    // Compare automatic fleets on the same demand, rather than retaining a previous manual cap.
    delete item.quantityOverride; delete item.chargersOverride; delete item.automationCoverageOverride;
    delete item.throughputPerHOverride; delete item.manuallyAdded; delete item.manualReason;
    if (kind === "purchase") {
      delete item.raasPackage; delete item.raasRubMonthOverride; delete item.raasFromEstimate;
      if (quote && Object.hasOwn(quote, "purchaseRub")) { delete item.priceRubOverride; if (quote.purchaseRub !== undefined) item.priceRubOverride = quote.purchaseRub; }
      if (quote?.costPackage) item.costPackage = structuredClone(quote.costPackage);
      else if (quote?.purchaseRub !== undefined && !item.costPackage) item.costPackage = { softwareIncludedInIntegration: false, repairsIncludedInService: false, includedChargers: 0, reason: quote.source };
      if (quote && Object.hasOwn(quote, "purchaseRub") && item.costPackage) item.costPackage = { ...item.costPackage, reason: quoteReason(item.costPackage.reason, quote.source) };
    } else {
      delete item.costPackage; delete item.serviceRubYearOverride;
      if (quote && Object.hasOwn(quote, "raasRubMonth")) { delete item.raasRubMonthOverride; if (quote.raasRubMonth !== undefined) item.raasRubMonthOverride = quote.raasRubMonth; }
      item.raasPackage = structuredClone(quote?.raasPackage ?? item.raasPackage ?? unassessedRaas(quote?.source || "Тариф и состав услуг требуется уточнить; неизвестная стоимость не равна нулю"));
      if (quote && Object.hasOwn(quote, "raasRubMonth")) item.raasPackage.reason = quoteReason(item.raasPackage.reason, quote.source);
    }
    return { ...structuredClone(ref ?? {}), key: `clean-${kind}-${product.slug}`, name: `${kind === "purchase" ? "Покупка" : "RaaS"} — ${product.name}`, kind, items: [item],
      normOverrides: { ...ref?.normOverrides, reservePct: input.norms.reservePct, annualHoursPerFte: input.norms.annualHoursPerFte },
      cashRealizationShare: input.cashRealizationShare ?? 1, spatialEvidence: undefined, pilotPlan: undefined, cleaningPlan: undefined,
      terminalResidualRub: undefined, terminalResidualSource: undefined };
  });
}

/** Shared finite-day schedule and the existing economic engine; never a 3D/quality approval. */
export function compareCleaningOptions(input: CleaningSelectionInput): CleaningSelectionRow[] {
  const processSlug = cleaningProcessForFacility(input.facility) ?? "";
  const process = processDef(processSlug);
  const ctx: ScenarioContext = { facility: input.facility, params: input.params, norms: input.norms,
    products: Object.fromEntries(input.products.map(product => [product.slug, product])),
    processes: Object.fromEntries(PROCESS_DEFS.map(def => [def.slug, def])), cycle: {} };
  const rows = CLEANING_SELECTION_SLUGS.map((slug): CleaningSelectionRow => {
    const product = input.products.find(product => product.slug === slug);
    const absent: OperatingEvidenceDecision = { applied: false, observedPerH: null, reason: "Применимый подтверждённый замер не предоставлен" };
    const empty = (): CleaningSelectionFinancial => ({ priceRub: null, result: null, rank: null, reason: "Цена не задана — финансовый вариант не ранжируется" });
    const row: CleaningSelectionRow = { productSlug: slug, productName: product?.name ?? slug, process: processSlug, status: "excluded", reasons: [], warnings: [],
      profile: null, profileBasis: "working", evidence: absent, day: null, demandM2PerDay: null, quantity: null, chargers: null, coverage: null, careFte: null,
      purchase: empty(), raas: empty(), specs: [] };
    if (!product || !process) { row.reasons.push(!product ? "Модель отсутствует в доступном каталоге" : "Для этого типа объекта процесс уборки не определён"); return row; }
    const constraints = checkConstraints(product, { facility: input.facility, params: input.params, process });
    row.reasons.push(...constraints.hard); row.warnings.push(...constraints.soft);
    if (product.handlingClass !== "cleaner") row.reasons.push("Модель не относится к уборочным роботам");
    if (row.reasons.length) return row;
    try {
      const ref = reference(input, slug, processSlug, "purchase") ?? reference(input, slug, processSlug, "raas");
      const source = input.profiles && Object.hasOwn(input.profiles, slug) ? input.profiles[slug] : ref?.items[0]?.cleaningProfile ?? cleaningWorkingProfile(slug);
      if (!source) throw new Error("Задайте эксплуатационный профиль; паспортная производительность его не заменяет");
      let profile = parseCleaningProfile({ ...source, windowH: input.windowH ?? 8, automatableLabourShare: input.automatableLabourShare ?? 0.5 });
      row.evidence = assessOperatingEvidence(product.operatingEvidence, { productSlug: slug, process: processSlug, facility: input.facility, mode: input.mode, unit: "м²/ч",
        confirmed: product.operatingEvidenceConfirmed === true, asOf: input.asOf ?? product.operatingEvidenceEvaluatedOn });
      if (row.evidence.applied && row.evidence.basis === "operating-hour" && row.evidence.observedPerH !== null) {
        if (!(row.evidence.observedPerH > 0)) throw new Error("Применимый замер показал нулевую выработку; выясните причину перед подбором");
        profile = parseCleaningProfile({ ...profile, throughputM2PerH: Math.min(profile.throughputM2PerH, row.evidence.observedPerH),
          source: `${profile.source}; ${product.operatingEvidence!.sourceRef}`,
          reason: `Выработка ограничена сопоставимым замером за активный час (${row.evidence.observedPerH} м²/ч). Работа/зарядка и уход остаются допущениями. ${profile.reason}` });
        row.profileBasis = "evidence-capped";
      } else if (row.evidence.applied) {
        row.evidence = { ...row.evidence, applied: false, reason: "Замер за час смены уже включает простои и не подставляется в профиль активного часа с повторной зарядкой; показан справочно" };
      }
      row.profile = profile; row.day = cleaningDay(profile);
      const hours = workHours(ctx);
      row.demandM2PerDay = processDemand(ctx, process, { ...hours, Hd: profile.windowH, Hy: profile.windowH * hours.D }).perDay;
      row.quantity = Math.max(1, ceilSafe(row.demandM2PerDay / row.day.capacityM2PerDay * (1 + input.norms.reservePct)));
      if (row.quantity > 500) throw new Error("Расчётный парк превышает предел 500 роботов; уточните площадь и профиль");
      row.chargers = row.quantity; row.coverage = Math.min(1, row.quantity * row.day.capacityM2PerDay / row.demandM2PerDay);
      row.careFte = row.quantity * row.day.careHoursPerDay * hours.D / input.norms.annualHoursPerFte;
      const headcount = process.headcountParam ? Number(input.params[process.headcountParam]) : NaN;
      if (!Number.isFinite(headcount) || headcount < 0) throw new Error("Укажите численность уборщиков для проверки ресурса ежедневного ухода");
      if (row.careFte > headcount * profile.automatableLabourShare + 1e-9 * Math.max(1, row.careFte)) throw new Error("Высвобождаемого рабочего времени не хватает на ежедневный уход за выбранным парком; уточните организацию обслуживания");
      row.status = "candidate";
      row.specs = specsFor(input, product, processSlug, profile);
      if (ref?.terminalResidualRub) row.warnings.push("Остаточная стоимость прежнего парка не перенесена: новый парк рассчитан автоматически. Задайте новую оценку с основанием в экономике сценария, если она применима.");
      row.warnings.push("Предварительная оценка по расписанию: качество, вода, лифты, люди и движение не подтверждены. Цикл и уход остаются редактируемыми допущениями.");
    } catch (error) { row.reasons.push(error instanceof Error ? error.message : "Не удалось рассчитать профиль"); row.status = "excluded"; }
    return row;
  });
  const specs = rows.flatMap(row => row.status === "candidate" ? row.specs : []);
  if (!specs.length) return rows;
  const results = computeScenariosCore(ctx, [{ key: "clean-asis", name: "Как есть — уборка", kind: "asis", items: [] }, ...specs]);
  for (const row of rows) for (const kind of ["purchase", "raas"] as const) {
    const spec = row.specs.find(spec => spec.kind === kind), item = spec?.items[0], product = ctx.products[row.productSlug];
    const price = kind === "purchase" ? item?.priceRubOverride ?? product?.priceRub : item?.raasRubMonthOverride ?? product?.raasRubMonth;
    const result = spec ? results.find(result => result.key === spec.key) ?? null : null;
    row[kind] = { priceRub: typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null, result, rank: null,
      reason: result?.status === "ok" ? "Финансовая оценка по заданным ценам и нормативам; не подтверждение пилота"
        : result?.status === "refused" ? result.refusal.message : "Цена не задана — финансовый вариант не ранжируется" };
  }
  for (const kind of ["purchase", "raas"] as const) {
    rows.filter(row => { const result = row[kind].result; return row.status === "candidate" && row[kind].priceRub !== null && result?.status === "ok" && typeof result.npvRub === "number" && Number.isFinite(result.npvRub); })
      .sort((a, b) => (b[kind].result?.status === "ok" ? b[kind].result.npvRub ?? -Infinity : -Infinity) - (a[kind].result?.status === "ok" ? a[kind].result.npvRub ?? -Infinity : -Infinity))
      .forEach((row, index) => { row[kind].rank = index + 1; });
  }
  return rows;
}

export function buildCleaningSelectionScenarios(row: CleaningSelectionRow): ScenarioSpec[] {
  if (row.status !== "candidate" || row.specs.length !== 2) throw new Error(row.reasons.join("; ") || "Профиль модели пока нельзя применить");
  return structuredClone(row.specs);
}
