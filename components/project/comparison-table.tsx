import { formatYearsRu } from "@/lib/format/plural";
import { formatMRub, formatNum, formatPct, formatRub } from "@/lib/format/rub";
import { processDef, type ProcessDef } from "@/lib/tz/processes";
import type { ComparisonRow, ScenarioSpec, SelectionStatus } from "@/lib/tz/types";
import { cn } from "@/lib/utils";

/**
 * Сравнение решений по единым характеристикам (ТЗ §2.2 шаг 4): продукты — столбцы (до шести),
 * характеристики — строки в одинаковых единицах, сгруппированные как в ТЗ: технические,
 * эксплуатационные и экономические. Значения берутся из `ComparisonRow` модели проекта;
 * отсутствующее значение — «нет данных», а не ноль.
 *
 * Если решений больше шести, добавленные вручную и уже стоящие в сценариях показываются всегда
 * (иначе ⚠ и выбранный продукт уходили бы за край: модель ставит их в конец списка), остальные
 * места занимают решения в порядке подбора.
 *
 * Для процессов, у которых в tz-1.0.0 нет экономики или имитации (`calcSupported`/`simSupported`
 * в `lib/tz/processes`), строки парка и экономики подписаны «не рассчитывается (прототип)», а
 * цикл на планировке — «не моделируется»: «нет данных» там читалось бы как пробел в каталоге.
 *
 * Продукт, добавленный вручную в обход подбора, отмечен ⚠ в заголовке столбца. В строках, где
 * «лучше» однозначно (принятая производительность, CAPEX, NPV, окупаемость, полнота данных),
 * лучшее значение выделено — это подсказка для глаза, а не рекомендация: рекомендацию даёт
 * подбор и вывод по сценариям.
 */

/**
 * Подписи статусов подбора на чипах (ТЗ §3.4). Кандидат называется «Подходит»: для человека
 * это ответ на вопрос «годится ли решение моему объекту». Модуль без "use client", поэтому
 * подписи доступны и серверным страницам; панель подбора их переэкспортирует.
 */
export const STATUS_CHIP_LABELS: Readonly<Record<SelectionStatus, string>> = {
  recommended: "Рекомендуется",
  candidate: "Подходит",
  "insufficient-data": "Недостаточно данных",
  excluded: "Исключён",
};

/** Подпись чипа статуса подбора. */
export function statusChipLabel(status: SelectionStatus): string {
  return STATUS_CHIP_LABELS[status];
}

/** Цвет чипа статуса подбора. */
export const STATUS_CHIP_TONE: Readonly<Record<SelectionStatus, string>> = {
  recommended: "border-positive/50 bg-positive/15 text-foreground",
  candidate: "border-primary/30 bg-primary/5 text-foreground",
  "insufficient-data": "border-caution/50 bg-caution/10 text-foreground",
  excluded: "border-border bg-muted text-muted-foreground",
};

/** Подпись чипа «требует проверки» (ТЗ §3.4.3). */
export const NEEDS_VERIFICATION_LABEL = "требует проверки";

/** Сколько решений помещается в таблицу на экране 1366×768. */
export const COMPARISON_MAX_COLUMNS = 6;

/** Текст для отсутствующего значения. */
export const NO_DATA = "нет данных";

/** Парк и экономика процесса в tz-1.0.0 не считаются (ТЗ §5.7: прототип). */
export const NOT_CALCULATED = "не рассчитывается (прототип)";

/** Цикл на планировке для процесса не моделируется имитацией. */
export const NOT_SIMULATED = "не моделируется";

/**
 * Ключ позиции сценария «процесс:продукт». Один продукт бывает в подборе нескольких процессов
 * (MULE, AK-2000-2, Carrier P, Pallet Shuttle), поэтому «стоит в сценариях» проверяется по паре,
 * а не по slug. Тип-шаблон не даёт передать вместо ключей голые slug'и (`Set<string>`).
 */
export type ScenarioItemKey = `${string}:${string}`;

export function scenarioItemKey(process: string, productSlug: string): ScenarioItemKey {
  return `${process}:${productSlug}`;
}

/** Ключи всех позиций сценариев проекта — для `inScenarios` подбора и `pinned` сравнения. */
export function scenarioItemKeys(specs: readonly Pick<ScenarioSpec, "items">[]): Set<ScenarioItemKey> {
  const out = new Set<ScenarioItemKey>();
  for (const s of specs) for (const it of s.items) out.add(scenarioItemKey(it.process, it.productSlug));
  return out;
}

