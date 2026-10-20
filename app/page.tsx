import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CleaningRobot3D } from "@/components/landing/cleaning-robot-3d";
import { cn } from "@/lib/utils";

/**
 * Первый экран: кто подбирает роботов и почему этому можно верить, два входа и путь от объекта
 * к пилоту, под ними во всю ширину — робот Alfa Robot убирает офисный мусор.
 *
 * С xl (1280px, шапка там в одну строку, 60px) первый блок занимает минимум экран:
 * схема забирает остаток высоты. Уже — обычная прокрутка:
 * шапка переносится, а текст в столбик в один экран не помещается.
 */
const CTA_LAYOUT = "h-auto min-h-14 w-full px-3 py-3 text-center text-sm leading-snug whitespace-normal";
const CTA_PRIMARY = cn(buttonVariants({ variant: "default", size: "xl" }), CTA_LAYOUT);
const CTA_SECONDARY = cn(buttonVariants({ variant: "outline", size: "xl" }), CTA_LAYOUT);

/** Ссылки подвала. */
const FOOTER_LINK = "tap-target font-medium underline underline-offset-4 hover:text-primary";

export default function Home() {
  return (
    <div className="surface-data">
    <div className="flex flex-col gap-8 py-8 xl:min-h-[calc(100dvh-60px)] xl:gap-5 xl:py-5">
      <section className="grid items-start gap-10 xl:grid-cols-[minmax(0,42rem)_minmax(0,1fr)] xl:gap-12">
        <div className="flex flex-col gap-5 xl:gap-3">
          <h1>Подбор роботов от тех, кто уже запускал их на других объектах</h1>
          <div className="flex flex-col gap-2">
            <p className="text-lg text-muted-foreground">
              Для собственников объектов недвижимости, которым важно не только рассчитать экономику
              роботизации, а внедрить роботов в работу объекта с минимальным временем простоев.
              <br />
              Учитываем особенности Объекта и подсвечиваем узкие места до пилота и внедрения роботов.
            </p>
            <p className="text-sm font-medium">
              30 роботов в работе в сети Азбука Вкуса, ТРЦ Авиапарк, ТРЦ Саларис, на складах Озон.
            </p>
          </div>
          {/* Две основные кнопки (владелец, 2026-10-20). Остальные демо-расчёты и тур «Как это
              работает» - во вкладке «Демо» шапки, каталог решений - тоже в шапке. */}
          <nav aria-label="Начать работу" className="grid min-w-0 auto-rows-fr gap-2 sm:grid-cols-2">
            <Link href="/projects/new" className={CTA_PRIMARY}>
              Создать проект
            </Link>
            <Link href="/demo/warehouse?case=complex" className={CTA_SECONDARY}>
              Демо: сложный склад · 3D
            </Link>
          </nav>
          <p className="text-sm text-muted-foreground">
            Первый расчёт парка и экономики за 5 минут, без регистрации. Дальше ведём до запуска: подготовка
            объекта, пилот, покупка или сервисный контракт.
          </p>
        </div>
        <div className="min-w-0 border-y border-border py-6 xl:py-4">
          <h2 className="text-xl">От условий объекта к плану внедрения</h2>
          <ol className="mt-6 grid gap-5 xl:mt-4 xl:gap-3" aria-label="Как работает платформа">
            {[
              ["Объект", "Выберите тип Объекта и задайте его данные"],
              ["Экономика", "Сравните затраты As is с покупкой или сервисным контрактом"],
              ["Имитация", "Наглядно демонстрируем, как подобранные решения будут работать у вас"],
              ["Пилот", "Как подготовить объект и персонал к пилоту и оценить его эффективность"],
            ].map(([title, description], index) => (
              <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-border pb-5 last:border-0 last:pb-0 xl:pb-3">
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

      {/* Робот Alfa Robot убирает мусор; на xl полоса забирает остаток экрана. */}
      <CleaningRobot3D className="h-72 xl:h-auto xl:min-h-44 xl:flex-1" />

      {/* Методика текущего расчёта и словарь — для проверки формул, источников и терминов. */}
      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-sm">
        <Link href="/methodology/tz" className={FOOTER_LINK}>
          Откуда цифры: методика и источники
        </Link>
        <Link href="/glossary" className={FOOTER_LINK}>
          Словарь терминов
        </Link>
      </footer>
    </div>
    </div>
  );
}
