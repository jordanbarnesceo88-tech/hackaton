import { rackRects } from "../../components/sim/scene-model";
import { createSim, expectedTasks, isDone } from "../../lib/sim/engine";
import { simInputIdentity } from "../../lib/sim/identity";
import { summarize } from "../../lib/sim/metrics";
import type { DemoModel } from "./core";
import { assessWarehouse } from "./assessment";
import { incidentSummary } from "./incidents";
import { createWarehouseTrafficState, prepareWarehouseTraffic, stepWarehouseTraffic } from "./traffic";
import { SPATIAL_MODEL_VERSION, parseSpatialProjectSnapshot } from "../../lib/sim/spatial-bridge";
import { checkExecution, type CooperativeOptions } from "../../lib/sim/cooperative";
import { demandMixOf, initialVacantStorageCount } from "../../lib/sim/demand-mix";

/** A project snapshot never goes through catalog defaults or the complex-demo geometry. */
export function calculateProjectPreview(value: unknown): DemoModel {
  const prepared = prepareProjectPreview(value);
  while (!isDone(prepared.terminal)) stepWarehouseTraffic(prepared.terminal);
  return finishProjectPreview(prepared);
}

/** Same canonical steps, with real event-loop yields and deadline checks during replay. */
export async function calculateProjectPreviewAsync(value: unknown, options: CooperativeOptions = {}): Promise<DemoModel> {
  const now = options.now ?? (() => performance.now());
  options = { ...options, now };
  const yieldFn = options.yieldFn ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  checkExecution(options);
  await yieldFn();
  checkExecution(options);
  const prepared = prepareProjectPreview(value);
  checkExecution(options);
  let sliceStart = now();
  while (!isDone(prepared.terminal)) {
    checkExecution(options);
    stepWarehouseTraffic(prepared.terminal);
    if (now() - sliceStart >= (options.sliceMs ?? 8)) {
      await yieldFn();
      checkExecution(options);
      sliceStart = now();
    }
  }
  checkExecution(options);
  const result = finishProjectPreview(prepared);
  checkExecution(options);
  return result;
}

function prepareProjectPreview(value: unknown) {
  const snapshot = parseSpatialProjectSnapshot(value);
  const original = structuredClone(snapshot.input);
  if (!Number.isSafeInteger(original.robots.count) || original.robots.count < 1 || original.robots.count > 60) throw new Error("Пространственный просмотр поддерживает парк от 1 до 60 роботов; исходный парк не сокращён.");
  if (!Number.isFinite(original.layout.activeAreaM2) || original.layout.activeAreaM2 <= 0 || original.layout.activeAreaM2 > 50000) throw new Error("Пространственный просмотр поддерживает активную площадь до 50 000 м²; исходная геометрия не заменена.");
  if (expectedTasks(original.demand) > 20000 || original.demand.warmupMin + original.demand.peakMin > 480) throw new Error("Снимок превышает предел пространственного просмотра: 20 000 заданий или 8 часов.");
  const source = createSim(original);
  if (source.precheck !== "ok") throw new Error(`Исходный снимок не поддерживается: ${source.precheck}. Данные проекта не заменены демонстрационными.`);
  const input = prepareWarehouseTraffic(original);
  input.demoIncidents = { ...input.demoIncidents!, enabled: false, schedule: [] };
  const terminal = createWarehouseTrafficState(input);
  return { snapshot, original, input, terminal };
}

