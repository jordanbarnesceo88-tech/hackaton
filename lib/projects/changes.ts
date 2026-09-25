import type { Prisma } from "@prisma/client";
import { normDef, isNormKey } from "../tz/norms";
import type { ProjectModel } from "../tz/model";
import type { ParamSpec, PendingChange, ScenarioSpec } from "../tz/types";

/**
 * Журнал корректировок проекта (ТЗ §3.5.4: «автоматически рассчитанные значения доступны для
 * просмотра и ручной корректировки с фиксацией изменений»). Изменения из рабочей области
 * превращаются в строки ChangeLog; автоматическое значение каждой строки сервер берёт из
 * собственного расчёта, а не из того, что прислал браузер, — иначе в журнал можно было бы
 * записать любое «расчётное» число.
 */

/** Автоматическое значение поля по расчёту сервера; null — у поля нет расчётного значения. */
export type ServerAuto = (scenarioKey: string | undefined, field: string) => number | string | null;

/** Контекст записи журнала. */
export type ChangeLogContext = {
  projectId: string;
  userId: string;
  /** id строк Scenario по ключу — после записи сценариев. */
  scenarioIdByKey: ReadonlyMap<string, string>;
  serverAuto: ServerAuto;
};

/**
 * Поля Json? строки журнала. Пустое значение не передаётся вовсе — колонка получает SQL NULL
 * (так модуль обходится без рантайма Prisma и годится для импорта где угодно).
 */
function jsonFields(values: { autoValue: unknown; oldValue: unknown; newValue: unknown }): {
  autoValue?: Prisma.InputJsonValue;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
} {
  const out: { autoValue?: Prisma.InputJsonValue; oldValue?: Prisma.InputJsonValue; newValue?: Prisma.InputJsonValue } = {};
  for (const key of ["autoValue", "oldValue", "newValue"] as const) {
    const v = values[key];
    if (v !== null && v !== undefined) out[key] = v as Prisma.InputJsonValue;
  }
  return out;
}

/**
 * Строки ChangeLog для записи через createMany. Изменение параметра объекта относится к
 * проекту (entity 'project'); изменение позиции, состава сценариев и норматива сценария — к
 * сценарию (entity 'scenario'). Нормативы переопределяются только в сценарии
 * (ScenarioSpec.normOverrides), поэтому 'norm:<key>' с ключом сценария пишется со ссылкой на
 * него; без ключа — как изменение проекта. У удалённого сценария строки Scenario уже нет,
 * поэтому ссылка на него не ставится (иначе каскадное удаление стёрло бы и саму запись об
 * удалении), а в entityId пишется его ключ.
 */
export function toChangeLogRows(
  pending: readonly PendingChange[],
  ctx: ChangeLogContext,
): Prisma.ChangeLogCreateManyInput[] {
  return pending.map((c) => {
    const scenarioId = c.scenarioKey !== undefined ? ctx.scenarioIdByKey.get(c.scenarioKey) : undefined;
    const isScenario =
      c.field.startsWith("item:") ||
      c.field.startsWith("scenario:") ||
      (c.field.startsWith("norm:") && c.scenarioKey !== undefined);
    const removed = c.field === "scenario:remove";
    return {
      entity: isScenario ? "scenario" : "project",
      entityId: isScenario ? (removed || !scenarioId ? (c.scenarioKey ?? "") : scenarioId) : ctx.projectId,
      projectId: ctx.projectId,
      scenarioId: isScenario && !removed && scenarioId ? scenarioId : null,
      userId: ctx.userId,
      field: c.field,
      ...jsonFields({ autoValue: ctx.serverAuto(c.scenarioKey, c.field), oldValue: c.old, newValue: c.new }),
      unit: c.unit ?? null,
      reason: c.reason ?? null,
    };
  });
}