/** Группы строк сравнения в порядке показа. */
export const COMPARISON_GROUPS = ["Технические", "Эксплуатация", "Экономика"] as const;
export type ComparisonGroup = (typeof COMPARISON_GROUPS)[number];

/** Строка таблицы сравнения: подпись, единица, группа, извлечение и форматирование значения. */
export type ComparisonMetric = {
  key: string;
  group: ComparisonGroup;
  label: string;
  /** Единица для подписи строки; функция — если единица зависит от процесса («паллет/ч»). */
  unit: string | ((process: string) => string) | null;
  text: (r: ComparisonRow) => string;
  /** Числовое значение для выделения лучшего; нет — строка не выделяется. */
  value?: (r: ComparisonRow) => number | null;
  better?: "max" | "min";
  /**
   * Что строка требует от процесса: `calc` — парк и экономику, `sim` — цикл на планировке.
   * Значения каталога (цена, ставка, полнота) от процесса не зависят и требований не имеют.
   */
  requires?: "calc" | "sim";
};

/** Число без лишних нулей: 1500 → «1 500», 1.5 → «1,5», 0.75 → «0,75». */
export function fmtValue(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return NO_DATA;
  const r2 = Math.round(v * 100) / 100;
  const digits = Number.isInteger(r2) ? 0 : Number.isInteger(r2 * 10) ? 1 : 2;
  return formatNum(r2, digits);
}

/** Единица производительности процесса: «паллет/ч»; неизвестный процесс — «ед./ч». */
export function throughputUnitOf(process: string): string {
  return processDef(process)?.throughputUnit ?? "ед./ч";
}

/** Окупаемость покупки словами: CAPEX посчитан, а срока нет — эффект не положителен. */
export function paybackText(r: Pick<ComparisonRow, "paybackPurchaseYears" | "capexPurchaseRub">): string {
  const y = r.paybackPurchaseYears;
  if (typeof y === "number" && Number.isFinite(y)) return formatYearsRu(y);
  return r.capexPurchaseRub !== null ? "не окупается" : NO_DATA;
}

/** Статус подбора в ячейке: «Подходит» или «Исключён · ⚠ добавлено вручную». */
export function comparisonStatusText(r: Pick<ComparisonRow, "status" | "manuallyAdded">): string {
  const s = statusChipLabel(r.status);
  return r.manuallyAdded ? `${s} · ⚠ добавлено вручную` : s;
}

/** Строки сравнения по группам ТЗ. */
export const COMPARISON_METRICS: readonly ComparisonMetric[] = [
  { key: "payloadKg", group: "Технические", label: "Грузоподъёмность", unit: "кг", text: (r) => fmtValue(r.payloadKg) },
  { key: "speedMps", group: "Технические", label: "Скорость", unit: "м/с", text: (r) => fmtValue(r.speedMps) },
  {
    key: "thrNorm",
    group: "Технические",
    label: "Производительность по норме",
    unit: throughputUnitOf,
    text: (r) => fmtValue(r.thrNorm),
  },
  {
    key: "thrCycle",
    group: "Технические",
    label: "Производительность по циклу на планировке",
    unit: throughputUnitOf,
    text: (r) => fmtValue(r.thrCycle),
    requires: "sim",
  },
  {
    key: "thrEff",
    group: "Технические",
    label: "Производительность принятая",
    unit: throughputUnitOf,
    text: (r) => fmtValue(r.thrEff),
    value: (r) => r.thrEff,
    better: "max",
  },
  { key: "autonomyH", group: "Технические", label: "Автономность", unit: "ч", text: (r) => fmtValue(r.autonomyH) },
  { key: "chargeMin", group: "Технические", label: "Время зарядки", unit: "мин", text: (r) => fmtValue(r.chargeMin) },
  { key: "minAisleM", group: "Технические", label: "Мин. ширина прохода", unit: "м", text: (r) => fmtValue(r.minAisleM) },
  { key: "n", group: "Эксплуатация", label: "Роботов", unit: "шт.", text: (r) => fmtValue(r.n), requires: "calc" },
  {
    key: "chargers",
    group: "Эксплуатация",
    label: "Зарядных станций",
    unit: "шт.",
    text: (r) => fmtValue(r.chargers),
    requires: "calc",
  },
  { key: "status", group: "Эксплуатация", label: "Статус подбора", unit: null, text: comparisonStatusText },
  // Денежные строки и полнота несут единицу в самом значении («2 700 000 ₽», «35,4 млн ₽»,
  // «150 000 ₽/мес», «80 %»), поэтому в подписи строки единицы нет — иначе она печаталась бы дважды.
  {
    key: "priceRub",
    group: "Экономика",
    label: "Цена за единицу",
    unit: null,
    text: (r) => (r.priceRub === null ? NO_DATA : formatRub(r.priceRub)),
  },
  {
    key: "capexPurchaseRub",
    group: "Экономика",
    label: "CAPEX покупки",
    unit: null,
    text: (r) => (r.capexPurchaseRub === null ? NO_DATA : formatMRub(r.capexPurchaseRub)),
    value: (r) => r.capexPurchaseRub,
    better: "min",
    requires: "calc",
  },
  {
    key: "npvPurchaseRub",
    group: "Экономика",
    label: "NPV покупки",
    unit: null,
    text: (r) => (r.npvPurchaseRub === null ? NO_DATA : formatMRub(r.npvPurchaseRub)),
    value: (r) => r.npvPurchaseRub,
    better: "max",
    requires: "calc",
  },
  {
    key: "paybackPurchaseYears",
    group: "Экономика",
    label: "Окупаемость покупки",
    unit: null,
    text: paybackText,
    value: (r) => r.paybackPurchaseYears,
    better: "min",
    requires: "calc",
  },
  {
    key: "raasRubMonth",
    group: "Экономика",
    label: "Ставка RaaS за робота",
    unit: null,
    text: (r) => (r.raasRubMonth === null ? NO_DATA : `${formatRub(r.raasRubMonth)}/мес`),
  },
  {
    key: "completenessPct",
    group: "Экономика",
    label: "Полнота данных",
    unit: null,
    text: (r) => (r.completenessPct === null ? NO_DATA : formatPct(r.completenessPct)),
    value: (r) => r.completenessPct,
    better: "max",
  },
];

