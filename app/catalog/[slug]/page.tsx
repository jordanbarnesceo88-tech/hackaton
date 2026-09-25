import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { Breadcrumb, buildTrails } from "@/components/catalog/breadcrumb";
import { ArchivedChip, LevelChip, StatusChip } from "@/components/catalog/chips";
import { CHAR_GROUP_ORDER, GroupSection, groupAnchor } from "@/components/catalog/group-section";
import { CHIP_CLASS, EXCLUDED_CHIP, NEEDS_VERIFICATION_CHIP } from "@/components/catalog/labels";
import {
  DataQualitySummary,
  DemoLinks,
  KeyFacts,
  ProductDescription,
  VerificationNotice,
} from "@/components/catalog/product-card";
import { compareHref } from "@/components/catalog/search-params";
import { getCatalogProduct } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { CHAR_GROUP_LABELS } from "@/lib/tz/characteristics";
import { cn } from "@/lib/utils";
import { getProcessFacilities } from "../_lib/data";

type Params = Promise<{ slug: string }>;

/** Одна выборка карточки на запрос: её читают и метаданные, и страница. */
const loadProduct = cache(async (slug: string) => getCatalogProduct(prisma, slug));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const product = await loadProduct(slug);
  return {
    title: product
      ? `${product.name} — Каталог — Платформа оценки роботизации`
      : "Продукт не найден — Платформа оценки роботизации",
  };
}

/**
 * Карточка продукта каталога (ТЗ §3.3.4): место в иерархии §3.3.1, шесть обязательных групп
 * характеристик, у каждой характеристики — значение с единицей, цитата из источника, бейдж
 * источника (ссылка, место, дата, основание) и признак подтверждения; расхождения источников —
 * с альтернативами. Доступна гостю (§3.1.2). Архивный продукт открывается тоже: на него могут
 * ссылаться сохранённые проекты.
 */
export default async function CatalogProductPage({ params }: { params: Params }) {
  await connection();
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  const processFacilities = await getProcessFacilities(
    prisma,
    product.processes.map((p) => p.slug),
  );
  const trails = buildTrails(product, processFacilities);
  const subtitle = [product.manufacturer, product.country].filter(Boolean).join(" · ");

  return (
    <div className="surface-data flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-3">
        <Link href="/catalog" prefetch={false} className="text-sm text-primary underline-offset-2 hover:underline">
          ← Весь каталог
        </Link>
        <Breadcrumb trails={trails} />
      </div>

      <header className="flex flex-col gap-3">
        <h1>{product.name}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={product.status} />
          <LevelChip level={product.level} />
          {product.needsVerification && (
            <span className={cn(CHIP_CLASS, "border-caution/50 bg-caution/10 text-foreground")}>{NEEDS_VERIFICATION_CHIP}</span>
          )}
          {product.excluded && (
            <span className={cn(CHIP_CLASS, "border-destructive/40 bg-destructive/5 text-destructive")}>{EXCLUDED_CHIP}</span>
          )}
          {product.archived && <ArchivedChip />}
        </div>
        <ProductDescription product={product} />
      </header>

      {product.archived && (
        <div className="rounded-lg border bg-muted px-4 py-3 text-sm">
          Продукт переведён в архив: в списке каталога и в подборе его нет. Карточка сохранена, потому что на неё
          могут ссылаться сохранённые проекты.
        </div>
      )}
      {product.excluded && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Не участвует в подборе</p>
          <p className="mt-1">{product.excludedReason ?? "Причина исключения не указана."}</p>
        </div>
      )}
      <VerificationNotice product={product} />

      <section aria-labelledby="key-facts" className="flex flex-col gap-2">
        <h2 id="key-facts" className="sr-only">
          Ключевые значения
        </h2>
        <KeyFacts product={product} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <DemoLinks product={product} />
          <Link
            href={compareHref([product.slug])}
            prefetch={false}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            Сравнить с другими решениями
          </Link>
        </div>
      </section>

      <nav aria-label="Группы характеристик" className="flex flex-wrap gap-x-4 gap-y-1 border-y py-2 text-sm">
        {CHAR_GROUP_ORDER.map((g) => (
          <a key={g} href={`#${groupAnchor(g)}`} className="text-primary underline-offset-2 hover:underline">
            {CHAR_GROUP_LABELS[g]}
          </a>
        ))}
      </nav>

      {CHAR_GROUP_ORDER.map((g) => (
        <GroupSection key={g} group={g} rows={product.characteristics[g]}>
          {g === "DATA_QUALITY" ? <DataQualitySummary product={product} /> : null}
        </GroupSection>
      ))}

      <p className="border-t pt-4 text-xs text-muted-foreground">
        Характеристики — справочные данные каталога. Перед закупкой значения нужно подтвердить у производителя и
        проверить на объекте.
      </p>
    </div>
  );
}
