import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { ThemedScreenshot } from "@/components/landing/themed-screenshot";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { cn } from "@/lib/utils";
import scenariosLight from "@/public/landing/scenarios-light.png";
import scenariosDark from "@/public/landing/scenarios-dark.png";
import capexLight from "@/public/landing/capex-light.png";
import capexDark from "@/public/landing/capex-dark.png";
import staffLight from "@/public/landing/staff-light.png";
import staffDark from "@/public/landing/staff-dark.png";
import sensitivityLight from "@/public/landing/sensitivity-light.png";
import sensitivityDark from "@/public/landing/sensitivity-dark.png";

/**
 * Первый экран.
 *
 * Построен на возражениях, которые задаёт финансовый директор, и ответах на них: это
 * содержание, а не украшение. Обещание продукта — не «посчитайте ROI», а «получите цифру, с
 * которой можно идти к тому, кто будет спорить».
 *
 * Пересборка 2026-09-27 (просьба владельца: «слишком много текста, добавить картинки»):
 * - поля страницы — те же, что у остальных страниц (.surface-data), текст держит меру строки
 *   сам;
 * - вопросы свёрнуты в раскрывающиеся пункты, в каждом ответе — снимок экрана, который этот
 *   ответ показывает (снимки — настоящие экраны демо-расчёта, scripts/capture-landing-shots.mjs);
 * - на первом экране — снимок сравнения сценариев рядом с кнопками.
 */
const OBJECTIONS = [
  {
    q: "«Цены вы взяли с потолка?»",
    a:
      "Нет, из открытых источников — и это видно в каждой строке расчёта. У каждой цены указаны " +
      "источник и дата проверки, у класса решений — опубликованный диапазон с отдельными ссылками " +
      "на цену и на производительность. Без обеих ссылок решение в каталог не попадает. " +
      "Производители промышленных роботов не публикуют прайс-листы, поэтому до коммерческого " +
      "предложения любая цена — оценка, и платформа так её и помечает.",
    shot: { light: capexLight, dark: capexDark, alt: "Статьи CAPEX: сумма, формула с подстановкой чисел и происхождение каждой цены" },
  },
  {
    q: "«Откуда такая экономия на персонале?»",
    a:
      "Из ваших же данных. Численность задаётся по каждой задаче, а не одним коэффициентом на весь " +
      "объект; где есть опубликованный норматив, он подсказан со ссылкой на источник. Экономия " +
      "пропорциональна покрытию: если роботы берут на себя половину работы, высвобождается " +
      "половина занятых на ней людей. Робот, который обслуживает площадь, не заменяет сборщиков " +
      "заказов — у них разная работа и разные нормы.",
    shot: { light: staffLight, dark: staffDark, alt: "Раздел параметров «Персонал»: численность и зарплаты по задачам" },
  },
  {
    q: "«А если ставка и сроки другие?»",
    a:
      "Поменяйте их. Ставку дисконтирования, горизонт расчёта, срок службы роботов и долю замещения " +
      "можно изменить, а диаграмма чувствительности покажет, какое допущение сильнее всего влияет " +
      "на результат. Чаще всего это стоимость труда.",
    shot: { light: sensitivityLight, dark: sensitivityDark, alt: "Диаграмма чувствительности NPV к параметрам расчёта" },
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
      {/* Первый экран: текст и входы слева, настоящий экран расчёта справа. Колонка текста —
          42rem: ровно столько, чтобы три входа первого ряда стояли в одну строку; две колонки —
          с xl (1280px), ниже снимок встаёт под текст во всю ширину. */}
      <section className="grid items-center gap-10 xl:grid-cols-[minmax(0,42rem)_minmax(0,1fr)] xl:gap-12">
        <div className="flex flex-col gap-6">
          <h1>Окупится ли роботизация вашего объекта?</h1>
          <p className="text-lg text-muted-foreground">
            Подберите роботов под задачи объекта и сравните три сценария: оставить всё как есть, купить технику
            или взять её как услугу (RaaS). Платформа посчитает вложения, текущие расходы и полную стоимость
            владения, а имитация покажет, справится ли парк с вашим потоком.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/demo" className={CTA_PRIMARY}>
              Открыть демо-расчёт склада
            </Link>
            <Link href="/projects/new" className={CTA_SECONDARY}>
              Создать проект
            </Link>
            {/* Онбординг-тур: карточки по шагам расчёта, см. components/onboarding/onboarding-tour.tsx.
                Открывается сам один раз новому посетителю и по этой кнопке — в любой момент. */}
            <OnboardingTour triggerSize="xl" triggerClassName="w-full sm:w-auto" />
          </div>
          <p className="text-sm text-muted-foreground">
            Демо открывается без регистрации, введённые в нём данные не сохраняются. Проект хранит историю
            версий расчёта и выгружается в отчёт и Excel.
          </p>
        </div>
        <ThemedScreenshot
          light={scenariosLight}
          dark={scenariosDark}
          alt="Сравнение сценариев демо-склада: «Как есть», покупка и услуга рядом, рекомендуемый отмечен звездой"
          sizes="(min-width: 1280px) 45vw, 100vw"
          fetchPriority="high"
        />
      </section>

      {/* Возражения — свёрнутыми пунктами: вопрос виден сразу, ответ и снимок — по раскрытию. */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h2>Что спросит ваш финансовый директор</h2>
          <p className="text-muted-foreground">
            Три вопроса, с которых обычно начинается разговор о роботизации, — и где в расчёте найти ответ.
          </p>
        </div>
        <Accordion>
          {OBJECTIONS.map((o) => (
            <AccordionItem key={o.q} title={o.q}>
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <p className="max-w-prose text-muted-foreground">{o.a}</p>
                <ThemedScreenshot
                  light={o.shot.light}
                  dark={o.shot.dark}
                  alt={o.shot.alt}
                  sizes="(min-width: 1280px) 40vw, (min-width: 1024px) 60vw, 100vw"
                />
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Входы в прозу: формулы и нормативы модели, методика упрощённой модели («откуда
          цифры») и словарь — для того, кто на «ЭПЗ» и «AS/RS» ещё останавливается. */}
      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm">
        <Link href="/methodology/tz" className={FOOTER_LINK}>
          Методика расчёта
        </Link>
        <Link href="/methodology" className={FOOTER_LINK}>
          Откуда цифры
        </Link>
        <Link href="/glossary" className={FOOTER_LINK}>
          Словарь терминов
        </Link>
      </footer>
    </div>
  );
}
