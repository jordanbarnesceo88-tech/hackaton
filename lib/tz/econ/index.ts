/**
 * Движок экономики модели tz-1.0.0 (ТЗ §3.5): чистые функции без React, Prisma, Date и
 * случайности. Импорты внутри — относительные, чтобы сид и скрипты через tsx работали без
 * алиаса `@/`; lib/sim не импортируется — производительность по циклу приходит в контексте.
 */
export {
  DEFAULT_PARAM_LABELS,
  FACILITY_PARAM_KEYS,
  HORIZON_MAX_YEARS,
  RefusalError,
  horizonOf,
  normsForSpec,
  num,
  optNum,
  toNumber,
  workHours,
  type CycleInfo,
  type Horizon,
  type ScenarioContext,
  type WorkHours,
} from "./context";
export { processDemand, type DemandResult } from "./demand";
export {
  chargersNeeded,
  coverage,
  normThroughput,
  sizeFleet,
  throughputFor,
  type ChargersResult,
  type ThroughputResult,
} from "./fleet";
export {
  baseline,
  operatingStaff,
  operatorPosts,
  payrollMultiplier,
  processBaseline,
  releasedFte,
  remaining,
  roleCost,
  staffingOf,
  type ProcessBaseline,
} from "./labour";
export { CAPEX_LABELS, INCLUDED_IN_SUBSCRIPTION, purchaseCapexLines, raasCapexLines } from "./capex";
export { OPEX_LABELS, asisOpexLines, purchaseOpexLines, raasOpexLines } from "./opex";
export {
  cashflows,
  dpbOf,
  npvOf,
  payback,
  roiNet,
  roiTz,
  tcoAsis,
  tcoOf,
  type CashflowInput,
  type PeriodicCost,
} from "./finance";
export { comparisonScope, computeScenariosCore } from "./core";
export { computeScenarios } from "./scenario";
export { horizonBounds, leverBounds, scenarioSensitivity, type LeverBounds } from "./sensitivity";
export { interpretBand } from "./interpret";
export {
  ESTIMATE_SHARE_LIMIT,
  LOW_COMPLETENESS_PCT,
  NORM_VS_CYCLE_RATIO,
  scenarioRisks,
  sortRisks,
} from "./risks";
export {
  DISCLAIMER,
  HORIZON_SCAN,
  breakEvenSalary,
  buildConclusion,
  horizonFlip,
  isViableScenario,
  pickRecommended,
  type HorizonFlip,
  type ReinvestNote,
} from "./conclusion";
export {
  CAPEX_LINE_KEYS,
  FORMULAS,
  OPEX_LINE_KEYS,
  capexFormulaKey,
  opexFormulaKey,
  type CapexLineKey,
  type Formula,
  type FormulaKey,
  type FormulaSource,
  type OpexLineKey,
} from "./formulas";
export { MODEL_LIMITATIONS } from "./limitations";
