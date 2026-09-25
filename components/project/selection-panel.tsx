"use client";

import Link from "next/link";
import { Fragment, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProcessDef } from "@/lib/tz/processes";
import type { ProductForCalc, SelectionResult, SelectionStatus } from "@/lib/tz/types";
import { cn } from "@/lib/utils";
import {
  NEEDS_VERIFICATION_LABEL,
  STATUS_CHIP_TONE,
  scenarioItemKey,
  statusChipLabel,
  type ScenarioItemKey,
} from "./comparison-table";
import { ScoreBar } from "./score-bar";

/**
 * Подбор решений для процесса объекта (ТЗ §2.2 шаг 3, §3.4.1–§3.4.5): таблица продуктов со
 * статусом, баллом с разложением по факторам, причинами включения или исключения,
 * ограничениями и недостающими данными с подсказкой, как их восполнить.
 *
 * Действия:
 * - «Использовать в сценариях» — для рекомендуемого и подходящих продуктов;
 * - «Добавить вручную…» — для исключённых и продуктов без данных (ТЗ §3.4.4: ручное
 *   добавление в сравнение с предупреждением). Причина обязательна, решение попадает в
 *   сценарии со значком ⚠ и записью в журнал — это делает рабочая область по `onManualAdd`.
 *
 * Исключённые продукты свёрнуты под «Исключённые решения (n)»: они нужны для объяснения
 * («почему не RoboCV»), но не должны заслонять кандидатов.
 *
 * Только для чтения (`readOnly` или без обработчиков) колонки «Действия» нет. Обработчики
 * необязательны, чтобы серверная страница (отчёт) могла показать панель, не передавая функций
 * в клиентский компонент.
 */

export type SelectionPanelProps = {
  process: ProcessDef;
  results: readonly SelectionResult[];
  /**
   * Позиции сценариев проекта — ключи «процесс:продукт» из `scenarioItemKeys(scenarios)`.
   * Не голые slug'и: MULE, AK-2000-2, Carrier P и Pallet Shuttle подбираются сразу для
   * нескольких процессов, и продукт из сценария перемещения паллет не должен значиться
   * «в сценариях» в таблице хранения.
   */
  inScenarios?: ReadonlySet<ScenarioItemKey>;
  onUse?: (slug: string) => void;
  /** Получает slug и уже обрезанную непустую причину. */
  onManualAdd?: (slug: string, reason: string) => void;
  readOnly?: boolean;
  /** Продукты процесса — для производителя в колонке «Продукт»; `SelectionResult` его не несёт. */
  products?: readonly Pick<ProductForCalc, "slug" | "manufacturer">[];
};

// Подписи и цвета чипов статуса и ключи позиций сценариев живут в модуле без "use client"
// (comparison-table.tsx), чтобы серверные страницы (отчёт) могли их вызывать; здесь они
// переэкспортируются для клиентского кода.
export {
  NEEDS_VERIFICATION_LABEL,
  STATUS_CHIP_LABELS,
  scenarioItemKey,
  scenarioItemKeys,
  statusChipLabel,
  type ScenarioItemKey,
} from "./comparison-table";

const NO_KEYS: ReadonlySet<ScenarioItemKey> = new Set<ScenarioItemKey>();

/** Продукт можно поставить в сценарии без оговорок: он прошёл ограничения и данных хватает. */
export function canUse(r: Pick<SelectionResult, "status">): boolean {
  return r.status === "recommended" || r.status === "candidate";
}

/** Продукт можно добавить только вручную, с причиной и пометкой ⚠. */
export function canManualAdd(r: Pick<SelectionResult, "status">): boolean {
  return r.status === "excluded" || r.status === "insufficient-data";
}

/**
 * Предупреждение в форме ручного добавления. Для исключённого продукта перечисляются
 * нарушенные ограничения, для продукта без данных — чего не хватает: «не прошло проверку
 * ограничений» про продукт без производительности было бы неправдой.
 */
export function manualAddWarning(r: Pick<SelectionResult, "status" | "reasons" | "missing">): string {
  const tail = "Оно будет добавлено с пометкой ⚠ и записью в журнал";
  if (r.status === "insufficient-data") {
    const why =
      r.reasons.find((x) => x.startsWith("Недостаточно данных")) ??
      (r.missing.length > 0 ? `не хватает данных: ${r.missing.map((m) => m.label).join(", ")}` : "не хватает данных");
    return `Решение не прошло проверку данных: ${why}. ${tail}`;
  }
  const reasons = r.reasons.length > 0 ? r.reasons.join("; ") : "причина не указана";
  return `Решение не прошло проверку ограничений: ${reasons}. ${tail}`;
}

