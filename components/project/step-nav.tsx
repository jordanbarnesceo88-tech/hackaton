import { buttonVariants } from "@/components/ui/button";
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
 *
 * `onStepClick` (бэклог #4b): когда задан, рабочая область показывает один шаг на экран, а не
 * все восемь один под другим — ссылки не прыгают по якорю (скрытый `display:none`-раздел
 * прокрутить некуда), а переключают `activeStep` в Workspace. `href` остаётся: не задан
 * `onStepClick` — компонент работает как раньше, якорями по `id` секции.
 */
export function StepNav({
  active,
  className,
  onStepClick,
}: {
  active?: number;
  className?: string;
  onStepClick?: (n: number) => void;
}) {
  return (
    <nav
      aria-label="Шаги по ТЗ"
      // top-[60px]: back under SiteHeader's own sticky --bar-h (60px) bar — the side-rail
      // experiment (top-0) was reverted, header is a top bar again. Same approximation as
      // before: can overlap by the extra height if the header wraps to a second line.
      className={cn("glass no-print sticky top-[60px] z-20 py-2", className)}
    >
      {/* subtabs (BCB): подчёркнутые, равноправные — не заливка-пилюля (§6 дифференциаторы
          спеки прямо предупреждает: пилюля с фоном — облик shadcn Tabs по умолчанию, не
          прототипа). Контейнер несёт общую нижнюю линию; активный пункт перекрывает её своей
          2px-линией акцента (-mb-px). */}
      <ol className="subtabs">
        {TZ_STEPS.map((step) => {
          const current = active === step.n;
          return (
            <li key={step.id} className="flex shrink-0">
              <a
                href={`#${step.id}`}
                aria-current={current ? "step" : undefined}
                onClick={
                  onStepClick
                    ? (e) => {
                        e.preventDefault();
                        onStepClick(step.n);
                      }
                    : undefined
                }
                className="subtab"
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
      {onStepClick && active !== undefined && (
        <div className="mt-1.5 flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => onStepClick(active - 1)}
            disabled={active <= 1}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            ← Назад
          </button>
          <span className="text-xs text-muted-foreground">
            Шаг {active} из {TZ_STEP_COUNT}
          </span>
          <button
            type="button"
            onClick={() => onStepClick(active + 1)}
            disabled={active >= TZ_STEP_COUNT}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Далее →
          </button>
        </div>
      )}
    </nav>
  );
}
