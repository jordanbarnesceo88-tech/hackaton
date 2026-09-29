import type { ReactNode } from "react";
import { isCharPresent } from "@/lib/catalog/product-for-calc";
import type { CatalogCharacteristic } from "@/lib/catalog/queries";
import { CHAR_GROUP_LABELS, CHARACTERISTIC_KEYS, REQUIRED_CHARACTERISTIC_KEYS } from "@/lib/tz/characteristics";
import type { CharGroup, CharKey } from "@/lib/tz/characteristics";
import { cn } from "@/lib/utils";
import {
  CHARACTERISTIC_COLUMNS,
  CHARACTERISTIC_HEADERS,
  CharacteristicRow,
  MissingCharacteristicRow,
} from "./characteristic-row";

/**
 * Группа характеристик карточки продукта — одна из шести обязательных групп ТЗ §3.3.4:
 * идентификация, технические, инфраструктура, экономика, применимость, качество данных.
 * Заголовок h2 — название группы из словаря характеристик (lib/tz/characteristics).
 *
 * Обязательные характеристики, которых у продукта нет, показаны строками «нет данных»: так
 * видно, из чего складывается полнота карточки и чего не хватает, а не только то, что есть.
 */

/** Порядок групп в карточке и в сравнении — как в словаре характеристик. */
export const CHAR_GROUP_ORDER = Object.keys(CHAR_GROUP_LABELS) as CharGroup[];

/** Обязательные ключи группы в порядке словаря. */
export function requiredKeysOf(group: CharGroup): CharKey[] {
  return REQUIRED_CHARACTERISTIC_KEYS.filter((k) => CHARACTERISTIC_KEYS[k].group === group);
}

/** Заполненность группы: сколько обязательных ключей заполнено и каких нет вовсе. */
export type GroupStats = {
  filled: number;
  required: number;
  /** Обязательные ключи, строк которых у продукта нет, — для строк-заглушек. */
  absentKeys: CharKey[];
};

/**
 * Заполненность группы по тем же правилам, что полнота карточки (`isCharPresent`: пустая
 * строка или пустой перечень заполненными не считаются).
 */
export function groupStats(group: CharGroup, rows: readonly CatalogCharacteristic[]): GroupStats {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const required = requiredKeysOf(group);
  const filled = required.filter((k) => {
    const row = byKey.get(k);
    return row !== undefined && isCharPresent(row);
  }).length;
  return { filled, required: required.length, absentKeys: required.filter((k) => !byKey.has(k)) };
}

/** Строка «заполнено 7 из 8 обязательных». */
export function groupStatsText(stats: GroupStats): string {
  return `заполнено ${stats.filled} из ${stats.required} обязательных`;
}

/** id заголовка группы — для aria-labelledby таблицы и якорей оглавления. */
export function groupAnchor(group: CharGroup): string {
  return `group-${group.toLowerCase().replace(/_/g, "-")}`;
}

export function GroupSection({
  group,
  rows,
  children,
}: {
  group: CharGroup;
  rows: readonly CatalogCharacteristic[];
  /** Дополнительный блок под заголовком (сводка качества данных). */
  children?: ReactNode;
}) {
  const id = groupAnchor(group);
  const stats = groupStats(group, rows);
  const complete = stats.filled === stats.required;
  return (
    <section aria-labelledby={id} className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id}>
          {CHAR_GROUP_LABELS[group]}
        </h2>
        <span className={cn("text-sm tabular-nums", complete ? "text-muted-foreground" : "text-caution")}>
          {groupStatsText(stats)}
        </span>
      </div>
      {children}
      <div className="data-table-wrap relative">
        <table className="w-full border-collapse text-sm" aria-labelledby={id}>
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              {CHARACTERISTIC_HEADERS.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cn("px-3 py-2 font-medium", i === CHARACTERISTIC_HEADERS.length - 1 && "text-center")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <CharacteristicRow key={c.key} c={c} />
            ))}
            {stats.absentKeys.map((k) => (
              <MissingCharacteristicRow key={k} label={CHARACTERISTIC_KEYS[k].label} />
            ))}
            {rows.length === 0 && stats.absentKeys.length === 0 && (
              <tr className="border-t">
                <td colSpan={CHARACTERISTIC_COLUMNS} className="px-3 py-3 text-muted-foreground">
                  Характеристик этой группы у продукта нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
