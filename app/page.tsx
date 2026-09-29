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
      "Нет. Каждая цена помечена как оценка, у каждой названы источник и дата проверки. У " +
      "классов решений это опубликованный диапазон со ссылками — отдельно на цену и на " +
      "производительность; класс без обеих ссылок в каталог не попадает. Вендоры не публикуют " +
      "прайс на промышленных роботов, поэтому точной цены здесь не может быть ни у кого — и " +
      "платформа говорит это прямо, а не показывает одно число с видом уверенности.",
    shot: { light: capexLight, dark: capexDark, alt: "Статьи CAPEX: сумма, формула с подстановкой чисел и происхождение каждой цены" },
  },
  {
    q: "«Почему замещается столько людей?»",
    a:
      "Потому что вы сами называете, сколько человек делает каждую работу: численность вводится " +
      "по задачам, а не выводится одним делителем на всё сразу. Где у работы есть опубликованный " +
      "норматив, он подставлен подсказкой со ссылкой. Результат масштабируется покрытием: парк, " +
      "закрывающий половину работы, освобождает половину людей, а не всех. Решение, обслуживающее " +
      "площадь, не «замещает» тех, кто собирает заказы, — у них разная работа и разные мерки.",
    shot: { light: staffLight, dark: staffDark, alt: "Раздел параметров «Персонал»: численность и зарплаты по задачам" },
  },
  {
    q: "«А если ставка и сроки другие?»",
    a:
      "Все допущения — ставка дисконтирования, горизонт, срок службы техники, доля замещения — " +
      "редактируются, а диаграмма чувствительности показывает, какое из них сильнее всего двигает " +
      "результат. Обычно это стоимость труда, а не цена робота.",
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
          <h1>Окупится ли роботизация вашего объекта</h1>
          <p className="text-lg text-muted-foreground">
            Подбор роботизированных решений, CAPEX, OPEX и TCO, сценарии «как есть / покупка / услуга» и
            проверка парка имитацией.
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
            Демо-расчёт открывается без входа и ничего не сохраняет. Проект сохраняется с версиями модели и данных
            и выгружается в отчёт и Excel.
          </p>
        </div>
        <ThemedScreenshot
          light={scenariosLight}
          dark={scenariosDark}
          alt="Сравнение сценариев демо-склада: «как есть», покупка и услуга рядом, рекомендованный отмечен звездой"
          sizes="(min-width: 1280px) 45vw, 100vw"
          fetchPriority="high"
        />
      </section>

      {/* Возражения — свёрнутыми пунктами: вопрос виден сразу, ответ и снимок — по раскрытию. */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h2>Что спросит ваш финансовый директор</h2>
          <p className="text-muted-foreground">
            Три вопроса, с которых обычно начинается разговор о роботизации, — и где в расчёте на них ответ.
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
          Формулы и нормативы модели
        </Link>
        <Link href="/methodology" className={FOOTER_LINK}>
          Откуда цифры и как считается модель
        </Link>
        <Link href="/glossary" className={FOOTER_LINK}>
          Словарь терминов
        </Link>
      </footer>
    </div>
  );
}