/**
 * Индекс лучшего значения строки среди столбцов. Выделять имеет смысл, только если значений
 * хотя бы два и они различаются; при равенстве лучших выделения нет (null).
 */
export function bestColumnIndex(values: readonly (number | null)[], better: "max" | "min"): number | null {
  const finite = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => typeof x.v === "number" && Number.isFinite(x.v));
  if (finite.length < 2) return null;
  const pick = better === "max" ? Math.max(...finite.map((x) => x.v)) : Math.min(...finite.map((x) => x.v));
  const winners = finite.filter((x) => x.v === pick);
  return winners.length === 1 ? (winners[0]?.i ?? null) : null;
}

/**
 * Столбцы таблицы процесса: не больше шести, но добавленные вручную и стоящие в сценариях
 * (`pinned`, ключи «процесс:продукт») — всегда, даже если их больше шести. Свободные места
 * занимают остальные решения в порядке модели (рекомендуемое, затем кандидаты по баллу).
 * Порядок столбцов — исходный, чтобы рекомендуемое оставалось первым.
 */
export function comparisonColumns(
  rows: readonly ComparisonRow[],
  pinned?: ReadonlySet<ScenarioItemKey>,
): ComparisonRow[] {
  const isPinned = (r: ComparisonRow) =>
    r.manuallyAdded || (pinned?.has(scenarioItemKey(r.process, r.productSlug)) ?? false);
  const keep = new Set(rows.filter(isPinned));
  const limit = Math.max(COMPARISON_MAX_COLUMNS, keep.size);
  for (const r of rows) {
    if (keep.size >= limit) break;
    keep.add(r);
  }
  return rows.filter((r) => keep.has(r));
}

/**
 * Подпись строки, которую процесс не считает: «не рассчитывается (прототип)» для парка и
 * экономики, «не моделируется» для цикла на планировке. Процесс неизвестен или считается — null.
 */
export function metricPlaceholder(
  m: Pick<ComparisonMetric, "requires">,
  process: Pick<ProcessDef, "calcSupported" | "simSupported"> | undefined,
): string | null {
  if (!process || !m.requires) return null;
  if (m.requires === "calc" && !process.calcSupported) return NOT_CALCULATED;
  if (m.requires === "sim" && !process.simSupported) return NOT_SIMULATED;
  return null;
}

/** Пояснение под таблицей процесса без экономики или имитации; всё считается — null. */
export function prototypeNote(
  process: Pick<ProcessDef, "name" | "calcSupported" | "simSupported"> | undefined,
): string | null {
  if (!process) return null;
  if (!process.calcSupported && !process.simSupported) {
    return `Для процесса «${process.name}» парк роботов, экономика и цикл на планировке в модели tz-1.0.0 не рассчитываются (прототип); показаны характеристики из каталога.`;
  }
  if (!process.calcSupported) {
    return `Для процесса «${process.name}» парк роботов и экономика в модели tz-1.0.0 не рассчитываются (прототип).`;
  }
  if (!process.simSupported) return `Цикл на планировке для процесса «${process.name}» не моделируется.`;
  return null;
}

