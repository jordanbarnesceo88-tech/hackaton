"use client";

import { useId } from "react";
import { pluralRu } from "@/lib/format/plural";
import { sameParamValue } from "@/lib/tz/params/schema";
import type { ParamIssue, ParamSpec, ParamValues } from "@/lib/tz/types";
import { isLockedChanged, isValueOutOfRange, ParamField, type ParamValue } from "./param-field";

/**
 * Форма параметров объекта (ТЗ §2.2 шаг 2, §3.2.2): поля сгруппированы по разделам датасета
 * организатора («Общие параметры объекта», «Режим работы», «Персонал»…), у каждого раздела
 * заголовок h3 — страница владеет h1, рабочая область — h2 шага. Над формой — счётчик
 * «Изменено параметров: N · Предупреждений: M», чтобы было видно, насколько проект отошёл от
 * демо-данных организатора и сколько значений вне его диапазонов.
 *
 * Проверку значений (validateParamValues) и журнал изменений ведёт рабочая область: форма
 * получает готовые `issues` и сообщает наверх ключ и приведённое значение. Счётчики формы и
 * разделов считают то же, что подсвечивают поля: предупреждения из `issues`, значения вне
 * диапазона и изменённые зафиксированные параметры, — чтобы «Предупреждений: 0» не стояло над
 * полем с предупреждением.
 *
 * Без обработчиков (`onChange`/`onReset`) форма только для чтения — так её может показать
 * серверная страница, не передавая функций в клиентский компонент.
 */

export type ParamsFormProps = {
  defs: readonly ParamSpec[];
  values: ParamValues;
  issues: readonly ParamIssue[];
  /** Базовые значения проекта (демо-данные организатора или загруженный файл). */
  baseValues: ParamValues;
  onChange?: (key: string, value: ParamValue) => void;
  onReset?: (key: string) => void;
  readOnly?: boolean;
};

/** Раздел формы: название и параметры в порядке показа. */
export type ParamSection = { section: string; defs: ParamSpec[] };

/** Разделы в порядке первого появления после сортировки параметров по `order`. */
export function groupBySection(defs: readonly ParamSpec[]): ParamSection[] {
  const sorted = [...defs].sort((a, b) => a.order - b.order);
  const out: ParamSection[] = [];
  const index = new Map<string, ParamSection>();
  for (const def of sorted) {
    let s = index.get(def.section);
    if (!s) {
      s = { section: def.section, defs: [] };
      index.set(def.section, s);
      out.push(s);
    }
    s.defs.push(def);
  }
  return out;
}

/** Базовое значение параметра: из базовых значений проекта, иначе демо-значение организатора. */
export function baseOf(def: ParamSpec, baseValues: ParamValues): ParamValue {
  const b = baseValues[def.key];
  return b === undefined ? def.base : b;
}

/** Текущее значение параметра: из значений проекта, иначе базовое. */
export function valueOf(def: ParamSpec, values: ParamValues, baseValues: ParamValues): ParamValue {
  const v = values[def.key];
  return v === undefined ? baseOf(def, baseValues) : v;
}

/** Параметр изменён относительно базового значения (числа — с допуском, текст — без регистра). */
export function isParamChanged(def: ParamSpec, values: ParamValues, baseValues: ParamValues): boolean {
  return !sameParamValue(valueOf(def, values, baseValues), baseOf(def, baseValues));
}

/**
 * Проблема для поля: сначала ошибка, затем предупреждение — поле показывает одну, самую важную.
 */
export function issueForKey(issues: readonly ParamIssue[], key: string): ParamIssue | null {
  let warning: ParamIssue | null = null;
  for (const i of issues) {
    if (i.key !== key) continue;
    if (i.severity === "error") return i;
    warning ??= i;
  }
  return warning;
}

/** У параметра есть ошибка проверки. */
export function hasParamError(def: ParamSpec, issues: readonly ParamIssue[]): boolean {
  return issues.some((i) => i.key === def.key && i.severity === "error");
}

/**
 * У параметра есть предупреждение — то же, что подсвечивает `ParamField`: предупреждение из
 * `issues`, значение вне диапазона или изменённый зафиксированный параметр.
 */
export function hasParamWarning(
  def: ParamSpec,
  values: ParamValues,
  baseValues: ParamValues,
  issues: readonly ParamIssue[],
): boolean {
  if (issues.some((i) => i.key === def.key && i.severity === "warning")) return true;
  const v = valueOf(def, values, baseValues);
  return isValueOutOfRange(def, v) || isLockedChanged(def, v);
}

/** Счётчики над формой. */
export type ParamsCounters = { changed: number; warnings: number; errors: number };

/**
 * Счётчики по параметрам: изменённые, с предупреждением, с ошибкой (каждый параметр считается
 * один раз). Замечания без поля в форме (несопоставленные строки файла) добавляются по одному.
 */
