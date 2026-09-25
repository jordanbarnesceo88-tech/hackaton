import { getCalcProducts, getNorms, getParamDefinitions, type Db } from "../catalog/queries";
import { baseValuesFor, paramSpecsFor } from "../data/organizer/params";
import { toStored, type SimRunSummary } from "../sim/metrics";
import { runSimSync } from "../sim/runner";
import { minStableFleet } from "../sim/sweep";
import type { SimInput, SimSummaryStored } from "../sim/types";
import {
  buildProjectModel,
  projectDataVersion,
  storedPartOf,
  withSnapshotProducts,
  type BuildProjectModelInput,
  type ProjectModel,
} from "../tz/model";
import { resolveNorms, type NormValues } from "../tz/norms";
import { timed } from "../tz/timing";
import type { ParamSpec, ParamValues, ProductForCalc, ProjectResults, ScenarioSpec } from "../tz/types";
import { stableJson } from "../tz/version";
import { initialScenarios } from "./defaults";

/**
 * Пересчёт проекта на сервере (ТЗ §3.1.5, §3.6.2): живые данные из БД или снимок проекта →
 * модель → прогоны имитации для сценариев роботизации → модель с рисками имитации →
 * ProjectResults с моментом расчёта. Этим же модулем пользуются серверные действия, API,
 * сев демо-проекта и печать демо-чисел, поэтому импорты только относительные (tsx без «@/»),
 * а клиент БД передаётся параметром.
 *
 * Момент расчёта (`calculatedAt`) и длительность прогонов имитации (`durationMs`) — настенное
 * время; всё остальное детерминировано: повторный расчёт на тех же данных совпадает бит-в-бит.
 */

/** Живые входы расчёта для типа объекта. */
export type LiveInputs = {
  paramDefs: ParamSpec[];
  products: ProductForCalc[];
  norms: NormValues;
  /**
   * Откуда описания параметров: из БД (администрируемые ParamDefinition) или из кода — пока
   * синхронизация данных не выполнялась и таблица пуста.
   */
  paramDefsFrom: "db" | "code";
};

/** Снимок проекта, на котором расчёт воспроизводится: продукты и нормативы. */
export type ProjectSnapshot = Pick<ProjectResults, "productSnapshots" | "normsUsed">;

/** Вход пересчёта проекта. */
export type ComputeProjectInput = {
  facility: string;
  params: ParamValues;
  /** Сценарии; не заданы — сценарии по умолчанию из подбора (initialScenarios). */
  scenarios?: readonly ScenarioSpec[];
  /** Снимок сохранённого расчёта; без него — живые данные каталога и нормативов. */
  snapshot?: ProjectSnapshot | null;
  /** Часы для длительности прогонов имитации, мс; по умолчанию performance.now. */
  now?: () => number;
};

/** Результат пересчёта: то, что сохраняется в проекте, и полная модель для страницы. */
export type ComputedProject = { results: ProjectResults; model: ProjectModel };

/** Бюджет подбора минимального устойчивого парка на один сценарий, мс. */
export const MIN_FLEET_BUDGET_MS = 20_000;

/**
 * Общий бюджет подборов минимального парка на весь проект, мс. Прогоны идут синхронно внутри
 * серверного действия, а ТЗ §4.3.3 ограничивает запуск модели 60 с: основные прогоны
 * имитации плюс подборы должны уложиться в этот предел даже при 9 разных сценариях
 * роботизации. Когда бюджет исчерпан, подбор пропускается (minStableFleet = null).
 */
export const PROJECT_MIN_FLEET_BUDGET_MS = 40_000;

const defaultNow = (): number => performance.now();

/**
 * Живые входы: описания параметров, продукты для расчёта и нормативы. Пока таблица
 * ParamDefinition пуста (данные не синхронизированы), описания берутся из кода — из тех же
 * данных организатора, которыми её засевает синхронизация.
 */
export async function loadLiveInputs(db: Db, facility: string): Promise<LiveInputs> {
  const [defs, products, norms] = await Promise.all([
    getParamDefinitions(db, facility),
    getCalcProducts(db, facility),
    getNorms(db),
  ]);
  if (defs.length > 0) return { paramDefs: defs, products, norms, paramDefsFrom: "db" };
  return { paramDefs: paramSpecsFor(facility), products, norms, paramDefsFrom: "code" };
}