/** Продукт стоит в сценариях именно для этого процесса. */
export function isInScenarios(
  inScenarios: ReadonlySet<ScenarioItemKey>,
  r: Pick<SelectionResult, "process" | "productSlug">,
): boolean {
  return inScenarios.has(scenarioItemKey(r.process, r.productSlug));
}

/**
 * Форма ручного добавления открыта для строки: её открыли для этого продукта, и он всё ещё
 * добавляется только вручную. Если после правки параметров продукт стал кандидатом или его
 * уже поставили в сценарии, форма закрывается — иначе годный кандидат ушёл бы в сценарии с ⚠,
 * а предупреждение перечисляло бы причины кандидата как нарушенные ограничения.
 */
export function isManualFormOpen(
  manualSlug: string | null,
  r: Pick<SelectionResult, "productSlug" | "status">,
  used: boolean,
): boolean {
  return manualSlug !== null && manualSlug === r.productSlug && canManualAdd(r) && !used;
}

/** Сводка по статусам над таблицей: «Рекомендуется: 1 · Подходит: 4 · …». */
export function selectionSummaryText(results: readonly Pick<SelectionResult, "status">[]): string {
  const count = (s: SelectionStatus) => results.filter((r) => r.status === s).length;
  return [
    `Рекомендуется: ${count("recommended")}`,
    `Подходит: ${count("candidate")}`,
    `Недостаточно данных: ${count("insufficient-data")}`,
    `Исключено: ${count("excluded")}`,
  ].join(" · ");
}

const CHIP_CLASS = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs leading-tight whitespace-nowrap";

