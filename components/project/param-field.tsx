"use client";

import { useState } from "react";
import { examplePhrase, formatNumberRu, outOfRangeIssue, rangeText, unitText, withUnit } from "@/lib/tz/params/messages";
import { coerce, isNumericKind, isOutOfRange, sameParamValue } from "@/lib/tz/params/schema";
import type { ParamIssue, ParamSpec } from "@/lib/tz/types";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";

/**
 * Поле параметра объекта (ТЗ §3.2.2 — ручной ввод, §3.2.4 — проверка типов, единиц и
 * диапазонов, §3.2.5 — значение по умолчанию и его источник, §4.5.3 — единицы, подсказки и
 * примеры в полях, сообщения об ошибках говорят, как исправить).
 *
 * Ввод разбирается той же функцией `coerce`, что и загрузка Excel/CSV: русская запись числа
 * («1 000», «2,5»), дописанная единица («20 000 м²»), габариты «Д×Ш×В». Наверх уходит только
 * приведённое значение нужного типа. Нераспознанный ввод остаётся в поле с сообщением
 * (role="alert"), а расчёт продолжает идти по последнему принятому значению — и поле прямо
 * называет это значение, чтобы на экране не было числа, по которому страница не считает.
 */

/** Значение параметра проекта: число, текст или null («не задано»). */
export type ParamValue = number | string | null;

export type ParamFieldProps = {
  def: ParamSpec;
  value: ParamValue;
  /** Проблема проверки этого параметра от рабочей области (validateParamValues). */
  issue?: ParamIssue | null;
  /** Значение отличается от базового — показываются «Задано вами» и «вернуть базовое». */
  changed: boolean;
  /** Без обработчика поле только для чтения (так серверная страница показывает параметры). */
  onChange?: (value: ParamValue) => void;
  /** Без обработчика кнопки «вернуть базовое» нет. */
  onReset?: () => void;
  readOnly?: boolean;
  /** Базовое значение проекта; по умолчанию — демо-значение организатора `def.base`. */
  baseValue?: ParamValue;
  /** Формула для показа (с названиями параметров вместо ключей); по умолчанию `def.formula`. */
  formula?: string | null;
};

/** Примечание к бейджу базового значения из датасета организатора. */
export const ORGANIZER_DEMO_NOTE = "демо-значение организатора";

/** Текст о зафиксированном параметре (min = max у организатора). */
export const LOCKED_NOTICE = "значение зафиксировано организатором; изменение будет записано в журнал";

/** Подпись поля с единицей: «Общая площадь склада, м²»; у безразмерных — только название. */
export function paramLabelText(def: Pick<ParamSpec, "label" | "unit">): string {
  const u = unitText(def.unit);
  return u ? `${def.label}, ${u}` : def.label;
}

/** Значение в поле ввода: число по-русски («20 000», «1,302»), текст как есть, null — пусто. */
export function paramInputText(value: ParamValue): string {
  if (typeof value === "number") return Number.isFinite(value) ? formatNumberRu(value) : "";
  return value ?? "";
}

/**
 * Строка о диапазоне: «диапазон организатора: 10 000–100 000 м²». Для параметров, которых нет
 * в датасете организатора (оценка, расчёт), границы наши — они называются «допустимый
 * диапазон», чтобы не приписывать их организатору. Зафиксированный параметр и параметр без
 * границ — null.
 */
export function rangeLine(def: ParamSpec): string | null {
  if (def.locked || (def.min === null && def.max === null)) return null;
  const text = rangeText(def);
  if (!text) return null;
  return `${def.origin === "organizer" ? "диапазон организатора" : "допустимый диапазон"}: ${text}`;
}

/**
 * Строка о формуле базового значения. Формула описывает, как получено базовое значение, а не
 * живую связь: при правке исходного параметра («Общая площадь склада») поле не пересчитывается,
 * и строка говорит об этом прямо, чтобы 10 000 рядом с «× 0,5» от 40 000 не читалось как ошибка.
 */
export function formulaLine(formula: string): string {
  return `базовое значение по формуле: ${formula} (не пересчитывается при правке других полей)`;
}

/**
 * Строки подсказки под полем: подсказка, примечание организатора (если отличается), пример и
 * диапазон одной строкой («например, 20 000 · диапазон организатора: 10 000–100 000 м²»),
 * формула базового значения. Пример и диапазон объединены, чтобы 50 полей склада не
 * растягивали шаг на экраны.
 */
export function paramHelpLines(def: ParamSpec, formula?: string | null): string[] {
  const lines: string[] = [];
  const hint = def.hint.trim();
  if (hint) lines.push(hint);
  const note = (def.organizerNote ?? "").trim();
  if (note && note !== hint) lines.push(`Примечание организатора: ${note}`);
  const exRange = [examplePhrase(def), rangeLine(def) ?? ""].filter((s) => s !== "").join(" · ");
  if (exRange) lines.push(exRange);
  const f = (formula ?? def.formula ?? "").trim();
  if (f) lines.push(formulaLine(f));
  return lines;
}