/**
 * Нормативы из снимка проекта. Прогоняются через `resolveNorms`: ключи, которых в снимке нет
 * (он сделан старой версией модели), получают значения по умолчанию, а сохранённые значения,
 * уже согласованные при расчёте, не меняются.
 */
export function normsFromSnapshot(normsUsed: Readonly<Record<string, number>>): NormValues {
  return resolveNorms(Object.entries(normsUsed).map(([key, value]) => ({ key, value })));
}

/** Параметры прогонов имитации. */
export type ProjectSimOptions = {
  now?: () => number;
  /** Бюджет подбора минимального парка на сценарий, мс. */
  minFleetBudgetMs?: number;
  /** Общий бюджет подборов минимального парка на проект, мс. */
  projectBudgetMs?: number;
};

/** Вердикт прогона по норме в форме сводки: неподдержанный прогон — null. */
function verdictOf(s: SimRunSummary | null): "CONFIRMED" | "NOT_CONFIRMED" | null {
  if (!s) return null;
  return s.verdict === "CONFIRMED" || s.verdict === "NOT_CONFIRMED" ? s.verdict : null;
}

/**
 * Прогоны имитации для сценариев модели: парк по расчёту, парк по паспортной норме и подбор
 * минимального устойчивого парка перебором в диапазоне [1; 2N]. Одинаковые входы (покупка и
 * услуга одного продукта с одним парком) прогоняются один раз. Сценарии без входа имитации
 * получают null. Подбор минимального парка ограничен бюджетом на сценарий и общим бюджетом
 * проекта, отсчитываемым от начала прогонов: когда общий бюджет исчерпан, подбор не
 * выполняется и minStableFleet остаётся null («не определён»).
 */
export function runProjectSims(model: ProjectModel, opts: ProjectSimOptions = {}): Record<string, SimSummaryStored | null> {
  const now = opts.now ?? defaultNow;
  const perScenarioMs = opts.minFleetBudgetMs ?? MIN_FLEET_BUDGET_MS;
  const projectMs = opts.projectBudgetMs ?? PROJECT_MIN_FLEET_BUDGET_MS;
  const t0 = now();
  const runs = new Map<string, SimRunSummary>();
  const run = (input: SimInput): SimRunSummary => {
    const key = stableJson(input);
    let s = runs.get(key);
    if (!s) {
      s = runSimSync(input, { now });
      runs.set(key, s);
    }
    return s;
  };
  const mins = new Map<string, number | null>();
  const minOf = (input: SimInput): number | null => {
    const key = stableJson(input);
    if (mins.has(key)) return mins.get(key) ?? null;
    const left = projectMs - (now() - t0);
    if (!(left > 0)) {
      mins.set(key, null);
      return null;
    }
    let m: number | null = null;
    try {
      m = minStableFleet(input, { min: 1, max: 2 * input.robots.count }, { now, budgetMs: Math.min(perScenarioMs, left) });
    } catch (e) {
      // Перебор не уложился в бюджет — минимальный парк не известен, это не ошибка расчёта.
      if (!(e instanceof Error && e.name === "SimBudgetExceeded")) throw e;
    }
    mins.set(key, m);
    return m;
  };

  const out: Record<string, SimSummaryStored | null> = {};
  for (const spec of model.scenarios) {
    const si = model.simInputs[spec.key];
    if (!si?.calculated) {
      out[spec.key] = null;
      continue;
    }
    const s = run(si.calculated);
    const byNorm = si.byNorm ? run(si.byNorm) : null;
    out[spec.key] = toStored({
      ...s,
      scenarioKey: spec.key,
      assumedUtilPct: si.assumedUtilPct ?? s.assumedUtilPct,
      minStableFleet: minOf(si.calculated),
      fleetByNorm: si.byNorm ? si.byNorm.robots.count : null,
      verdictByNorm: verdictOf(byNorm),
    });
  }
  return out;
}

/**
 * Пересчёт на уже загруженных входах (без обращения к БД): модель, прогоны имитации, модель с
 * рисками имитации и сохраняемый результат. Со снимком продукты сценариев и нормативы берутся
 * из снимка, остальные продукты каталога — живые (их видит подбор). Без сценариев берутся
 * сценарии по умолчанию из подбора.
 */
