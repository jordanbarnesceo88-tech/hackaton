"use client";

import { useState } from "react";
import { resetNormAction, updateNormAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/project/source-badge";
import { fx } from "@/lib/tz/econ/text";
import type { Origin } from "@/lib/tz/types";
import { FormStatus, useAdminForm } from "./admin-form";
import { numberInputValue } from "./format";
import { BADGE_CLASS, INPUT_CLASS, LABEL_CLASS, LABEL_TEXT_CLASS } from "./styles";

export type NormRowValues = {
  key: string;
  label: string;
  unit: string | null;
  value: number;
  /** Значение по умолчанию из кода (NORM_DEFS); null — норматива нет в коде, расчёт его не читает. */
  defaultValue: number | null;
  min: number | null;
  max: number | null;
  origin: Origin;
  basis: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  editedByAdmin: boolean;
  /** Момент последнего изменения строки (ISO) — версия для ключа полей. */
  updatedAt: string;
};

function boundsText(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${fx(min)}–${fx(max)}`;
  if (min !== null) return `не меньше ${fx(min)}`;
  if (max !== null) return `не больше ${fx(max)}`;
  return "без ограничений";
}

/**
 * Норматив в админке (ТЗ §3.1.4 — администратор управляет значениями по умолчанию; §3.5.1 —
 * у каждого коэффициента есть источник и обоснование). Поле значения с допустимым диапазоном,
 * «Сохранить» (значение вне диапазона прижимается к границе — сервер скажет, какое число
 * сохранено) и «Сбросить к умолчанию».
 */
export function NormRow({ norm }: { norm: NormRowValues }) {
  const save = useAdminForm(updateNormAction);
  const reset = useAdminForm(resetNormAction);
  const [last, setLast] = useState<"save" | "reset">("save");
  const known = norm.defaultValue !== null;
  const atDefault = known && norm.value === norm.defaultValue && !norm.editedByAdmin;
  const shown = last === "save" ? save : reset;
  const inputId = `norm-${norm.key}`;

  return (
    <li className="grid gap-3 border-t py-4 first:border-t-0 lg:grid-cols-[minmax(14rem,22rem)_1fr]">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {norm.label}
        </label>
        <span className="text-xs text-muted-foreground">
          <code>{norm.key}</code>
          {norm.unit ? ` · ${norm.unit}` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge origin={norm.origin} sourceUrl={norm.sourceUrl} sourceRef={norm.sourceRef} note={norm.basis} />
          {norm.editedByAdmin && (
            <span data-tone="warn" className={BADGE_CLASS}>правка администратора</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {known ? (
          <>
            <form
              onSubmit={(e) => {
                setLast("save");
                save.onSubmit(e);
              }}
              className="flex flex-wrap items-end gap-3"
              aria-label={`Значение: ${norm.label}`}
            >
              <input type="hidden" name="key" value={norm.key} />
              <div key={`${save.state.seq}:${reset.state.seq}:${norm.updatedAt}`} className="contents">
                <label className={`${LABEL_CLASS} w-36`}>
                  <span className={LABEL_TEXT_CLASS}>Значение</span>
                  <input
                    id={inputId}
                    name="value"
                    inputMode="decimal"
                    required
                    defaultValue={numberInputValue(norm.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className={`${LABEL_CLASS} min-w-48 flex-1`}>
                  <span className={LABEL_TEXT_CLASS}>Основание правки (необязательно)</span>
                  <input
                    name="reason"
                    maxLength={300}
                    placeholder="например, тариф на электроэнергию 2026 г."
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
              <Button type="submit" size="sm" disabled={save.pending || reset.pending}>
                Сохранить
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Допустимый диапазон: {boundsText(norm.min, norm.max)}
              {norm.unit ? ` ${norm.unit}` : ""} · по умолчанию {fx(norm.defaultValue ?? 0)}
            </p>
            <form
              onSubmit={(e) => {
                setLast("reset");
                reset.onSubmit(e);
              }}
              className="flex flex-wrap items-center gap-3"
            >
              <input type="hidden" name="key" value={norm.key} />
              <Button
                type="submit"
                variant="outline"
                size="xs"
                disabled={atDefault || save.pending || reset.pending}
              >
                Сбросить к умолчанию
              </Button>
              <FormStatus state={shown.state} pending={save.pending || reset.pending} />
            </form>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Значение {fx(norm.value)}. Этого норматива нет в текущей модели расчёта — расчёт его не читает, править
            его незачем.
          </p>
        )}
      </div>
    </li>
  );
}
