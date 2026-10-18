"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { WarehouseSimulation } from "@/components/sim/warehouse-simulation";
import type { SpatialFinancialAssumptions } from "@/components/sim/spatial-preview";
import { simInputIdentity } from "@/lib/sim/identity";
import { createSpatialProjectSnapshot, type SpatialProjectSnapshot, type SpatialProjectResult } from "@/lib/sim/spatial-bridge";
import { buildSpatialFinancialScenario, parseSpatialScenarioProposal, type SpatialScenarioProposal } from "@/lib/sim/spatial-proposal";
import { DecisionSummary } from "./decision-summary";
import { PilotPlan } from "./pilot-plan";
import { OperationsStaffing } from "./operations-staffing";
import { MatchedComparison } from "./matched-comparison";
import { buildMatchedComparison, type MatchedComparison as MatchedComparisonData } from "@/lib/tz/matched-comparison";
import { staffingBreakEvenBudget } from "@/lib/tz/econ/staffing-budget";
import { isAbortError, yieldToPage } from "@/components/sim/run-headless";
import { buildSimVariants, storedMatches, type SimScenario } from "@/components/sim/variants";
import { BackToTop } from "@/components/ui/back-to-top";
import { Button } from "@/components/ui/button";
import { pluralRu } from "@/lib/format/plural";
import { formatNum } from "@/lib/format/rub";
import type { SaveProjectInput, SaveProjectResult } from "@/lib/projects/action-types";
import { canAdoptSavedSnapshot, projectDraftKey, projectSnapshotModel } from "@/lib/projects/archive";
import { changeFieldLabel, serverAutoFrom } from "@/lib/projects/changes";
import { shortProductName } from "@/lib/projects/defaults";
import type { ParamsSource } from "@/lib/projects/queries";
import { SCENARIO_NAME_MAX, SCENARIOS_MAX, SCENARIOS_MIN } from "@/lib/projects/validate";
import { projectCsv } from "@/lib/report/tz/csv";
import { formatCalcDate, scenarioFinance, scenarioNorms } from "@/lib/report/tz/rows";
import { SIM_LIMITS } from "@/lib/sim/engine";
import { toStored, type SimRunSummary } from "@/lib/sim/metrics";
import { runSim } from "@/lib/sim/runner";
import type { SimInput, SimSummaryStored } from "@/lib/sim/types";
import { buildProjectModel, storedPartOf, type BuildProjectModelInput, type ProjectModel } from "@/lib/tz/model";
import { normDef, type NormKey, type NormValues } from "@/lib/tz/norms";
import { sameParamValue } from "@/lib/tz/params/schema";
import { validateParamValues } from "@/lib/tz/params/validate";
import { processDef, type ProcessDef } from "@/lib/tz/processes";
import { timed } from "@/lib/tz/timing";
import type {
  ParamSpec,
  ParamValues,
  PendingChange,
  PilotPlanInput,
  ProductForCalc,
  ProjectResults,
  ScenarioItem,
  ScenarioKind,
  ScenarioSpec,
  SelectionResult,
} from "@/lib/tz/types";
import { stableJson } from "@/lib/tz/version";
import { ChangeLog, type ChangeLogEntry } from "./change-log";
import { ComparisonTable, scenarioItemKeys, statusChipLabel } from "./comparison-table";
import { Conclusion } from "./conclusion";
import { FacilitySchematic, PROTOTYPE_BADGE } from "./facility-schematic";
import { ImportForm } from "./import-form";
import { NormsPanel, type NormPanelRow, type ScenarioNormKey } from "./norms-panel";
import type { ParamValue } from "./param-field";
import { ParamsForm } from "./params-form";
import { ProjectToolbar, RecalcBar } from "./project-toolbar";
import { ScenarioDetails, parseItemOverrideField, type ItemOverrideKind } from "./scenario-details";
import { ScenarioTable } from "./scenario-table";
import { SelectionPanel } from "./selection-panel";
import { SensitivityPanel } from "./sensitivity-panel";
import { StepNav, StepPager, TZ_STEP_COUNT, TZ_STEPS, stepHeading } from "./step-nav";
import { VersionBanner } from "./version-banner";

/**
 * Рабочая область проекта — весь путь ТЗ §2.2 на одной странице, восемь шагов с якорями
 * («Шаг N из 8»): 1 объект · 2 параметры (вручную или из Excel/CSV) · 3 подбор с причинами ·
 * 4 сравнение по единым характеристикам · 5 экономика с нормативами и «Как посчитано» ·
 * 6 сценарии в одной таблице, чувствительность и вывод · 7 имитация, подтверждающая расчёт ·
 * 8 сохранение, отчёт и выгрузки с журналом корректировок.
 *
 * Режимы:
 * - `guest` — гостевой /demo (ТЗ §3.1.2): модель считается в браузере, ничего не сохраняется,
 *   журнал ведётся только на экране, CSV собирается в браузере;
 * - `owner` — проект пользователя (§3.1.3, §3.1.5): первый показ воспроизведён из снимка
 *   сохранённого расчёта, «Сохранить проект» отправляет параметры, сценарии и журнал на сервер,
 *   который пересчитывает модель и имитацию сам;
 * - `readonly` — только просмотр: без правок и сохранения.
 *
 * Расчёт: `buildProjectModel` — та же чистая функция, что на сервере, поэтому число в браузере
 * совпадает с сохранённым бит-в-бит. Правка параметров не пересчитывает модель на каждое
 * нажатие клавиши: страница показывает «Параметры изменены — нажмите «Пересчитать»» (шаг 5
 * легенды датасета организатора). Явные действия со сценариями (выбор решения, ручная
 * корректировка, новый сценарий, «Принять парк по имитации») — это законченные правки, поэтому
 * модель после них пересчитывается сразу.
 *
 * Имитация для строки «Имитация» таблицы сценариев: после каждого пересчёта для каждого
 * сценария роботизации последовательно выполняются прогоны парка по расчёту, парка по норме
 * организатора и подбор минимального устойчивого парка — те же, что делает сервер при
 * сохранении (lib/projects/recalc.runProjectSims), но по частям, с отменой и уступкой
 * управления странице. Затем модель собирается ещё раз со сводками — так в сценарии попадают
 * риски SIM_NOT_CONFIRMED и SIM_OVERSIZED, как на сервере. Владелец до первого пересчёта видит
 * сохранённые сводки.
 */

export type WorkspaceMode = "guest" | "owner" | "readonly";

/** Проект в рабочей области. */
export type WorkspaceProject = {
  revision?: number;
  /** id сохранённого проекта; у гостевого расчёта нет. */
  id?: string;
  name: string;
  /** Slug типа объекта: warehouse, airport, medical. */
  facility: string;
  /** «Склад», «Аэропорт», «Медучреждение». */
  facilityLabel: string;
  objectName?: string | null;
  /** Откуда параметры проекта. */
  paramsSource?: ParamsSource;
  /** Засеянный демо-проект: сохранение, пересчёт на сервере и удаление закрыты. */
  isDemo?: boolean;
};

export type WorkspaceProps = {
  archive?: boolean;
  initialStep?: number;
  initialFocusKey?: string;
  mode: WorkspaceMode;
  project: WorkspaceProject;
  /** Описания параметров типа объекта (администрируемые ParamDefinition или код). */
  defs: ParamSpec[];
  /** Базовые значения параметров (демо-данные организатора). */
  baseValues: ParamValues;
  initialParams: ParamValues;
  initialScenarios: ScenarioSpec[];
  /** Продукты для подбора и расчёта (у сохранённого проекта — живой каталог со снимками проекта). */
  products: ProductForCalc[];
  /** Метаданные нормативов для таблицы «Нормативы и допущения»; значения берутся из модели. */
  normRows: NormPanelRow[];
  /** Процессы типа объекта в порядке показа (подписи — из БД, если данные синхронизированы). */
  processes: ProcessDef[];
  initialModel: ProjectModel;
  /** Время сборки первой модели на сервере, мс. */
  initialMs: number;
  /**
   * Сохранённый расчёт владельца (версии, момент расчёта и сводки имитации) и версия данных на
   * живых данных — для баннера версий. Полные результаты не нужны: модель уже воспроизведена из
   * снимка (initialModel), а лишние ~150 КБ ушли бы в страницу второй раз.
   */
  stored?: {
    results: Pick<ProjectResults, "modelVersion" | "dataVersion" | "calculatedAt" | "sim">;
    liveDataVersion: string;
  };
  /** Журнал корректировок из БД (владелец). */
  changes?: ChangeLogEntry[];
};

// ——————————————————————————— Чистые помощники ———————————————————————————

/** Часы для замеров: вызываются только из обработчиков событий и колбэков, не при отрисовке. */
const now = (): number => performance.now();

/** Время расчёта для строки состояния: до 10 мс — с десятыми, дальше — целыми. */
export function msText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0";
  return ms < 10 ? formatNum(ms, 1) : formatNum(ms, 0);
}

/** «Расчёт выполнен за 74 мс · модель tz-1.0.0 · данные 7be2cba2». */
export function calcStatusText(ms: number, model: Pick<ProjectModel, "modelVersion" | "dataVersion">): string {
  return `Расчёт выполнен за ${msText(ms)} мс · модель ${model.modelVersion} · данные ${model.dataVersion}`;
}

/** Первый свободный ключ сценария с префиксом: p3, r2, m1 (формат ^[a-z0-9-]{1,40}$). */
export function nextScenarioKey(prefix: string, specs: readonly Pick<ScenarioSpec, "key">[]): string {
  const taken = new Set(specs.map((s) => s.key));
  for (let n = 1; n < 1000; n++) {
    const key = `${prefix}${n}`;
    if (!taken.has(key)) return key;
  }
  return `${prefix}${taken.size + 1}`;
}