export function resultsFromInputs(live: LiveInputs, input: ComputeProjectInput): ComputedProject {
  const snap = input.snapshot ?? null;
  const common = {
    facility: input.facility,
    params: input.params,
    paramDefs: live.paramDefs,
    products: snap ? withSnapshotProducts(live.products, snap.productSnapshots) : live.products,
    norms: snap ? normsFromSnapshot(snap.normsUsed) : live.norms,
  };
  const base: BuildProjectModelInput = { ...common, scenarios: input.scenarios ?? initialScenarios(common) };
  const first = buildProjectModel(base);
  const sims = runProjectSims(first, { now: input.now });
  const model = buildProjectModel({ ...base, sims });
  const results: ProjectResults = { ...storedPartOf(model), calculatedAt: new Date().toISOString(), sim: sims };
  return { results, model };
}

/**
 * Пересчёт проекта: живые входы из БД (или снимок), модель, имитация, результат. Момент
 * расчёта ставится здесь, а не в lib/tz: модель остаётся чистой функцией.
 */
export async function computeProjectResults(db: Db, input: ComputeProjectInput): Promise<ComputedProject> {
  const live = await loadLiveInputs(db, input.facility);
  return resultsFromInputs(live, input);
}

/**
 * Версия данных, которую получил бы проект на живых данных: те же продукты по slug (их
 * текущие карточки), текущие нормативы и текущие описания параметров объекта. Если она не
 * совпадает с сохранённой `dataVersion`, каталог, нормативы или описания параметров
 * (границы, умолчания, подписи) изменились после расчёта — страница показывает баннер
 * «Пересчитать на актуальных данных» (§3.1.5).
 */
export function liveDataVersionFrom(
  live: LiveInputs,
  results: Pick<ProjectResults, "facility" | "productSnapshots">,
): string {
  const bySlug = new Map(live.products.map((p) => [p.slug, p]));
  const snaps: Record<string, ProductForCalc | null> = {};
  for (const slug of Object.keys(results.productSnapshots).sort()) snaps[slug] = bySlug.get(slug) ?? null;
  const defs = live.paramDefs.filter((d) => d.facility === results.facility);
  return projectDataVersion(snaps, live.norms, defs);
}

/** Версия данных проекта на живых данных БД (см. `liveDataVersionFrom`). */
export async function liveDataVersion(
  db: Db,
  results: Pick<ProjectResults, "facility" | "productSnapshots">,
): Promise<string> {
  const live = await loadLiveInputs(db, results.facility);
  return liveDataVersionFrom(live, results);
}

/**
 * Модель сохранённого проекта, воспроизведённая из снимка: сохранённые параметры, сценарии,
 * снимки продуктов, нормативы и сводки имитации. Для страницы проекта: первый показ совпадает
 * с сохранённым расчётом, а «Пересчитать» в браузере продолжает считать на тех же данных.
 */
export function reproduceModel(live: LiveInputs, stored: ProjectResults): ProjectModel {
  return buildProjectModel({
    facility: stored.facility,
    params: stored.paramsUsed,
    paramDefs: live.paramDefs,
    scenarios: stored.scenarios,
    products: withSnapshotProducts(live.products, stored.productSnapshots),
    norms: normsFromSnapshot(stored.normsUsed),
    sims: stored.sim,
  });
}

/** Новый проект на базовых значениях организатора: параметры, сценарии и модель с временем. */
export type InitialProject = {
  params: ParamValues;
  scenarios: ScenarioSpec[];
  model: ProjectModel;
  /** Время сборки модели, мс (для строки состояния «Расчёт выполнен за … мс»). */
  ms: number;
};

/**
 * Демо-расчёт объекта на данных организатора (гостевой /demo, ТЗ §3.1.2): базовые значения
 * параметров, сценарии по умолчанию и модель без прогонов имитации (их запускает браузер).
 * Базовые значения — из описаний параметров (БД), а если их нет — из кода.
 */
export function initialProject(live: LiveInputs, facility: string, now: () => number = defaultNow): InitialProject {
  const params: ParamValues =
    live.paramDefs.length > 0
      ? Object.fromEntries(live.paramDefs.filter((d) => d.facility === facility).map((d) => [d.key, d.base]))
      : baseValuesFor(facility);
  const common = { facility, params, paramDefs: live.paramDefs, products: live.products, norms: live.norms };
  const { value, ms } = timed(() => {
    const scenarios = initialScenarios(common);
    return { scenarios, model: buildProjectModel({ ...common, scenarios }) };
  }, now);
  return { params, scenarios: value.scenarios, model: value.model, ms };
}
