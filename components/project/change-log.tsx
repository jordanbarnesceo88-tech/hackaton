"use client";

import { fx } from "@/lib/tz/econ/text";

/**
 * Журнал корректировок (ТЗ §3.5.4: автоматически рассчитанные значения можно переопределить,
 * каждое изменение фиксируется; §3.3.5 — действия администратора). Показывает, кто, когда и
 * что поменял: автоматическое значение, старое, новое, единицу и причину.
 *
 * В гостевом режиме журнал ведётся только на экране — заголовок прямо говорит, что он не
 * сохраняется.
 */

export type ChangeLogEntry = {
  /** Момент изменения: ISO 8601 или Date. */
  at: string | Date;
  user?: string | null;
  scenario?: string | null;
  fieldLabel: string;
  auto: unknown;
  old: unknown;
  new: unknown;
  unit?: string | null;
  reason?: string | null;
};

/**
 * Время записи. Часовой пояс зафиксирован (Москва) и подписан: сервер и браузер обязаны
 * выдать одну и ту же строку, иначе гидратация разойдётся, а время без пояса вводит в
 * заблуждение при разных часовых поясах сервера и пользователя.
 */
const AT_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function formatLogTime(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return typeof at === "string" ? at : "—";
  return `${AT_FORMAT.format(d)} МСК`;
}

/** Значение журнала (Json): число по-русски, строка как есть, пусто — «—». */
export function formatLogValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return fx(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const TH = "px-3 py-2 text-left font-medium text-muted-foreground";
const TD = "border-t px-3 py-1.5 align-top";

export function ChangeLog({
  entries,
  guest = false,
}: {
  entries: readonly ChangeLogEntry[];
  /** Гостевой режим: журнал только на экране, заголовок говорит, что он не сохраняется. */
  guest?: boolean;
  /** Для единообразия с отчётом: элементов управления здесь нет, вид не меняется. */
  print?: boolean;
}) {
  const title = guest ? "Журнал корректировок (не сохраняется)" : "Журнал корректировок";
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Корректировок пока нет: все значения расчётные или взяты из данных организатора.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="print-table w-full border-collapse text-sm">
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>
                  Когда
                </th>
                {!guest && (
                  <th scope="col" className={TH}>
                    Кто
                  </th>
                )}
                <th scope="col" className={TH}>
                  Сценарий
                </th>
                <th scope="col" className={TH}>
                  Что изменено
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Авто
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Было
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Стало
                </th>
                <th scope="col" className={TH}>
                  Ед.
                </th>
                <th scope="col" className={TH}>
                  Причина
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatLogTime(e.at)}</td>
                  {!guest && <td className={TD}>{e.user ?? "—"}</td>}
                  <td className={TD}>{e.scenario ?? "—"}</td>
                  <td className={TD}>{e.fieldLabel}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatLogValue(e.auto)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatLogValue(e.old)}</td>
                  <td className={`${TD} text-right tabular-nums font-medium`}>{formatLogValue(e.new)}</td>
                  <td className={TD}>{e.unit ?? ""}</td>
                  <td className={TD}>{e.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
