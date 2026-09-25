import type { NormRow, Db } from "../catalog/queries";
import { fx } from "../tz/econ/text";
import { isNormKey, normDef, NORM_DEFS, resolveNorms } from "../tz/norms";
import type { NormDef, NormKey } from "../tz/norms";

/**
 * Нормативы через API (GET и PUT /api/v1/norms, ТЗ §3.8.2 «API нормативов», §3.1.4 и §3.3.5 —
 * администратор управляет справочниками, §3.5.4 — изменения журналируются).
 *
 * Правило то же, что у страницы администратора «Нормативы»: значение прижимается к [min, max]
 * норматива (границы — в коде, NORM_DEFS), строка получает признак editedByAdmin (синхронизация
 * данных её значение больше не перезаписывает), а каждое изменение пишется в журнал ChangeLog
 * (entity 'norm', entityId — ключ, field 'value', autoValue — значение по умолчанию из кода).
 * Модуль принимает клиент БД параметром и использует относительные импорты.
 */

/** Норматив в ответе API: строка БД (или кода) плюс значение по умолчанию и итоговое значение расчёта. */
export type NormApiRow = {
  key: string;
  label: string;
  group: string;
  order: number;
  unit: string | null;
  /** Значение в таблице Norm (или из кода, пока таблица пуста). */
  value: number;
  /** Значение по умолчанию из кода модели. */
  defaultValue: number | null;
  /**
   * Значение, с которым считает модель: после прижатия к [min, max] и взаимных ограничений
   * (resolveNorms). null — ключ устарел и расчётом не читается.
   */
  effectiveValue: number | null;
  min: number | null;
  max: number | null;
  origin: string;
  basis: string;
  sourceRef: string | null;
  sourceUrl: string | null;
  editedByAdmin: boolean;
  updatedAt: string | null;
};