function finishProjectPreview({ snapshot, original, input, terminal }: ReturnType<typeof prepareProjectPreview>): DemoModel {
  const simModelVersion = SPATIAL_MODEL_VERSION;
  const summary = { ...summarize(terminal, { scenarioKey: snapshot.scenarioKey, assumedUtilPct: snapshot.assumedUtilPct }), incidentSummary: incidentSummary(terminal), verdictScope: "intake-sla" as const, simModelVersion };
  const layout = input.siteLayout!;
  return {
    id: "project", title: snapshot.scenarioName, modelVersion: "spatial-project-1", simModelVersion, dataVersion: "project-snapshot",
    input, layout, racks: layout.obstacles?.filter(r => r.kind === "rack").map(r => ({ ...r })) ?? rackRects(layout).map(r => ({ ...r, y: layout.heightM - r.y - r.h })),
    summary, assessment: assessWarehouse(terminal, summary), finance: null,
    financeUnavailableReason: original.transportWorkflow === "closed-pod-1"
      ? "Подачи и возвраты стеллажей учтены в аналитическом цикле проекта. Этот прогон проверяет фактические очереди и выполнение нагрузки; результат двух часов не экстраполирует годовой NPV и денежную экономию."
      : "Это пространственная проверка сохранённого входа. Его исторический финансовый цикл не изменяется этим просмотром; годовые показатели этим прогоном не подтверждены.",
    product: { name: "Робот выбранного сценария", speedMps: input.robots.speedMps, loadedSpeedFactor: input.robots.loadedSpeedFactor },
    sources: (snapshot.provenance ?? []).map(p => `${p.label}: ${p.value ?? "не задано"} ${p.unit ?? ""}; ${p.origin}${p.note ? `; ${p.note}` : ""}`),
    assumptions: [
      "Передан точный снимок входа выбранного сценария: парк, нагрузка, seed, зарядки и характеристики сохранены. Каталожные значения демо не подставлялись.",
      original.siteLayout ? "Сохранён явный план сценария: стены, проёмы, препятствия и точки работы не заменяются. Для пространственного движения добавлены парковки, проверяемые подстеллажные заезды и контроллер; исполнительный граф имеет отдельный идентификатор. План без безопасного заезда отклоняется." : `Из параметров проекта построена типовая планировка с ${layout.slots.length} местами мобильных стеллажей: плотные парные ряды с шагом 1,20 м, зазорами 0,20 м, рабочими проходами 2,60 м и поперечными проездами 3,20 м. Это проектные допущения, а не обмеры объекта; исходный и исполнительный вход имеют разные идентификаторы. Превышение бюджета планировки отклоняется без сокращения числа стеллажей.`,
      "Учебные инциденты отключены: это базовая проверка исходного сценария. Внешний вид AMR использует условный референс Ronavi H1500 и не подтверждает конструкцию выбранного продукта.",
      "Между роботами используется консервативный диск радиусом 0,90 м и зазор 0,15 м. Стоящие стеллажи проверяются по прямоугольным габаритам; прямой подхват и извлечение учитывают ориентацию груза. Отступ маршрутов от стен — 0,95 м. На каждом шаге проверяется весь участок перемещения корпуса; зона подхвата удерживается до полного выезда робота. Люди, торможение, фактическая надёжность и качество обслуживания не моделируются; отсутствие любых тупиков не гарантируется.",
      "Стеллажи имеют постоянные идентификаторы. Подачи перед приёмкой и возвраты после отгрузки выполняются физически, занимают роботов и не засчитываются повторно в клиентский поток. Клиентский внутренний перенос идёт между местами хранения и меняет домашний адрес того же стеллажа; служебный возврат ему не добавляется. В процессе closed-pod-1 эти различия входят в аналитический цикл проекта; фактические ожидания и объезды проверяются этим прогоном.",
      original.demand.mix ? `Клиентский поток: приёмка ${(demandMixOf(original.demand).inbound*100).toFixed(2)} %, отгрузка ${(demandMixOf(original.demand).outbound*100).toFixed(2)} %, внутренние перемещения ${(demandMixOf(original.demand).internal*100).toFixed(2)} %. Пропорции следуют суточным объёмам проекта.` : "Исторический вход без состава потока: принято прежнее распределение 50/50 приёмки и отгрузки; внутренние клиентские перемещения не заданы.",
      ...(demandMixOf(original.demand).internal>0 ? [`Начальная доля свободных мест — явное допущение ${(100*(original.demand.storageVacancyShare??0)).toFixed(2)} %, а не обмер объекта: ${initialVacantStorageCount(layout.slots.length,original.demand)} из ${layout.slots.length} существующих мест изначально свободны. Целевое свободное место выбирается равномерно при назначении и резервируется до завершения переноса; освободившееся исходное место становится доступным. Товарные остатки и бизнес-правила адресного хранения не моделируются.`] : []),
      "К заданиям допускается весь выбранный парк, без дополнительного ограничения количества роботов по площади. Назначение учитывает занятые точки, доступность носителя, заряд и безопасный маршрут. Старейшее доступное из первых 16 клиентских заданий получает ближайший свободный робот; внутренние подачи и возвраты имеют приоритет. Возврат на парковку можно прервать. Подстеллажный манёвр защищён до полного освобождения выезда. В обычных проходах при конфликте ищется свободный маршрут или карман уступания, без бронирования всей будущей поездки. Один seed проверяет одну нагрузку.",
      "Итог возвращается в проект как отдельное доказательство этого входа. Для другого парка можно явно создать финансовый сценарий с годовыми допущениями; исходный вариант сохраняется для сравнения.",
    ],
    projectOrigin: { requestId: snapshot.requestId, scenarioKey: snapshot.scenarioKey, variantId: snapshot.variantId, sourceInput: structuredClone(snapshot.input), sourceInputKey: snapshot.inputKey, executionInputKey: simInputIdentity(input) },
  };
}
