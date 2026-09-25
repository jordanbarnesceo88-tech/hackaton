"use client";

import { formatYearsRu } from "@/lib/format/plural";
import { fx } from "@/lib/tz/econ/text";
import type { TraceStep } from "@/lib/tz/types";
import { SourceBadge } from "./source-badge";

/**
 * Трассировка расчёта «Как посчитано» (ТЗ §3.5.8: формулы, единицы, источники и допущения
 * видны пользователю). Каждый шаг — одна строка «подпись: формула = подстановка» с выделенным
 * результатом и бейдж происхождения: из данных организатора, оценка, вычислено, задано вами.
 *
 * Подстановки движка (lib/tz/econ) уже заканчиваются результатом («46 872 000 ₽ − 37 067 494 ₽
 * = 9 804 506 ₽»), поэтому результат второй раз не приписывается: он находится в подстановке
 * и выделяется, а недостающая единица дописывается к нему («9 804 506 ₽/год», «= 10 шт.»).
 * Только если результата в подстановке нет, он добавляется в конце: «… = {результат} {единица}».
 */

/** Единицы срока: результат печатается как срок с согласованием («3,6 года», «5,0 лет»). */
const YEAR_UNITS: ReadonlySet<string> = new Set(["лет", "год", "года", "г."]);

/**
 * Результат шага с единицей: рубли — без копеек, проценты — до десятых, доли — до тысячных,
 * сроки — до десятых с согласованием («3,6 года»), остальное — по правилу подстановок движка
 * (целые без дробной части, до сотых от единицы).
 */
export function formatTraceValue(value: number, unit: string): string {
  if (unit.startsWith("₽")) return `${fx(value, 0)} ${unit}`;
  if (unit === "%") return `${fx(value, 1)} %`;
  if (unit === "доля") return fx(value, 3);
  if (YEAR_UNITS.has(unit)) return formatYearsRu(value);
  return unit === "" ? fx(value) : `${fx(value)} ${unit}`;
}

/**
 * Разбиение подстановки для показа: `pre` + `result` + `post`. `result` — результат шага,
 * выделяемый на экране; `appended` — результата в подстановке не было, и он приписан после
 * « = ». Склеенные части дают текст шага после «формула = ».
 */
export type TraceParts = { pre: string; result: string; post: string; appended: boolean };

/** Число в записи ru-RU: знак, разряды через пробел (в т. ч. неразрывный), десятичная запятая. */
const RU_NUMBER = /[-−]?\d+(?:[   ]\d{3})*(?:,\d+)?/g;

function parseRu(token: string): number {
  return Number(token.replace(/[   ]/g, "").replace("−", "-").replace(",", "."));
}

/** Число из подстановки совпадает с результатом с точностью до показанных знаков. */
function sameAsShown(token: string, value: number): boolean {
  const n = parseRu(token);
  if (!Number.isFinite(n)) return false;
  const decimals = token.includes(",") ? (token.split(",")[1]?.length ?? 0) : 0;
  return Math.abs(n - value) <= 0.5 * 10 ** -decimals * (1 + 1e-9) + 1e-9 * Math.abs(value);
}

/** Единица, которую не дописываем к голому числу: безразмерная доля. */
function silentUnit(unit: string): boolean {
  return unit === "" || unit === "доля";
}

export function traceParts(step: TraceStep): TraceParts {
  const sub = step.substituted;
  // Результат ищется в «хвосте» после последнего «=»; если «=» нет — во всей подстановке
  // («90 паллет/ч (не подтверждена…)», «год 4: 2 700 000 ₽»).
  const eq = sub.lastIndexOf("=");
  const tailStart = eq === -1 ? 0 : eq + 1;
  const tail = sub.slice(tailStart);
  for (const m of tail.matchAll(RU_NUMBER)) {
    const token = m[0];
    if (!sameAsShown(token, step.value)) continue;
    const numStart = tailStart + (m.index ?? 0);
    const numEnd = numStart + token.length;
    const after = sub.slice(numEnd);
    const unitMatch = /^(\s*)(\S+)/.exec(after);
    if (after.trim() === "") {
      // «… = 1 900» → «1 900 паллет/сут».
      return {
        pre: sub.slice(0, numStart),
        result: silentUnit(step.unit) ? token : `${token} ${step.unit}`,
        post: after,
        appended: false,
      };
    }
    if (unitMatch && unitMatch[2] !== undefined) {
      const [whole, space = "", word] = unitMatch;
      // «9 804 506 ₽» при единице «₽/год» → «9 804 506 ₽/год»; «140,3 %» — единица уже на месте.
      const widens = step.unit.startsWith(`${word}/`);
      if (word === step.unit || widens) {
        return {
          pre: sub.slice(0, numStart),
          result: `${token}${space}${widens ? step.unit : word}`,
          post: after.slice(whole.length),
          appended: false,
        };
      }
    }
    // Единица в подстановке своя («3,61 г.») — выделяется только число.
    return { pre: sub.slice(0, numStart), result: token, post: after, appended: false };
  }
  return { pre: sub, result: formatTraceValue(step.value, step.unit), post: "", appended: true };
}

/** Текст шага: «{подпись}: {формула} = {подстановка с результатом и единицей}». */
export function traceStepText(step: TraceStep): string {
  const p = traceParts(step);
  const body = p.appended ? `${p.pre} = ${p.result}` : `${p.pre}${p.result}${p.post}`;
  return `${step.label}: ${step.formula} = ${body}`;
}

export function TraceList({
  steps,
  title,
}: {
  steps: readonly TraceStep[];
  title?: string;
  /** Для единообразия с отчётом: элементов управления здесь нет, вид не меняется. */
  print?: boolean;
}) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">Шагов расчёта нет: сценарий не дошёл до вычислений.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {title && <h4 className="text-sm font-semibold">{title}</h4>}
      <ol className="flex list-decimal flex-col gap-2 pl-6 text-sm">
        {steps.map((s, i) => {
          const p = traceParts(s);
          return (
            <li key={`${s.key}-${i}`} className="break-inside-avoid">
              <span className="font-medium">{s.label}:</span>{" "}
              <span className="text-muted-foreground">{s.formula}</span> ={" "}
              <span className="font-mono text-xs break-words">
                {p.pre}
                {p.appended ? " = " : null}
                <span className="font-sans text-sm font-semibold whitespace-nowrap">{p.result}</span>
                {p.post}
              </span>{" "}
              <SourceBadge origin={s.origin} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