/** Название сценария, не длиннее SCENARIO_NAME_MAX и не совпадающее с другими (без учёта регистра). */
export function uniqueScenarioName(base: string, specs: readonly Pick<ScenarioSpec, "name">[]): string {
  const taken = new Set(specs.map((s) => s.name.trim().toLowerCase()));
  const fit = (s: string, tail = "") => {
    const room = SCENARIO_NAME_MAX - tail.length;
    const head = s.length > room ? `${s.slice(0, Math.max(1, room - 1)).trimEnd()}…` : s;
    return `${head}${tail}`;
  };
  const first = fit(base.trim());
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; n < 100; n++) {
    const name = fit(base.trim(), ` (${n})`);
    if (!taken.has(name.toLowerCase())) return name;
  }
  return fit(base.trim(), ` (${specs.length + 1})`);
}

/** Заголовок сценария по виду и продукту: «Покупка — Ronavi H1500», «Услуга (RaaS) — …». */
export function scenarioTitle(kind: Exclude<ScenarioKind, "asis">, productName: string, suffix = ""): string {
  const prefix = kind === "raas" ? "Услуга (RaaS) — " : "Покупка — ";
  return `${prefix}${shortProductName(productName)}${suffix}`;
}

/** Ставка RaaS у продукта известна. */
function hasRaasRate(p: ProductForCalc | undefined): boolean {
  const r = p?.raasRubMonth;
  return typeof r === "number" && Number.isFinite(r) && r > 0;
}

/** Поле ScenarioItem, которое меняет корректировка вида `kind`. */
const ITEM_PROP = {
  quantity: "quantityOverride",
  price: "priceRubOverride",
  throughput: "throughputPerHOverride",
  service: "serviceRubYearOverride",
  raasRate: "raasRubMonthOverride",
} as const satisfies Record<Exclude<ItemOverrideKind, "raasEstimate">, keyof ScenarioItem>;

/** Единица корректировки для журнала. */
function itemUnit(kind: Exclude<ItemOverrideKind, "raasEstimate">, process: string): string {
  switch (kind) {
    case "quantity":
      return "шт.";
    case "price":
      return "₽";
    case "throughput":
      return processDef(process)?.throughputUnit ?? "ед./ч";
    case "service":
      return "₽/год";
    case "raasRate":
      return "₽/мес";
  }
}