function TextList({ items, empty = "—" }: { items: readonly string[]; empty?: string }) {
  if (items.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <ul className="grid gap-1 pl-4">
      {items.map((t, i) => (
        <li key={i} className="list-disc">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Состояние формы ручного добавления: для какого продукта открыта и введённая причина. */
type ManualState = { slug: string; reason: string } | null;

type TableProps = {
  rows: readonly SelectionResult[];
  inScenarios: ReadonlySet<ScenarioItemKey>;
  manufacturers: ReadonlyMap<string, string | null>;
  /** Показывать колонку «Действия»: не только чтение и есть хотя бы один обработчик. */
  actions: boolean;
  canUseAction: boolean;
  canManualAction: boolean;
  manual: ManualState;
  formId: string;
  onUse: (slug: string) => void;
  onOpenManual: (slug: string) => void;
  onReason: (reason: string) => void;
  onCancelManual: () => void;
  onSubmitManual: () => void;
  caption: string;
};

function ResultsTable({
  rows,
  inScenarios,
  manufacturers,
  actions,
  canUseAction,
  canManualAction,
  manual,
  formId,
  onUse,
  onOpenManual,
  onReason,
  onCancelManual,
  onSubmitManual,
  caption,
}: TableProps) {
  const colCount = actions ? 7 : 6;
  return (
    <div className="data-table-wrap">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Продукт
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Статус
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Балл
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Причины
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Ограничения
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Недостающие данные
            </th>
            {actions && (
              <th scope="col" className="px-3 py-2 font-medium">
                Действия
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const manufacturer = manufacturers.get(r.productSlug) ?? null;
            const used = isInScenarios(inScenarios, r);
            const open = actions && canManualAction && isManualFormOpen(manual?.slug ?? null, r, used);
            const reasonId = `${formId}-${r.productSlug}-reason`;
            return (
              <Fragment key={r.productSlug}>
                <tr className={cn("border-t align-top", r.status === "recommended" && "bg-positive/5")}>
                  <th scope="row" className="min-w-36 px-3 py-2 text-left font-normal">
                    <Link
                      href={`/catalog/${encodeURIComponent(r.productSlug)}`}
                      prefetch={false}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {r.productName}
                    </Link>
                    {manufacturer && <div className="text-xs text-muted-foreground">{manufacturer}</div>}
                  </th>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <span className={cn(CHIP_CLASS, STATUS_CHIP_TONE[r.status])}>{statusChipLabel(r.status)}</span>
                      {r.needsVerification && (
                        <span className={cn(CHIP_CLASS, "border-caution/50 text-caution")}>{NEEDS_VERIFICATION_LABEL}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ScoreBar score={r.score} />
                  </td>
                  <td className="max-w-72 min-w-52 px-3 py-2 text-xs">
                    <TextList items={r.reasons} />
                  </td>
                  <td className="max-w-72 min-w-52 px-3 py-2 text-xs">
                    <TextList items={r.limitations} empty="нет" />
                  </td>
                  <td className="max-w-64 min-w-44 px-3 py-2 text-xs">
                    {r.missing.length === 0 ? (
                      <span className="text-muted-foreground">нет</span>
                    ) : (
                      <ul className="grid gap-1 pl-4">
                        {r.missing.map((m) => (
                          <li key={m.key} className="list-disc">
                            <span className="font-medium">{m.label}</span>
                            <span className="text-muted-foreground"> — {m.howToFix}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  {actions && (
                    <td className="px-3 py-2">
                      {used ? (
                        <span className={cn(CHIP_CLASS, canUse(r) ? "border-positive/50 text-foreground" : "border-caution/50 text-caution")}>
                          {canUse(r) ? "✓ В сценариях" : "⚠ Добавлено вручную"}
                        </span>
                      ) : canUse(r) && canUseAction ? (
                        <Button type="button" size="sm" onClick={() => onUse(r.productSlug)}>
                          Использовать в сценариях
                        </Button>
                      ) : canManualAdd(r) && canManualAction ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-expanded={open}
                          aria-controls={open ? `${formId}-${r.productSlug}` : undefined}
                          onClick={() => (open ? onCancelManual() : onOpenManual(r.productSlug))}
                        >
                          Добавить вручную…
                        </Button>
                      ) : null}
                    </td>
                  )}
                </tr>
                {open && manual !== null ? (
                  <tr className="bg-caution/5">
                    <td colSpan={colCount} className="px-3 py-3">
                      <form
                        id={`${formId}-${r.productSlug}`}
                        className="flex max-w-3xl flex-col gap-2 rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm"
                        onSubmit={(e) => {
                          e.preventDefault();
                          onSubmitManual();
                        }}
                      >
                        <p className="text-caution">{manualAddWarning(r)}</p>
                        <label htmlFor={reasonId} className="font-medium">
                          Причина (обязательно)
                        </label>
                        <textarea
                          id={reasonId}
                          required
                          rows={2}
                          maxLength={500}
                          value={manual.reason}
                          onChange={(e) => onReason(e.target.value)}
                          placeholder="например, производитель подтвердил применимость письмом — решение нужно для сравнения"
                          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" size="sm" disabled={manual.reason.trim() === ""}>
                            Добавить с пометкой ⚠
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={onCancelManual}>
                            Отмена
                          </Button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SelectionPanel({
  process,
  results,
  inScenarios = NO_KEYS,
  onUse,
  onManualAdd,
  readOnly = false,
  products,
}: SelectionPanelProps) {
  const formId = useId();
  const [manual, setManual] = useState<ManualState>(null);

  const mine = results.filter((r) => r.process === process.slug);
  const active = mine.filter((r) => r.status !== "excluded");
  const excluded = mine.filter((r) => r.status === "excluded");
  const manufacturers = new Map((products ?? []).map((p) => [p.slug, p.manufacturer]));
  const canUseAction = !readOnly && onUse !== undefined;
  const canManualAction = !readOnly && onManualAdd !== undefined;

  const tableProps = {
    inScenarios,
    manufacturers,
    actions: canUseAction || canManualAction,
    canUseAction,
    canManualAction,
    manual,
    formId,
    onUse: (slug: string) => onUse?.(slug),
    onOpenManual: (slug: string) => setManual({ slug, reason: "" }),
    onReason: (reason: string) => setManual((m) => (m === null ? m : { ...m, reason })),
    onCancelManual: () => setManual(null),
    onSubmitManual: () => {
      if (manual === null || onManualAdd === undefined) return;
      const reason = manual.reason.trim();
      if (reason === "") return;
      onManualAdd(manual.slug, reason);
      setManual(null);
    },
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3>{process.name}</h3>
        <p className="text-sm text-muted-foreground">
          Спрос процесса: {process.demandFormula} ({process.demandUnit})
        </p>
        {mine.length > 0 && <p className="text-xs text-muted-foreground">{selectionSummaryText(mine)}</p>}
      </div>

      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">В каталоге нет решений для этого процесса.</p>
      ) : (
        <>
          {active.length > 0 ? (
            <ResultsTable rows={active} caption={`Подбор решений: ${process.name}`} {...tableProps} />
          ) : (
            <p className="rounded-md border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution">
              Ни одно решение не прошло проверку ограничений объекта — причины ниже, в исключённых решениях.
            </p>
          )}
          {excluded.length > 0 && (
            <details className="group/excluded">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Исключённые решения ({excluded.length})
              </summary>
              <div className="mt-2">
                <ResultsTable rows={excluded} caption={`Исключённые решения: ${process.name}`} {...tableProps} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
