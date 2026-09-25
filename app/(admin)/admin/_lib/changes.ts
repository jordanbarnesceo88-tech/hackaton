import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { isNormKey, normDef } from "@/lib/tz/norms";
import type { AdminChangeEntry } from "@/components/admin/change-table";
import { ENTITY_LABELS, FACILITY_NAMES, changeFieldLabel } from "@/components/admin/format";

/**
 * Чтение журнала действий администратора для страниц админки (папка _lib не становится
 * маршрутом). Запросы здесь, а не в lib/admin/actions.ts: каждая экспортируемая асинхронная
 * функция файла с «use server» — это серверное действие, доступное POST-запросом.
 */

/** Название продукта из записи об удалении или создании: {slug, name}. */
function nameFromValue(v: Prisma.JsonValue | null): string | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const name = (v as Record<string, unknown>).name;
    if (typeof name === "string" && name !== "") return name;
  }
  return null;
}

/**
 * Последние записи журнала по условию, с подписями объектов: название продукта, подпись
 * норматива, «Склад › параметр». Удалённый продукт подписывается названием из записи.
 */
export async function loadChangeEntries(where: Prisma.ChangeLogWhereInput, take: number): Promise<AdminChangeEntry[]> {
  const rows = await prisma.changeLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    include: { user: { select: { email: true } } },
  });
  const productIds = [
    ...new Set(rows.filter((r) => r.entity === "product" || r.entity === "characteristic").map((r) => r.entityId)),
  ];
  const paramIds = [...new Set(rows.filter((r) => r.entity === "paramDefinition").map((r) => r.entityId))];
  const [products, params] = await Promise.all([
    productIds.length > 0
      ? prisma.catalogProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    paramIds.length > 0
      ? prisma.paramDefinition.findMany({
          where: { id: { in: paramIds } },
          select: { id: true, label: true, facilityType: { select: { slug: true } } },
        })
      : Promise.resolve([]),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const paramLabel = new Map(
    params.map((p) => [p.id, `${FACILITY_NAMES[p.facilityType.slug] ?? p.facilityType.slug} › ${p.label}`]),
  );

  return rows.map((r) => {
    let object: string;
    switch (r.entity) {
      case "product":
      case "characteristic":
        object =
          productName.get(r.entityId) ?? nameFromValue(r.oldValue) ?? nameFromValue(r.newValue) ?? `продукт ${r.entityId}`;
        break;
      case "norm":
        object = isNormKey(r.entityId) ? normDef(r.entityId).label : r.entityId;
        break;
      case "paramDefinition":
        object = paramLabel.get(r.entityId) ?? `параметр ${r.entityId}`;
        break;
      case "catalog":
        object = `Выпуск данных ${r.entityId}`;
        break;
      default:
        object = r.entityId;
    }
    return {
      id: r.id,
      at: r.createdAt,
      user: r.user?.email ?? null,
      entity: ENTITY_LABELS[r.entity] ?? r.entity,
      object,
      field: r.entity === "norm" ? "Значение" : changeFieldLabel(r.entity, r.field),
      old: r.oldValue,
      new: r.newValue,
      unit: r.unit,
      reason: r.reason,
    };
  });
}