/**
 * Сообщение «вне диапазона». Для параметров организатора — текст общего модуля («вне диапазона
 * организатора»); для оценок и расчётных параметров границы наши, поэтому «вне допустимого
 * диапазона» — как и в строке подсказки.
 */
export function outOfRangeText(def: ParamSpec, v: number): string {
  if (def.origin === "organizer") return outOfRangeIssue(def, v).message;
  return `${def.label}: ${formatNumberRu(v)} вне допустимого диапазона ${rangeText(def)} — проверьте значение`;
}

/** Изменено значение, зафиксированное организатором (min = max): принимается с записью в журнал. */
export function isLockedChanged(def: ParamSpec, value: ParamValue): boolean {
  return def.locked && def.base !== null && value !== null && !sameParamValue(value, def.base);
}

/** Значение вне диапазона у незафиксированного параметра — поле подсвечивает его само. */
export function isValueOutOfRange(def: ParamSpec, value: ParamValue): boolean {
  return typeof value === "number" && !def.locked && isOutOfRange(def, value);
}

/**
 * Предупреждение под полем: от проверки рабочей области (кроме «зафиксировано» — о нём говорит
 * отдельная строка), иначе собственная проверка диапазона. Сообщение «вне диапазона» для
 * параметров не из датасета организатора переписывается, чтобы не приписывать ему наши границы.
 */
export function paramWarningText(def: ParamSpec, value: ParamValue, issue?: ParamIssue | null): string | null {
  if (issue?.severity === "warning" && issue.code !== "locked_changed") {
    if (issue.code === "out_of_range" && def.origin !== "organizer" && typeof value === "number") {
      return outOfRangeText(def, value);
    }
    return issue.message;
  }
  return typeof value === "number" && isValueOutOfRange(def, value) ? outOfRangeText(def, value) : null;
}

/**
 * Черновик ввода: текст в поле, значение модели, против которого он набран, и проблема разбора.
 * Черновик показывается, только пока модель держит то же значение: если значение поменялось
 * извне (кнопка «вернуть базовое», загрузка файла), поле показывает модель.
 */
export type ParamDraft = { text: string; against: ParamValue; issue: ParamIssue | null };

/** Что делать с набранным текстом: новый черновик и, если значение принято, что отдать наверх. */
export type ParamInputOutcome = { draft: ParamDraft; emit: { value: ParamValue } | null };

/**
 * Разбор набранного текста при значении модели `value`:
 * - нераспознанный ввод — черновик с проблемой, наверх ничего не уходит;
 * - пустое поле у параметра без базового значения — законное «не задано», наверх уходит null;
 * - пустое поле у параметра с базовым значением — модель держит прежнее значение (поле скажет,
 *   по какому числу идёт расчёт);
 * - распознанное значение — наверх, если оно отличается от текущего.
 */
export function interpretParamInput(def: ParamSpec, value: ParamValue, raw: string): ParamInputOutcome {
  const res = coerce(def, raw);
  if (!res.ok) return { draft: { text: raw, against: value, issue: res.issue }, emit: null };
  if (res.value === null) {
    if (value !== null && def.base === null) return { draft: { text: raw, against: null, issue: null }, emit: { value: null } };
    return { draft: { text: raw, against: value, issue: null }, emit: null };
  }
  return {
    draft: { text: raw, against: res.value, issue: null },
    emit: res.value !== value ? { value: res.value } : null,
  };
}

/** Черновик, который ещё относится к значению модели; значение поменялось извне — null. */
export function liveParamDraft(draft: ParamDraft | null, value: ParamValue): ParamDraft | null {
  return draft !== null && draft.against === value ? draft : null;
}

const INPUT_CLASS =
  "w-full border-0 border-b-2 border-input bg-transparent px-1 py-1.5 text-sm tabular-nums transition-colors " +
  "outline-none hover:border-muted-foreground focus-visible:border-primary focus-visible:ring-0 " +
  "read-only:hover:border-input aria-invalid:border-destructive";

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none transition-colors " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-70 " +
  "aria-invalid:border-destructive";

