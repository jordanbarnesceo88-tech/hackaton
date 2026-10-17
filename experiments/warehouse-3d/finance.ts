import { productForCalcFromSeed } from "../../lib/catalog/product-for-calc";
import { CATALOG } from "../../lib/data/organizer/catalog";
import { paramSpecsFor } from "../../lib/data/organizer/params";
import { simInputIdentity } from "../../lib/sim/identity";
import { createSpatialProjectSnapshot, SPATIAL_MODEL_VERSION } from "../../lib/sim/spatial-bridge";
import { spatialEvidenceMatchesInput } from "../../lib/sim/spatial-evidence";
import { buildProjectModel, type ProjectModel } from "../../lib/tz/model";
import { resolveNorms } from "../../lib/tz/norms";
import type { ScenarioOk, ScenarioSpec, SpatialEvidence } from "../../lib/tz/types";
import { parseOperationsStaffing } from "../../lib/tz/econ/labour";
import { parseCostPackage } from "../../lib/tz/econ/cost-package";
import { operationsStaffingText } from "../../lib/tz/operations-staffing-text";
import type { DemoModel } from "./core";
import { prepareWarehouseTraffic, type DemoTrafficInput } from "./traffic";

export type SpatialFinanceAssumptions = {
  annualCoverageShare: number;
  cashRealizationShare: number;
  operationsStaffing?: ScenarioSpec["operationsStaffing"];
  costPackage?: ScenarioSpec["items"][number]["costPackage"];
  fleet: number;
  chargers: number;
  sourceInputKey: string;
  executionInputKey: string;
  spatialMatchesFinancialInput: boolean;
  financialGeometry: "typical-warehouse" | "explicit-site";
  notes: string[];
};

