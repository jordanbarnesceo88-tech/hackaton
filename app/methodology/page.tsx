import Link from "next/link";
import { ALL_CITATIONS, citationAgeDays } from "@/lib/sources/registry";
import { EXPLANATIONS } from "@/lib/economics/explanations";
import { PANEL_LABELS, type EconomicsRowKey } from "@/components/calculator/economics-rows";

export const metadata = { title: "Откуда цифры — Платформа оценки роботизации" };

const ORDER: EconomicsRowKey[] = [
  "quantity", "displacedFte", "capex", "opex", "baseline",
  "savings", "simplePayback", "discountedPayback", "roi", "npv",
];

const LABELS: Record<EconomicsRowKey, string> = {
  quantity: "Требуется единиц",
  displacedFte: "Замещается персонала (ЭПЗ)",
  capex: "CAPEX",
  opex: "OPEX/год",
  baseline: "Базовые затраты на труд/год",
  savings: "Годовая экономия",
  simplePayback: "Срок окупаемости (простой)",
  discountedPayback: "Срок окупаемости (дисконт.)",
  roi: PANEL_LABELS.roi,
  npv: PANEL_LABELS.npv,
};

const GUARANTEES: [string, string][] = [
  [
    "Отчёт не может разойтись с экраном",
    "Панель расчёта и печатный отчёт строятся из одного источника строк, и отдельный тест " +
      "проходит весь путь — от подбора до сохранённого отчёта — и сверяет числа. Он написан " +
      "после того, как расхождение однажды ушло клиенту: отчёт сообщал 4 425 300 ₽ против " +
      "2 267 100 ₽ на экране.",
  ],
  [
    "Список решений и расчёт показывают одно число",
    "Сравнение считает окупаемость по каждому решению, расчёт — по выбранному. Тест сверяет их " +
      "до первой правки допущений и проверен на то, что действительно падает при расхождении.",
  ],
  [
    "Источники не тухнут молча",
    "Отдельная проверка сообщает возраст каждой цитаты и отказывает, если ей больше 180 дней. " +
      "Она намеренно не в сборке: тест, краснеющий от смены даты, ломает сборку за то, чего " +
      "никто не менял.",
  ],
  [
    "Движок не показывает NaN",
    "На вырожденных входных данных расчёт возвращает типизированный отказ, а не бесконечность " +
      "и не NaN. Интерфейс показывает «проверьте параметры» вместо числа, которого не существует.",
  ],
  [
    "Класс решения не заводится без источника",
    "У обобщённого класса обязаны быть оба конца обоих диапазонов — цены и производительности — " +
      "из опубликованных источников. Из двенадцати задуманных классов заведено семь: по " +
      "остальным нашлась цена, но не нашлась производительность на единицу, и недостающий конец " +
      "не достраивался по смыслу.",
  ],
  [
    "Оценка называется оценкой",
    "Вендоры не публикуют прайс на промышленных роботов, поэтому каждая цена — диапазон, " +
      "помеченный «оценка», а в расчёт идёт его середина. Показатели без дисконтирования " +
      "подписаны «простой», чтобы их не приняли за защищаемые.",
  ],
];

/**
 * Справочник: формулы, источники и механика, которая их стережёт.
 *
 * Единственное место, где инженерная часть уместна, — потому что здесь она отвечает на заданный
 * вопрос («откуда я знаю, что отчёт не разойдётся с экраном?»), а не сообщает о себе. Тот же
 * текст на первом экране был бы хвастовством.
 */
export default function MethodologyPage() {
  const cited = [...ALL_CITATIONS].sort((a, b) => a.label.localeCompare(b.label, "ru"));

  return (
    <div className="surface-prose flex flex-col gap-10 py-12">
      <div className="flex flex-col gap-3">
        <h1>Откуда цифры</h1>
        <p className="text-muted-foreground">
          Расчёт стоит ровно столько, сколько стоят входящие в него утверждения. Здесь собраны
          все: что считает модель, откуда взяты внешние данные и чем мы не даём себе соврать.
        </p>
      </div>

      <section className="flex flex-col gap-5">
        <h2>Что означает каждый показатель</h2>
        {ORDER.map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <h3>{LABELS[key]}</h3>
            <p className="text-sm text-muted-foreground">{EXPLANATIONS[key].body}</p>
          </div>
        ))}
        <p className="text-sm text-muted-foreground">
          Те же объяснения доступны прямо в расчёте — у каждого числа, по кнопке рядом с ним.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2>Внешние источники</h2>
        <p className="text-sm text-muted-foreground">
          Цена и производительность — разные утверждения, поэтому у класса решений два источника,
          и они проверяются по отдельности. Список <b>выводится из тех же данных, которыми
          наполнено приложение</b>: разойтись с ним он не может.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="border-b bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Что утверждается</th>
                <th className="px-3 py-2 font-medium">Тип</th>
                <th className="px-3 py-2 font-medium">Проверено</th>
                <th className="px-3 py-2 font-medium">Источник</th>
              </tr>
            </thead>
            <tbody>
              {cited.map((c, i) => {
                const age = citationAgeDays(c);
                return (
                  <tr key={`${c.url}-${i}`} className="border-b last:border-0">
                    <td className="px-3 py-2">{c.label}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.kind === "price" ? "цена" : "производительность"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {c.lastVerified}
                      {age !== null && age > 180 && (
                        <span className="ml-2 text-caution">устарело</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <a href={c.url} target="_blank" rel="noopener noreferrer"
                        className="break-all underline underline-offset-2">
                        {new URL(c.url).hostname}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2>Чем мы не даём себе соврать</h2>
        <p className="text-sm text-muted-foreground">
          Обещание «цифра выдержит возражения» стоит ровно столько, сколько стоит механика,
          которая его держит. Вот она — не как список достижений, а как ответ на вопрос
          «а почему я должен вам верить».
        </p>
        <dl className="flex flex-col gap-4">
          {GUARANTEES.map(([title, body]) => (
            <div key={title}>
              <dt className="font-medium">{title}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="border-t pt-6">
        <Link href="/onboarding" className="tap-target font-medium underline underline-offset-4">
          Проверить свой объект →
        </Link>
      </footer>
    </div>
  );
}
