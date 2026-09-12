import Link from "next/link";
import { GLOSSARY, GLOSSARY_GROUP_ORDER } from "@/lib/glossary";

export const metadata = { title: "Словарь терминов — Платформа оценки роботизации" };

/**
 * Словарь: что означают слова, которыми продукт разговаривает.
 *
 * Отдельная страница, а не подсказки по экранам, потому что дефект был именно в доступности:
 * объяснения показателей и обоснования допущений в продукте есть, но открываются они у чисел,
 * то есть в конце мастера. AS/RS, AMR, ЭПЗ и CAPEX человек читает задолго до этого — в
 * каталоге, на первом экране, в письме со ссылкой, — и, не зная одного слова, он не спорит с
 * экраном, а пролистывает его.
 *
 * Страница намеренно скучная: заголовок, разделы, определения. Всё содержание лежит в
 * `lib/glossary.ts` и покрыто тестом, поэтому здесь нет ни одного термина, который можно было
 * бы забыть обновить вместе с движком.
 */
export default function GlossaryPage() {
  return (
    <div className="surface-prose flex flex-col gap-10 py-12">
      <div className="flex flex-col gap-3">
        <h1>Словарь терминов</h1>
        <p className="text-muted-foreground">
          Продукт разговаривает двумя чужими языками сразу — складской автоматизации и
          инвестиционного анализа. Здесь они переведены на обычный. Показатели, которые считает
          сама модель, описаны так, как она их считает: если определение отсюда разойдётся с
          расчётом, право будет объяснение, а не расчёт.
        </p>
      </div>

      {GLOSSARY_GROUP_ORDER.map((group) => (
        <section key={group} className="flex flex-col gap-4">
          <h2>{group}</h2>
          <dl className="flex flex-col gap-5">
            {GLOSSARY.filter((e) => e.group === group).map((e) => (
              <div key={e.term}>
                <dt className="font-medium">
                  {e.term}
                  {e.expansion && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {e.expansion}
                    </span>
                  )}
                </dt>
                <dd className="mt-1 text-sm text-muted-foreground">{e.body}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm">
        <Link href="/methodology" className="tap-target font-medium underline underline-offset-4">
          Откуда цифры и как считается модель
        </Link>
        <Link href="/onboarding" className="tap-target font-medium underline underline-offset-4">
          Проверить свой объект →
        </Link>
      </footer>
    </div>
  );
}
