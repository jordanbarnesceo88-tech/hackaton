"use client";

import { DEFAULT_PARAM_LABELS } from "@/lib/tz/econ/context";
import { isNormKey, normDef } from "@/lib/tz/norms";
import { processDef } from "@/lib/tz/processes";
import type { Refusal, RefusalReason } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Отказ расчёта сценария (ТЗ §3.5.1: без недокументированных подстановок). Движок не считает
 * сценарий, если не хватает данных, и вместо нуля или NaN возвращает типизированный отказ.
 * Здесь показывается его сообщение и список полей, которые нужно заполнить, — и НИКОГДА не
 * число: отказ — это «не посчитано», а не «посчитано как ноль».
 */

/** Короткие подписи причин отказа — заголовок блока. */
export const REFUSAL_TITLES: Readonly<Record<RefusalReason, string>> = {
  throughput_required: "Не хватает производительности",
  price_required: "Не хватает цены",
  raas_rate_required: "Не хватает ставки RaaS",
  staffing_required: "Не хватает данных о персонале",
  calc_not_supported: "Экономика не рассчитывается",
  invalid_inputs: "Исправьте входные данные",
};

/** Подписи корректировок позиции сценария по виду поля `item:<процесс>:<вид>`. */
const ITEM_FIELD_LABELS: Readonly<Record<string, string>> = {
  quantity: "Количество роботов",
  price: "Цена робота, ₽",
  service: "Сервис, ₽/год за робота",
  raasRate: "Ставка RaaS, ₽/мес за робота",
  manual: "Решение для процесса",
};

/** Подписи полей уровня сценария: 'scenario:<вид>'. */
const SCENARIO_FIELD_LABELS: Readonly<Record<string, string>> = {
  add: "Сценарий покупки или услуги",
  items: "Решение (продукт) для сценария",
};

/**
 * Подпись поля из отказа (формат PendingChange: 'param:<ключ>', 'item:<процесс>:<вид>',
 * 'norm:<ключ>', 'scenario:<вид>'). Подпись параметра берётся из `paramLabels` (подписи
 * ParamDefinition проекта), иначе из встроенных подписей движка, иначе показывается сам
 * ключ — чтобы поле можно было найти, даже если подписи нет.
 */
export function refusalFieldLabel(field: string, paramLabels?: Readonly<Record<string, string>>): string {
  const [kind, a, b] = field.split(":");
  if (kind === "param" && a) return paramLabels?.[a] ?? DEFAULT_PARAM_LABELS[a] ?? a;
  if (kind === "norm" && a) return isNormKey(a) ? `Норматив «${normDef(a).label}»` : a;
  if (kind === "scenario" && a && SCENARIO_FIELD_LABELS[a]) return SCENARIO_FIELD_LABELS[a];
  if (kind === "item" && a && b) {
    const process = processDef(a);
    const base =
      b === "throughput"
        ? `Производительность, ${process?.throughputUnit ?? "ед./ч"}`
        : (ITEM_FIELD_LABELS[b] ?? b);
    return process ? `${base} — процесс «${process.name}»` : base;
  }
  return field;
}

/**
 * Сообщение отказа для показа. Движок в отказе raas_rate_required предлагает «нажмите
 * «Подставить оценку (…)»»; где кнопки нет (отчёт, режим чтения, таблица сценариев без
 * управления), этот призыв отрезается, чтобы экран не ссылался на несуществующую кнопку.
 */
export function refusalMessage(refusal: Refusal, actionable: boolean): string {
  if (actionable) return refusal.message;
  return refusal.message.replace(/,\s*или нажмите «Подставить оценку[^»]*»/u, "");
}

export function RefusalNote({
  refusal,
  paramLabels,
  actionable = true,
  className,
}: {
  refusal: Refusal;
  /** Подписи параметров объекта по ключу — для полей вида 'param:<ключ>'. */
  paramLabels?: Readonly<Record<string, string>>;
  /** Рядом есть кнопки исправления (рабочая область); false — отчёт или режим чтения. */
  actionable?: boolean;
  className?: string;
}) {
  const fields = [...new Set(refusal.fields)];
  return (
    <div
      role="note"
      className={cn("rounded-md border border-caution/40 bg-caution/10 px-3 py-2 text-sm", className)}
    >
      <p className="font-medium text-caution">Сценарий не рассчитан: {REFUSAL_TITLES[refusal.reason]}</p>
      <p className="mt-1">{refusalMessage(refusal, actionable)}</p>
      {fields.length > 0 && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">Что заполнить:</p>
          <ul className="mt-0.5 list-disc pl-5 text-xs">
            {fields.map((f) => (
              <li key={f}>{refusalFieldLabel(f, paramLabels)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
