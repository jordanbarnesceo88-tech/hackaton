import { cardinalHeading } from "./pod-collision";
import { rackRects, type Rect } from "../../components/sim/scene-model";
import { productForCalcFromSeed } from "../../lib/catalog/product-for-calc";
import { CATALOG } from "../../lib/data/organizer/catalog";
import { baseValuesFor, paramSpecsFor } from "../../lib/data/organizer/params";
import { businessExampleInputs } from "../../lib/projects/business-examples";
import { createSim, isDone, stepSim } from "../../lib/sim/engine";
import { buildWarehouseLayout } from "../../lib/sim/layout";
import type { SimRunSummary } from "../../lib/sim/metrics";
import { summarize } from "../../lib/sim/metrics";
import type { SimEngineState } from "../../lib/sim/state";
import type { SimInput, SimLayout } from "../../lib/sim/types";
import { MODEL_LIMITATIONS } from "../../lib/tz/econ/limitations";
import { chargersNeeded } from "../../lib/tz/econ/fleet";
import { buildProjectModel } from "../../lib/tz/model";
import { resolveNorms } from "../../lib/tz/norms";
import type { ScenarioOk, ScenarioSpec, ParamValues } from "../../lib/tz/types";
import { SPATIAL_MODEL_VERSION } from "../../lib/sim/spatial-bridge";
import { complexSite } from "./site";
import { frameOf, initTelemetry, observeStep, previewFrame } from "./telemetry";
import { calculateSectionCase, createSectionPlayback, stepSectionPlayback, sectionFrame, sectionDone, previewSectionFrame, type SectionInput, type SectionState } from "./sections";
import { attachWarehouseSafety, createWarehouseTrafficState, isTrafficInput, isWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";
import { positionAlong } from "../../lib/sim/routing";
import { attachIncidentFrame, incidentSummary } from "./incidents";
import { assessCleaning, assessWarehouse, type DemoAssessment } from "./assessment";
import { carrierSpec, type CarrierInput } from "./carriers";
import { pedestrianFrame } from "./pedestrians";
export { carrierSpec, carrierPose } from "./carriers";
export { compareWarehouseFleet, applyFleetComparison } from "./comparison";
export { calculateProjectPreview } from "./project-input";
export { buildPilotPlan } from "./pilot";
export { createSpatialProjectSnapshot } from "../../lib/sim/spatial-bridge";
export { calculateSpatialFinance } from "./finance";

export const DEMO_CASES = [
  { id: "steady-flow", title: "Регулярный поток", description: "6 роботов и 2 зарядки на 5 000 м². Тот же учебный объект, что в расчёте экономики; выполнение нагрузки проверяется заново." },
  { id: "complex", title: "Склад с отделениями", description: "L-планировка: стены, дверные проезды, зоны мобильных стеллажей, комплектация, экспедиция и зарядная зона." },
  { id: "baseline", title: "Расчётный парк", description: "Базовые параметры склада организатора; парк подобран автоматически." },
  { id: "capacity-reserve", title: "Парк из 14 роботов", description: "14 роботов на базовом потоке: сравните выполненную работу и ограничения с расчётным парком." },
  { id: "insufficient", title: "Недостаточный парк", description: "Тот же склад и поток, но только 3 робота." },
  { id: "increased-flow", title: "Повышенный пик", description: "11 роботов при пиковом коэффициенте 2,5 вместо 1,5." },
  { id: "sections", title: "Уборка по секциям · эксперимент", description: "Дополнительный сценарий уборки; не заменяет складской расчёт команды." },
] as const;

export type DemoOverrides = { fleet?: number; peakFactor?: number; areaM2?: number };
type Finance = Pick<ScenarioOk, "capexRub" | "npvRub" | "paybackYears" | "tcoRub">;
export type DemoModel = {
  qualificationDiagnostics?: import("../../lib/sim/capacity-protocol").QualificationDiagnostics;
  id: string;
  title: string;
  modelVersion: string;
  simModelVersion: string;
  dataVersion: string;
  input: CarrierInput;
  layout: SimLayout;
  /** World coordinates, metres from the lower left, matching playback positions. */
  racks: Rect[];
  /** Legacy verdict describes intake SLA; assessment judges the complete demo goal. */
  summary: SimRunSummary & { verdictScope: "intake-sla" };
  assessment: DemoAssessment;
  finance: { purchase: Finance; raas: Finance | null } | null;
  financeUnavailableReason?: string;
  financialParams?: ParamValues;
  financialSourceInput?: SimInput;
  sources: string[];
  assumptions: string[];
  product: { name: string; speedMps: number; loadedSpeedFactor: number };
  projectOrigin?: { requestId: string; scenarioKey: string; variantId: string; sourceInput: SimInput; sourceInputKey: string; executionInputKey: string };
};

const products = CATALOG.map(productForCalcFromSeed);
const product = products.find((p) => p.slug === "ronavi-h1500");
const paramDefs = paramSpecsFor("warehouse");

function validateOverrides(overrides: DemoOverrides): void {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Неверные параметры демо");
  for (const [key, value] of Object.entries(overrides)) {
    if (!["fleet", "peakFactor", "areaM2"].includes(key)) throw new Error(`Неизвестный параметр: ${key}`);
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Параметр ${key} должен быть конечным числом`);
    if (key === "fleet") {
      // Same manual-fleet ceiling as the project editor; not a hardware capacity limit.
      if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error("Парк: целое число от 1 до 500");
    } else {
      const spec = paramDefs.find((p) => p.key === (key === "areaM2" ? "activeAreaM2" : key));
      if (!spec || (spec.min !== null && value < spec.min) || (spec.max !== null && value > spec.max)) {
        throw new Error(`${key}: допустимый диапазон ${spec?.min}–${spec?.max}`);
      }
    }
  }
}

type WarehouseCaseId = "steady-flow" | "complex" | "baseline" | "capacity-reserve" | "insufficient" | "increased-flow";
type SectionModel = ReturnType<typeof calculateSectionCase>;
/** Recheck the chosen N/C on its canonical financial source before attaching a financial result. */
export function recheckSpatialFinanceInput(model: DemoModel): DemoModel {
  if (model.projectOrigin || !model.financialParams || !model.financialSourceInput) throw new Error("Для проверки нужен автономный склад с финансовым исходником");
  const source = structuredClone(model.financialSourceInput);
  source.robots.count = model.input.robots.count;
  source.layout.chargers = model.input.layout.chargers;
  const input = prepareWarehouseTraffic(source);
  const incidents = (model.input as SimInput & { demoIncidents?: typeof input.demoIncidents }).demoIncidents;
  if (incidents) input.demoIncidents = structuredClone(incidents);
  const terminal = createPlayback(input);
  while (!isDone(terminal)) stepPlayback(terminal);
  const summary = { ...summarize(terminal, { scenarioKey: "purchase" }), incidentSummary: incidentSummary(terminal), verdictScope: "intake-sla" as const, simModelVersion: SPATIAL_MODEL_VERSION };
  const layout = input.siteLayout!;
  const sourceModel = structuredClone(model) as DemoModel & { comparisonOrigin?: unknown; financialModel?: unknown; financialAssumptions?: unknown };
  delete sourceModel.comparisonOrigin; delete sourceModel.financialModel; delete sourceModel.financialAssumptions;
  return { ...sourceModel, input, layout, summary, assessment: assessWarehouse(terminal, summary), finance: null,
    sources: model.sources.map(line => line.startsWith("Сравнение ") ? `До повторной проверки: ${line}` : line),
    racks: layout.obstacles?.filter(r => r.kind === "rack").map(r => ({ ...r })) ?? rackRects(layout),
    financialSourceInput: source,
    assumptions: [...model.assumptions, "Перед финансовым сравнением выбранные N/C повторно проверены на исходной геометрии; граф парковок сравнения не переносится скрыто."],
  };
}

export function calculateCase(id: "sections", overrides?: DemoOverrides): SectionModel;
export function calculateCase(id: WarehouseCaseId, overrides?: DemoOverrides): DemoModel;
export function calculateCase(id: string, overrides?: DemoOverrides): DemoModel | SectionModel;
export function calculateCase(id: string, overrides: DemoOverrides = {}): DemoModel | SectionModel {
  if (id === "sections") return calculateSectionCase(overrides);
  const preset = DEMO_CASES.find((c) => c.id === id);
  if (!preset) throw new Error(`Неизвестный сценарий: ${id}`);
  validateOverrides(overrides);
  if (!product) throw new Error("В каталоге отсутствует Ronavi H1500");
  const example = id === "steady-flow" ? businessExampleInputs("steady-flow", baseValuesFor("warehouse"), products) : null;
  const params = example?.params ?? baseValuesFor("warehouse");
  params.peakFactor = overrides.peakFactor ?? (id === "increased-flow" ? 2.5 : params.peakFactor ?? 1.5);
  if (overrides.areaM2 !== undefined) {
    params.activeAreaM2 = overrides.areaM2;
    // Organizer baseline describes the active area as 50% of the total area.
    params.totalAreaM2 = 2 * overrides.areaM2;
  }
  const fleet = overrides.fleet ?? (id === "steady-flow" ? 6 : id === "capacity-reserve" ? 14 : id === "insufficient" ? 3 : id === "increased-flow" || id === "complex" ? 11 : undefined);
  const item = { process: "pallet-transport", productSlug: product.slug, ...(fleet === undefined ? {} : { quantityOverride: fleet }) };
  const scenarios: ScenarioSpec[] = example?.scenarios ?? [
    { key: "asis", name: "Как есть", kind: "asis", items: [] },
    { key: "purchase", name: "Покупка", kind: "purchase", items: [{ ...item }] },
    { key: "raas", name: "RaaS", kind: "raas", items: [{ ...item }] },
  ];
  if (example && overrides.fleet !== undefined) for (const scenario of scenarios) for (const selected of scenario.items) selected.quantityOverride = overrides.fleet;
  if (id === "complex") {
    const site = complexSite(Number(params.activeAreaM2), chargersNeeded(fleet!, product, resolveNorms()).count, true);
    params.receivingDocksCount = site.receiving.length;
    params.shippingDocksCount = site.shipping.length;
    const scale=Math.sqrt(Number(params.activeAreaM2)/10000);
    const trajectory=[{tS:0,x:124*scale,y:10*scale}];
    for(let t=600;t<8000;t+=300)trajectory.push({tS:t,x:124*scale,y:10*scale},{tS:t+20,x:124*scale,y:30*scale},{tS:t+80,x:124*scale,y:30*scale},{tS:t+100,x:124*scale,y:10*scale});
    for (const spec of scenarios) if (spec.kind !== "asis") {
      spec.pedestrians={version:"pedestrians-1",policy:"controlled-crossing",crossingWidthM:2,reactionTimeS:.5,decelerationMps2:.8,accelerationMps2:.8,clearanceM:.25,people:[{id:"person-crosswalk-1",radiusM:.3,trajectory:structuredClone(trajectory)}]};
      spec.siteLayout = structuredClone(site);
      spec.items[0]!.chargersOverride = site.chargers.length;
    }
  }
  const model = buildProjectModel({ facility: "warehouse", params, paramDefs, scenarios, products, norms: resolveNorms() });
  const invalid = model.paramIssues.filter((issue) => issue.severity === "error");
  if (invalid.length) throw new Error(invalid.map((issue) => issue.message).join("; "));
  const purchase = model.results.find((r) => r.key === "purchase");
  if (!purchase || purchase.status !== "ok") throw new Error("Не удалось рассчитать покупку для этих параметров");
  const raas = model.results.find((r) => r.key === "raas");
  const sim = model.simInputs.purchase;
  const calculatedInput = sim?.calculated;
  if (!calculatedInput) throw new Error(sim?.unavailableReason ?? "Имитация для этих параметров недоступна");
  let input = calculatedInput;
  const financialSourceInput = structuredClone(input);
  const preparedInput = prepareWarehouseTraffic(input);
  if (example) preparedInput.demoIncidents = { ...preparedInput.demoIncidents!, enabled: false, schedule: [] };
  input = preparedInput;
  const layout = input.siteLayout ?? buildWarehouseLayout(input.layout);
  const terminal = createPlayback(input);
  while (!isDone(terminal)) stepPlayback(terminal);
  const summary = { ...summarize(terminal, { scenarioKey: "purchase", assumedUtilPct: sim.assumedUtilPct ?? undefined }), incidentSummary: incidentSummary(terminal), verdictScope: "intake-sla" as const, simModelVersion: SPATIAL_MODEL_VERSION };
  const sources = [
    ...paramDefs.filter((p) => p.sourceRef).map((p) => `${p.label}: ${params[p.key]} ${p.unit ?? ""} — ${p.sourceRef}${params[p.key] !== p.base ? "; изменено в демо, не измерение" : ""}`),
    ...product.sources.map((s) => `${s.label}: ${s.value} — ${s.sourceUrl ?? s.sourceRef ?? s.origin}; происхождение: ${s.origin}${s.date ? ` (${s.date})` : ""}${s.confirmed ? "" : "; требует подтверждения"}`),
    ...(id === "complex" ? [`L-планировка, перегородки и дверные проезды — проектное допущение демо, не чертёж заказчика. Хранение организовано как ${layout.slots.length} напольных домашних мест мобильных стеллажей. Стены, колонны и столы комплектации участвуют в маршрутизации.`] : [purchase, ...(raas?.status === "ok" ? [raas] : [])].flatMap((r) => [...r.capexLines, ...r.opexLines].map((line) => `${r.name} / ${line.label}: ${line.valueRub} ₽; происхождение: ${line.origin}${line.originNote ? `; ${line.originNote}` : ""}; ${line.substituted}`))),
  ];
  return {
    id, title: preset.title, modelVersion: model.modelVersion, simModelVersion: SPATIAL_MODEL_VERSION, dataVersion: model.dataVersion, input, layout,
    racks: layout.obstacles?.filter(r => r.kind === "rack").map(r => ({ ...r })) ?? [],
    summary,
    assessment: assessWarehouse(terminal, summary),
    finance: null, financialParams: model.paramsUsed, financialSourceInput,
    financeUnavailableReason: "Прогон учитывает защитные остановки и объезды. Для экономики этого состава задайте годовой охват нагрузки и денежную реализацию труда кнопкой ниже. Короткий прогон сам по себе не определяет годовую экономию. Зарядные станции взяты из опорного расчёта.",
    sources,
    assumptions: [
      ...(id==="complex"?["Учебный управляемый переход в экспедиции: человек ждёт у бордюра, пока переход свободен, и идёт без остановок до другого бордюра. Расписание задаёт желаемое, а не гарантированное начало. Радиус 0,30 м, запас на реакцию 0,5 с, торможение/разгон 0,8 м/с² и зазор 0,25 м — оценочные допущения. Интеграция 1 с с дополнительным запасом одного шага; это не сертификация безопасности."]:[]),
      carrierSpec(input).sourceNote,
      ...(example ? [example.assumption, "Учебные отказы в регулярном потоке отключены, как в исходном расчёте. Для разбора отказов выберите другой складской сценарий."] : ["Демонстрация на снимке каталога и базовых параметрах организатора, а не измерения реального объекта. Вердикт модели не доказывает окупаемость или успешность пилота."]),
      ...(id === "capacity-reserve" ? ["Парк 14 — фиксированный вариант сравнения на базовой нагрузке, а не резерв относительно текущего расчётного парка. Результат пересчитывается движком и не гарантирует выполнение нагрузки."] : []),
      ...(!example ? ["Инциденты привода, локализации, связи и контроллера АКБ заданы расписанием демо. Подтверждение, диагностика и восстановление выполняются автоматически в модели, не означают фактический ремонт или отправку операторских команд. При критическом инциденте робот и его операции остановлены, задание удерживается, корпус остаётся препятствием. Предупреждение АКБ не означает низкий SOC и не останавливает работу."] : []),
      "Исходный поток разделён 50/50 на приёмку и отгрузку и учитывается в паллетных заказах. Перед приёмкой тот же стеллаж физически подаётся с домашнего места, после отгрузки возвращается туда. Эти внутренние рейсы имеют отдельные задания и расходуют время и энергию, но не увеличивают число клиентских заказов. Один фиксированный seed воспроизводит нагрузку и исполнение.",
      "areaM2 — площадь активной зоны; общая площадь принята вдвое больше по базовому допущению организатора. Зарядные станции определяет текущий расчёт экономики.",
      "Ставка RaaS Ronavi — опубликованная ставка «от» для компании, а не подтверждённое предложение на H1500. Перед закупкой нужны договор, состав услуг и актуальные цены.",
      "Время зарядки взято из снимка организатора; в каталоге есть расхождения источников. Нужно проверить режим зарядки у производителя.",
      "Габарит движения: консервативный диск радиусом 0,90 м для робота со стеллажом, защитный зазор 0,15 м; отступ графа от стен 0,95 м. Стоящие стеллажи проверяются по прямоугольному габариту; прямое извлечение длиной 2 м заканчивается в рабочем проходе, где разрешён поворот. Только назначенный робот заезжает под свой стеллаж по прямому участку и выезжает назад после постановки и полного опускания платформы. Весь перемещаемый отрезок резервируется; при конфликте движение и соответствующий таймер останавливаются. Люди и тормозной путь не моделируются.",
      "В автоматически построенном плане хранение организовано напольными местами постоянных мобильных стеллажей; ряды имеют шаг 1,20 м, парную глубину 3 м, рабочие проходы 2,60 м и поперечные проходы 3,20 м через каждые 12 мест. У каждого места есть проверенный прямой заезд/выезд длиной 2 м. Явный план сохраняет исходные стены, препятствия и точки и отклоняется, если такой подхват невозможен. Это проектная схема, не WMS и не чертёж заказчика.",
      "Если граф проходов не даёт объезд, выполняется ограниченный поиск по сетке доступного пола с проверкой стен, границ и других корпусов. Дискретизация и лимит поиска могут пропустить существующий путь: робот безопасно ждёт, а глобальная гарантия выхода из любого тупика не заявляется. Закреплённая парковка другого робота не используется как карман уступания.",
      "Ожидания в итоговой сводке включают занятые точки и конфликты движения. Начальные позиции — отдельные соединённые с графом парковочные карманы; все роботы моделируются физически, а не накладываются друг на друга.",
      "К заданиям допускается весь выбранный парк; дополнительного ограничения количества роботов по площади нет. Назначение учитывает занятые точки, доступность носителя, заряд и безопасный маршрут. Из первых 16 ожидающих клиентских заданий выбирается старейшее доступное, для него — ближайший свободный робот; внутренние подачи и возвраты обслуживаются прежде новых клиентских заявок. Возврат на парковку можно прервать новым заданием. Заезд под стеллаж и извлечение защищены локальным разрешением до полного освобождения манёвра. Обычные проходы не бронируются на всю будущую поездку: при конфликте ищется свободный маршрут или карман уступания. Перестроения маршрута выполняются не чаще одного за шаг и одного за 5 с для робота. Глобальная гарантия отсутствия тупиков не заявляется.",
      ...(id === "complex" ? ["Стены высотой 4,5 м, колонны 6 м и оборудование — проектное допущение для демонстрации.", "Планировочный граф задаёт реальные маршруты для этой геометрии. ETA — оценка движения и собственных операций, без неизвестного ожидания в очередях; телеметрия — данные модели, не реальные датчики.", ...MODEL_LIMITATIONS.filter((s) => !s.startsWith("Длина плеча") && !s.startsWith("Разъезды"))] : MODEL_LIMITATIONS.filter((s) => !s.startsWith("Разъезды"))),
    ],
    product: { name: product.name, speedMps: input.robots.speedMps, loadedSpeedFactor: input.robots.loadedSpeedFactor },
  };
}

type PlaybackState = SimEngineState | SectionState;
const sectionInput = (input: SimInput | SectionInput): input is SectionInput => "kind" in input && input.kind === "cleaning";
const sectionState = (state: PlaybackState): state is SectionState => "kind" in state.input && state.input.kind === "cleaning";
export function createPlayback(input: SimInput): SimEngineState;
export function createPlayback(input: SectionInput): SectionState;
export function createPlayback(input: SimInput | SectionInput): PlaybackState;
export function createPlayback(input: SimInput | SectionInput): PlaybackState {
  if (sectionInput(input)) return createSectionPlayback(input);
  carrierSpec(input as CarrierInput);
  if (isTrafficInput(input)) { const state = createWarehouseTrafficState(input); initTelemetry(state); return state; }
  const state = createSim(structuredClone(input));
  if (state.precheck !== "ok") throw new Error(`Недопустимый вход имитации: ${state.precheck}`);
  initTelemetry(state);
  return state;
}

/** Batching never changes the engine's one-second integration step. */
export function stepPlayback(state: PlaybackState, seconds = 1): void {
  if (sectionState(state)) { stepSectionPlayback(state, seconds); return; }
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 3600) throw new Error("Шаг проигрывания: целое число секунд от 0 до 3600");
  for (let i = 0; i < seconds && !isDone(state); i++) observeStep(state, () => isWarehouseTrafficState(state) ? stepWarehouseTraffic(state) : stepSim(state));
}

function warehouseFrame(state: SimEngineState) {
  const frame = isWarehouseTrafficState(state) ? attachWarehouseSafety(frameOf(state), state) : frameOf(state);
  return attachIncidentFrame(frame, state);
}
export function playbackFrame(state: SimEngineState): ReturnType<typeof warehouseFrame>;
export function playbackFrame(state: SectionState): ReturnType<typeof sectionFrame>;
export function playbackFrame(state: PlaybackState): ReturnType<typeof warehouseFrame> | ReturnType<typeof sectionFrame>;
export function playbackFrame(state: PlaybackState) {
  if (sectionState(state)) return sectionFrame(state);
  return warehouseFrame(state);
}

/** Smooth visual preview only: canonical time and KPI accumulators remain unchanged. */
export function previewInterpolate(state: SimEngineState, alpha: number): ReturnType<typeof warehouseFrame>;
export function previewInterpolate(state: SectionState, alpha: number): ReturnType<typeof previewSectionFrame>;
export function previewInterpolate(state: PlaybackState, alpha: number): ReturnType<typeof warehouseFrame> | ReturnType<typeof previewSectionFrame>;
export function previewInterpolate(state: PlaybackState, alpha: number) {
  if (sectionState(state)) return previewSectionFrame(state, alpha);
  if (isWarehouseTrafficState(state)) return previewSafeWarehouse(state, alpha);
  return attachIncidentFrame(previewFrame(state, alpha), state);
}

const safePreviews = new WeakMap<SimEngineState, { tS: number; next: SimEngineState }>();
function previewSafeWarehouse(state: SimEngineState, alpha: number) {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error("Доля предварительного кадра: 0..1");
  const frame = playbackFrame(state);
  if (isDone(state) || alpha === 0) return frame;
  let cache = safePreviews.get(state);
  if (!cache || cache.tS !== state.tS) {
    // Playback never edits static geometry. Share its identity so speculative steps
    // reuse the bounded floor grid instead of rebuilding it for every cloned frame.
    const next = { ...structuredClone(state), layout: state.layout };
    if (isWarehouseTrafficState(next)) stepWarehouseTraffic(next);
    cache = { tS: state.tS, next }; safePreviews.set(state, cache);
  }
  frame.tS = state.tS + alpha;
  if(isWarehouseTrafficState(cache.next)&&cache.next.demoPedestrians)Object.assign(frame,{people:pedestrianFrame(cache.next.demoPedestrians,frame.tS)});
  frame.robots.forEach((r, i) => {
    const current = state.robots[i]!, future = cache.next.robots[i]!;
    if (r.incident?.active && r.incident.haltsRobot) { r.vMps = 0; return; }
    if (Math.abs(future.x - current.x) + Math.abs(future.y - current.y) < 1e-9) { r.vMps = 0; return; }
    const pathChanged = JSON.stringify(current.path) !== JSON.stringify(future.path), path = pathChanged ? future.path : current.path;
    const from = pathChanged ? 0 : current.distM, to = future.distM;
    const distance=from+Math.max(0,to-from)*alpha,p=positionAlong(path,distance);
    r.x=p.x;r.y=p.y;r.vMps=Math.max(0,to-from);
    const reverseSource = pathChanged && future.underlift?.stage === "retreat" ? future : current;
    const locked = reverseSource.underlift && (["extract", "exit"].includes(reverseSource.underlift.stage) ||
      reverseSource.underlift.stage === "retreat" && (pathChanged || reverseSource.distM < (reverseSource.underlift.retreatUntilM ?? 0) - 1e-9));
    let heading=locked?reverseSource.underlift!.headingRad:r.heading;
    if(!locked){let walked=0;for(let j=1;j<path.length;j++){const a=path[j-1]!,b=path[j]!,length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);if(length>1e-9&&walked+length>=distance-1e-9){heading=cardinalHeading(a,b,heading);break;}walked+=length;}}
    r.heading=heading;if(r.underlift)r.underlift.headingRad=heading;
  });
  for (const carrier of frame.carriers) if (carrier.phase === "carrying" && carrier.robotId !== null) {
    const robot = frame.robots.find(r => r.id === carrier.robotId);
    if (robot) { carrier.x = robot.x; carrier.y = robot.y; carrier.heading = robot.heading; }
  }
  for (const robot of frame.robots) if (robot.podPose) {
    const pod = frame.carriers.find(c => c.id === robot.podPose!.id);
    if (pod) robot.podPose = { id: pod.id, x: pod.x, y: pod.y, heading: pod.heading, liftM: pod.liftM, contents: pod.contents };
  }
  return frame;
}

export const isPlaybackDone = (state: PlaybackState): boolean => sectionState(state) ? sectionDone(state) : isDone(state);

/** Current canonical assessment is separate from the terminal headless result in model.assessment. */
export function assessPlayback(state: PlaybackState): DemoAssessment {
  return sectionState(state) ? assessCleaning(state) : assessWarehouse(state, summarize(state));
}
