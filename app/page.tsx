import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { CleaningRobotPreview } from "@/components/landing/cleaning-robot-preview";
import { cn } from "@/lib/utils";

/**
 * Первый экран: кто подбирает роботов и почему этому можно верить, три входа и путь от объекта
 * к пилоту. Ниже — робот-уборщик в работе (лёгкая схема, полная 3D-сцена — по ссылке) и
 * вопросы финансового директора, для которого «нельзя ошибиться с бюджетом».
 */
const OBJECTIONS = [
  {
    q: "«Цены вы взяли с потолка?»",
    a:
      "Нет. У каждой цены указаны источник и дата проверки. Это оценка: комплектация, доставка " +
      "и сервис меняют итог, поэтому перед пилотом цену подтверждает коммерческое предложение " +
      "поставщика.",
    href: "/methodology/tz",
    link: "Методика и источники",
  },
  {
    q: "«Откуда экономия на персонале?»",
    a:
      "Численность вы задаёте сами, по каждой задаче; где есть норматив, он подсказан со ссылкой. " +
      "Модель считает высвобождаемое время в ставках (FTE), а не увольнения. Сколько из этого " +
      "станет экономией ФОТ, решаете вы: можно оставить всех в штате.",
    href: "/demo?example=retained-staff",
    link: "Пример с сохранением сотрудников",
  },
  {
    q: "«А если ставка и сроки другие?»",
    a:
      "Поменяйте их: ставку дисконтирования, горизонт, срок службы роботов и долю замещения. " +
      "Диаграмма чувствительности покажет, что сильнее всего влияет на результат вашего сценария.",
    href: "/demo?example=steady-flow",
    link: "Проверить в демо-расчёте",
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
          <div className="flex flex-col gap-2">
            <p className="text-lg text-muted-foreground">
              Считаем по реальной производительности и находим узкие места до покупки. Для собственников, УК и
              операторов, которым нельзя ошибиться с бюджетом.
            </p>
            <p className="text-sm font-medium">30 роботов в работе у «Азбуки Вкуса» и других клиентов</p>
          </div>
          {/* Каталог решений — в шапке, здесь не дублируется. */}
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/demo?example=steady-flow" className={CTA_PRIMARY}>
              Открыть демо-расчёт склада
            </Link>
            <Link href="/projects/new" className={CTA_SECONDARY}>
              Создать проект
            </Link>
            <OnboardingTour triggerSize="xl" triggerClassName="w-full sm:w-auto" />
          </div>
          <p className="text-sm text-muted-foreground">
            Первый расчёт парка и экономики за 5 минут, без регистрации. Дальше ведём до запуска: подготовка
            объекта, пилот, сервис.
          </p>
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

      {/* Робот в работе: лёгкая схема на месте 4-мегабайтной сцены, сама сцена — в новой вкладке. */}
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h2>Посмотрите робота в работе</h2>
          <p className="text-muted-foreground">
            Робот-уборщик проходит торговый зал полосами, объезжает стеллажи и возвращается на базу.
          </p>
          <Link
            href="/demo/cleaning"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-fit")}
          >
            Открыть 3D-сцену уборки ↗
          </Link>
        </div>
        <CleaningRobotPreview className="min-w-0 rounded-lg border border-border p-2" />
      </section>

      {/* Подробности и ссылки доступны по раскрытию вопроса. */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h2>Что спросит ваш финансовый директор</h2>
          <p className="text-muted-foreground">
            Три вопроса, с которых начинается разговор о бюджете.
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