export function ParamField({
  def,
  value,
  issue,
  changed,
  onChange,
  onReset,
  readOnly: readOnlyProp = false,
  baseValue,
  formula,
}: ParamFieldProps) {
  const [draft, setDraft] = useState<ParamDraft | null>(null);
  const readOnly = readOnlyProp || onChange === undefined;
  const id = `p-${def.key}`;
  const helpId = `${id}-help`;
  const msgId = `${id}-msg`;
  const lockId = `${id}-locked`;

  const liveDraft = liveParamDraft(draft, value);
  const shown = liveDraft !== null ? liveDraft.text : paramInputText(value);
  const localIssue = liveDraft?.issue ?? null;
  // Поле очищено, но модель держит значение (у параметра есть базовое) — расчёт идёт по нему.
  const blankDetached = liveDraft !== null && liveDraft.issue === null && liveDraft.text.trim() === "" && value !== null;

  const base = baseValue === undefined ? def.base : baseValue;
  const atOrganizerBase = value === null ? def.base === null : def.base !== null && sameParamValue(value, def.base);

  const errorMessage = localIssue?.message ?? (issue?.severity === "error" ? issue.message : null);
  const warningMessage = paramWarningText(def, value, issue);
  const lockedChanged = isLockedChanged(def, value);

  const selectValue = value === null ? "" : String(value);
  const help = paramHelpLines(def, formula);
  const hasMessage = errorMessage !== null || warningMessage !== null || blankDetached || localIssue !== null;
  const describedBy = [hasMessage ? msgId : null, def.locked ? lockId : null, help.length > 0 ? helpId : null]
    .filter((x): x is string => x !== null)
    .join(" ");

  function handleText(raw: string) {
    const outcome = interpretParamInput(def, value, raw);
    setDraft(outcome.draft);
    if (outcome.emit !== null) onChange?.(outcome.emit.value);
  }

  const invalid = errorMessage !== null;
  const cautionBorder = !invalid && (warningMessage !== null || lockedChanged);

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border-l-2 py-1 pl-3",
        invalid ? "border-destructive" : cautionBorder ? "border-caution" : "border-transparent",
      )}
    >
      <label htmlFor={id} className="text-sm leading-snug font-medium">
        {paramLabelText(def)}
      </label>

      {def.kind === "enum" && def.options.length > 0 ? (
        <select
          id={id}
          className={cn(SELECT_CLASS, cautionBorder && "border-caution")}
          value={selectValue}
          disabled={readOnly}
          aria-required={def.required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            const v = e.target.value;
            onChange?.(v === "" ? null : v);
          }}
        >
          {(value === null || !def.required) && <option value="">— не задано —</option>}
          {/* Значение не из списка (старый проект, правка справочника) показывается как есть,
              а не подменяется первым вариантом. */}
          {selectValue !== "" && !def.options.includes(selectValue) && <option value={selectValue}>{selectValue}</option>}
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          inputMode={isNumericKind(def) ? "decimal" : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={def.kind === "dims" ? "Д×Ш×В" : undefined}
          className={cn(INPUT_CLASS, cautionBorder && "border-caution")}
          value={shown}
          readOnly={readOnly}
          aria-required={def.required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            if (!readOnly) handleText(e.target.value);
          }}
          onBlur={() => setDraft((d) => (d !== null && d.issue !== null ? d : null))}
        />
      )}

      <div id={msgId}>
        {errorMessage !== null && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage}
          </p>
        )}
        {(localIssue !== null || blankDetached) && value !== null && (
          <p className="text-xs text-caution">
            {blankDetached ? "Поле пусто" : "Значение не принято"} — расчёт идёт по {withUnit(value, def.unit)}.
          </p>
        )}
        {warningMessage !== null && <p className="text-xs text-caution">{warningMessage}</p>}
      </div>

      {def.locked && (
        <p id={lockId} className={cn("text-xs", lockedChanged ? "text-caution" : "text-muted-foreground")}>
          {LOCKED_NOTICE}
        </p>
      )}

      {help.length > 0 && (
        <ul id={helpId} className="grid gap-0.5 text-xs text-muted-foreground">
          {help.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-start gap-2">
        {value === null ? (
          // Пустому полю источник не приписывается: бейдж «Оценка» рядом с пустотой читался бы
          // как «пусто — это оценка». Почему значения нет, говорит подсказка поля.
          <span className="text-xs text-muted-foreground">не задано</span>
        ) : atOrganizerBase && !changed ? (
          <SourceBadge
            origin={def.origin}
            sourceRef={def.sourceRef}
            sourceUrl={def.sourceUrl}
            note={def.origin === "organizer" ? ORGANIZER_DEMO_NOTE : def.basis}
          />
        ) : (
          <SourceBadge origin="user" />
        )}
        {changed && (
          <>
            <span className="text-xs text-muted-foreground">
              базовое: {base === null ? "не задано" : withUnit(base, def.unit)}
            </span>
            {!readOnly && onReset !== undefined && (
              <button
                type="button"
                className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                onClick={() => {
                  setDraft(null);
                  onReset();
                }}
              >
                вернуть базовое
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
