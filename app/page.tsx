import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { cn } from "@/lib/utils";
import { DemoSceneLinks } from "@/components/project/demo-scene-links";

/** Первый экран объясняет путь к решению; расчётные результаты открываются в демо. */
const OBJECTIONS = [
  {
    q: "«Цены вы взяли с потолка?»",
    a:
      "В каталоге и расчёте можно проверить источники, даты и статус данных. Оценочную цену " +
      "нужно отличать от коммерческого предложения для вашего объекта: комплектация, доставка " +
      "и сервис меняют итоговую стоимость. Неизвестные условия поставки и цены необходимо " +
      "уточнить у поставщика перед пилотом.",
    href: "/methodology/tz",
    link: "Посмотреть методику и источники",
  },
  {
    q: "«Почему замещается столько людей?»",
    a:
      "Потому что вы сами называете, сколько человек делает каждую работу: численность вводится " +
      "по задачам, а не выводится одним делителем на всё сразу. Где у работы есть опубликованный " +
      "норматив, он подставлен подсказкой со ссылкой. С учётом покрытия и доли роботизируемой работы " +
      "модель оценивает высвобождаемые трудозатраты в эквиваленте полной занятости (FTE), а не число увольнений. " +
      "Денежная экономия зависит от отдельно заданной доли реализации этого эффекта: при нулевой доле " +
      "сотрудники остаются в штате и сокращения ФОТ нет. Решение, обслуживающее " +
      "площадь, не «замещает» тех, кто собирает заказы: у них разная работа и разные мерки.",
    href: "/demo?example=retained-staff",
    link: "Открыть пример с сохранением сотрудников",
  },
  {
    q: "«А если ставка и сроки другие?»",
    a:
      "Все допущения — ставка дисконтирования, горизонт, срок службы роботов, доля замещения — " +
      "редактируются, а диаграмма чувствительности показывает, какое из них сильнее всего двигает " +
      "результат именно для вашего сценария.",
    href: "/demo?example=steady-flow",
    link: "Проверить допущения в демо-расчёте",
  },
];

// Первый ряд — три входа одного размера (xl): одно основное действие залито, остальные —
// контурные. Иерархию задаёт вариант, не рост кнопки.
// На телефоне входы — во всю ширину: в столбик кнопки разной длины читались как разные кнопки.
/** Основное действие первого экрана. */
const CTA_PRIMARY = cn(buttonVariants({ variant: "default", size: "xl" }), "w-full sm:w-auto");

/** Второстепенные входы первого ряда — тот же размер, контур. */
const CTA_SECONDARY = cn(buttonVariants({ variant: "outline", size: "xl" }), "w-full sm:w-auto");

/** Ссылки подвала. */
const FOOTER_LINK = "tap-target font-medium underline underline-offset-4 hover:text-primary";

export default function Home() {
  return (
    <div className="surface-data flex flex-col gap-20 py-12 lg:py-16">
      <section className="grid items-start gap-10 xl:grid-cols-[minmax(0,42rem)_minmax(0,1fr)] xl:gap-12">
        <div className="flex flex-col gap-6">
          <h1>Подбор роботов от тех, кто уже запускал их на других объектах</h1>
          <p className="text-lg text-muted-foreground">
            Считаем по реальной производительности и находим узкие места до покупки. Для собственников, УК и
            операторов, которым нельзя ошибиться с бюджетом.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/demo?example=steady-flow" className={CTA_PRIMARY}>
              Открыть демо-расчёт склада
            </Link>
            <Link href="/catalog" className={CTA_SECONDARY}>
              Каталог решений
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/projects/new" className={CTA_SECONDARY}>
              Создать проект
            </Link>
            <OnboardingTour triggerSize="xl" triggerClassName="w-full sm:w-auto" />
          </div>
          <p className="text-sm text-muted-foreground">
            Парк и экономика за 30 секунд. Дальше ведём до запуска: подготовка объекта, пилот, сервис.
          </p>
          <DemoSceneLinks />
        </div>
        <div className="min-w-0 border-y border-border py-6">
          <h2 className="text-xl">От условий объекта к плану внедрения</h2>
          <ol className="mt-6 grid gap-5" aria-label="Как работает платформа">
            {[
              ["Объект", "Задайте поток, режим работы и ограничения площадки."],
              ["Экономика", "Сравните покупку и услугу, затраты и высвобождаемый труд."],
              ["Проверка потока", "Оцените выбранный парк и нагрузку с учётом границ модели."],
              ["План пилота", "Определите подготовку объекта, бюджет и критерии приёмки."],
            ].map(([title, description], index) => (
              <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-border pb-5 last:border-0 last:pb-0">
                <span aria-hidden="true" className="font-mono text-sm text-primary">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Подробности и ссылки доступны по раскрытию вопроса. */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h2>Что спросит ваш финансовый директор</h2>
          <p className="text-muted-foreground">
            Три вопроса, с которых обычно начинается разговор о роботизации. Методика и примеры помогают проверить основания расчёта.
          </p>
        </div>
        <Accordion>
          {OBJECTIONS.map((o) => (
            <AccordionItem key={o.q} title={o.q}>
              <div className="flex flex-col gap-4">
                <p className="max-w-prose text-muted-foreground">{o.a}</p>
                <Link href={o.href} className="tap-target w-fit font-medium underline underline-offset-4 hover:text-primary">{o.link} →</Link>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Методика текущего расчёта и словарь — для проверки формул, источников и терминов. */}
      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm">
        <Link href="/methodology/tz" className={FOOTER_LINK}>
          Откуда цифры: методика и источники
        </Link>
        <Link href="/glossary" className={FOOTER_LINK}>
          Словарь терминов
        </Link>
      </footer>
    </div>
  );
}
