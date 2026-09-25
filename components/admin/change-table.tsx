import { formatAdminTime, formatAdminValue } from "./format";
import { TABLE_WRAP_CLASS, TD_CLASS, TH_CLASS } from "./styles";

/** Строка журнала администратора, подготовленная страницей. */
export type AdminChangeEntry = {
  id: string;
  at: Date;
  user: string | null;
  /** «Продукт», «Норматив», «Параметр объекта»… */
  entity: string;
  /** Что именно: название продукта, подпись норматива, «Склад › Площадь»… */
  object: string;
  field: string;
  old: unknown;
  new: unknown;
  unit: string | null;
  reason: string | null;
};

/**
 * Журнал действий администратора (ТЗ §3.3.5 — управление каталогом и справочниками; §3.5.4 —
 * изменения фиксируются): когда, кто, что и в каком поле, было → стало, основание.
 * Серверный компонент без состояния — его рисуют страницы «Данные» и карточка продукта.
 */
export function ChangeTable({ entries, caption }: { entries: readonly AdminChangeEntry[]; caption: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Записей пока нет.</p>;
  }
  return (
    <div className={TABLE_WRAP_CLASS}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className={TH_CLASS}>
              Когда
            </th>
            <th scope="col" className={TH_CLASS}>
              Кто
            </th>
            <th scope="col" className={TH_CLASS}>
              Объект
            </th>
            <th scope="col" className={TH_CLASS}>
              Поле
            </th>
            <th scope="col" className={TH_CLASS}>
              Было
            </th>
            <th scope="col" className={TH_CLASS}>
              Стало
            </th>
            <th scope="col" className={TH_CLASS}>
              Основание
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className={`${TD_CLASS} whitespace-nowrap tabular-nums`}>{formatAdminTime(e.at)}</td>
              <td className={`${TD_CLASS} break-all`}>{e.user ?? "—"}</td>
              <td className={TD_CLASS}>
                <span className="block text-xs text-muted-foreground">{e.entity}</span>
                {e.object}
              </td>
              <td className={TD_CLASS}>{e.field}</td>
              <td className={`${TD_CLASS} max-w-72 break-words tabular-nums`}>
                {formatAdminValue(e.old)}
                {e.unit && typeof e.old === "number" ? ` ${e.unit}` : ""}
              </td>
              <td className={`${TD_CLASS} max-w-72 break-words font-medium tabular-nums`}>
                {formatAdminValue(e.new)}
                {e.unit && typeof e.new === "number" ? ` ${e.unit}` : ""}
              </td>
              <td className={`${TD_CLASS} max-w-60 break-words`}>{e.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
