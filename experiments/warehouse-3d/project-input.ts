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
    financeUnavailableReason: "Это пространственная проверка входа выбранного сценария. Финансовый расчёт проекта не пересчитан с учётом транспортных потерь; его NPV и экономия не подтверждены этим прогоном.",
    product: { name: "Робот выбранного сценария", speedMps: input.robots.speedMps, loadedSpeedFactor: input.robots.loadedSpeedFactor },
    sources: (snapshot.provenance ?? []).map(p => `${p.label}: ${p.value ?? "не задано"} ${p.unit ?? ""}; ${p.origin}${p.note ? `; ${p.note}` : ""}`),
    assumptions: [
      "Передан точный снимок входа выбранного сценария: парк, нагрузка, seed, зарядки и характеристики сохранены. Каталожные значения демо не подставлялись.",
      original.siteLayout ? "Сохранён явный план сценария: те же стены, проёмы, препятствия, точки работы и граф используются для финансового цикла и пространственной проверки. Для движения добавлены парковки и контроллер; исполнительный вход имеет отдельный идентификатор." : "Типовая геометрия построена из параметров проекта. Добавлены отдельные парковки и пространственный контроллер, поэтому исходный и исполнительный вход имеют разные идентификаторы.",
      "Учебные инциденты отключены: это базовая проверка исходного сценария. Внешний вид AMR использует условный референс Ronavi H1500 и не подтверждает конструкцию выбранного продукта.",
      "Корпус — диск 0,75 м; зазор 0,15 м. Весь путь резервируется. Люди, торможение, фактическая надёжность и качество обслуживания не моделируются; отсутствие любых тупиков не гарантируется.",
      `Лимит ${input.demoTraffic.maxActiveRoutes} относится к выполняемым заданиям и поездкам к зарядке. Возврат без задания и стоянка на зарядке не занимают этот лимит; их корпуса и движение проверяются на общих основаниях. Старейшее доступное из первых 16 заданий получает ближайший свободный робот, возврат на парковку можно прервать. Это настройка диспетчера, не измеренная пропускная способность объекта. Один seed проверяет одну нагрузку.`,
      "Итог возвращается в проект как отдельное доказательство этого входа. Для другого парка можно явно создать финансовый сценарий с годовыми допущениями; исходный вариант сохраняется для сравнения.",
    ],
    projectOrigin: { requestId: snapshot.requestId, scenarioKey: snapshot.scenarioKey, variantId: snapshot.variantId, sourceInput: structuredClone(snapshot.input), sourceInputKey: snapshot.inputKey, executionInputKey: simInputIdentity(input) },
  };
}
