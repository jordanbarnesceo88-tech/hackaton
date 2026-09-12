import Link from "next/link";
import { exampleHref, EXAMPLE_OBJECT_NAME } from "@/lib/wizard/example-scenario";

/**
 * Первый экран.
 *
 * Раньше здесь стоял redirect("/onboarding"), и человек попадал сразу на вопрос «в какой вы
 * отрасли?», не зная, зачем отвечать. Экран построен на трёх возражениях, которые задаёт
 * финансовый директор, и ответах на них: это содержание, а не украшение. Обещание продукта —
 * не «посчитайте ROI», а «получите цифру, с которой можно идти к тому, кто будет спорить».
 */
const OBJECTIONS = [
  {
    q: "«Цены вы взяли с потолка?»",
    a:
      "Нет. Каждая цена — опубликованный диапазон с ссылкой на источник и датой проверки, и " +
      "помечена как оценка. Вендоры не публикуют прайс на промышленных роботов, поэтому " +
      "точной цены здесь не может быть ни у кого — и мы говорим это прямо, а не показываем " +
      "одно число с видом уверенности.",
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

export default function Home() {
  return (
    <div className="surface-prose flex flex-col gap-10 py-16">
      <div className="flex flex-col gap-4">
        <h1>Окупится ли роботизация вашего объекта</h1>
        <p className="text-lg text-muted-foreground">
          Расчёт, который выдержит разговор с тем, кто будет возражать: дисконтированная
          окупаемость, NPV, анализ чувствительности — и ссылка на источник у каждой цифры,
          которую мы не выдумали.
        </p>
      </div>

      {/* Два входа, и второй важен не меньше первого: человек, который смотрит продукт, а не
          считает свой объект, до опроса не дойдёт — ему нужно сразу увидеть, о чём речь.
          Пример ведёт на посчитанные числа, а не на пустую форму. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/onboarding"
            className="inline-block rounded-md bg-primary px-6 py-3 text-lg font-medium
              text-primary-foreground transition-opacity hover:opacity-90
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Проверить свой объект
          </Link>
          <Link
            href={exampleHref()}
            className="inline-block rounded-md border px-6 py-3 text-lg font-medium
              transition-colors hover:border-primary hover:text-primary
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Посмотреть на готовом примере
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Шесть шагов, без регистрации — или сразу готовый расчёт для «{EXAMPLE_OBJECT_NAME}»:
          шесть решений, из них окупается одно. Сохранить расчёт можно потом.
        </p>
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

      <footer className="border-t pt-6 text-sm">
        <Link href="/methodology" className="tap-target font-medium underline underline-offset-4">
          Откуда цифры и как считается модель
        </Link>
      </footer>
    </div>
  );
}
