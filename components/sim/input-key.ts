import type { SimInput } from "@/lib/sim/types";

/**
 * Ключ входа имитации по значению. Прогон детерминирован, поэтому одинаковый по значению вход
 * даёт одинаковый результат, и перезапускать его незачем.
 *
 * Зачем не по ссылке: владелец (рабочая область проекта) может собирать входы заново на каждой
 * отрисовке, а в `onSummary` — обновлять своё состояние. Тогда ключ по ссылке зацикливает
 * прогон: итог → состояние владельца → новые объекты входа → новый прогон → итог… Ключ по
 * значению разрывает цикл: пересчёт запускается, только когда вход действительно изменился.
 *
 * Вход — простые данные (числа, null, вложенные объекты), поэтому ключ — JSON. Нечисловые NaN и
 * ±∞ JSON превратил бы в null и тем изменил бы смысл входа, поэтому они кодируются строками и
 * восстанавливаются при разборе.
 */

const NON_FINITE_PREFIX = "__num:";

/** Ключ входа: JSON с сохранением NaN и ±∞. */
export function simInputKey(input: SimInput): string {
  return JSON.stringify(input, (_k, v: unknown) =>
    typeof v === "number" && !Number.isFinite(v) ? `${NON_FINITE_PREFIX}${String(v)}` : v,
  );
}

/** Вход по ключу — точная копия исходного входа. */
export function parseSimInputKey(key: string): SimInput {
  return JSON.parse(key, (_k, v: unknown) =>
    typeof v === "string" && v.startsWith(NON_FINITE_PREFIX) ? Number(v.slice(NON_FINITE_PREFIX.length)) : v,
  ) as SimInput;
}
