import { cn } from "@/lib/utils";

/**
 * Навигация «Шаг N из 8» по рабочей области проекта (ТЗ §2.2: объект → параметры → подбор →
 * сравнение → экономика → сценарии → имитация → сохранение и отчёт). Жюри проходит путь §5.4
 * именно в этом порядке, поэтому шаги пронумерованы так же, как в ТЗ, а разделы рабочей
 * области получают те же якоря.
 *
 * Компонент без состояния: работает и в серверной странице, и внутри клиентской рабочей
 * области. Заголовков h1 здесь нет — единственный h1 принадлежит странице.
 */

/** Шаг рабочей области: номер по ТЗ, якорь раздела и короткое название. */
export type TzStep = { n: number; id: string; title: string };

/** Восемь шагов пути по ТЗ §2.2 с якорями разделов рабочей области. */
export const TZ_STEPS: readonly TzStep[] = [
  { n: 1, id: "object", title: "Объект" },
  { n: 2, id: "params", title: "Параметры" },
  { n: 3, id: "selection", title: "Подбор" },
  { n: 4, id: "comparison", title: "Сравнение" },
  { n: 5, id: "economics", title: "Экономика" },
  { n: 6, id: "scenarios", title: "Сценарии" },
  { n: 7, id: "simulation", title: "Имитация" },
  { n: 8, id: "report", title: "Отчёт" },
];

/** Сколько всего шагов — знаменатель в «Шаг N из 8». */
export const TZ_STEP_COUNT = TZ_STEPS.length;

/**
 * Отступ сверху для раздела-якоря: липкая навигация иначе закрывает заголовок раздела, к
 * которому перешли по ссылке. Рабочая область добавляет этот класс к каждой секции шага.
 */
export const STEP_SECTION_CLASS = "scroll-mt-16";

/**
 * Заголовок раздела шага: «Шаг 2 из 8 · Параметры». Без `title` берётся название шага из
 * `TZ_STEPS`.
 */
export function stepHeading(n: number, title?: string): string {
  const t = title ?? TZ_STEPS.find((s) => s.n === n)?.title ?? "";
  return `Шаг ${n} из ${TZ_STEP_COUNT} · ${t}`;
}

/** Текст ссылки навигации: «1 Объект». */
export function stepLinkText(step: TzStep): string {
  return `${step.n} ${step.title}`;
}

/**
 * Липкая полоса ссылок на разделы. `active` — номер текущего шага: ссылка получает
 * aria-current="step" и выделение. На узком экране полоса прокручивается горизонтально, а не
 * переносится в несколько строк, чтобы не съедать высоту экрана 1366×768.
 */
export function StepNav({ active, className }: { active?: number; className?: string }) {
  return (
    <nav
      aria-label="Шаги по ТЗ"
      className={cn(
        "no-print sticky top-0 z-20 border-b bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <ol className="flex gap-1 overflow-x-auto text-sm">
        {TZ_STEPS.map((step) => {
          const current = active === step.n;
          return (
            <li key={step.id} className="shrink-0">
              <a
                href={`#${step.id}`}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors",
                  "hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  current ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
                )}
              >
                {/* Пробел между номером и названием — текстовый узел, чтобы имя ссылки было
                    «1 Объект», а не «1Объект». */}
                <span
                  className={cn(
                    "inline-grid size-5 place-items-center rounded-full border text-xs tabular-nums",
                    current ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {step.n}
                </span>{" "}
                {step.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
