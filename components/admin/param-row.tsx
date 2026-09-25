"use client";

import { updateParamDefinitionAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/project/source-badge";
import { fx } from "@/lib/tz/econ/text";
import type { Origin } from "@/lib/tz/types";
import { FormStatus, useAdminForm } from "./admin-form";
import { numberInputValue } from "./format";
import { BADGE_CLASS, CHECK_LABEL_CLASS, CHIP_CLASS, INPUT_CLASS, LABEL_CLASS, LABEL_TEXT_CLASS, SELECT_CLASS } from "./styles";

export type ParamRowValues = {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  kind: string;
  options: string[];
  base: number | string | null;
  min: number | null;
  max: number | null;
  locked: boolean;
  required: boolean;
  hint: string;
  example: string;
  origin: Origin;
  sourceRef: string | null;
  sourceUrl: string | null;
  basis: string | null;
  organizerNote: string | null;
  editedByAdmin: boolean;
};

const NUMERIC_KINDS: ReadonlySet<string> = new Set(["number", "integer", "percent"]);

const KIND_LABELS: Readonly<Record<string, string>> = {
  number: "число",
  integer: "целое",
  percent: "процент",
  enum: "выбор из списка",
  text: "текст",
  dims: "габариты Д×Ш×В",
};

function valueText(v: number | string | null, unit: string | null): string {
  if (v === null || v === "") return "—";
  const s = typeof v === "number" ? fx(v) : v;
  return unit ? `${s} ${unit}` : s;
}

function rangeText(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${fx(min)}–${fx(max)}`;
  if (min !== null) return `от ${fx(min)}`;
  if (max !== null) return `до ${fx(max)}`;
  return "не задан";
}

/** Базовое значение для поля ввода. */
function baseInput(v: number | string | null): string {
  if (typeof v === "number") return numberInputValue(v);
  return v ?? "";
}

/**
 * Описание параметра объекта (ТЗ §3.2.5 — значение по умолчанию и источник норматива; §3.2.6 —
 * администратор меняет значения по умолчанию и диапазоны): базовое значение (демо-данные
 * организатора), минимум и максимум для проверки ввода, обязательность, подсказка и пример.
 */
export function ParamRow({ param, version }: { param: ParamRowValues; version: string }) {
  const form = useAdminForm(updateParamDefinitionAction);
  const numeric = NUMERIC_KINDS.has(param.kind);
  const hasOptions = param.kind === "enum" && param.options.length > 0;
  return (
    <li className="grid gap-2 border-t py-3 first:border-t-0 md:grid-cols-[minmax(12rem,20rem)_1fr]">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">{param.label}</span>
        <span className="text-xs text-muted-foreground">
          <code>{param.key}</code> · {KIND_LABELS[param.kind] ?? param.kind}
          {param.unit ? ` · ${param.unit}` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge
            origin={param.origin}
            sourceUrl={param.sourceUrl}
            sourceRef={param.sourceRef}
            note={param.basis ?? param.organizerNote}
          />
          {param.required && <span className={CHIP_CLASS}>обязательный</span>}
          {param.locked && <span className={CHIP_CLASS}>зафиксирован (min = max)</span>}
          {param.editedByAdmin && (
            <span data-tone="warn" className={BADGE_CLASS}>правка администратора</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">По умолчанию</dt>
          <dd className="tabular-nums">{valueText(param.base, param.unit)}</dd>
          {numeric && (
            <>
              <dt className="text-muted-foreground">Диапазон проверки</dt>
              <dd className="tabular-nums">{rangeText(param.min, param.max)}</dd>
            </>
          )}
          {param.example !== "" && (
            <>
              <dt className="text-muted-foreground">Пример</dt>
              <dd>{param.example}</dd>
            </>
          )}
        </dl>
        <details>
          <summary className="tap-target w-fit cursor-pointer text-xs text-primary underline underline-offset-2">
            Изменить
          </summary>
          <form
            onSubmit={form.onSubmit}
            className="mt-2 flex flex-col gap-3 rounded-lg border bg-muted/20 p-3"
            aria-label={`Правка параметра: ${param.label}`}
          >
            <input type="hidden" name="id" value={param.id} />
            <div key={`${form.state.seq}:${version}`} className="grid gap-3 sm:grid-cols-3">
              <label className={LABEL_CLASS}>
                <span className={LABEL_TEXT_CLASS}>
                  По умолчанию{param.unit ? `, ${param.unit}` : ""}
                </span>
                {hasOptions ? (
                  <select name="base" defaultValue={typeof param.base === "string" ? param.base : ""} className={SELECT_CLASS}>
                    <option value="">— не задано —</option>
                    {param.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="base"
                    inputMode={numeric ? "decimal" : undefined}
                    defaultValue={baseInput(param.base)}
                    className={INPUT_CLASS}
                  />
                )}
              </label>
              {numeric && (
                <>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>Минимум</span>
                    <input
                      name="min"
                      inputMode="decimal"
                      defaultValue={numberInputValue(param.min)}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>Максимум</span>
                    <input
                      name="max"
                      inputMode="decimal"
                      defaultValue={numberInputValue(param.max)}
                      className={INPUT_CLASS}
                    />
                  </label>
                </>
              )}
              <label className={`${LABEL_CLASS} sm:col-span-2`}>
                <span className={LABEL_TEXT_CLASS}>Подсказка в форме</span>
                <textarea name="hint" rows={2} maxLength={500} defaultValue={param.hint} className={INPUT_CLASS} />
              </label>
              <label className={LABEL_CLASS}>
                <span className={LABEL_TEXT_CLASS}>Пример ввода</span>
                <input name="example" maxLength={200} defaultValue={param.example} className={INPUT_CLASS} />
              </label>
              <label className={CHECK_LABEL_CLASS}>
                <input type="checkbox" name="required" defaultChecked={param.required} />
                Обязательный параметр
              </label>
              <label className={`${LABEL_CLASS} sm:col-span-2`}>
                <span className={LABEL_TEXT_CLASS}>Основание правки (необязательно)</span>
                <input name="reason" maxLength={300} className={INPUT_CLASS} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" disabled={form.pending}>
                Сохранить параметр
              </Button>
              <FormStatus state={form.state} pending={form.pending} />
            </div>
          </form>
        </details>
      </div>
    </li>
  );
}
