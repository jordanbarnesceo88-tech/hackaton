import { RESOURCE_KIND_LABELS } from "../../implementation/resources";
import type { ReportResults } from "./rows";

export type ImplementationReportRow = {
  productName: string;
  label: string;
  text: string;
  source: string;
};

/** Export only recorded product guidance; opening an archive must not adopt live contacts or manuals. */
export function implementationReportRows(results: ReportResults): ImplementationReportRow[] {
  const rows: ImplementationReportRow[] = [];
  const slugs = new Set(results.scenarios.flatMap(scenario => scenario.items.map(item => item.productSlug)));
  for (const slug of slugs) {
    const product = results.productSnapshots[slug];
    if (!product) continue;
    const push = (label: string, text: string, source: string) => rows.push({ productName: product.name, label, text, source });
    const snapshot = product.implementation;
    if (!snapshot) {
      push("Подготовка внедрения", "Сведения о внедрении в снимке не сохранены.", "Архив проекта; текущая база знаний не подставляется.");
      continue;
    }
    const templateSource = `Сохранённый методический шаблон платформы; ${snapshot.version}. Условия и пороги согласовать для объекта.`;
    const guide = snapshot.guide;
    if (guide) {
      push("Область применения", guide.scope, templateSource);
      for (const [label, items] of [
        ["Узкие места", guide.bottlenecks], ["Подготовка объекта", guide.preparation],
        ["Приёмка пилота", guide.acceptance], ["Эксплуатация и отказы", guide.operations],
        ["Шаги заказчика", guide.customer],
      ] as const) for (const item of items) push(label, item, templateSource);
    }
    if (snapshot.providers.length === 0) push("Внедрение и сервис", "Контакт обслуживающей организации в снимке не подтверждён; запросить условия для объекта.", snapshot.version);
    for (const provider of snapshot.providers) {
      const verification = provider.verification === "contract-reference" ? "Условия по указанному договору; проверить применимость к объекту" : provider.verification === "public-source" ? "Публичные сведения; договор на объект не подтверждён" : "Сведения команды; условия обслуживания не подтверждены";
      const source = [verification, `проверено ${provider.checkedAt}`, provider.sourceUrl, provider.sourceRef].filter(Boolean).join("; ");
      push("Организация сервиса", `${provider.name}: ${provider.role}. ${provider.coverage}`, source);
      push("Контакт сервиса", [provider.contactUrl, provider.email, provider.phone].filter(Boolean).join("; ") || "Контакт не предоставлен", source);
      push("Сроки сервиса", `Реакция: ${provider.responseSla ?? "не опубликована; согласовать в договоре"}. Выезд: ${provider.onsiteSla ?? "не опубликован; согласовать для адреса объекта"}.`, source);
    }
    const resources = snapshot.resources ?? [];
    if (resources.length === 0) push("Материалы производителя", "Проверенные модельные материалы в снимке не сохранены; запросить руководство и регламент ТО.", snapshot.version);
    for (const resource of resources) {
      const source = `${resource.url}; проверено ${resource.checkedAt}; ${resource.manufacturer}; модели: ${resource.models.join(", ")}`;
      push(RESOURCE_KIND_LABELS[resource.kind], `${resource.title}. ${resource.summary}`, source);
      if (resource.sections.length) push("Разделы материала", resource.sections.join("; "), source);
      for (const limit of resource.limits) push("Границы материала", limit, source);
    }
  }
  return rows;
}
