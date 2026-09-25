"use client";

import type { ReactNode } from "react";
import { updateCharacteristicAction } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { FormStatus, useAdminForm } from "./admin-form";
import { SCOPE_LABELS, charEditorDefaults } from "./format";
import type { CharEditorValues, CharKind } from "./format";
import { CHECK_LABEL_CLASS, INPUT_CLASS, LABEL_CLASS, LABEL_TEXT_CLASS, SELECT_CLASS } from "./styles";

/**
 * Строка характеристики в карточке продукта (ТЗ §3.3.4 — значение, источник, дата, признак
 * подтверждения; §3.3.5 — правка администратора). Значение с бейджем источника приходит
 * готовым с сервера (children), форма правки раскрывается по «Изменить». Поля формы зависят от
 * вида ключа словаря: число или диапазон с оговоркой и областью, текст, перечень (по пункту на
 * строку). Начальные значения — `charEditorDefaults`: «Сохранить» без правок отправляет ровно
 * сохранённое, и сервер отвечает «Изменений нет».
 */
export function CharacteristicRow({
  slug,
  charKey,
  label,
  kind,
  dictUnit,
  required,
  current,
  version,
  children,
}: {
  slug: string;
  charKey: string;
  label: string;
  kind: CharKind;
  dictUnit: string | null;
  required: boolean;
  current: CharEditorValues | null;
  /** Версия продукта (updatedAt): после правки другим действием поля показывают свежие значения. */
  version: string;
  children: ReactNode;
}) {
  const form = useAdminForm(updateCharacteristicAction);
  const numeric = kind === "num" || kind === "range";
  const d = charEditorDefaults(kind, current, dictUnit);
  const listRows = kind === "list" ? Math.min(8, Math.max(2, (current?.valueList.length ?? 0) + 1)) : 2;
  return (
    <li className="grid gap-2 border-t py-3 first:border-t-0 sm:grid-cols-[minmax(9rem,15rem)_1fr]">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          <code>{charKey}</code>
          {required ? " · обязательная (ТЗ §3.3.4)" : ""}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {children}
        <details className="group/edit">
          <summary className="tap-target w-fit cursor-pointer text-xs text-primary underline underline-offset-2">
            {current ? "Изменить" : "Заполнить"}
          </summary>
          <form
            onSubmit={form.onSubmit}
            className="mt-2 flex flex-col gap-3 rounded-lg border bg-muted/20 p-3"
            aria-label={`Правка: ${label}`}
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="key" value={charKey} />
            <div key={`${form.state.seq}:${version}`} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {numeric && (
                <>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>Значение (типичное, идёт в расчёт)</span>
                    <input
                      name="valueNum"
                      inputMode="decimal"
                      defaultValue={d.valueNum}
                      placeholder="например, 1 500"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>Диапазон: от</span>
                    <input name="valueMin" inputMode="decimal" defaultValue={d.valueMin} className={INPUT_CLASS} />
                  </label>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>Диапазон: до</span>
                    <input name="valueMax" inputMode="decimal" defaultValue={d.valueMax} className={INPUT_CLASS} />
                  </label>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>Оговорка источника</span>
                    <select name="qualifier" defaultValue={d.qualifier} className={SELECT_CLASS}>
                      <option value="">нет</option>
                      <option value="до">до (предел, в расчёт не идёт)</option>
                      <option value="от">от</option>
                      <option value="≈">≈ (примерно)</option>
                    </select>
                  </label>
                  <label className={LABEL_CLASS}>
                    <span className={LABEL_TEXT_CLASS}>К чему относится</span>
                    <select name="scope" defaultValue={d.scope} className={SELECT_CLASS}>
                      <option value="">не указано</option>
                      {Object.entries(SCOPE_LABELS).map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {kind !== "list" && (
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Единица</span>
                  <input
                    name="unit"
                    maxLength={40}
                    defaultValue={d.unit}
                    placeholder={dictUnit ? `по словарю: ${dictUnit}` : "например, паллет/ч"}
                    className={INPUT_CLASS}
                  />
                </label>
              )}
              <label className={`${LABEL_CLASS} sm:col-span-2`}>
                <span className={LABEL_TEXT_CLASS}>
                  {kind === "list"
                    ? "Пункты — по одному на строку"
                    : numeric
                      ? "Текст (если числа нет, например «по запросу»)"
                      : "Значение"}
                </span>
                <textarea
                  name="valueText"
                  rows={listRows}
                  maxLength={kind === "list" ? 3000 : 1000}
                  defaultValue={d.valueText}
                  placeholder={kind === "list" ? "например:\nWi-Fi 5 ГГц\n4G" : undefined}
                  className={INPUT_CLASS}
                />
              </label>
              <label className={`${LABEL_CLASS} sm:col-span-2`}>
                <span className={LABEL_TEXT_CLASS}>Ссылка на первоисточник</span>
                <input
                  name="sourceUrl"
                  type="url"
                  maxLength={500}
                  defaultValue={d.sourceUrl}
                  placeholder="https://производитель.ru/страница-модели"
                  className={INPUT_CLASS}
                />
              </label>
              <label className={LABEL_CLASS}>
                <span className={LABEL_TEXT_CLASS}>Дата проверки</span>
                <input name="verifiedAt" type="date" defaultValue={d.verifiedAt} className={INPUT_CLASS} />
              </label>
              <div className="flex items-end pb-1.5">
                <label className={CHECK_LABEL_CLASS}>
                  <input type="checkbox" name="confirmed" defaultChecked={d.confirmed} />
                  Подтверждено первоисточником
                </label>
              </div>
              <label className={`${LABEL_CLASS} sm:col-span-2 lg:col-span-4`}>
                <span className={LABEL_TEXT_CLASS}>Примечание (откуда значение, что уточнить)</span>
                <textarea name="note" rows={2} maxLength={1000} defaultValue={d.note} className={INPUT_CLASS} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" disabled={form.pending}>
                Сохранить характеристику
              </Button>
              <FormStatus state={form.state} pending={form.pending} />
            </div>
          </form>
        </details>
      </div>
    </li>
  );
}