/** Строки сравнения по процессам в порядке первого появления. */
export function groupByProcess(rows: readonly ComparisonRow[]): { process: string; rows: ComparisonRow[] }[] {
  const out: { process: string; rows: ComparisonRow[] }[] = [];
  for (const r of rows) {
    const g = out.find((x) => x.process === r.process);
    if (g) g.rows.push(r);
    else out.push({ process: r.process, rows: [r] });
  }
  return out;
}

function unitText(m: ComparisonMetric, process: string): string | null {
  if (m.unit === null) return null;
  return typeof m.unit === "function" ? m.unit(process) : m.unit;
}

function ProcessComparison({
  process,
  rows,
  pinned,
  showCaption,
}: {
  process: string;
  rows: ComparisonRow[];
  pinned: ReadonlySet<ScenarioItemKey> | undefined;
  showCaption: boolean;
}) {
  const shown = comparisonColumns(rows, pinned);
  const def = processDef(process);
  const processName = def?.name ?? process;
  const note = prototypeNote(def);
  return (
    <div className="flex flex-col gap-2">
      {showCaption && <p className="text-sm font-medium">{processName}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Сравнение решений: {processName}</caption>
          <thead className="bg-muted/50 text-left text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                Характеристика
              </th>
              {shown.map((r) => (
                <th key={r.productSlug} scope="col" className="px-3 py-2 align-bottom font-medium">
                  {r.manuallyAdded ? (
                    <span className="text-caution" title="Добавлено вручную: решение не прошло проверку подбора">
                      ⚠ {r.productName}
                      <span className="sr-only"> (добавлено вручную)</span>
                    </span>
                  ) : (
                    r.productName
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {COMPARISON_GROUPS.map((group) => {
            const metrics = COMPARISON_METRICS.filter((m) => m.group === group);
            return (
              <tbody key={group}>
                <tr className="border-t bg-muted/30">
                  <th scope="colgroup" colSpan={shown.length + 1} className="px-3 py-1.5 text-left text-xs font-semibold">
                    {group}
                  </th>
                </tr>
                {metrics.map((m) => {
                  const unit = unitText(m, process);
                  const placeholder = metricPlaceholder(m, def);
                  const best =
                    placeholder === null && m.value && m.better ? bestColumnIndex(shown.map(m.value), m.better) : null;
                  return (
                    <tr key={m.key} className="border-t">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">
                        {m.label}
                        {unit && <span className="text-muted-foreground">, {unit}</span>}
                      </th>
                      {placeholder !== null ? (
                        // Процесс эту строку не считает — одна ячейка на все решения вместо «нет
                        // данных» в каждой: пробела в каталоге нет, модель этот расчёт не строит.
                        <td colSpan={shown.length} className="px-3 py-1.5 text-muted-foreground italic">
                          {placeholder}
                        </td>
                      ) : (
                        shown.map((r, i) => {
                          const text = m.text(r);
                          return (
                            <td
                              key={r.productSlug}
                              className={cn(
                                "px-3 py-1.5 whitespace-nowrap tabular-nums",
                                text === NO_DATA && "text-muted-foreground",
                                best === i && "font-semibold",
                              )}
                            >
                              {text}
                              {best === i && <span className="sr-only"> (лучшее в строке)</span>}
                            </td>
                          );
                        })
                      )}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {rows.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          Показаны {shown.length} из {rows.length} решений: добавленные вручную и выбранные в сценарии — всегда,
          остальные — в порядке подбора. Полный список — в таблице подбора (шаг 3).
        </p>
      )}
    </div>
  );
}

export type ComparisonTableProps = {
  rows: readonly ComparisonRow[];
  /**
   * Позиции сценариев проекта (`scenarioItemKeys(scenarios)`): такие решения показываются в
   * таблице всегда, даже если решений больше шести.
   */
  pinned?: ReadonlySet<ScenarioItemKey>;
};

export function ComparisonTable({ rows, pinned }: ComparisonTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Нет решений для сравнения — отметьте продукты в подборе (шаг 3).
      </p>
    );
  }
  const groups = groupByProcess(rows);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <ProcessComparison
          key={g.process}
          process={g.process}
          rows={g.rows}
          pinned={pinned}
          showCaption={groups.length > 1}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        Жирным выделено лучшее значение в строке (где «лучше» однозначно). Рекомендация — в подборе и выводе по
        сценариям.
      </p>
    </div>
  );
}
