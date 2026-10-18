import { RESOURCE_KIND_LABELS, type ImplementationResource } from "@/lib/implementation/resources";
import { safeHttpUrl } from "@/components/project/source-badge";

export function ModelResources({ resources }: { resources: readonly ImplementationResource[] }) {
  return <section className="grid min-w-0 gap-3 text-sm" aria-label="Материалы производителей">
    <h3 className="font-semibold">Материалы производителей</h3>
    <p className="text-xs text-muted-foreground">Каждый материал относится к указанным моделям. Спецификация, брошюра и кейс описывают возможности; для запуска и обслуживания требуется руководство вашей комплектации.</p>
    {resources.length === 0 && <p>Проверенные модельные материалы в этом снимке не сохранены. До пилота запросите у поставщика руководство, регламент ТО и программу безопасного восстановления.</p>}
    {resources.map(resource => {
      const url = safeHttpUrl(resource.url);
      return <article key={resource.id} className="grid min-w-0 gap-2 border-t pt-3">
        <p className="text-xs font-semibold text-muted-foreground">{RESOURCE_KIND_LABELS[resource.kind]}</p>
        <h4 className="font-semibold">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="tap-target text-primary underline">{resource.title} ↗</a> : resource.title}</h4>
        <p>{resource.manufacturer} · {resource.models.join(", ")} · проверено {resource.checkedAt}</p>
        <p>{resource.summary}</p>
        {resource.sections.length > 0 && <p>Разделы: {resource.sections.join("; ")}.</p>}
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{resource.limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
        {url && <p className="break-all text-xs text-muted-foreground">{url}</p>}
      </article>;
    })}
  </section>;
}
