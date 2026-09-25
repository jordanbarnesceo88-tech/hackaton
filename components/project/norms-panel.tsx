"use client";

import { DEFAULT_NORMS, normDef, type NormKey } from "@/lib/tz/norms";
import { fx, rangeText } from "@/lib/tz/econ/text";
import type { Origin } from "@/lib/tz/types";
import { OverrideInput } from "./override-input";
import { SourceBadge, safeHttpUrl } from "./source-badge";

/**
 * Нормативы и допущения расчёта (ТЗ §3.5.1 — без недокументированных коэффициентов; §3.5.8 —
 * источники и допущения видны; §3.2.5 — источник каждого норматива). Таблица: Параметр |
 * Значение | Ед. | Источник | Обоснование.
 *
 * Пять нормативов можно переопределить на уровне сценария (ScenarioSpec.normOverrides):
 * загрузка, резерв парка, доступность, ставка дисконтирования и доля автоматизируемого труда.
 * Все пять — доли, поэтому они редактируются в процентах: «авто: 77,5 %», ввод «80» — это
 * 80 %, подсказка «диапазон 70–85 %» в тех же единицах. Значение вне границ норматива (тех же,
 * что применяет движок в resolveNorms) не принимается: поле показывает допустимый диапазон,
 * и в журнал не попадает число, которого пользователь не вводил.
 *
 * В печатном варианте (`print`) нет ни полей, ни раскрывающихся блоков: место в источнике и
 * ссылка печатаются текстом под бейджем (ТЗ §3.7.2 — отчёт называет источники данных).
 */

/** Нормативы, которые пользователь может переопределить в сценарии. */
export const SCENARIO_NORM_KEYS = [
  "utilization",
  "reservePct",
  "availability",
  "discountRate",
  "laborShareAutomatable",
] as const satisfies readonly NormKey[];

export type ScenarioNormKey = (typeof SCENARIO_NORM_KEYS)[number];

/**
 * Строка таблицы: метаданные норматива и действующее значение. Совместима и со строкой
 * таблицы Norm (lib/catalog/queries NormRow), и с описанием из кода (NORM_DEFS) плюс значение.
 */
export type NormPanelRow = {
  key: string;
  value: number;
  label: string;
  unit: string | null;
  origin: Origin;
  basis: string;
  sourceUrl?: string | null;
  sourceRef?: string | null;
  min?: number | null;
  max?: number | null;
  group?: string;
};

/** Норматив-доля: «доля», «доля в год». */
function isShareUnit(unit: string | null): boolean {
  return unit !== null && (unit === "доля" || unit.startsWith("доля "));
}

/** Единица ввода для доли: «доля» → «%», «доля в год» → «% в год»; прочие — как есть. */
export function percentUnit(unit: string): string {
  return isShareUnit(unit) ? `%${unit.slice("доля".length)}` : unit;
}

/** Значение норматива для таблицы: доли дополнительно процентом («0,775 (77,5 %)»). */
export function normValueText(value: number, unit: string | null): string {
  if (isShareUnit(unit)) return `${fx(value)} (${fx(value * 100, 1)} %)`;
  return fx(value);
}

const TH = "px-3 py-2 text-left font-medium text-muted-foreground";
const TD = "border-t px-3 py-1.5 align-top";

