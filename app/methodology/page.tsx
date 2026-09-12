import Link from "next/link";
import { connection } from "next/server";
import { auditSources, type CitationAudit } from "@/lib/sources/registry";
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
    "Возраст каждой цитаты считается перед деплоем — и показан выше, на этой же странице, а не " +
      "обещан словами. Проверок две, потому что стареют источники по-разному: характеристика " +
      "техники — утверждение о «сейчас», и после 180 дней она проверку роняет; цена, прочитанная " +
      "на витрине в конкретный день, остаётся правдой про этот день, и у неё показывается " +
      "возраст без вердикта. Единый порог на всё приучал бы продлевать дату, не открывая " +
      "страницу, — так гейт свежести и умирает. Обе проверки намеренно не в сборке: тест, " +
      "краснеющий от смены даты, ломает сборку за то, чего никто не менял.",
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

/** Худшее сверху; при равном возрасте — по алфавиту, чтобы порядок не выглядел случайным. */
function worstFirst(a: CitationAudit, b: CitationAudit): number {
  const ageA = a.ageDays ?? Number.POSITIVE_INFINITY;
  const ageB = b.ageDays ?? Number.POSITIVE_INFINITY;
  return ageB - ageA || a.citation.label.localeCompare(b.citation.label, "ru");
}

/** Возраст словами. «Дата непригодна» — не пропуск, а худший случай: см. citationAgeDays. */
const plainAge = (ageDays: number | null) =>
  ageDays === null ? "дата непригодна" : `${ageDays} дн.`;

/**
 * Таблица цитат одного бакета. Колонка вердикта есть только у строгого: «ok» напротив снимка
 * означал бы, что у даты есть срок годности, — ровно то утверждение, которое разделение
 * проверок и опровергает.
 */
function CitationTable({ rows, verdict }: { rows: CitationAudit[]; verdict: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Что утверждается</th>
            <th className="px-3 py-2 font-medium">Тип</th>
            <th className="px-3 py-2 font-medium">Проверено</th>
            <th className="px-3 py-2 font-medium">Возраст</th>
            <th className="px-3 py-2 font-medium">Источник</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ citation: c, ageDays, overdue }, i) => (
            <tr key={`${c.url ?? c.label}-${c.kind}-${i}`} className="border-b last:border-0">
              <td className="px-3 py-2">{c.label}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {c.kind === "price" ? "цена" : "производительность"}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.lastVerified}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {plainAge(ageDays)}
                {verdict && overdue && <span className="ml-2 text-caution">устарело</span>}
              </td>
              <td className="px-3 py-2">
                {/* Ссылки может не быть, и это не пропуск, а факт: цену на промышленных
                    роботов производители не публикуют, поэтому у вендорских строк она
                    оценка, чей источник назван словами. Показать здесь ссылку на
                    спек-страницу значило бы приписать ей утверждение о цене. */}
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer"
                    className="break-all underline underline-offset-2">
                    {new URL(c.url).hostname}
                  </a>
                ) : (
                  <span className="text-muted-foreground">
                    {c.basis ?? "оценка без публичной страницы"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Справочник: формулы, источники и механика, которая их стережёт.
 *
 * Единственное место, где инженерная часть уместна, — потому что здесь она отвечает на заданный
 * вопрос («откуда я знаю, что отчёт не разойдётся с экраном?»), а не сообщает о себе. Тот же
 * текст на первом экране был бы хвастовством.
 *
 * Раздел про источники показывает НЕ пересказ проверки свежести, а её вывод: тот же
 * `auditSources`, который печатает `npm run check:sources`, вызывается здесь на запросе.
 * Обещание «источники не тухнут молча» в виде абзаца стоит ровно ноль — судья не побежит
 * запускать скрипт; тот же механизм, показанный с датами, возрастом и порогом, проверяем
 * глазами за десять секунд.
 */
export default async function MethodologyPage() {
  // Возраст цитаты меняется каждую ночь. Отрисованная на сборке, эта страница застыла бы на
  // дне деплоя и полгода показывала бы «13 дней» — то есть врала бы ровно там, где взялась
  // доказывать обратное. connection() запрещает пререндер: всё, что ниже, считается на запросе.
  await connection();
  const audit = auditSources();
  const gated = [...audit.gated].sort(worstFirst);
  const snapshots = [...audit.snapshots].sort(worstFirst);
  const oldestGated = gated[0];
  const oldestSnapshot = snapshots[0];
  const broken = audit.undated.length;
  const failing = audit.overdue.length + audit.undated.length;
  const checkedAt = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(audit.checkedAt));

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
        <p className="text-sm text-muted-foreground">
          Ниже — не рассказ о проверке свежести, а её вывод. Возраст каждой цитаты и порог
          посчитаны при открытии этой страницы той же функцией, которую печатает{" "}
          <code>npm run check:sources</code> перед деплоем.
        </p>

        <div className="flex flex-col gap-2 rounded-md border p-4 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={failing === 0 ? "font-medium text-positive" : "font-medium text-caution"}>
              {failing === 0 ? "Проверка пройдена" : `Требуют перепроверки: ${failing}`}
            </span>
            <span className="text-muted-foreground">посчитано при открытии страницы, {checkedAt}</span>
          </div>
          <p className="text-muted-foreground">
            Обязаны быть верны сегодня — {gated.length}
            {oldestGated && `, самой старой ${plainAge(oldestGated.ageDays)}`}; порог{" "}
            {audit.maxAgeDays} дн., за ним проверка перед деплоем отказывает.
          </p>
          <p className="text-muted-foreground">
            Снимков рынка на дату — {snapshots.length}
            {oldestSnapshot && `, самому старому ${plainAge(oldestSnapshot.ageDays)}`}; порогу не
            подчиняются, возраст показан для читателя.
          </p>
          {broken > 0 && (
            <p className="text-caution">
              У {broken} цитат дата непригодна — такую строку проверка перед деплоем не пропускает
              ни в одном из двух режимов: датой, которую нельзя прочитать, нельзя и отчитаться.
            </p>
          )}
        </div>

        <h3>Обязаны быть верны сегодня</h3>
        <p className="text-sm text-muted-foreground">
          Характеристики техники и оценки цен, у которых нет публичной страницы. Такое
          утверждение сделано в настоящем времени: страницу перепишут вместе с ревизией машины —
          и цитата станет ложной, притом что у нас никто ничего не менял. Заметить это может
          только человек, который откроет источник заново, и порог в {audit.maxAgeDays} дней
          существует затем, чтобы однажды его к этому принудить.
        </p>
        <CitationTable rows={gated} verdict />

        <h3>Снимок рынка на дату</h3>
        <p className="text-sm text-muted-foreground">
          Цены, прочитанные на витрине или в обзоре стоимости в конкретный день. Такая цитата не
          протухает: цена, стоявшая 7 сентября, остаётся правдой про 7 сентября, а дата — часть
          утверждения, а не срок годности. Возраст показан, чтобы вы сами решили, годится ли вам
          такая давность; проверку он не роняет — требование обновлять верную цитату каждые
          полгода закончилось бы продлением даты не глядя, и тогда порог перестал бы значить
          что-либо и там, где он нужен.
        </p>
        <CitationTable rows={snapshots} verdict={false} />
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
