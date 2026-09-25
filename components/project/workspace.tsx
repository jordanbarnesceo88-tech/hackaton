"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { WarehouseSimulation } from "@/components/sim/warehouse-simulation";
import { isAbortError, yieldToPage } from "@/components/sim/run-headless";
import { buildSimVariants, storedMatches, type SimScenario } from "@/components/sim/variants";
import { Button } from "@/components/ui/button";
import { pluralRu } from "@/lib/format/plural";
import { formatNum } from "@/lib/format/rub";
import type { SaveProjectInput, SaveProjectResult } from "@/lib/projects/actions";
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
  ProductForCalc,
  ProjectResults,
  ScenarioItem,
  ScenarioKind,
  ScenarioSpec,
  SelectionResult,
} from "@/lib/tz/types";
import { stableJson } from "@/lib/tz/version";
import { cn } from "@/lib/utils";
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
import { STEP_SECTION_CLASS, StepNav, TZ_STEPS, stepHeading } from "./step-nav";
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
  const demo = `демо-данные организатора: Датасеты_хакатон.xlsx, лист «${facilityLabel}»`;
  if (!source) return demo;
  switch (source.kind) {
    case "demo":
      return demo;
    case "upload":
      return source.fileName ? `файл «${source.fileName}» (проверен при загрузке; сам файл не хранится)` : "загруженный файл";
    case "manual":
      return "ручной ввод от базовых значений организатора";
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
 * (`runProjectSims`): парк по расчёту, парк по норме и минимальный устойчивый парк двоичным
 * поиском на [1; 2N] (`firstTrue` из lib/sim/sweep), только асинхронно. Одинаковые входы
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
    const s = await runSim(input, { now, signal: opts.signal, yieldFn: yieldToPage, budgetMs: Math.max(1_000, left) });
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
        // Двоичный поиск «не держит → держит», как firstTrue: правый конец — часовой hi + 1.
        let a = lo;
        let b = hi + 1;
        while (a < b) {
          const mid = a + Math.floor((b - a) / 2);
          if (now() - tStart > budget) throw new MinFleetBudget();
          const s = await run({ ...input, robots: { ...input.robots, count: mid } });
          if (s.verdict === "CONFIRMED") b = mid;
          else a = mid + 1;
        }
        m = lo <= hi && b <= hi ? b : null;
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
    const minStableFleet = await minOf(calculated);
    out[spec.key] = toStored({
      ...s,
      scenarioKey: spec.key,
      assumedUtilPct: si.assumedUtilPct ?? s.assumedUtilPct,
      minStableFleet,
      fleetByNorm: si.byNorm ? si.byNorm.robots.count : null,
      verdictByNorm: verdictOf(byNorm),
    });
    done++;
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
  return `Имитация: ${count} ${pluralRu(count, ["сценарий проверен", "сценария проверено", "сценариев проверено"])} за ${msText(calc.simMs ?? 0)} мс`;
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
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b pb-1">
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
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              selected ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
            )}
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
          className="field h-8 py-0"
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
          className="field h-8 max-w-full py-0"
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
  const editable = mode !== "readonly";
  const guest = mode === "guest";

  // Нормативы проекта: у сохранённого проекта — из снимка, у гостя — живые. Не меняются.
  const [norms] = useState<NormValues>(() => initialModel.normsUsed);
  const [params, setParams] = useState<ParamValues>(initialParams);
  const [savedParams, setSavedParams] = useState<ParamValues>(initialParams);
  const [paramMeta, setParamMeta] = useState<Record<string, { at: string; reason?: string }>>({});
  const [scenarios, setScenarios] = useState<ScenarioSpec[]>(initialScenarios);
  const [savedKey, setSavedKey] = useState<string>(() => stateKey(initialParams, initialScenarios));
  const [pending, setPending] = useState<LocalChange[]>([]);
  const [stale, setStale] = useState(false);
  const [calc, setCalc] = useState<Calc>(() => ({
    token: 0,
    input: { facility, params: initialParams, paramDefs: defs, scenarios: initialScenarios, products, norms: initialModel.normsUsed },
    base: initialModel,
    model: initialModel,
    ms: initialMs,
    sims: stored ? stored.results.sim : null,
    simSource: stored ? "stored" : null,
    simMs: null,
    simCount: null,
  }));
  const [simStatus, setSimStatus] = useState<SimStatus | null>(null);
  const [focusPick, setFocusPick] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ where: "selection" | "scenarios" | "params"; text: string } | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  const model = calc.model;

  // ——— Имитация после каждого пересчёта ———
  const simTarget = calc.sims === null ? calc : null;
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

  // ——— Текущий шаг по прокрутке (подсветка в навигации) ———
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = TZ_STEPS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const step = TZ_STEPS.find((s) => s.id === top?.target.id);
        if (step) setActiveStep(step.n);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  // ——— Производные значения ———
  const defsByKey = useMemo(() => new Map(defs.map((d) => [d.key, d])), [defs]);
  const paramLabels = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d.label])), [defs]);
  const processNames = useMemo(() => Object.fromEntries(processes.map((p) => [p.slug, p.name])), [processes]);
  const issues = useMemo(() => validateParamValues(defs, params, { origin: "manual" }).issues, [defs, params]);
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
    return { params, scenarios: scen, changes: [...paramChanges.map((c) => c.change), ...pending.map((c) => c.change)] };
  }

  function onSaved(_r: Extract<SaveProjectResult, { ok: true }>, input: SaveProjectInput) {
    const sent = new Set(input.changes);
    setPending((p) => p.filter((c) => !sent.has(c.change)));
    setSavedParams(input.params);
    setSavedKey(stateKey(input.params, input.scenarios));
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
          : !simProcess
            ? "процесс решения имитацией не моделируется"
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
  const sectionClass = cn(STEP_SECTION_CLASS, "scroll-mt-32 flex flex-col gap-4");
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
    <div className="flex flex-col gap-10 pb-16">
      {stored && project.id && (
        <VersionBanner
          projectId={project.id}
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

      <div className="no-print sticky top-0 z-30 -mx-2 border-b bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <StepNav active={activeStep} className="static border-b-0 bg-transparent py-1.5 backdrop-blur-none" />
        <RecalcBar
          onRecalc={recalc}
          readOnly={!editable}
          stale={stale}
          statusText={statusText}
          simText={simText}
          unsaved={mode === "owner" && !project.isDemo && dirty}
        />
      </div>

      {/* Шаг 1 — объект */}
      <section id="object" aria-labelledby={`${uid}-h-object`} className={sectionClass}>
        <h2 id={`${uid}-h-object`}>{stepHeading(1)}</h2>
        {facility !== "warehouse" && (
          <p className="w-fit rounded-full border border-caution/50 bg-caution/10 px-3 py-1 text-sm font-medium">
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
                ? "только просмотр"
                : project.isDemo
                  ? "демо-проект: общий для всех, кто входит демо-аккаунтом, — правки можно посчитать, но сохранить — только в копии"
                  : "проект сохраняется на сервере; повторное открытие воспроизводит расчёт по снимку данных"}
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
      </section>

      {/* Шаг 2 — параметры */}
      <section id="params" aria-labelledby={`${uid}-h-params`} className={sectionClass}>
        <h2 id={`${uid}-h-params`}>{stepHeading(2)}</h2>
        <p className="text-sm text-muted-foreground">
          У каждого поля — единица, пример, диапазон и источник базового значения. После правки нажмите «Пересчитать»:
          модель считается в браузере той же функцией, что на сервере.
        </p>
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
      </section>

      {/* Шаг 3 — подбор */}
      <section id="selection" aria-labelledby={`${uid}-h-selection`} className={sectionClass}>
        <h2 id={`${uid}-h-selection`}>{stepHeading(3)}</h2>
        <p className="text-sm text-muted-foreground">
          Для каждого процесса объекта: статус решения, балл с разложением по факторам, причины включения или
          исключения, ограничения и недостающие данные. Исключённое решение можно добавить вручную — с причиной и
          пометкой ⚠.
        </p>
        <p role="status" aria-live="polite" className="text-sm [&:empty]:hidden">
          {noticeFor("selection")}
        </p>
        {[...calcProcesses, ...(calcProcesses.length === 0 ? otherProcesses : [])].map((p) => (
          <div key={p.slug} className="flex flex-col gap-2 rounded-lg border p-4">
            {!p.calcSupported && (
              <p className="w-fit rounded-full border border-caution/50 bg-caution/10 px-2.5 py-0.5 text-xs font-medium">
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
                  <p className="w-fit rounded-full border border-caution/50 bg-caution/10 px-2.5 py-0.5 text-xs font-medium">
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
      </section>

      {/* Шаг 4 — сравнение */}
      <section id="comparison" aria-labelledby={`${uid}-h-comparison`} className={sectionClass}>
        <h2 id={`${uid}-h-comparison`}>{stepHeading(4)}</h2>
        <ComparisonTable rows={model.comparison} pinned={itemKeys} />
      </section>

      {/* Шаг 5 — экономика */}
      <section id="economics" aria-labelledby={`${uid}-h-economics`} className={sectionClass}>
        <h2 id={`${uid}-h-economics`}>{stepHeading(5)}</h2>
        <p className="text-sm text-muted-foreground">
          Состав оборудования, CAPEX и OPEX по статьям, денежный поток и «Как посчитано» — по выбранному сценарию.
          Расчётные значения можно переопределить: каждое изменение попадает в журнал (шаг 8).
        </p>
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
            className="flex flex-col gap-6"
          >
            <ScenarioDetails
              result={focusResult}
              spec={focusSpec}
              products={model.productSnapshots}
              norms={scenarioNorms(model, focusResult.key)}
              horizonYears={horizonFor(focusResult.key)}
              paramLabels={paramLabels}
              readOnly={!editable}
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
      </section>

      {/* Шаг 6 — сценарии */}
      <section id="scenarios" aria-labelledby={`${uid}-h-scenarios`} className={sectionClass}>
        <h2 id={`${uid}-h-scenarios`}>{stepHeading(6)}</h2>
        <p className="text-sm text-muted-foreground">
          Базовый сценарий «Как есть» и варианты роботизации — покупка и услуга (RaaS) — в одной таблице. Строка
          «Имитация» показывает, подтверждает ли имитация расчётный парк (шаг 7).
        </p>
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
            <h3 className="text-base font-semibold">Состав сценариев</h3>
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
                variant="ghost"
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

        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">Чувствительность</h3>
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
      </section>

      {/* Шаг 7 — имитация */}
      <section id="simulation" aria-labelledby={`${uid}-h-simulation`} className={sectionClass}>
        <h2 id={`${uid}-h-simulation`}>{stepHeading(7)}</h2>
        {showSimulation ? (
          // Таблица «Откуда параметры имитации» печатает ссылки на источники текстом; длинная
          // ссылка без пробелов растягивала раскрытый блок шире карточки (её обрезает
          // overflow-hidden). Переносим такие строки в ячейках раскрывающихся блоков где угодно.
          <div className="min-w-0 [&_details_td]:[overflow-wrap:anywhere]">
            <WarehouseSimulation
              scenarios={simScenarios}
              initialKey={simInitialKey}
              readOnly={!editable}
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
      </section>

      {/* Шаг 8 — сохранение и отчёт */}
      <section id="report" aria-labelledby={`${uid}-h-report`} className={sectionClass}>
        <h2 id={`${uid}-h-report`}>{stepHeading(8, guest ? "Выгрузка и журнал" : "Сохранение и отчёт")}</h2>
        <ProjectToolbar
          mode={mode}
          projectId={project.id}
          projectName={project.name}
          isDemo={project.isDemo}
          dirty={dirty}
          getSaveInput={mode === "owner" ? getSaveInput : undefined}
          onSaved={onSaved}
          getCsv={guest ? getCsv : undefined}
          savedAtText={stored ? formatCalcDate(stored.results.calculatedAt) : null}
        />
        <ChangeLog entries={journal} guest={guest} />
      </section>
    </div>
  );
}

/** Ключ состояния для «есть несохранённые изменения»: параметры и сценарии в каноническом JSON. */
function stateKey(params: ParamValues, scenarios: readonly ScenarioSpec[]): string {
  try {
    return stableJson({ params, scenarios });
  } catch {
    return "";
  }
}