/** N/C and explicit annual assumptions feed the existing financial engine; peak output is evidence only. */
export function calculateSpatialFinance(
  demo: DemoModel,
  options: { annualCoverageShare: number; cashRealizationShare: number; operationsStaffing?: ScenarioSpec["operationsStaffing"]; costPackage?: ScenarioSpec["items"][number]["costPackage"] },
): { model: ProjectModel; purchase: ScenarioOk; raas: ScenarioOk | null; assumptions: SpatialFinanceAssumptions } {
  if (demo.projectOrigin) throw new Error("Экономика проекта рассчитывается в проекте по его каталогу и параметрам");
  const { annualCoverageShare, cashRealizationShare } = options;
  const operationsStaffing = options.operationsStaffing === undefined ? undefined : parseOperationsStaffing(options.operationsStaffing);
  const costPackage = options.costPackage === undefined ? undefined : parseCostPackage(options.costPackage);
  if (!demo.financialParams || !demo.financialSourceInput) throw new Error("Нет исходных финансовых параметров автономного склада");
  for (const share of [annualCoverageShare, cashRealizationShare]) if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error("Доли годового покрытия и денежного эффекта должны быть от 0 до 1");
  if (!demo.assessment.terminal || demo.assessment.status === "RUNNING" || demo.simModelVersion !== SPATIAL_MODEL_VERSION) throw new Error("Нужен завершённый прогон текущей модели склада");
  const products = CATALOG.map(productForCalcFromSeed), product = products.find(p => p.slug === "ronavi-h1500");
  if (!product) throw new Error("В каталоге нет Ronavi H1500");
  const source = createSpatialProjectSnapshot({ requestId: "standalone-finance", scenarioKey: "purchase", scenarioName: "Покупка", variantId: "calculated", input: demo.financialSourceInput });
  if (source.input.robots.count !== demo.input.robots.count || source.input.layout.chargers !== demo.input.layout.chargers) throw new Error("Исходный финансовый снимок не соответствует парку и зарядкам на сцене");
  const canonicalExecution = prepareWarehouseTraffic(source.input);
  const incidents = (demo.input as DemoTrafficInput).demoIncidents;
  if (incidents) canonicalExecution.demoIncidents = structuredClone(incidents);
  if (simInputIdentity(canonicalExecution) !== simInputIdentity(demo.input)) throw new Error("Исполнительная геометрия или условия изменены; повторите проверку выбранного состава на исходном плане");
  const values = [demo.summary.achievedPerH, demo.summary.queueEnd, demo.summary.waitP95Min];
  if (values.some(n => !Number.isFinite(n) || n < 0) || demo.summary.fleet !== source.input.robots.count || demo.summary.requiredPerH !== source.input.demand.peakPerH) throw new Error("Итоги прогона не соответствуют финансовому снимку");
  const evidence: SpatialEvidence = {
    sourceInputKey: source.inputKey, executionInputKey: simInputIdentity(demo.input), simModelVersion: demo.simModelVersion,
    input: source.input, assessment: { status: demo.assessment.status, headline: demo.assessment.headline, terminal: true },
    summary: { fleet: demo.summary.fleet, requiredPerH: demo.summary.requiredPerH, achievedPerH: demo.summary.achievedPerH, queueEnd: demo.summary.queueEnd, waitP95Min: demo.summary.waitP95Min },
  };
  const item = { process: "pallet-transport", productSlug: product.slug, quantityOverride: source.input.robots.count, chargersOverride: source.input.layout.chargers, automationCoverageOverride: annualCoverageShare };
  const scenarios: ScenarioSpec[] = [
    { key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "purchase", name: "Покупка", kind: "purchase", items: [{ ...item }], cashRealizationShare, spatialEvidence: structuredClone(evidence), simSeed: source.input.seed, ...(source.input.siteLayout ? { siteLayout: structuredClone(source.input.siteLayout) } : {}) },
    { key: "raas", name: "RaaS", kind: "raas", items: [{ ...item }], cashRealizationShare, spatialEvidence: structuredClone(evidence), simSeed: source.input.seed, ...(source.input.siteLayout ? { siteLayout: structuredClone(source.input.siteLayout) } : {}) },
  ];
  for (const spec of scenarios) if (spec.kind !== "asis" && operationsStaffing) spec.operationsStaffing = structuredClone(operationsStaffing);
  if (costPackage) scenarios.find(spec => spec.kind === "purchase")!.items[0]!.costPackage = structuredClone(costPackage);
  const model = buildProjectModel({ facility: "warehouse", params: structuredClone(demo.financialParams), paramDefs: paramSpecsFor("warehouse"), products, norms: resolveNorms(), scenarios });
  const invalid = model.paramIssues.filter(issue => issue.severity === "error");
  if (invalid.length) throw new Error(invalid.map(issue => issue.message).join("; "));
  const purchase = model.results.find(result => result.key === "purchase"), raas = model.results.find(result => result.key === "raas");
  if (!purchase || purchase.status !== "ok") throw new Error(purchase?.status === "refused" ? purchase.refusal.message : "Финансовый движок отказал в расчёте покупки для этих исходных данных");
  const matches = spatialEvidenceMatchesInput(evidence, model.simInputs.purchase?.calculated);
  if (!matches) throw new Error("Пространственный вход не совпадает с финансовым сценарием; повторите проверку без подмены геометрии и условий");
  return {
    model, purchase, raas: raas?.status === "ok" ? raas : null,
    assumptions: {
      annualCoverageShare, cashRealizationShare, fleet: item.quantityOverride, chargers: item.chargersOverride,
      ...(operationsStaffing ? { operationsStaffing } : {}), ...(costPackage ? { costPackage } : {}),
      sourceInputKey: source.inputKey, executionInputKey: evidence.executionInputKey, spatialMatchesFinancialInput: matches,
      financialGeometry: source.input.siteLayout ? "explicit-site" : "typical-warehouse",
      notes: [
        "Годовая доля автоматизации и доля денежного эффекта заданы явно как оценки; выпуск короткого прогона не пересчитывается в годовую экономию.",
        "NPV, CAPEX, OPEX и окупаемость рассчитываются общим финансовым движком проекта для Ronavi H1500.",
        "Исходный вход пространственной проверки совпадает с входом финансового сценария; плечи и цикл рассчитаны по тому же плану и графу маршрутов.",
        operationsStaffingText(operationsStaffing),
        costPackage ? `Комплектация покупки задана отдельно: ${costPackage.reason}. На RaaS этот пакет покупки не переносится.` : "Комплектация покупки не подтверждена: ПО, интеграция, зарядные станции и ремонт вне сервиса считаются отдельно.",
      ],
    },
  };
}