function NormsTable({ rows, print }: { rows: readonly NormPanelRow[]; print: boolean }) {
  const groups: { name: string; rows: NormPanelRow[] }[] = [];
  for (const r of rows) {
    const name = r.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.rows.push(r);
    else groups.push({ name, rows: [r] });
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="print-table w-full border-collapse text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className={TH}>
              Параметр
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Значение
            </th>
            <th scope="col" className={TH}>
              Ед.
            </th>
            <th scope="col" className={TH}>
              Источник
            </th>
            <th scope="col" className={TH}>
              Обоснование
            </th>
          </tr>
        </thead>
        {groups.map((g, gi) => (
          <tbody key={`${g.name}-${gi}`}>
            {g.name !== "" && (
              <tr>
                <th scope="colgroup" colSpan={5} className="border-t bg-muted/20 px-3 py-1.5 text-left text-xs font-semibold">
                  {g.name}
                </th>
              </tr>
            )}
            {g.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className={`${TD} text-left font-normal`}>
                  {r.label}
                </th>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{normValueText(r.value, r.unit)}</td>
                <td className={`${TD} whitespace-nowrap`}>{r.unit ?? ""}</td>
                <td className={`${TD} min-w-36`}>
                  {print ? (
                    <PrintSource row={r} />
                  ) : (
                    <SourceBadge origin={r.origin} sourceUrl={r.sourceUrl} sourceRef={r.sourceRef} />
                  )}
                </td>
                <td className={`${TD} min-w-72 text-xs text-muted-foreground`}>{r.basis}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Источник для печати: бейдж без раскрытия, место в источнике и ссылка — текстом. */
function PrintSource({ row }: { row: NormPanelRow }) {
  const ref = (row.sourceRef ?? "").trim();
  const url = safeHttpUrl(row.sourceUrl);
  return (
    <div className="flex flex-col gap-0.5">
      <SourceBadge origin={row.origin} />
      {ref !== "" && <span className="text-xs break-words">{ref}</span>}
      {url !== null && <span className="text-xs break-all text-muted-foreground">{url}</span>}
    </div>
  );
}

export function NormsPanel({
  rows,
  overrides,
  onOverride,
  readOnly = false,
  print = false,
  scenarioName,
}: {
  rows: readonly NormPanelRow[];
  /** Переопределения выбранного сценария (ScenarioSpec.normOverrides). */
  overrides?: Partial<Record<NormKey, number>>;
  /** null — вернуть значение проекта; `reason` — причина для журнала. Без обработчика — только чтение. */
  onOverride?: (key: ScenarioNormKey, value: number | null, reason?: string) => void;
  readOnly?: boolean;
  /** Вариант для отчёта: без полей ввода, таблица раскрыта. */
  print?: boolean;
  /** Сценарий, к которому относятся переопределения. */
  scenarioName?: string;
}) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const editable = !print && !readOnly && onOverride !== undefined;
  const setKeys = SCENARIO_NORM_KEYS.filter((k) => overrides?.[k] !== undefined);
  const showOverrides = editable || setKeys.length > 0;

  return (
    <section aria-label="Нормативы и допущения" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Нормативы и допущения</h3>
      {showOverrides && (
        <div className="flex flex-col gap-2 rounded-md border px-3 py-3">
          <p className="text-sm font-medium">
            Переопределения сценария{scenarioName ? ` «${scenarioName}»` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Значения — в процентах; допустим только диапазон норматива. Каждое изменение записывается в журнал
            корректировок.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(editable ? SCENARIO_NORM_KEYS : setKeys).map((key) => {
              const def = normDef(key);
              const auto = byKey.get(key)?.value ?? DEFAULT_NORMS[key];
              const share = isShareUnit(def.unit);
              const range = def.min !== null && def.max !== null ? `диапазон ${rangeText(def.min, def.max, def.unit)}` : undefined;
              return (
                <OverrideInput
                  key={key}
                  label={def.label}
                  unit={share ? percentUnit(def.unit) : def.unit}
                  percent={share}
                  auto={auto}
                  value={overrides?.[key]}
                  range={[def.min, def.max]}
                  readOnly={!editable}
                  hint={range}
                  onChange={editable ? (v, reason) => onOverride?.(key, v, reason) : undefined}
                />
              );
            })}
          </div>
        </div>
      )}
      {print ? (
        <NormsTable rows={rows} print />
      ) : (
        <details className="group">
          <summary className="cursor-pointer text-sm text-primary underline-offset-2 hover:underline">
            Все нормативы и допущения ({rows.length}): значение, источник и обоснование
          </summary>
          <div className="mt-2">
            <NormsTable rows={rows} print={false} />
          </div>
        </details>
      )}
    </section>
  );
}
