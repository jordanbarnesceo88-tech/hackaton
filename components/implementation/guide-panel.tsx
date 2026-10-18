import Link from "next/link";
import type { ImplementationSnapshot } from "@/lib/implementation/snapshot";
import type { ServiceProvider } from "@/lib/implementation/service-directory";

export function ServiceContacts({ providers }: { providers: readonly ServiceProvider[] }) {
  return <section className="grid min-w-0 gap-3 text-sm" aria-label="Внедрение и сервис">
    <h3 className="font-semibold">К кому обратиться</h3>
    {providers.length === 0 && <p>Подтверждённого контакта для этого производителя в снимке нет. До пилота запросите у поставщика обслуживающую организацию, географию выезда и условия договора.</p>}
    {providers.map(provider => <article key={provider.id} className="grid min-w-0 gap-2 border-t pt-3">
      <h4 className="font-semibold">{provider.name}</h4>
      <p>{provider.role}. {provider.coverage}</p>
      <p>Реакция: {provider.responseSla ?? "срок не опубликован; согласовать в договоре"}. Выезд: {provider.onsiteSla ?? "срок не опубликован; согласовать для адреса объекта"}.</p>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 break-all">
        {provider.contactUrl && <a className="tap-target text-primary underline" href={provider.contactUrl} target="_blank" rel="noopener noreferrer">Связаться с организацией ↗</a>}
        {provider.email && <a className="tap-target text-primary underline" href={`mailto:${encodeURIComponent(provider.email).replace(/%40/g, "@")}`}>{provider.email}</a>}
        {provider.phone && <a className="tap-target text-primary underline" href={`tel:${provider.phone.replace(/[^+0-9]/g, "")}`}>{provider.phone}</a>}
        {!provider.contactUrl && !provider.email && !provider.phone && <span>Контакт ещё не предоставлен.</span>}
      </div>
      <p className="break-words text-xs text-muted-foreground">{provider.verification === "public-source" ? "Сведения с сайта организации" : provider.verification === "contract-reference" ? "Условия введены по договору; применимость к объекту проверить по указанному основанию" : "Сведения команды, условия обслуживания не подтверждены"} · проверка {provider.checkedAt}. {provider.sourceUrl && <a href={provider.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all underline">Источник</a>}{provider.sourceRef && <span> {provider.sourceRef}</span>}</p>
    </article>)}
    <p className="text-xs text-muted-foreground">Наличие контакта не подтверждает договор на выбранный объект. До запуска согласуйте гарантию, ТО, наличие запчастей, реакцию, выезд и стоимость работ.</p>
  </section>;
}

export function ImplementationGuidePanel({ snapshot, expanded = false }: { snapshot: ImplementationSnapshot; expanded?: boolean }) {
  const guide = snapshot.guide;
  return <section className="grid min-w-0 gap-4 border-t pt-4 text-sm" data-implementation-version={snapshot.version}>
    {guide && <>
      <h3 className="font-semibold">Подготовка и приёмка: {guide.title}</h3>
      <p>{guide.scope}</p>
      <details className="min-w-0" open={expanded}>
        <summary className="tap-target cursor-pointer font-semibold">Узкие места, подготовка и критерии пилота</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {([
            ["Проверить до запуска", guide.bottlenecks], ["Подготовить объект", guide.preparation],
            ["Принять результат пилота", guide.acceptance], ["Работа инженера", guide.operations],
          ] as const).map(([title, items]) => <section key={title} className="grid content-start gap-2"><h4 className="font-semibold">{title}</h4><ul className="list-disc space-y-2 pl-5">{items.map(item => <li key={item}>{item}</li>)}</ul></section>)}
        </div>
      </details>
      <p className="text-xs text-muted-foreground">Методический шаблон платформы; условия и численные пороги согласуются для конкретного объекта. Руководство модели и программа безопасности поставщика обязательны для запуска.</p>
      <Link className="tap-target w-fit text-primary underline" href={`/knowledge/${encodeURIComponent(guide.solutionType)}`}>База знаний по классу: инженер и заказчик →</Link>
    </>}
    <ServiceContacts providers={snapshot.providers} />
  </section>;
}