/** Нормативы для GET: из БД, а пока таблица пуста — из кода (так же считает расчёт). */
export function normApiRows(rows: readonly NormRow[]): { source: "db" | "code"; norms: NormApiRow[] } {
  if (rows.length === 0) {
    const effective = resolveNorms();
    return {
      source: "code",
      norms: (NORM_DEFS as readonly NormDef[]).map((d) => ({
        key: d.key,
        label: d.label,
        group: d.group,
        order: d.order,
        unit: d.unit,
        value: d.value,
        defaultValue: d.value,
        effectiveValue: effective[d.key as NormKey],
        min: d.min,
        max: d.max,
        origin: d.origin,
        basis: d.basis,
        sourceRef: d.sourceRef ?? null,
        sourceUrl: d.sourceUrl ?? null,
        editedByAdmin: false,
        updatedAt: null,
      })),
    };
  }
  const effective = resolveNorms(rows);
  return {
    source: "db",
    norms: rows.map((r) => ({
      key: r.key,
      label: r.label,
      group: r.group,
      order: r.order,
      unit: r.unit,
      value: r.value,
      defaultValue: isNormKey(r.key) ? normDef(r.key).value : null,
      effectiveValue: isNormKey(r.key) ? effective[r.key] : null,
      min: r.min,
      max: r.max,
      origin: r.origin,
      basis: r.basis,
      sourceRef: r.sourceRef,
      sourceUrl: r.sourceUrl,
      editedByAdmin: r.editedByAdmin,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/** Наибольшая длина причины изменения. */
export const NORM_REASON_MAX = 500;

/** Проверенный запрос PUT: пары «ключ — значение» и причина. */
export type NormUpdateInput = { values: [NormKey, number][]; reason: string | null };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Проверка тела PUT /api/v1/norms: `{ values: { <ключ>: <число>, … }, reason?: string }`.
 * Неизвестный ключ, не-число или лишнее поле — ошибка (ввод отклоняется, а не подчищается).
 * Выход за [min, max] ошибкой не считается: значение прижимается к границе, и ответ это
 * показывает (clamped) — как на странице администратора.
 */
export function validateNormUpdate(body: unknown): { ok: true; value: NormUpdateInput } | { ok: false; errors: string[] } {
  if (!isPlainObject(body)) return { ok: false, errors: ["Тело запроса — объект { values: { <ключ>: <число> }, reason?: <строка> }"] };
  const errors: string[] = [];
  const extra = Object.keys(body).filter((k) => k !== "values" && k !== "reason" && body[k] !== undefined);
  if (extra.length > 0) errors.push(`Неизвестные поля ${extra.join(", ")} — допустимы values и reason`);
  const values: [NormKey, number][] = [];
  if (!isPlainObject(body.values) || Object.keys(body.values).length === 0) {
    errors.push("values — непустой объект «ключ норматива → число», например { \"utilization\": 0.8 }");
  } else {
    for (const [key, v] of Object.entries(body.values)) {
      if (!isNormKey(key)) {
        errors.push(`Норматив «${key}» неизвестен — ключи в GET /api/v1/norms`);
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v)) {
        errors.push(`Норматив «${normDef(key).label}» (${key}): значение — число`);
        continue;
      }
      values.push([key, v]);
    }
  }
  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") errors.push("reason — строка");
    else {
      const r = body.reason.replace(/\s+/g, " ").trim();
      if (r.length > NORM_REASON_MAX) errors.push(`reason — не длиннее ${NORM_REASON_MAX} символов`);
      else if (r !== "") reason = r;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { values, reason } };
}

/** Значение, прижатое к [min, max] норматива. */
export function clampNorm(def: Pick<NormDef, "min" | "max">, value: number): number {
  let v = value;
  if (def.min !== null && v < def.min) v = def.min;
  if (def.max !== null && v > def.max) v = def.max;
  return v;
}

/** Итог по одному нормативу. */
export type NormChangeResult = {
  key: NormKey;
  label: string;
  unit: string;
  requested: number;
  oldValue: number;
  newValue: number;
  /** Запрошенное значение вне [min, max] — записана граница. */
  clamped: boolean;
  min: number | null;
  max: number | null;
  status: "updated" | "unchanged";
  message?: string;
};

/** Кто меняет: пользователь-администратор (для журнала) или токен (пользователя нет). */
export type NormActor = { userId: string | null; via: "session" | "bearer" };

/**
 * Записывает значения нормативов и журнал. Вызывать внутри транзакции (`prisma.$transaction`):
 * запросы идут по очереди. Строка, которой в таблице ещё нет (данные не засеяны), создаётся с
 * метаданными из кода. Значение, совпадающее с текущим, не пишется и в журнал не попадает.
 */
export async function applyNormValues(db: Db, input: NormUpdateInput, actor: NormActor): Promise<NormChangeResult[]> {
  const out: NormChangeResult[] = [];
  const reason =
    input.reason ?? (actor.via === "bearer" ? "Изменено через API (токен администратора)" : "Изменено через API");
  for (const [key, requested] of input.values) {
    const def = normDef(key);
    const newValue = clampNorm(def, requested);
    const clamped = newValue !== requested;
    const row = await db.norm.findUnique({ where: { key } });
    const oldValue = row ? row.value : def.value;
    const base: NormChangeResult = {
      key,
      label: def.label,
      unit: def.unit,
      requested,
      oldValue,
      newValue,
      clamped,
      min: def.min,
      max: def.max,
      status: "unchanged",
    };
    if (clamped) {
      base.message =
        def.min !== null && def.min === def.max
          ? `норматив зафиксирован: ${fx(def.min)} ${def.unit}`.trim()
          : `вне допустимого диапазона — записана граница ${fx(newValue)} (допустимо от ${def.min === null ? "−∞" : fx(def.min)} до ${def.max === null ? "+∞" : fx(def.max)})`;
    }
    if (row && row.value === newValue) {
      out.push(base);
      continue;
    }
    if (row) {
      await db.norm.update({
        where: { key },
        data: { value: newValue, editedByAdmin: true, updatedById: actor.userId },
      });
    } else {
      await db.norm.create({
        data: {
          key,
          value: newValue,
          label: def.label,
          min: def.min,
          max: def.max,
          unit: def.unit,
          origin: def.origin,
          basis: def.basis,
          sourceRef: def.sourceRef ?? null,
          sourceUrl: def.sourceUrl ?? null,
          group: def.group,
          order: def.order,
          editedByAdmin: true,
          updatedById: actor.userId,
        },
      });
    }
    await db.changeLog.create({
      data: {
        entity: "norm",
        entityId: key,
        userId: actor.userId,
        field: "value",
        autoValue: def.value,
        oldValue,
        newValue,
        unit: def.unit.trim() !== "" ? def.unit : null,
        reason,
      },
    });
    out.push({ ...base, status: "updated" });
  }
  return out;
}