/** Конечное число или null. */
function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Автоматические значения по модели, посчитанной на сервере:
 * - 'item:<process>:quantity' — расчётное число роботов (Nавто, без ручной правки);
 * - 'item:<process>:price' — цена продукта из снимка каталога;
 * - 'item:<process>:throughput' — принятая производительность без ручной правки: min(норма;
 *   цикл) или то из них, что известно;
 * - 'item:<process>:service' — сервис из карточки продукта, иначе норматив
 *   servicePctOfPriceYear × цена;
 * - 'item:<process>:raasRate' — ставка RaaS из карточки продукта;
 * - 'param:<key>' — базовое значение организатора (описание параметра);
 * - 'norm:<key>' — значение норматива проекта;
 * - прочие поля ('…:manual', 'scenario:add|remove') — null.
 */
export function serverAutoFrom(model: ProjectModel, paramDefs: readonly ParamSpec[]): ServerAuto {
  const specs = new Map<string, ScenarioSpec>(model.scenarios.map((s) => [s.key, s]));
  const results = new Map(model.results.map((r) => [r.key, r]));
  const defs = new Map(paramDefs.map((d) => [d.key, d]));
  return (scenarioKey, field) => {
    if (field.startsWith("param:")) {
      const def = defs.get(field.slice("param:".length));
      return def ? def.base : null;
    }
    if (field.startsWith("norm:")) {
      const key = field.slice("norm:".length);
      return isNormKey(key) ? num(model.normsUsed[key]) : null;
    }
    const m = /^item:([a-z0-9-]+):([A-Za-z]+)$/.exec(field);
    if (!m || scenarioKey === undefined) return null;
    const process = m[1];
    const what = m[2];
    const spec = specs.get(scenarioKey);
    const item = spec?.items.find((it) => it.process === process);
    const product = item ? model.productSnapshots[item.productSlug] : undefined;
    const ir = results.get(scenarioKey)?.items.find((r) => r.process === process);
    switch (what) {
      case "quantity":
        return num(ir?.nAuto);
      case "price":
        return num(product?.priceRub);
      case "throughput": {
        const norm = num(ir?.thrNorm);
        const cycle = num(ir?.thrCycle);
        if (norm !== null && cycle !== null) return Math.min(norm, cycle);
        return norm ?? cycle;
      }
      case "service": {
        const own = num(product?.serviceRubYear);
        if (own !== null) return own;
        const price = num(product?.priceRub);
        const pct = num(model.normsUsed.servicePctOfPriceYear);
        return price !== null && pct !== null ? pct * price : null;
      }
      case "raasRate":
        return num(product?.raasRubMonth);
      default:
        return null;
    }
  };
}

/** Подписи полей позиции сценария для журнала. */
const ITEM_FIELD_LABELS: Readonly<Record<string, string>> = {
  quantity: "Количество роботов",
  price: "Цена робота",
  throughput: "Производительность",
  service: "Сервис в год за робота",
  raasRate: "Ставка RaaS в месяц за робота",
  manual: "Решение добавлено вручную",
};

/**
 * Подпись поля журнала по-русски: «Параметр: {подпись}», «Норматив: {подпись}», «{процесс}:
 * количество роботов», «Сценарий добавлен» и т. п. `paramLabels` — подписи параметров
 * объекта (из описаний); без них выводится ключ.
 */
export function changeFieldLabel(
  field: string,
  paramLabels: Readonly<Record<string, string>> = {},
  processNames: Readonly<Record<string, string>> = {},
): string {
  if (field === "scenario:add") return "Сценарий добавлен";
  if (field === "scenario:remove") return "Сценарий удалён";
  if (field.startsWith("param:")) {
    const key = field.slice("param:".length);
    return `Параметр: ${paramLabels[key] ?? key}`;
  }
  if (field.startsWith("norm:")) {
    const key = field.slice("norm:".length);
    return `Норматив: ${isNormKey(key) ? normDef(key).label : key}`;
  }
  const m = /^item:([a-z0-9-]+):([A-Za-z]+)$/.exec(field);
  if (m) {
    const [, process = "", what = ""] = m;
    const label = ITEM_FIELD_LABELS[what] ?? what;
    const proc = processNames[process];
    return proc ? `${label} (${proc})` : label;
  }
  return field;
}
