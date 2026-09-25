"use client";

import Link from "next/link";
import { formatYearsRu } from "@/lib/format/plural";
import { copyProjectAction, deleteProjectAction } from "@/lib/projects/actions";
import { ProjectActionForm, deleteConfirmText } from "./project-toolbar";

/**
 * Список «Мои проекты» (ТЗ §3.1.3: пользователь создаёт, открывает, копирует и удаляет свои
 * проекты). Колонки: название (и объект), тип объекта, число сценариев, когда изменён, лучшая
 * простая окупаемость среди рассчитанных сценариев роботизации. Действия — «Открыть»,
 * «Копировать» (переход в копию) и «Удалить» с подтверждением.
 *
 * Засеянный демо-проект помечен «демо»: он общий для всех, кто входит демо-аккаунтом, поэтому
 * его нельзя удалить — только скопировать.
 */

/** Строка списка: только сериализуемые поля (даты — ISO). */
export type ProjectsListItem = {
  id: string;
  name: string;
  objectName: string | null;
  facility: string;
  facilityLabel: string;
  scenarioCount: number;
  /** Когда изменён, ISO 8601. */
  updatedAt: string;
  bestPaybackYears: number | null;
  isDemo: boolean;
};

/**
 * Дата и время по Москве с подписью пояса: сервер и браузер выдают одну строку (иначе
 * гидратация разойдётся), а время без пояса вводило бы в заблуждение.
 */
const LIST_DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function listDateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${LIST_DATE.format(d).replace(",", "")} МСК`;
}

/** Ячейка «Лучшая окупаемость»: «3,3 года» или пояснение, почему числа нет. */
export function paybackCellText(years: number | null): string {
  return years === null ? "нет окупаемых сценариев" : formatYearsRu(years);
}

const TH = "px-3 py-2 text-left font-medium text-muted-foreground";
const TD = "border-t px-3 py-2 align-top";

export function ProjectsList({ items }: { items: readonly ProjectsListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
        Проектов пока нет. Нажмите «Новый проект», выберите тип объекта и источник параметров — демо-данные
        организатора, файл Excel/CSV или ручной ввод.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Мои проекты</caption>
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className={TH}>
              Проект
            </th>
            <th scope="col" className={TH}>
              Тип объекта
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Сценариев
            </th>
            <th scope="col" className={TH}>
              Изменён
            </th>
            <th scope="col" className={TH}>
              Лучшая окупаемость
            </th>
            <th scope="col" className={TH}>
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <th scope="row" className={`${TD} text-left font-normal`}>
                <Link href={`/projects/${encodeURIComponent(p.id)}`} className="tap-target font-medium text-primary underline-offset-2 hover:underline">
                  {p.name}
                </Link>
                {p.isDemo && (
                  <span className="ml-2 rounded-full border border-caution/50 bg-caution/10 px-2 py-0.5 text-xs">демо</span>
                )}
                {p.objectName && <span className="block text-xs text-muted-foreground">{p.objectName}</span>}
              </th>
              <td className={TD}>{p.facilityLabel}</td>
              <td className={`${TD} text-right tabular-nums`}>{p.scenarioCount}</td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{listDateText(p.updatedAt)}</td>
              <td className={`${TD} tabular-nums ${p.bestPaybackYears === null ? "text-muted-foreground" : ""}`}>
                {paybackCellText(p.bestPaybackYears)}
              </td>
              <td className={TD}>
                <div className="flex flex-wrap items-start gap-2">
                  <Link
                    href={`/projects/${encodeURIComponent(p.id)}`}
                    className="tap-target inline-flex h-7 items-center rounded-md border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                    aria-label={`Открыть проект «${p.name}»`}
                  >
                    Открыть
                  </Link>
                  <ProjectActionForm
                    run={() => copyProjectAction(p.id)}
                    label="Копировать"
                    pendingLabel="Копируем…"
                    size="sm"
                    title={`Копировать проект «${p.name}»`}
                  />
                  <ProjectActionForm
                    run={() => deleteProjectAction(p.id)}
                    label="Удалить"
                    pendingLabel="Удаляем…"
                    size="sm"
                    variant="destructive"
                    confirmText={deleteConfirmText(p.name)}
                    disabled={p.isDemo}
                    title={p.isDemo ? "Демо-проект нельзя удалить — скопируйте его" : `Удалить проект «${p.name}»`}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