export function paramsCounters(
  defs: readonly ParamSpec[],
  values: ParamValues,
  baseValues: ParamValues,
  issues: readonly ParamIssue[],
): ParamsCounters {
  const known = new Set(defs.map((d) => d.key));
  const orphan = issues.filter((i) => !known.has(i.key));
  return {
    changed: defs.filter((d) => isParamChanged(d, values, baseValues)).length,
    warnings:
      defs.filter((d) => hasParamWarning(d, values, baseValues, issues)).length +
      orphan.filter((i) => i.severity === "warning").length,
    errors: defs.filter((d) => hasParamError(d, issues)).length + orphan.filter((i) => i.severity === "error").length,
  };
}

/** «Изменено параметров: 2 · Предупреждений: 1»; ошибки добавляются, только если они есть. */
export function countersText(c: ParamsCounters): string {
  const base = `Изменено параметров: ${c.changed} · Предупреждений: ${c.warnings}`;
  return c.errors > 0 ? `${base} · Ошибок: ${c.errors}` : base;
}

/**
 * Подпись рядом с заголовком раздела: «6 параметров», «6 параметров, изменено 2, замечаний 1».
 * Замечания названы и в свёрнутом разделе, чтобы предупреждение не пряталось вместе с полем.
 */
export function sectionSummaryText(total: number, changed: number, problems = 0): string {
  const parts = [`${total} ${pluralRu(total, ["параметр", "параметра", "параметров"])}`];
  if (changed > 0) parts.push(`изменено ${changed}`);
  if (problems > 0) parts.push(`замечаний ${problems}`);
  return parts.join(", ");
}

/**
 * Формула с названиями параметров вместо ключей: «totalAreaM2 × 0,5» → ««Общая площадь склада»
 * × 0,5». Неизвестные слова остаются как есть.
 */
export function humanizeFormula(formula: string | null, defs: readonly ParamSpec[]): string | null {
  if (formula === null) return null;
  const labels = new Map(defs.map((d) => [d.key, d.label]));
  return formula.replace(/[A-Za-z][A-Za-z0-9]*/g, (w) => {
    const label = labels.get(w);
    return label === undefined ? w : `«${label}»`;
  });
}

export function ParamsForm({ defs, values, issues, baseValues, onChange, onReset, readOnly = false }: ParamsFormProps) {
  const uid = useId();
  const sections = groupBySection(defs);
  const counters = paramsCounters(defs, values, baseValues, issues);
  const known = new Set(defs.map((d) => d.key));
  // Замечания без поля в форме — строки файла, которые не сопоставились, лишние ключи API.
  const orphan = issues.filter((i) => !known.has(i.key));

  return (
    <div className="flex flex-col gap-6">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {countersText(counters)}
      </p>

      {orphan.length > 0 && (
        <div className="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm">
          <p className="font-medium">Замечания к загруженным данным</p>
          <ul className="mt-1 grid gap-0.5 pl-4">
            {orphan.map((i, n) => (
              <li key={`${i.key}-${i.row ?? ""}-${n}`} className="list-disc" role={i.severity === "error" ? "alert" : undefined}>
                {i.row !== undefined ? `Строка ${i.row}: ` : ""}
                {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sections.map((s, si) => {
        const headingId = `${uid}-section-${si}`;
        const changedHere = s.defs.filter((d) => isParamChanged(d, values, baseValues)).length;
        const problemsHere = s.defs.filter(
          (d) => hasParamError(d, issues) || hasParamWarning(d, values, baseValues, issues),
        ).length;
        return (
          // Раздел сворачивается: у склада больше 50 параметров, а жюри обычно правит два-три.
          <details key={s.section} open className="group/section">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="text-muted-foreground transition-transform group-open/section:rotate-90">
                ▸
              </span>
              <h3 id={headingId} className="inline">
                {s.section}
              </h3>
              <span className={problemsHere > 0 ? "text-xs text-caution" : "text-xs text-muted-foreground"}>
                {sectionSummaryText(s.defs.length, changedHere, problemsHere)}
              </span>
            </summary>
            <div role="group" aria-labelledby={headingId} className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              {s.defs.map((def) => (
                <ParamField
                  key={def.key}
                  def={def}
                  value={valueOf(def, values, baseValues)}
                  baseValue={baseOf(def, baseValues)}
                  issue={issueForKey(issues, def.key)}
                  changed={isParamChanged(def, values, baseValues)}
                  formula={humanizeFormula(def.formula, defs)}
                  readOnly={readOnly}
                  onChange={onChange ? (v) => onChange(def.key, v) : undefined}
                  onReset={onReset ? () => onReset(def.key) : undefined}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