/** Числовой параметр из значений проекта (null — не число). */
function numParam(params: ParamValues, key: string): number | null {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Площадь объекта для статичной схемы: общая площадь, площадь терминала или активная зона. */
function schematicAreaOf(params: ParamValues): number | null {
  for (const key of ["totalAreaM2", "terminalAreaM2", "activeAreaM2"]) {
    const v = numParam(params, key);
    if (v !== null && v > 0) return v;
  }
  return null;
}

/** Откуда параметры проекта — для шага 1. */
function sourceText(source: ParamsSource | undefined, facilityLabel: string): string {
  const demo = `демо-набор данных, лист «${facilityLabel}»`;
  if (!source) return demo;
  switch (source.kind) {
    case "demo":
      return demo;
    case "upload":
      return source.fileName ? `файл «${source.fileName}» (проверен при загрузке; сам файл не хранится)` : "загруженный файл";
    case "manual":
      return "ручной ввод поверх базовых значений";
    case "api":
      return "переданы через API";
  }
}

/** Безопасное имя файла: без символов, запрещённых в Windows. */
function fileNameOf(name: string): string {
  const s = name.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return s === "" ? "расчёт" : s.slice(0, 120);
}

// ——————————————————————————— Имитация в браузере ———————————————————————————

/** Бюджет подбора минимального парка на сценарий и на все сценарии, мс — как на сервере (lib/projects/recalc). */
const MIN_FLEET_BUDGET_MS = 20_000;
const PROJECT_MIN_FLEET_BUDGET_MS = 40_000;
/** Бюджет всех прогонов одного пересчёта, мс (ТЗ §4.3.3: запуск модели не дольше 60 с). */
const SIMS_BUDGET_MS = 60_000;

type SimProgress = { done: number; total: number; current: string | null };

/** Вердикт прогона по норме в форме сводки: неподдержанный прогон — null. */
function verdictOf(s: SimRunSummary | null): "CONFIRMED" | "NOT_CONFIRMED" | null {
  if (!s) return null;
  return s.verdict === "CONFIRMED" || s.verdict === "NOT_CONFIRMED" ? s.verdict : null;
}

/** Бюджет подбора исчерпан: минимальный парк не определён — это не ошибка расчёта. */
class MinFleetBudget extends Error {}

/**
 * Сводки имитации по сценариям модели — те же прогоны и та же сводка, что у сервера
 * (`runProjectSims`): парк по расчёту, парк по норме и последовательный перебор [1; 2N]. Одинаковые входы
 * (покупка и услуга одного продукта) прогоняются один раз.
 */
async function runModelSims(
  model: ProjectModel,
  opts: { signal: AbortSignal; onProgress: (p: SimProgress) => void },
): Promise<{ sims: Record<string, SimSummaryStored | null>; ms: number; count: number }> {
  await yieldToPage();
  const t0 = now();
  const runs = new Map<string, SimRunSummary>();
  const run = async (input: SimInput): Promise<SimRunSummary> => {
    const key = stableJson(input);
    const hit = runs.get(key);
    if (hit) return hit;
    const left = SIMS_BUDGET_MS - (now() - t0);
    const s = await runSim(input, { now, signal: opts.signal, yieldFn: yieldToPage, budgetMs: Math.max(0, left) });
    runs.set(key, s);
    return s;
  };
  const mins = new Map<string, number | null>();
  const minOf = async (input: SimInput): Promise<number | null> => {
    const key = stableJson(input);
    if (mins.has(key)) return mins.get(key) ?? null;
    const tStart = now();
    const budget = Math.min(MIN_FLEET_BUDGET_MS, PROJECT_MIN_FLEET_BUDGET_MS - (tStart - t0));
    let m: number | null = null;
    if (budget > 0) {
      const lo = 1;
      const hi = Math.min(SIM_LIMITS.maxRobots, Math.floor(2 * input.robots.count));
      try {
        for (let n = lo; n <= hi; n++) {
          if (now() - tStart > budget) throw new MinFleetBudget();
          const s = await runSim({ ...input, robots: { ...input.robots, count: n } }, {
            now,
            signal: opts.signal,
            yieldFn: yieldToPage,
            budgetMs: Math.max(0, Math.min(budget - (now() - tStart), SIMS_BUDGET_MS - (now() - t0))),
          });
          if (s.verdict === "CONFIRMED") {
            m = n;
            break;
          }
        }
      } catch (e) {
        if (!(e instanceof MinFleetBudget) && !(e instanceof Error && e.name === "SimBudgetExceeded")) throw e;
        m = null;
      }
    }
    mins.set(key, m);
    return m;
  };

  const jobs = model.scenarios.filter((s) => model.simInputs[s.key]?.calculated);
  const out: Record<string, SimSummaryStored | null> = {};
  let done = 0;
  for (const spec of model.scenarios) {
    const si = model.simInputs[spec.key];
    const calculated = si?.calculated ?? null;
    if (!si || !calculated) {
      out[spec.key] = null;
      continue;
    }
    opts.onProgress({ done, total: jobs.length, current: spec.name });
    const s = await run(calculated);
    const byNorm = si.byNorm ? await run(si.byNorm) : null;
    out[spec.key] = toStored({
      ...s,
      scenarioKey: spec.key,
      assumedUtilPct: si.assumedUtilPct ?? s.assumedUtilPct,
      minStableFleet: null,
      fleetByNorm: si.byNorm ? si.byNorm.robots.count : null,
      verdictByNorm: verdictOf(byNorm),
    });
    done++;
  }
  for (const spec of model.scenarios) {
    const calculated = model.simInputs[spec.key]?.calculated;
    const summary = out[spec.key];
    if (calculated && summary) summary.minStableFleet = await minOf(calculated);
  }
  return { sims: out, ms: now() - t0, count: jobs.length };
}

// ——————————————————————————— Состояние расчёта ———————————————————————————

/** Последний расчёт: вход, модель без сводок имитации и модель, которая на экране. */
type Calc = {
  token: number;
  input: BuildProjectModelInput;
  base: ProjectModel;
  model: ProjectModel;
  ms: number;
  /** Сводки имитации по сценариям; null — ещё не посчитаны для этого расчёта. */
  sims: Record<string, SimSummaryStored | null> | null;
  simSource: "stored" | "browser" | null;
  simMs: number | null;
  simCount: number | null;
};

type SimStatus =
  | { token: number; kind: "running"; done: number; total: number; current: string | null }
  | { token: number; kind: "error"; message: string };

/** Изменение для журнала, ожидающее сохранения, с моментом правки. */
type LocalChange = { change: PendingChange; at: string };

/** Статус имитации в строке состояния. */
function simStatusText(calc: Calc, status: SimStatus | null): string | null {
  if (status && status.token === calc.token) {
    if (status.kind === "error") return `Имитация не выполнена: ${status.message}`;
    const n = Math.min(status.total, status.done + 1);
    return `Имитация: сценарий ${n} из ${status.total}${status.current ? ` («${status.current}»)` : ""}…`;
  }
  if (calc.sims === null) return "Имитация: готовим прогоны…";
  if (calc.simSource === "stored") return "Имитация — по сохранённому расчёту";
  const count = calc.simCount ?? Object.values(calc.sims).filter((s) => s !== null).length;
  if (count === 0) return null;
  return `Имитация в браузере: ${count} ${pluralRu(count, ["сценарий проверен", "сценария проверено", "сценариев проверено"])} за ${msText(calc.simMs ?? 0)} мс`;
}

// ——————————————————————————— Вкладки сценариев ———————————————————————————

function ScenarioTabs({
  label,
  items,
  value,
  onChange,
  panelId,
  idBase,
}: {
  label: string;
  items: readonly { key: string; name: string; manual?: boolean }[];
  value: string;
  onChange: (key: string) => void;
  panelId: string;
  idBase: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="subtabs">
      {items.map((s) => {
        const selected = s.key === value;
        return (
          <button
            key={s.key}
            id={`${idBase}-${s.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(s.key)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = items.findIndex((x) => x.key === value);
              const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
              if (next) {
                onChange(next.key);
                document.getElementById(`${idBase}-${next.key}`)?.focus();
              }
            }}
            className="subtab"
          >
            {s.name}
            {s.manual && (
              <span className="ml-1 text-caution" aria-label="решение добавлено вручную">
                ⚠
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ——————————————————————————— Добавление сценария ———————————————————————————

type ProductOption = { value: string; process: string; slug: string; label: string };
const OPTION_SEP = "::";

function AddScenarioForm({
  groups,
  disabledReason,
  onAdd,
}: {
  groups: readonly { process: string; name: string; options: ProductOption[] }[];
  disabledReason: string | null;
  onAdd: (kind: Exclude<ScenarioKind, "asis">, process: string, slug: string) => void;
}) {
  const kindId = useId();
  const productId = useId();
  const [kind, setKind] = useState<Exclude<ScenarioKind, "asis">>("purchase");
  const [choice, setChoice] = useState("");
  const first = groups.flatMap((g) => g.options)[0]?.value ?? "";
  const all = groups.flatMap((g) => g.options);
  const value = all.some((o) => o.value === choice) ? choice : first;
  const picked = all.find((o) => o.value === value) ?? null;
  const disabled = disabledReason !== null || picked === null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={kindId} className="text-xs text-muted-foreground">
          Вид сценария
        </label>
        <select
          id={kindId}
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value === "raas" ? "raas" : "purchase")}
          className="field"
        >
          <option value="purchase">Покупка</option>
          <option value="raas">Услуга (RaaS)</option>
        </select>
      </div>
      <div className="flex min-w-64 flex-col gap-1">
        <label htmlFor={productId} className="text-xs text-muted-foreground">
          Решение
        </label>
        <select
          id={productId}
          value={value}
          onChange={(e) => setChoice(e.currentTarget.value)}
          className="field max-w-full"
        >
          {groups.map((g) => (
            <optgroup key={g.process} label={g.name}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        title={disabledReason ?? undefined}
        onClick={() => {
          if (picked) onAdd(kind, picked.process, picked.slug);
        }}
      >
        Добавить сценарий
      </Button>
    </div>
  );
}

// ——————————————————————————— Рабочая область ———————————————————————————

export function Workspace({
  archive = false,
  initialStep = 1,
  initialFocusKey,
  mode,
  project,
  defs,
  baseValues,
  initialParams,
  initialScenarios,
  products,
  normRows,
  processes,
  initialModel,
  initialMs,
  stored,
  changes = [],
}: WorkspaceProps) {
  const uid = useId();
  const facility = project.facility;
  const editable = mode !== "readonly" && !archive;
  const guest = mode === "guest";

  // Нормативы проекта: у сохранённого проекта — из снимка, у гостя — живые. Не меняются.
  const [norms, setNorms] = useState<NormValues>(() => initialModel.normsUsed);
  const [params, setParams] = useState<ParamValues>(initialParams);
  const [savedParams, setSavedParams] = useState<ParamValues>(initialParams);
  const [revision, setRevision] = useState(project.revision);
  const [paramMeta, setParamMeta] = useState<Record<string, { at: string; reason?: string }>>({});
  const [scenarios, setScenarios] = useState<ScenarioSpec[]>(initialScenarios);
  const [matched, setMatched] = useState<{ inputKey: string; comparison: MatchedComparisonData } | null>(null);
  const latestDraft = useRef({ params, scenarios });
  useLayoutEffect(() => { latestDraft.current = { params, scenarios }; }, [params, scenarios]);
  const [savedKey, setSavedKey] = useState<string>(() => stateKey(initialParams, initialScenarios));
  const [pending, setPending] = useState<LocalChange[]>([]);
  const [stale, setStale] = useState(false);
  const [calc, setCalc] = useState<Calc>(() => ({
    token: 0,
    input: { facility, params: initialParams, paramDefs: defs, scenarios: initialScenarios, products, norms: initialModel.normsUsed },
    base: initialModel,
    model: initialModel,
    ms: initialMs,
    sims: stored ? stored.results.sim : archive ? {} : null,
    simSource: stored ? "stored" : null,
    simMs: null,
    simCount: null,
  }));
  const [simStatus, setSimStatus] = useState<SimStatus | null>(null);
  const [focusPick, setFocusPick] = useState<string | null>(initialFocusKey ?? null);
  const [notice, setNotice] = useState<{ where: "selection" | "scenarios" | "params"; text: string } | null>(null);
  const [activeStep, setActiveStep] = useState(initialStep);
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<number>>(() => new Set([initialStep]));
  const stickyRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = stickyRef.current?.querySelector<HTMLOListElement>('nav[aria-label="Шаги расчёта"] ol');
    if (!list) return;
    const reveal = () => {
      const selected = list.querySelector<HTMLElement>('[aria-current="step"]');
      if (!selected) return;
      const bounds = list.getBoundingClientRect(), target = selected.getBoundingClientRect();
      if (target.left < bounds.left || target.right > bounds.right) {
        list.scrollLeft += target.left - bounds.left - Math.max(0, (bounds.width - target.width) / 2);
      }
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeStep]);
  /** Номер последнего перехода между шагами — см. goToStep. */
  const stepTransitionSeq = useRef(0);
  /**
   * Пейджер шагов (просьба владельца 2026-09-26; заменил «один экран на шаг» бэклога #4b): на
   * экране один шаг; содержимое монтируется при первом посещении и затем остаётся под `hidden`, поэтому черновики полей, выбранные
   * вкладки и имитация переход между шагами переживают. Смена шага — горизонтальный сдвиг:
   * вперёд — текущий уходит влево, назад — вправо (View Transitions API, «Пейджер рабочей
   * области» в globals.css). Без API и при prefers-reduced-motion шаг меняется мгновенно.
   *
   * Прежняя схема — все восемь разделов в потоке с min-h-[85dvh], scrollIntoView и
   * IntersectionObserver, который при прокрутке звал тот же scrollIntoView, — перехватывала
   * колесо мыши: прокрутка, дошедшая до следующего раздела, перебрасывалась к его началу, а
   * содержимое уезжало под липкую панель. Раздел пустел на треть экрана из-за min-h.
   *
   * Шаг — в адресе (#economics и т.д., replaceState): обновление страницы и ссылки вида
   * «#report» открывают нужный шаг.
   */
  function goToStep(n: number, opts: { focusHeading?: boolean } = {}) {
    const next = Math.min(TZ_STEP_COUNT, Math.max(1, n));
    const id = TZ_STEPS.find((st) => st.n === next)?.id;
    if (next === activeStep) {
      revealStepTop();
      return;
    }
    const apply = () => {
      flushSync(() => {
        setVisitedSteps(previous => previous.has(next) ? previous : new Set(previous).add(next));
        setActiveStep(next);
      });
      if (id) window.history.replaceState(null, "", `#${id}`);
      revealStepTop();
      // С нижней кнопки «Далее» фокус переносится на заголовок нового шага: сама кнопка
      // осталась в скрытом шаге, и фокус иначе упал бы на body.
      if (opts.focusHeading && id) document.getElementById(`${uid}-h-${id}`)?.focus({ preventScroll: true });
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof document.startViewTransition !== "function") {
      apply();
      return;
    }
    const root = document.documentElement;
    root.setAttribute("data-step-dir", next > activeStep ? "next" : "prev");
    // Стрелки жмут быстро: новый переход начинается, пока предыдущий ещё идёт. Снимать
    // направление может только последний — иначе завершение первого оборвало бы анимацию второго.
    const seq = ++stepTransitionSeq.current;
    void document.startViewTransition(apply).finished.finally(() => {
      if (stepTransitionSeq.current === seq) root.removeAttribute("data-step-dir");
    });
  }

  /** Начало шага — сразу под липкой панелью, если страница прокручена ниже него. */
  function revealStepTop() {
    const steps = stepsRef.current;
    if (!steps) return;
    const barBottom = stickyRef.current?.getBoundingClientRect().bottom ?? 0;
    const top = steps.getBoundingClientRect().top;
    if (top < barBottom) window.scrollTo({ top: window.scrollY + top - barBottom - 16, behavior: "instant" });
  }

  const model = calc.model;

  // ——— Имитация после каждого пересчёта ———
  const simTarget = !archive && calc.sims === null ? calc : null;
  useEffect(() => {
    if (!simTarget) return;
    const ac = new AbortController();
    const { token, base, input } = simTarget;
    runModelSims(base, {
      signal: ac.signal,
      onProgress: (p) => setSimStatus({ token, kind: "running", ...p }),
    })
      .then(({ sims, ms, count }) => {
        if (ac.signal.aborted) return;
        const withSims = count > 0 ? buildProjectModel({ ...input, sims }) : base;
        setCalc((c) => (c.token === token ? { ...c, sims, model: withSims, simSource: "browser", simMs: ms, simCount: count } : c));
        setSimStatus(null);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbortError(e)) return;
        console.error("Workspace: имитация", e);
        setSimStatus({ token, kind: "error", message: e instanceof Error && e.message ? e.message : "неизвестная ошибка" });
      });
    return () => ac.abort();
  }, [simTarget]);

  // ——— Шаг из адреса: при открытии страницы и по ссылкам «#report» внутри неё ———
  const onHashStep = useEffectEvent((initial: boolean) => {
    const n = TZ_STEPS.find((st) => `#${st.id}` === window.location.hash)?.n;
    if (n === undefined) return;
    if (initial) flushSync(() => {
      setVisitedSteps(previous => previous.has(n) ? previous : new Set(previous).add(n));
      setActiveStep(n);
    });
    else goToStep(n);
  });
  useEffect(() => {
    // Server and hydration share initialStep; the URL hash is applied together with its content after mount.
    const raf = requestAnimationFrame(() => onHashStep(true));
    const onHash = () => onHashStep(false);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // ——— Производные значения ———
  const defsByKey = useMemo(() => new Map(defs.map((d) => [d.key, d])), [defs]);
  const paramLabels = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d.label])), [defs]);
  const processNames = useMemo(() => Object.fromEntries(processes.map((p) => [p.slug, p.name])), [processes]);
  const issues = useMemo(() => archive ? model.paramIssues : validateParamValues(defs, params, { origin: "manual" }).issues, [archive, model.paramIssues, defs, params]);
  const itemKeys = useMemo(() => scenarioItemKeys(scenarios), [scenarios]);
  const productsBySlug = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);
  const currentKey = useMemo(() => stateKey(params, scenarios), [params, scenarios]);
  const dirty = currentKey !== savedKey || pending.length > 0;
  const rows = useMemo(
    () => normRows.map((r) => ({ ...r, value: (model.normsUsed as Record<string, number>)[r.key] ?? r.value })),
    [normRows, model.normsUsed],
  );

  const paramChanges = defs
    .filter((d) => !sameParamValue(params[d.key] ?? null, savedParams[d.key] ?? null))
    .map((d): LocalChange => {
      const meta = paramMeta[d.key];
      const change: PendingChange = {
        field: `param:${d.key}`,
        auto: d.base,
        old: savedParams[d.key] ?? null,
        new: params[d.key] ?? null,
      };
      if (d.unit) change.unit = d.unit;
      if (meta?.reason) change.reason = meta.reason;
      return { change, at: meta?.at ?? "" };
    });

  const results = model.results;
  const recommendedKey = model.conclusion.recommendedScenarioKey;
  const firstRobot = results.find((r) => r.kind !== "asis") ?? results[0];
  const focusKey =
    focusPick && results.some((r) => r.key === focusPick)
      ? focusPick
      : (recommendedKey && results.some((r) => r.key === recommendedKey) ? recommendedKey : (firstRobot?.key ?? ""));
  const focusResult = results.find((r) => r.key === focusKey) ?? null;
  const focusSpec = scenarios.find((s) => s.key === focusKey) ?? model.scenarios.find((s) => s.key === focusKey);
  const matchedInputKey = `${projectDraftKey(params, scenarios)}:${focusKey}:${model.dataVersion}`;
  const tabs = results.map((r) => ({
    key: r.key,
    name: r.name,
    manual: (scenarios.find((s) => s.key === r.key)?.items ?? []).some((it) => it.manuallyAdded),
  }));
  const okResult = results.find((r) => r.status === "ok");
  const tcoYears = okResult && okResult.status === "ok" ? okResult.tcoYears : norms.tcoMinYears;
  const horizonFor = (key: string): number | undefined => {
    const r = results.find((x) => x.key === key);
    if (!r || r.status !== "ok") return undefined;
    return scenarioFinance(model, r).H ?? undefined;
  };

  // ——— Пересчёт ———
  function recalcWith(nextParams: ParamValues, nextScenarios: readonly ScenarioSpec[]): ProjectModel {
    const input: BuildProjectModelInput = {
      facility,
      params: nextParams,
      paramDefs: defs,
      scenarios: nextScenarios,
      products,
      norms,
    };
    const { value, ms } = timed(() => buildProjectModel(input), now);
    setCalc((c) => ({
      token: c.token + 1,
      input,
      base: value,
      model: value,
      ms,
      sims: null,
      simSource: null,
      simMs: null,
      simCount: null,
    }));
    setScenarios(value.scenarios);
    setStale(false);
    return value;
  }

  function recalc() {
    recalcWith(params, scenarios);
    setNotice(null);
  }

  /** Изменение сценариев — законченное действие: журнал и немедленный пересчёт. */
  function commitScenarios(next: ScenarioSpec[], logs: PendingChange[], note?: { where: "selection" | "scenarios"; text: string }) {
    if (logs.length > 0) {
      const at = new Date().toISOString();
      setPending((p) => [...p, ...logs.map((change) => ({ change, at }))]);
    }
    recalcWith(params, next);
    setNotice(note ?? null);
  }

  // ——— Параметры ———
  function onParamChange(key: string, value: ParamValue) {
    setParams((p) => ({ ...p, [key]: value }));
    setParamMeta((m) => ({ ...m, [key]: { at: new Date().toISOString() } }));
    setStale(true);
  }

  function onParamReset(key: string) {
    const def = defsByKey.get(key);
    const base = baseValues[key] !== undefined ? baseValues[key] : (def?.base ?? null);
    onParamChange(key, base ?? null);
  }

  function onImportApply(values: ParamValues, meta: { fileName: string }) {
    const at = new Date().toISOString();
    const next: ParamValues = { ...params };
    const nextMeta = { ...paramMeta };
    let n = 0;
    for (const [key, v] of Object.entries(values)) {
      if (!defsByKey.has(key)) continue;
      const value = v ?? null;
      if (sameParamValue(value, next[key] ?? null)) continue;
      next[key] = value;
      nextMeta[key] = { at, reason: `значение из файла «${meta.fileName}»` };
      n++;
    }
    setParams(next);
    setParamMeta(nextMeta);
    if (n > 0) setStale(true);
    setNotice({
      where: "params",
      text:
        n > 0
          ? `Из файла «${meta.fileName}» применено ${n} ${pluralRu(n, ["значение", "значения", "значений"])} — нажмите «Пересчитать»`
          : `Значения из файла «${meta.fileName}» совпадают с текущими`,
    });
  }

  // ——— Подбор ———
  function onUse(process: ProcessDef, slug: string) {
    const product = productsBySlug.get(slug);
    const name = product?.name ?? model.selection.find((r) => r.productSlug === slug)?.productName ?? slug;
    let next = [...scenarios];
    const logs: PendingChange[] = [];
    const added: string[] = [];
    const kinds: Exclude<ScenarioKind, "asis">[] = hasRaasRate(product) ? ["purchase", "raas"] : ["purchase"];
    let full = false;
    for (const kind of kinds) {
      if (next.some((s) => s.kind === kind && s.items.some((it) => it.process === process.slug && it.productSlug === slug))) continue;
      const item: ScenarioItem = { process: process.slug, productSlug: slug };
      const placeholder = next.findIndex((s) => s.kind === kind && s.items.length === 0);
      if (placeholder >= 0) {
        // Сценарий без решения («решение не выбрано») получает это решение.
        const s = next[placeholder] as ScenarioSpec;
        const others = next.filter((_, i) => i !== placeholder);
        next[placeholder] = { ...s, name: uniqueScenarioName(scenarioTitle(kind, name), others), items: [item] };
        added.push(next[placeholder]?.name ?? "");
        continue;
      }
      if (next.length >= SCENARIOS_MAX) {
        full = true;
        continue;
      }
      const key = nextScenarioKey(kind === "raas" ? "r" : "p", next);
      const spec: ScenarioSpec = { key, name: uniqueScenarioName(scenarioTitle(kind, name), next), kind, items: [item] };
      next = [...next, spec];
      added.push(spec.name);
      logs.push({ scenarioKey: key, field: "scenario:add", auto: null, old: null, new: spec.name, reason: "решение из подбора: «Использовать в сценариях»" });
    }
    const parts: string[] = [];
    if (added.length > 0) parts.push(`В сценарии добавлено: ${added.map((a) => `«${a}»`).join(", ")}`);
    else if (!full) parts.push(`«${shortProductName(name)}» уже есть в сценариях`);
    if (full) parts.push(`в проекте уже ${SCENARIOS_MAX} сценариев — удалите лишний в шаге 6`);
    if (!hasRaasRate(product)) parts.push("ставки RaaS у решения нет — сценарий услуги не создан (его можно добавить в шаге 6 и подставить оценку ставки)");
    if (added.length === 0) {
      setNotice({ where: "selection", text: parts.join("; ") });
      return;
    }
    commitScenarios(next, logs, { where: "selection", text: parts.join("; ") });
  }

  function onManualAdd(process: ProcessDef, slug: string, reason: string) {
    if (scenarios.length >= SCENARIOS_MAX) {
      setNotice({ where: "selection", text: `В проекте уже ${SCENARIOS_MAX} сценариев — удалите лишний в шаге 6` });
      return;
    }
    const name = productsBySlug.get(slug)?.name ?? model.selection.find((r) => r.productSlug === slug)?.productName ?? slug;
    const key = nextScenarioKey("m", scenarios);
    const spec: ScenarioSpec = {
      key,
      name: uniqueScenarioName(scenarioTitle("purchase", name, " (вручную)"), scenarios),
      kind: "purchase",
      items: [{ process: process.slug, productSlug: slug, manuallyAdded: true, manualReason: reason }],
    };
    commitScenarios(
      [...scenarios, spec],
      [{ scenarioKey: key, field: `item:${process.slug}:manual`, auto: null, old: null, new: shortProductName(name), reason }],
      { where: "selection", text: `Добавлен сценарий «${spec.name}» — решение отмечено ⚠ и записано в журнал` },
    );
    setFocusPick(key);
  }

  // ——— Корректировки сценария ———
  function onItemOverride(scenarioKey: string, field: string, value: number | null, reason?: string) {
    const parsed = parseItemOverrideField(field);
    const spec = scenarios.find((s) => s.key === scenarioKey);
    if (!parsed || !spec) return;
    const idx = spec.items.findIndex((it) => it.process === parsed.process);
    const current = spec.items[idx];
    if (idx < 0 || !current) return;
    const kind = parsed.kind === "raasEstimate" ? "raasRate" : parsed.kind;
    const prop = ITEM_PROP[kind];
    const item: ScenarioItem = { ...current };
    const old = current[prop] ?? null;
    if (value === null) delete item[prop];
    else item[prop] = value;
    if (kind === "raasRate") {
      // Оценка ставки помечается как оценка; ручная ставка и «вернуть расчётное» снимают пометку.
      if (parsed.kind === "raasEstimate" && value !== null) item.raasFromEstimate = true;
      else delete item.raasFromEstimate;
    }
    const logField = `item:${parsed.process}:${kind}`;
    const autoRaw = serverAutoFrom(model, defs)(scenarioKey, logField);
    const auto = typeof autoRaw === "number" ? autoRaw : null;
    const why =
      reason?.trim() ||
      (parsed.kind === "raasEstimate" && value !== null
        ? `ставка по оценке: ${formatNum(norms.raasMonthlyPctOfPrice * 100, 1)} % цены в месяц (норматив)`
        : value === null
          ? "возврат к расчётному значению"
          : undefined);
    const change: PendingChange = {
      scenarioKey,
      field: logField,
      auto,
      old: old ?? auto,
      new: value ?? auto,
      unit: itemUnit(kind, parsed.process),
    };
    if (why) change.reason = why;
    const items = spec.items.map((it, i) => (i === idx ? item : it));
    commitScenarios(
      scenarios.map((s) => (s.key === scenarioKey ? { ...s, items } : s)),
      [change],
    );
  }

  function onNormOverride(scenarioKey: string, key: ScenarioNormKey, value: number | null, reason?: string) {
    const spec = scenarios.find((s) => s.key === scenarioKey);
    if (!spec) return;
    const prev = spec.normOverrides ?? {};
    const nextO: Partial<Record<NormKey, number>> = { ...prev };
    if (value === null) delete nextO[key];
    else nextO[key] = value;
    const nextSpec: ScenarioSpec = { ...spec };
    if (Object.keys(nextO).length > 0) nextSpec.normOverrides = { ...nextO };
    else delete nextSpec.normOverrides;
    const auto = norms[key];
    const change: PendingChange = {
      scenarioKey,
      field: `norm:${key}`,
      auto,
      old: prev[key] ?? auto,
      new: value ?? auto,
      unit: normDef(key).unit,
    };
    const why = reason?.trim() || (value === null ? "возврат к нормативу проекта" : undefined);
    if (why) change.reason = why;
    commitScenarios(
      scenarios.map((s) => (s.key === scenarioKey ? nextSpec : s)),
      [change],
    );
  }

  function onAcceptFleet(scenarioKey: string, n: number) {
    const spec = scenarios.find((s) => s.key === scenarioKey);
    const idx = spec ? spec.items.findIndex((it) => processDef(it.process)?.simSupported) : -1;
    const current = spec?.items[idx];
    if (!spec || !current) return;
    const field = `item:${current.process}:quantity`;
    const autoRaw = serverAutoFrom(model, defs)(scenarioKey, field);
    const auto = typeof autoRaw === "number" ? autoRaw : null;
    const items = spec.items.map((it, i) => (i === idx ? { ...it, quantityOverride: n } : it));
    commitScenarios(
      scenarios.map((s) => (s.key === scenarioKey ? { ...s, items } : s)),
      [
        {
          scenarioKey,
          field,
          auto,
          old: current.quantityOverride ?? auto,
          new: n,
          unit: "шт.",
          reason: "принят парк по имитации",
        },
      ],
    );
  }

  function onSpatialResult(snapshot: SpatialProjectSnapshot, result: SpatialProjectResult) {
    if (!editable || stale) return;
    const expected = model.simInputs[snapshot.scenarioKey]?.calculated;
    if (!expected || simInputIdentity(expected) !== snapshot.inputKey) return;
    const evidence = { sourceInputKey: result.sourceInputKey, executionInputKey: result.executionInputKey,
      simModelVersion: result.simModelVersion, input: snapshot.input,
      assessment: result.assessment as NonNullable<ScenarioSpec["spatialEvidence"]>["assessment"], summary: result.summary };
    const source = scenarios.find(s => s.key === snapshot.scenarioKey);
    if (!source || stableJson(source.spatialEvidence ?? null) === stableJson(evidence)) return;
    setFocusPick(snapshot.scenarioKey);
    // A completed check changes eligibility, not the cash-flow assumptions or the selected fleet.
    recalcWith(params, scenarios.map(s => s.key === source.key ? { ...s, spatialEvidence: evidence } : s));
  }


  function onPilotChange(value: { pilotPlan: PilotPlanInput; terminalResidualRub: number }) {
    if (!editable || stale || !focusSpec || focusSpec.kind === "asis") return;
    const shortPlan = (plan: PilotPlanInput | undefined) => plan ? {
      fleet: plan.fleet, chargers: plan.chargers, durationDays: plan.durationDays, dayBasis: plan.dayBasis,
      acquisition: plan.acquisition, targetThroughputPerH: plan.targetThroughputPerH,
      costs: Object.fromEntries(Object.entries(plan.costs).map(([key, cost]) => [key, { valueRub: cost.valueRub, source: cost.source.slice(0, 120) }])),
      contingencyPct: plan.contingencyPct, readiness: plan.readiness,
    } : null;
    commitScenarios(scenarios.map(s => s.key === focusSpec.key ? { ...s, ...value } : s), [
      { scenarioKey: focusSpec.key, field: "scenario:pilot", auto: null, old: shortPlan(focusSpec.pilotPlan), new: shortPlan(value.pilotPlan), reason: "Состав, срок, смета и критерии пилота заданы для выбранного сценария" },
      ...(value.terminalResidualRub === (focusSpec.terminalResidualRub ?? 0) ? [] : [{ scenarioKey: focusSpec.key, field: "scenario:residual", auto: 0, old: focusSpec.terminalResidualRub ?? 0, new: value.terminalResidualRub, unit: "₽", reason: "Явная оценка чистой остаточной стоимости в конце TCO-периода" }]),
    ]);
  }

  function onOperationsStaffing(value: ScenarioSpec["operationsStaffing"]) {
    if (!editable || stale || !focusSpec || focusSpec.kind === "asis") return;
    const next = { ...focusSpec };
    if (value) next.operationsStaffing = value;
    else delete next.operationsStaffing;
    commitScenarios(scenarios.map(s => s.key === next.key ? next : s), [{
      scenarioKey: next.key, field: "scenario:staffing", auto: null,
      old: focusSpec.operationsStaffing ?? null, new: value ?? null,
      reason: value?.reason ?? "Возврат к исходному допущению о выделенном посте эксплуатации",
    }]);
  }

  function onCostPackage(process: string, value: ScenarioItem["costPackage"]) {
    if (!editable || stale || !focusSpec || focusSpec.kind !== "purchase") return;
    const previous = focusSpec.items.find(item => item.process === process);
    if (!previous) return;
    const nextItem = { ...previous };
    if (value) nextItem.costPackage = value;
    else delete nextItem.costPackage;
    commitScenarios(scenarios.map(s => s.key === focusSpec.key ? { ...s, items: s.items.map(item => item === previous ? nextItem : item) } : s), [{
      scenarioKey: focusSpec.key, field: `item:${process}:package`, auto: null,
      old: previous.costPackage ?? null, new: value ?? null,
      reason: value?.reason ?? "Возврат к исходным отдельным статьям расходов",
    }]);
  }

  function onBuildMatchedComparison() {
    if (!editable || stale || !focusSpec || focusSpec.kind === "asis") return;
    const comparison = buildMatchedComparison({ input: { facility, params, paramDefs: defs, scenarios, products, norms }, source: focusSpec });
    setMatched({ inputKey: matchedInputKey, comparison });
  }

  function onAdoptMatchedScenario(value: ScenarioSpec) {
    if (!editable || stale || matched?.inputKey !== matchedInputKey || scenarios.length >= SCENARIOS_MAX) return;
    const spec = structuredClone(value);
    spec.key = nextScenarioKey(value.kind === "raas" ? "r" : "p", scenarios);
    spec.name = uniqueScenarioName(value.name.slice(0, SCENARIO_NAME_MAX), scenarios);
    commitScenarios([...scenarios, spec], [{ scenarioKey: spec.key, field: "scenario:add", auto: null, old: null, new: spec.name,
      reason: "Отдельный вариант из сравнения моделей при одинаковой нагрузке; пространственная пригодность проверяется отдельно" }],
    { where: "scenarios", text: `Создан сценарий «${spec.name}». Исходный сценарий сохранён.` });
    setFocusPick(spec.key);
  }

  // ——— Состав сценариев ———
  function onAddScenario(kind: Exclude<ScenarioKind, "asis">, process: string, slug: string) {
    if (scenarios.length >= SCENARIOS_MAX) return;
    const name = productsBySlug.get(slug)?.name ?? model.selection.find((r) => r.productSlug === slug)?.productName ?? slug;
    const key = nextScenarioKey(kind === "raas" ? "r" : "p", scenarios);
    const spec: ScenarioSpec = {
      key,
      name: uniqueScenarioName(scenarioTitle(kind, name), scenarios),
      kind,
      items: [{ process, productSlug: slug }],
    };
    commitScenarios(
      [...scenarios, spec],
      [{ scenarioKey: key, field: "scenario:add", auto: null, old: null, new: spec.name, reason: "добавлен вручную в шаге 6" }],
      { where: "scenarios", text: `Добавлен сценарий «${spec.name}»` },
    );
    setFocusPick(key);
  }

  function onCopyScenario() {
    const spec = scenarios.find((s) => s.key === focusKey);
    if (!spec || spec.kind === "asis" || scenarios.length >= SCENARIOS_MAX) return;
    const key = nextScenarioKey(spec.kind === "raas" ? "r" : "p", scenarios);
    const copy: ScenarioSpec = {
      ...structuredClone(spec),
      key,
      name: uniqueScenarioName(`${spec.name} (копия)`, scenarios),
    };
    commitScenarios(
      [...scenarios, copy],
      [{ scenarioKey: key, field: "scenario:add", auto: null, old: null, new: copy.name, reason: `копия сценария «${spec.name}»` }],
      { where: "scenarios", text: `Добавлена копия «${copy.name}» — меняйте её, исходный сценарий останется для сравнения` },
    );
    setFocusPick(key);
  }

  function onRemoveScenario() {
    const spec = scenarios.find((s) => s.key === focusKey);
    if (!spec || spec.kind === "asis" || scenarios.length <= SCENARIOS_MIN) return;
    commitScenarios(
      scenarios.filter((s) => s.key !== spec.key),
      [{ scenarioKey: spec.key, field: "scenario:remove", auto: null, old: spec.name, new: null, reason: "удалён в шаге 6" }],
      { where: "scenarios", text: `Сценарий «${spec.name}» удалён` },
    );
    setFocusPick(null);
  }

  // ——— Сохранение и выгрузка ———
  function getSaveInput(): SaveProjectInput {
    const scen = stale ? recalcWith(params, scenarios).scenarios : scenarios;
    return { expectedRevision: revision, params, scenarios: scen, changes: [...paramChanges.map((c) => c.change), ...pending.map((c) => c.change)] };
  }

  function onSaved(_r: Extract<SaveProjectResult, { ok: true }>, input: SaveProjectInput) {
    setRevision(_r.revision);
    const sent = new Set(input.changes);
    setPending((p) => p.filter((c) => !sent.has(c.change)));
    const canonical = _r.results;
    setSavedParams(canonical.paramsUsed);
    setSavedKey(stateKey(canonical.paramsUsed, canonical.scenarios));
    if (canAdoptSavedSnapshot(latestDraft.current, input)) {
      const savedModel = projectSnapshotModel(canonical);
      setParams(savedModel.paramsUsed);
      setScenarios(savedModel.scenarios);
      setNorms(savedModel.normsUsed);
      setStale(false);
      setCalc(c => ({ ...c, token: c.token + 1,
        input: { facility, params: savedModel.paramsUsed, paramDefs: defs, scenarios: savedModel.scenarios, products, norms: savedModel.normsUsed },
        base: savedModel, model: savedModel, sims: canonical.sim ?? {}, simSource: "stored", simMs: null, simCount: null }));
    }
  }

  function getCsv(): { csv: string; fileName: string } {
    const m = stale ? recalcWith(params, scenarios) : model;
    const sims = stale ? undefined : (calc.sims ?? undefined);
    const projectName = project.name;
    return { csv: projectCsv({ ...storedPartOf(m), sim: sims }, { projectName }), fileName: `${fileNameOf(projectName)}.csv` };
  }

  // ——— Имитация: сценарии и варианты парка ———
  const simScenarios = useMemo<SimScenario[]>(() => {
    const sims = calc.sims;
    return calc.model.scenarios.map((s) => {
      if (s.kind === "asis") return { key: s.key, name: s.name, variants: [] };
      const si = calc.model.simInputs[s.key];
      const calculated = si?.calculated ?? null;
      const st = sims?.[s.key] ?? null;
      const result = calc.model.results.find((r) => r.key === s.key);
      const simProcess = s.items.some((it) => processDef(it.process)?.simSupported);
      const reason = calculated
        ? undefined
        : result?.status === "refused"
          ? "сценарий не рассчитан — см. шаг 5"
          : si?.unavailableReason
            ? si.unavailableReason
            : !simProcess
              ? "имитация не моделирует этот процесс"
              : "нет данных для имитации";
      return {
        key: s.key,
        name: s.name,
        variants: buildSimVariants({
          scenarioName: s.name,
          calculated,
          byNorm: si?.byNorm ?? null,
          minStableFleet: storedMatches(st, calculated) ? st.minStableFleet : null,
          provenance: si?.provenance ?? null,
        }),
        stored: st,
        ...(si?.assumedUtilPct !== null && si?.assumedUtilPct !== undefined ? { assumedUtilPct: si.assumedUtilPct } : {}),
        ...(reason ? { unavailableReason: reason } : {}),
      };
    });
  }, [calc]);
  function onSpatialScenario(proposal: SpatialScenarioProposal, assumptions: SpatialFinancialAssumptions) {
    if (!editable || stale) throw new Error("Сначала пересчитайте актуальный редактируемый проект.");
    if (scenarios.length >= SCENARIOS_MAX) throw new Error(`В проекте уже ${SCENARIOS_MAX} сценариев. Удалите ненужный вариант перед добавлением.`);
    const source = scenarios.find(s => s.key === proposal.candidate.scenarioKey);
    const scenario = simScenarios.find(s => s.key === source?.key);
    const variant = scenario?.variants.find(v => v.id === proposal.candidate.variantId);
    if (!source || !variant?.input || simInputIdentity(variant.input) !== proposal.originalInputKey) throw new Error("Исходный вариант изменился после запуска 3D. Повторите проверку.");
    const snapshot = createSpatialProjectSnapshot({ requestId: proposal.requestId, scenarioKey: source.key,
      scenarioName: source.name, variantId: variant.id, input: variant.input,
      ...(variant.provenance ? { provenance: variant.provenance } : {}),
      ...(scenario?.assumedUtilPct === undefined ? {} : { assumedUtilPct: scenario.assumedUtilPct }),
    });
    const verified = parseSpatialScenarioProposal(proposal, snapshot);
    const key = nextScenarioKey(source.kind === "raas" ? "r" : "p", scenarios);
    const name = uniqueScenarioName(`${source.name} · 3D · ${verified.candidate.input.robots.count} шт.`, scenarios).slice(0, SCENARIO_NAME_MAX);
    const spec = buildSpatialFinancialScenario({ source, key, name, proposal: verified, ...assumptions });
    commitScenarios([...scenarios, spec], [{ scenarioKey: key, field: "scenario:add", auto: null, old: null, new: spec.name,
      reason: `Пространственная проверка: ${spec.items.find(i => processDef(i.process)?.simSupported)?.quantityOverride} роботов, ${verified.candidate.input.layout.chargers} зарядок; годовое покрытие ${formatNum(assumptions.annualCoverageShare * 100, 2)}%; денежная реализация труда ${formatNum(assumptions.cashRealizationShare * 100, 2)}%.`,
    }], { where: "scenarios", text: `Создан «${spec.name}». Экономика пересчитана; исходный вариант сохранён для сравнения.` });
    setFocusPick(key);
    goToStep(8, { focusHeading: true });
  }

  const simInitialKey =
    (recommendedKey && model.simInputs[recommendedKey]?.calculated ? recommendedKey : null) ??
    model.scenarios.find((s) => model.simInputs[s.key]?.calculated)?.key ??
    "";
  const showSimulation =
    facility === "warehouse" && scenarios.some((s) => s.items.some((it) => processDef(it.process)?.simSupported));

  // ——— Подбор: процессы и варианты «Добавить сценарий» ———
  const calcProcesses = processes.filter((p) => p.calcSupported);
  const otherProcesses = processes.filter((p) => !p.calcSupported);
  const addGroups = processes
    .map((p) => ({
      process: p.slug,
      name: p.name,
      options: model.selection
        .filter((r: SelectionResult) => r.process === p.slug)
        .map((r) => ({
          value: `${p.slug}${OPTION_SEP}${r.productSlug}`,
          process: p.slug,
          slug: r.productSlug,
          label: `${r.productName} — ${statusChipLabel(r.status).toLowerCase()}`,
        })),
    }))
    .filter((g) => g.options.length > 0);

  // ——— Журнал ———
  const scenarioNameOf = (key: string | undefined) =>
    key === undefined ? null : (scenarios.find((s) => s.key === key)?.name ?? key);
  const localEntries: ChangeLogEntry[] = [...paramChanges, ...pending]
    .map(({ change, at }) => ({
      at: at || "—",
      user: guest ? null : "вы — запишется при сохранении проекта",
      scenario: scenarioNameOf(change.scenarioKey),
      fieldLabel: changeFieldLabel(change.field, paramLabels, processNames),
      auto: change.auto,
      old: change.old,
      new: change.new,
      unit: change.unit ?? null,
      reason: change.reason ?? null,
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const journal = guest ? localEntries : [...changes, ...localEntries];

  const statusText = calcStatusText(calc.ms, model);
  const simText = simStatusText(calc, simStatus);
  // Only visited content mounts; section anchors/headings always exist. Visited children stay mounted.
  // Ритм шага: заголовок с вводной — одна группа, дальше блоки шага через 40px; внутри блока
  // свой, более плотный шаг. Раньше всё шло через 16px, и соседние разделы сливались.
  const sectionClass = "flex flex-col gap-5 sm:gap-10";
  const economicsPanelId = `${uid}-economics-panel`;
  const sensitivityPanelId = `${uid}-sensitivity-panel`;
  const noticeFor = (where: "selection" | "scenarios" | "params") => (notice && notice.where === where ? notice.text : "");
  const addDisabled = !editable
    ? "Режим чтения"
    : scenarios.length >= SCENARIOS_MAX
      ? `В проекте уже ${SCENARIOS_MAX} сценариев — удалите лишний`
      : null;
  const focusIsAsis = focusSpec?.kind === "asis";

  return (
    <div className="flex flex-col gap-10 pb-16" data-project-revision={revision} data-project-archive={archive}>
      {stored && project.id && (
        <VersionBanner
          archive={archive}
          revision={revision}
          projectId={project.id}
          dirty={dirty}
          stored={{
            modelVersion: stored.results.modelVersion,
            dataVersion: stored.results.dataVersion,
            calculatedAt: stored.results.calculatedAt,
          }}
          liveDataVersion={stored.liveDataVersion}
          disabledReason={
            project.isDemo
              ? "Демо-проект общий для всех, кто входит демо-аккаунтом: скопируйте его, чтобы пересчитать на актуальных данных."
              : mode === "readonly"
                ? "Режим чтения: пересчёт недоступен."
                : null
          }
        />
      )}

      {/* xl:top-[60px]: stacks under SiteHeader's own sticky bar (60px), not competing with it
          for the same y=0 — this bar's z-30 is higher than the header's z-20, so at top-0 it
          would have painted over the header once both were stuck. Below xl the header is not
          sticky (two rows, see site-header.tsx) and this bar takes top-0. */}
      <div
        ref={stickyRef}
        className="no-print sticky top-0 z-30 -mx-2 border-b bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 xl:top-[60px]"
      >
        <StepNav
          active={activeStep}
          onStepClick={goToStep}
          className="static border-b-0 bg-transparent py-1.5 backdrop-blur-none"
        />
        <RecalcBar
          onRecalc={recalc}
          readOnly={!editable}
          stale={stale}
          statusText={statusText}
          simText={simText}
          unsaved={mode === "owner" && !project.isDemo && dirty}
        />
      </div>

      {/* Шаги — пейджер: виден один, смена горизонтальным сдвигом (goToStep выше). */}
      <div ref={stepsRef} className="workspace-steps flex flex-col gap-10">
      {/* Шаг 1 — объект */}
      <section id="object" aria-labelledby={`${uid}-h-object`} className={sectionClass} hidden={activeStep !== 1}>
        <h2 id={`${uid}-h-object`} tabIndex={-1}>{stepHeading(1)}</h2>
        {visitedSteps.has(1) && <>
        {facility !== "warehouse" && (
          <p data-tone="warn" className="callout callout--sm w-fit">
            {PROTOTYPE_BADGE}
          </p>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Тип объекта</dt>
          <dd>{project.facilityLabel}</dd>
          {!guest && (
            <>
              <dt className="text-muted-foreground">Проект</dt>
              <dd>{project.name}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Объект</dt>
          <dd>{project.objectName?.trim() ? project.objectName : "не указан"}</dd>
          <dt className="text-muted-foreground">Источник параметров</dt>
          <dd>{sourceText(project.paramsSource, project.facilityLabel)}</dd>
          <dt className="text-muted-foreground">Режим</dt>
          <dd>
            {guest
              ? "гостевой расчёт: модель считается в браузере, ничего не сохраняется"
              : mode === "readonly"
                ? "режим чтения: изменения не сохраняются"
                : project.isDemo
                  ? "демо-проект, общий для всех, кто входит демо-аккаунтом: можно править и пересчитывать, но сохранить только в копии"
                  : "проект сохраняется на сервере и при повторном открытии показывает тот же расчёт на тех же данных"}
          </dd>
          <dt className="text-muted-foreground">Процессы объекта</dt>
          <dd>
            <ul className="flex flex-col gap-0.5">
              {processes.map((p) => (
                <li key={p.slug}>
                  {p.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    —{" "}
                    {p.calcSupported
                      ? p.simSupported
                        ? "подбор, экономика и имитация"
                        : "подбор и экономика"
                      : "подбор решений; экономика — прототип"}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </dl>
        </>}
      </section>

      {/* Шаг 2 — параметры */}
      <section id="params" aria-labelledby={`${uid}-h-params`} className={sectionClass} hidden={activeStep !== 2}>
        <header className="flex flex-col gap-2">
          <h2 id={`${uid}-h-params`} tabIndex={-1}>{stepHeading(2)}</h2>
          <p className="text-sm text-muted-foreground">
            У каждого поля — единица, пример, диапазон и источник базового значения. После правки нажмите «Пересчитать»:
            браузер считает по той же модели, что и сервер.
          </p>
        </header>
        {visitedSteps.has(2) && <>
        {editable && (
          <details className="rounded-lg border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Загрузить параметры из Excel или CSV по шаблону</summary>
            <div className="mt-3">
              <ImportForm facility={facility} onApply={onImportApply} />
            </div>
          </details>
        )}
        <p role="status" aria-live="polite" className="text-sm [&:empty]:hidden">
          {noticeFor("params")}
        </p>
        <ParamsForm
          defs={defs}
          values={params}
          issues={issues}
          baseValues={baseValues}
          onChange={editable ? onParamChange : undefined}
          onReset={editable ? onParamReset : undefined}
          readOnly={!editable}
        />
        </>}
      </section>

      {/* Шаг 3 — подбор */}
      <section id="selection" aria-labelledby={`${uid}-h-selection`} className={sectionClass} hidden={activeStep !== 3}>
        <header className="flex flex-col gap-2">
          <h2 id={`${uid}-h-selection`} tabIndex={-1}>{stepHeading(3)}</h2>
          <p className="text-sm text-muted-foreground">
            Выберите технику для процесса. Сначала показаны три кандидата; причины, ограничения и качество данных можно раскрыть.
          </p>
        </header>
        {visitedSteps.has(3) && <>
        <p role="status" aria-live="polite" className="text-sm [&:empty]:hidden">
          {noticeFor("selection")}
        </p>
        {[...calcProcesses, ...(calcProcesses.length === 0 ? otherProcesses : [])].map((p) => (
          <div key={p.slug} className="flex flex-col gap-2 rounded-lg border p-4">
            {!p.calcSupported && (
              <p data-tone="warn" className="callout callout--sm w-fit">
                Экономика для процесса в прототипе не рассчитывается
              </p>
            )}
            <SelectionPanel
              process={p}
              results={model.selection}
              inScenarios={itemKeys}
              onUse={editable ? (slug) => onUse(p, slug) : undefined}
              onManualAdd={editable ? (slug, reason) => onManualAdd(p, slug, reason) : undefined}
              readOnly={!editable}
              products={products}
            />
          </div>
        ))}
        {calcProcesses.length > 0 && otherProcesses.length > 0 && (
          <details className="rounded-lg border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Другие процессы объекта ({otherProcesses.length}): подбор решений без экономики — прототип
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              {otherProcesses.map((p) => (
                <div key={p.slug} className="flex flex-col gap-2 rounded-lg border p-4">
                  <p data-tone="warn" className="callout callout--sm w-fit">
                    Экономика для процесса в прототипе не рассчитывается
                  </p>
                  <SelectionPanel
                    process={p}
                    results={model.selection}
                    inScenarios={itemKeys}
                    onUse={editable ? (slug) => onUse(p, slug) : undefined}
                    onManualAdd={editable ? (slug, reason) => onManualAdd(p, slug, reason) : undefined}
                    readOnly={!editable}
                    products={products}
                  />
                </div>
              ))}
            </div>
          </details>
        )}
        </>}
      </section>

      {/* Шаг 4 — сравнение */}
      <section id="comparison" aria-labelledby={`${uid}-h-comparison`} className={sectionClass} hidden={activeStep !== 4}>
        <h2 id={`${uid}-h-comparison`} tabIndex={-1}>{stepHeading(4)}</h2>
        {visitedSteps.has(4) && <ComparisonTable rows={model.comparison} pinned={itemKeys} />}
      </section>

      {/* Шаг 5 — экономика */}
      <section id="economics" aria-labelledby={`${uid}-h-economics`} className={sectionClass} hidden={activeStep !== 5}>
        <header className="flex flex-col gap-2">
          <h2 id={`${uid}-h-economics`} tabIndex={-1}>{stepHeading(5)}</h2>
          <p className="text-sm text-muted-foreground">
            Состав оборудования, CAPEX и OPEX по статьям, денежный поток и «Как посчитано» — по выбранному сценарию.
            Расчётные значения можно изменить вручную: каждая корректировка попадает в журнал (шаг 8).
          </p>
        </header>
        {visitedSteps.has(5) && <>
        {/* Вкладки и панель, которой они управляют, — одна группа (16px), а не два блока шага. */}
        <div className="flex flex-col gap-4">
          {results.length > 0 && (
            <ScenarioTabs
              label="Сценарий для экономики"
              items={tabs}
              value={focusKey}
              onChange={setFocusPick}
              panelId={economicsPanelId}
              idBase={`${uid}-eco-tab`}
            />
          )}
          {focusResult && (
            <div
              id={economicsPanelId}
              role="tabpanel"
              aria-labelledby={`${uid}-eco-tab-${focusResult.key}`}
              className="flex flex-col gap-12"
            >
              {focusSpec && focusResult.kind !== "asis" && <OperationsStaffing
                key={`${focusSpec.key}-${stableJson(focusSpec.operationsStaffing ?? null)}`}
                value={focusSpec.operationsStaffing}
                annualCostRub={focusResult.status === "ok" ? focusResult.items.reduce((sum, item) => sum + item.operatingStaffRub, 0) : null}
                breakEvenAnnualRub={focusResult.status === "ok" ? staffingBreakEvenBudget(focusResult.items.reduce((sum, item) => sum + item.operatingStaffRub, 0), focusResult.npvRub, horizonFor(focusResult.key) ?? NaN, scenarioNorms(model, focusResult.key).discountRate) : null}
                defaultSalaryRubMonth={(focusResult.items[0]?.roleCostRubYear ?? 0) / (12 * scenarioNorms(model, focusResult.key).payrollMultiplier)}
                defaultPayrollMultiplier={scenarioNorms(model, focusResult.key).payrollMultiplier}
                defaultAnnualHours={scenarioNorms(model, focusResult.key).annualHoursPerFte}
                readOnly={!editable || stale}
                onChange={editable && !stale ? onOperationsStaffing : undefined}
              />}
              <ScenarioDetails
                result={focusResult}
                spec={focusSpec}
                products={model.productSnapshots}
                norms={scenarioNorms(model, focusResult.key)}
                horizonYears={horizonFor(focusResult.key)}
                paramLabels={paramLabels}
                readOnly={!editable}
                onCostPackage={editable && !stale ? onCostPackage : undefined}
                onOverride={
                  editable && focusResult.kind !== "asis"
                    ? (field, value, reason) => onItemOverride(focusResult.key, field, value, reason)
                    : undefined
                }
              />
              <NormsPanel
                rows={rows}
                overrides={focusSpec?.normOverrides}
                onOverride={
                  editable && focusResult.kind !== "asis"
                    ? (key, value, reason) => onNormOverride(focusResult.key, key, value, reason)
                    : undefined
                }
                readOnly={!editable || focusResult.kind === "asis"}
                scenarioName={focusResult.name}
              />
            </div>
          )}
        </div>
        </>}
      </section>

      {/* Шаг 6 — сценарии */}
      <section id="scenarios" aria-labelledby={`${uid}-h-scenarios`} className={sectionClass} hidden={activeStep !== 6}>
        <header className="flex flex-col gap-2">
          <h2 id={`${uid}-h-scenarios`} tabIndex={-1}>{stepHeading(6)}</h2>
          <p className="text-sm text-muted-foreground">
            Таблица сравнивает «Как есть» (текущий процесс без роботов) со сценариями роботизации: покупкой и услугой
            (RaaS). Строка «Имитация» показывает, подтверждает ли имитация расчётный парк (шаг 7).
          </p>
        </header>
        {visitedSteps.has(6) && <>
        {editable && facility === "warehouse" && <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor={`${uid}-matched-source`} className="flex min-w-0 flex-col gap-1.5 text-sm">Исходный сценарий для сравнения моделей
              <select id={`${uid}-matched-source`} className="h-10 max-w-full rounded-md border bg-background px-3 text-sm" value={focusKey} onChange={event => setFocusPick(event.target.value)}>
                {scenarios.map(spec => <option key={spec.key} value={spec.key}>{spec.name}</option>)}
              </select>
            </label>
            <Button type="button" variant="outline" disabled={stale || !focusSpec || focusSpec.kind === "asis"} onClick={onBuildMatchedComparison}>Сравнить модели: покупка и RaaS</Button>
          </div>
          {matched && matched.inputKey !== matchedInputKey && <p className="text-sm text-muted-foreground" role="status">Условия или исходный сценарий изменились. Постройте сравнение заново.</p>}
          {matched?.inputKey === matchedInputKey && <MatchedComparison comparison={matched.comparison} onAdopt={scenarios.length < SCENARIOS_MAX ? onAdoptMatchedScenario : undefined} readOnly={scenarios.length >= SCENARIOS_MAX} />}
        </div>}
        <ScenarioTable
          results={results}
          sim={calc.sims ?? {}}
          tcoYears={tcoYears}
          recommendedKey={recommendedKey}
          norms={model.normsUsed}
          readOnly={!editable}
          paramLabels={paramLabels}
        />
        <div className="rounded-lg border px-4 py-3">
          <Conclusion conclusion={model.conclusion} />
        </div>

        {editable && (
          <div className="flex flex-col gap-3 rounded-lg border px-4 py-3">
            <h3 className="section-title">Состав сценариев</h3>
            <p className="text-xs text-muted-foreground">
              В проекте от {SCENARIOS_MIN} до {SCENARIOS_MAX} сценариев, «Как есть» — ровно один. Сейчас: {scenarios.length}.
            </p>
            <AddScenarioForm groups={addGroups} disabledReason={addDisabled} onAdd={onAddScenario} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCopyScenario}
                disabled={!focusSpec || focusIsAsis || scenarios.length >= SCENARIOS_MAX}
                title={focusIsAsis ? "«Как есть» в проекте один — копировать его нельзя" : undefined}
              >
                Копировать сценарий
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onRemoveScenario}
                disabled={!focusSpec || focusIsAsis || scenarios.length <= SCENARIOS_MIN}
                title={
                  focusIsAsis
                    ? "«Как есть» удалить нельзя"
                    : scenarios.length <= SCENARIOS_MIN
                      ? `В проекте должно быть не меньше ${SCENARIOS_MIN} сценариев`
                      : undefined
                }
              >
                Удалить сценарий
              </Button>
              <span className="text-xs text-muted-foreground">
                {focusSpec ? `Выбран: «${focusSpec.name}» (вкладки ниже и в шаге 5)` : ""}
              </span>
            </div>
            <p role="status" aria-live="polite" className="text-sm [&:empty]:hidden">
              {noticeFor("scenarios")}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <h3 className="section-title">Чувствительность</h3>
          {results.length > 0 && (
            <ScenarioTabs
              label="Сценарий для анализа чувствительности"
              items={tabs}
              value={focusKey}
              onChange={setFocusPick}
              panelId={sensitivityPanelId}
              idBase={`${uid}-sens-tab`}
            />
          )}
          {focusResult && (
            <div id={sensitivityPanelId} role="tabpanel" aria-labelledby={`${uid}-sens-tab-${focusResult.key}`}>
              {focusResult.status === "ok" ? (
                <SensitivityPanel
                  scenarioName={focusResult.name}
                  rows={focusResult.sensitivity}
                  metric={focusResult.kind === "asis" ? "tco" : "npv"}
                  baseValue={focusResult.kind === "asis" ? focusResult.tcoRub : focusResult.npvRub}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Сценарий «{focusResult.name}» не рассчитан — чувствительность не считается. Причина — в шаге 5.
                </p>
              )}
            </div>
          )}
        </div>
        </>}
      </section>

      {/* Шаг 7 — имитация */}
      <section id="simulation" aria-labelledby={`${uid}-h-simulation`} className={sectionClass} hidden={activeStep !== 7}>
        <h2 id={`${uid}-h-simulation`} tabIndex={-1}>{stepHeading(7)}</h2>
        {visitedSteps.has(7) && <>
        {archive ? (
          <div className="grid gap-3 text-sm" data-archive-simulation>
            <p>Архив имитации: показаны сохранённые итоги. Текущий движок и проигрывание не запускаются при открытии.</p>
            {Object.entries(calc.sims ?? {}).filter(([, summary]) => summary !== null).map(([key, summary]) => summary && (
              <p key={key}>{model.scenarios.find(s => s.key === key)?.name ?? key}: {summary.fleet} роботов; достигнуто {formatNum(summary.achievedPerH, 1)} из {formatNum(summary.requiredPerH, 1)} пал./ч; вердикт {summary.verdict}.</p>
            ))}
            <p>{model.layout ? `Сохранённая планировка: ${formatNum(model.layout.widthM, 1)} × ${formatNum(model.layout.heightM, 1)} м, ${model.layout.slots.length} мест хранения.` : "Планировка и входы старого архива не сохранены. Они не восстанавливаются текущим алгоритмом."} Для нового прогона явно пересчитайте проект или его копию.</p>
          </div>
        ) : showSimulation ? (
          // Таблица «Откуда параметры имитации» печатает ссылки на источники текстом; длинная
          // ссылка без пробелов растягивала раскрытый блок шире карточки (её обрезает
          // overflow-hidden). Переносим такие строки в ячейках раскрывающихся блоков где угодно.
          <div className="min-w-0 [&_details_td]:[overflow-wrap:anywhere]">
            <WarehouseSimulation
              scenarios={simScenarios}
              initialKey={simInitialKey}
              selectedScenarioKey={focusKey}
              stale={stale}
              readOnly={!editable}
              onScenarioSelect={setFocusPick}
              onSpatialResult={onSpatialResult}
              onSpatialScenario={onSpatialScenario}
              onAcceptFleet={editable ? onAcceptFleet : undefined}
              nowFn={now}
              headingAs="h3"
            />
          </div>
        ) : (
          <FacilitySchematic
            facility={facility}
            facilityLabel={project.facilityLabel}
            areaM2={schematicAreaOf(model.paramsUsed)}
            badge={facility === "warehouse" ? null : PROTOTYPE_BADGE}
            note={
              facility === "warehouse"
                ? "Имитация выполняется для сценариев с роботом на процессе «Перемещение паллет»: выберите такое решение в шаге 3."
                : "Для этого типа объекта в прототипе показаны параметры, подбор и доступные решения; имитация парка не выполняется."
            }
          />
        )}
        </>}
      </section>

      {/* Шаг 8 — сохранение и отчёт */}
      <section id="report" aria-labelledby={`${uid}-h-report`} className={sectionClass} hidden={activeStep !== 8}>
        <h2 id={`${uid}-h-report`} tabIndex={-1}>{stepHeading(8, "Результат и план внедрения")}</h2>
        {visitedSteps.has(8) && <>
        {archive ? <section className="grid gap-2" aria-label="Сохранённый вывод">
          <h3>Сохранённый вывод модели {model.modelVersion}</h3>
          <p>{model.conclusion.headline}</p>
          <ul className="list-disc pl-5">{model.conclusion.bullets.map((text, index) => <li key={index}>{text}</li>)}</ul>
          <p className="text-xs text-muted-foreground">{model.conclusion.disclaimer}</p>
        </section> : <DecisionSummary model={model} scenarioKey={focusKey} stale={stale}
          expectedInput={model.simInputs[focusKey]?.calculated ?? null}
          onCompare={() => goToStep(6, { focusHeading: true })}
          onSimulation={() => goToStep(7, { focusHeading: true })}
          onPilot={() => { const plan = document.getElementById(`${uid}-pilot`); plan?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); plan?.focus({ preventScroll: true }); }} />}
        {focusResult?.status === "ok" && focusResult.kind !== "asis" && <section id={`${uid}-pilot`} tabIndex={-1} className="min-w-0 scroll-mt-24"><PilotPlan
          key={`${focusKey}:${calc.token}`} model={model} scenarioKey={focusKey}
          readOnly={!editable || stale} onChange={onPilotChange} /></section>}
        <ProjectToolbar
          mode={archive ? "readonly" : mode}
          revision={revision}
          projectId={project.id}
          projectName={project.name}
          reportScenarioKey={focusKey}
          isDemo={project.isDemo}
          dirty={dirty}
          getSaveInput={mode === "owner" ? getSaveInput : undefined}
          onSaved={onSaved}
          getCsv={guest ? getCsv : undefined}
          savedAtText={stored ? formatCalcDate(stored.results.calculatedAt) : null}
        />
        <ChangeLog entries={journal} guest={guest} />
        </>}
      </section>

      <StepPager active={activeStep} onStep={(n) => goToStep(n, { focusHeading: true })} />
      </div>

      {/* «Наверх» на длинных шагах (параметры, подбор, сравнение, экономика, сценарии,
          имитация) — кнопка сама появляется только после прокрутки. */}
      <BackToTop
        onTop={() => {
          const id = TZ_STEPS.find((st) => st.n === activeStep)?.id;
          if (id) document.getElementById(`${uid}-h-${id}`)?.focus({ preventScroll: true });
        }}
      />
    </div>
  );
}

/** Ключ состояния для «есть несохранённые изменения»: параметры и сценарии в каноническом JSON. */
function stateKey(params: ParamValues, scenarios: readonly ScenarioSpec[]): string {
  try {
    return projectDraftKey(params, scenarios);
  } catch {
    return "";
  }
}
