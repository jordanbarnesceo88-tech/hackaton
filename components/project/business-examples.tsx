import Link from "next/link";
import { BUSINESS_EXAMPLES, type BusinessExampleId } from "@/lib/projects/business-examples";

export function BusinessExamples({ active }: { active?: BusinessExampleId }) {
  const titles = ["Регулярный поток", "Пиковая нагрузка", "Сотрудники остаются"];
  return <section className="min-w-0" aria-label="Готовые бизнес-примеры">
    <nav aria-label="Бизнес-примеры" className="flex min-w-0 gap-2 overflow-x-auto pb-1">
      {BUSINESS_EXAMPLES.map((example, index) => <Link key={example.id} href={`/demo?example=${example.id}`}
        title={example.title} aria-current={active === example.id ? "page" : undefined}
        className={`inline-flex min-h-11 shrink-0 items-center rounded border px-3 text-sm transition-colors ${active === example.id ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border hover:bg-muted"}`}>
        {titles[index]}
      </Link>)}
    </nav>
    <details className="text-xs text-muted-foreground"><summary className="tap-target inline-flex cursor-pointer items-center">Об учебных примерах</summary>
      <div className="grid max-w-4xl gap-2 py-2">{BUSINESS_EXAMPLES.map(example => <p key={example.id}><strong>{example.title}.</strong> {example.description} {example.lesson}</p>)}
        <p>Учебные данные с явными оценками. Каждый пример открывает новый гостевой расчёт. Объект, парк и денежные допущения можно изменить.</p>
      </div>
    </details>
  </section>;
}
