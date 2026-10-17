import Link from "next/link";
import { BUSINESS_EXAMPLES, type BusinessExampleId } from "@/lib/projects/business-examples";

export function BusinessExamples({ active }: { active?: BusinessExampleId }) {
  const examples = <section className="grid gap-3 border-y border-border py-5" aria-label="Готовые бизнес-примеры">
    <div className="grid gap-1"><h2 className="text-lg font-semibold">Разберите решение на готовом объекте</h2><p className="max-w-3xl text-sm text-muted-foreground">В каждом примере уже заданы объект, парк и денежные допущения. Откройте результат, проверьте исходные данные и измените параметры.</p></div>
    <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
      {BUSINESS_EXAMPLES.map((e,i)=><div key={e.id} className={`grid content-start gap-2 py-4 md:py-2 ${i===0?'md:pr-5':i===2?'md:pl-5':'md:px-5'}`}>
        <Link href={`/demo?example=${e.id}`} className="tap-target inline-flex items-center text-sm font-semibold text-primary underline underline-offset-4" aria-current={active===e.id?'page':undefined}>{e.title}</Link>
        <p className="text-sm leading-relaxed text-muted-foreground">{e.description}</p>
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">Учебные данные с явными оценками. Каждый пример открывает новый гостевой расчёт.</p>
  </section>;
  if (active) return <details className="border-y border-border py-1 sm:py-3"><summary className="tap-target cursor-pointer text-sm font-semibold">Другие бизнес-примеры</summary>{examples}</details>;
  return examples;
}
