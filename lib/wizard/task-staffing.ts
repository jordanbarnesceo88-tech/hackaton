import type { AssumptionValues, FacilityParams, WorkloadStream } from "@/lib/economics/types";
import { demandPerYear } from "@/lib/economics/normalize";
import { resolveTaskFte } from "@/lib/economics/task-labour";

/**
 * Экран «кто чем занят»: строка на каждую применимую задачу.
 *
 * Существует потому, что движок перестал выводить замещение из спроса и теперь спрашивает
 * занятость у владельца объекта — а спросить было негде, и ветка стояла нерабочей: семь решений
 * из одиннадцати отказывались считать (Р-1).
 *
 * Предзаполнение считается ТЕМ ЖЕ `resolveTaskFte`, которым считает движок, а не своей копией
 * формулы. Копия неизбежно разъедется, и тогда поле будет показывать одно число, а расчёт
 * вести по другому — ровно тот класс расхождения, ради которого заведена граница сохранения.
 */
export type TaskStaffingRow = {
  slug: string;
  /** Название РАБОТЫ, а не техники: «Паллетирование коробок», не «паллетайзеры». */
  taskLabel: string;
  /**
   * Норматив категории, пересчитанный в людей под этот объект. `null` — норматива со ссылкой
   * нет, и поле остаётся ПУСТЫМ. Подставить правдоподобное число вместо отсутствующего
   * источника здесь нельзя: оно немедленно станет «расчётом», хотя его никто не считал.
   */
  suggested: number | null;
  /** Что человек уже назвал. `undefined` — ещё не называл (это не ноль). */
  declared: number | undefined;
  /** Норматив есть и у него есть ссылка — экран показывает её рядом с полем. */
  sourceUrl: string | null;
};

export type TaskCategory = {
  slug: string;
  taskLabel: string;
  workloadStream: WorkloadStream;
  workerOutputPerYear: number | null;
  workerOutputSourceUrl: string | null;
};

export function taskStaffingRows(
  categories: TaskCategory[],
  params: FacilityParams,
  a: AssumptionValues
): TaskStaffingRow[] {
  return categories.map((c) => ({
    slug: c.slug,
    taskLabel: c.taskLabel,
    suggested: resolveTaskFte({
      // Именно undefined: спрашиваем «что сказал бы норматив», а не «что назвал человек».
      declared: undefined,
      demandPerYear: demandPerYear(params, a, c.workloadStream),
      workerOutputPerYear: c.workerOutputPerYear,
      staffCount: params.staffCount,
    }),
    declared: params.taskStaffing?.[c.slug],
    sourceUrl: c.workerOutputSourceUrl,
  }));
}

/**
 * Сколько человек задачи ещё не разобрали.
 *
 * Строка «остальные N человек — не роботизируем» снимает главное возражение к любому такому
 * калькулятору до того, как оно прозвучит: он не утверждает, что заменит весь штат.
 *
 * Считается по заявленному, а не по предложенному: пока человек не подтвердил норматив, это
 * наше предположение, а не его ответ.
 */
export function staffingRemainder(rows: TaskStaffingRow[], staffCount: number): number {
  const claimed = rows.reduce((sum, r) => sum + (r.declared ?? 0), 0);
  return staffCount - claimed;
}

/**
 * Г-2: сумма занятостей не может превышать штат объекта.
 *
 * Потолок в движке стоит НА РЕШЕНИЕ (`min(staffCount, …)`), а суммы по задачам не проверял
 * никто. Поэтому занятости, сложившиеся больше штата, проходили молча, и каждое решение
 * независимо забирало весь штат — а строка остатка показала бы отрицательное число.
 */
export function staffingExceedsHeadcount(
  rows: TaskStaffingRow[],
  staffCount: number
): boolean {
  return staffingRemainder(rows, staffCount) < 0;
}
