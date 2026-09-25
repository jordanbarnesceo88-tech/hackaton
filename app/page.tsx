import Link from "next/link";
import { TZ_STEPS, stepLinkText } from "@/components/project/step-nav";
import { exampleHref, EXAMPLE_OBJECT_NAME } from "@/lib/wizard/example-scenario";

/**
 * Первый экран.
 *
 * Раньше здесь стоял redirect("/onboarding"), и человек попадал сразу на вопрос «в какой вы
 * отрасли?», не зная, зачем отвечать. Экран построен на трёх возражениях, которые задаёт
 * финансовый директор, и ответах на них: это содержание, а не украшение. Обещание продукта —
 * не «посчитайте ROI», а «получите цифру, с которой можно идти к тому, кто будет спорить».
 *
 * Сверху — расчёт по методике ТЗ (модель tz-1.0.0): демо-расчёт склада на данных организатора
 * без входа и проекты после входа (путь жюри ТЗ §5.4). Прежняя упрощённая модель v1 не удалена,
 * но в демонстрации по ТЗ не участвует (§5.7) — её входы перенесены в нижнюю секцию без
 * изменения текстов и адресов ссылок.
 */
const OBJECTIONS = [
  {
    q: "«Цены вы взяли с потолка?»",
    a:
      "Нет. Каждая цена помечена как оценка, у каждой названы источник и дата проверки. У " +
      "классов решений это опубликованный диапазон со ссылками — отдельно на цену, отдельно " +
      "на производительность; класс без обеих ссылок в каталог не попадает. У конкретных " +
      "моделей источник назван в обосновании: сторонняя оценка с диапазоном либо страница " +
      "дистрибьютора. Вендоры не публикуют прайс на промышленных роботов, поэтому точной " +
      "цены здесь не может быть ни у кого — и мы говорим это прямо, а не показываем одно " +
      "число с видом уверенности.",
  },
  {
    q: "«Почему замещается столько людей?»",
    a:
      "Потому что вы сами назвали, сколько человек делает каждую работу. Модель это число " +
      "больше не выводит: она выводила его одним делителем на все задачи сразу, занижала " +
      "выработку в десятки раз и получала паллетайзер, «замещающий» весь штат комбината с " +
      "окупаемостью в одиннадцать дней. Где у работы есть опубликованный норматив, он " +
      "подставлен подсказкой со ссылкой — и виден. Дальше результат масштабируется покрытием: " +
      "парк, закрывающий половину работы, освобождает половину людей, а не всех. Решение, " +
      "обслуживающее площадь, не «замещает» тех, кто собирает заказы — у них разная работа и " +
      "разные мерки.",
  },
  {
    q: "«А если ставка и сроки другие?»",
    a:
      "Все допущения — ставка дисконтирования, горизонт, срок службы техники, доля " +
      "замещения — редактируются, а диаграмма чувствительности показывает, какое из них " +
      "двигает результат сильнее всего. Обычно это стоимость труда, а не цена робота.",
  },
];

/** Основная кнопка — тот же вид, что у прежнего первого входа. */
const CTA_PRIMARY =
  "inline-block rounded-md bg-primary px-6 py-3 text-lg font-medium text-primary-foreground " +
  "transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

/** Вторая кнопка — контурная, как у прежнего «готового примера». */
const CTA_SECONDARY =
  "inline-block rounded-md border px-6 py-3 text-lg font-medium transition-colors " +
  "hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

/**
 * Входы прежней модели v1 — тише основных: она в демонстрации по ТЗ не участвует, но ссылки
 * остаются рабочими.
 */
const CTA_QUIET =
  "inline-block rounded-md border px-4 py-2 font-medium transition-colors hover:border-primary " +
  "hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export default function Home() {
  return (
    <div className="surface-prose flex flex-col gap-10 py-16">
      <div className="flex flex-col gap-4">
        <h1>Окупится ли роботизация вашего объекта</h1>
        <p className="text-lg text-muted-foreground">
          Расчёт по методике ТЗ: подбор решений, CAPEX/OPEX/TCO, сценарии «как есть / покупка /
          услуга» и имитация работы склада на данных организатора
        </p>
      </div>

      {/* Два входа в расчёт по ТЗ. Демо-расчёт открывается без входа и ничего не сохраняет
          (гость, ТЗ §3.1.2); проект требует входа и сохраняется с версиями модели и данных. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/demo" className={CTA_PRIMARY}>
            Открыть демо-расчёт склада
          </Link>
          <Link href="/projects/new" className={CTA_SECONDARY}>
            Создать проект
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Демо-расчёт — без входа, на базовых значениях датасета организатора; изменения в нём не
          сохраняются. В проекте параметры вводятся вручную или загружаются из файла Excel/CSV по
          шаблону, сценарии сравниваются в одной таблице, а результат сохраняется и выгружается в
          отчёт и Excel. У демо-аккаунта уже есть готовый проект склада. Склад рассчитывается
          полностью; аэропорт и медучреждение показаны на уровне параметров, подбора и доступных
          решений (прототип).
        </p>
        <ol aria-label="Шаги расчёта по ТЗ" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {TZ_STEPS.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <span className="tabular-nums">{stepLinkText(s)}</span>
              {s.n < TZ_STEPS.length && (
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>

      <section className="flex flex-col gap-6 border-t pt-8">
        <h2>Что спросит ваш финансовый директор</h2>
        {OBJECTIONS.map((o) => (
          <div key={o.q} className="flex flex-col gap-1.5">
            <h3>{o.q}</h3>
            <p className="text-muted-foreground">{o.a}</p>
          </div>
        ))}
      </section>

      {/* Прежняя модель v1: 47 типов объектов, расчёт в долларах с пересчётом в рубли. Тексты и
          адреса ссылок не меняются — на них опираются e2e-тесты v1. Второй вход важен не меньше
          первого: пример ведёт на посчитанные числа, а не на пустую форму. */}
      <section className="flex flex-col gap-4 border-t pt-8">
        <h2>Быстрая оценка по 47 типам объектов (упрощённая модель v1)</h2>
        <p className="text-sm text-muted-foreground">
          прежняя модель в долларах с пересчётом в рубли; в демонстрации по ТЗ не участвует
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/onboarding" className={CTA_QUIET}>
            Проверить свой объект
          </Link>
          <Link href={exampleHref()} className={CTA_QUIET}>
            Посмотреть на готовом примере
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Шесть шагов, без регистрации — или сразу готовый расчёт для «{EXAMPLE_OBJECT_NAME}»:
          шесть решений, из них окупается одно. Сохранить расчёт можно потом.
        </p>
      </section>

      {/* Входы в прозу: формулы и нормативы модели ТЗ, методика прежней модели («откуда
          цифры») и словарь — для того, кто на «ЭПЗ» и «AS/RS» ещё останавливается. */}
      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm">
        <Link href="/methodology/tz" className="tap-target font-medium underline underline-offset-4">
          Формулы и нормативы модели ТЗ
        </Link>
        <Link href="/methodology" className="tap-target font-medium underline underline-offset-4">
          Откуда цифры и как считается модель
        </Link>
        <Link href="/glossary" className="tap-target font-medium underline underline-offset-4">
          Словарь терминов
        </Link>
      </footer>
    </div>
  );
}
