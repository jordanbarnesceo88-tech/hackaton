import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ProductCharacteristic } from "@prisma/client";
import { ChangeTable } from "@/components/admin/change-table";
import { CharacteristicRow } from "@/components/admin/characteristic-row";
import {
  LEVEL_HINTS,
  LEVEL_LABELS,
  PRODUCT_ORIGIN_LABELS,
  STATUS_LABELS,
  charEditorValues,
} from "@/components/admin/format";
import { ProductActions } from "@/components/admin/product-actions";
import { ProductForm } from "@/components/admin/product-form";
import { CHIP_CLASS } from "@/components/admin/styles";
import { SourceBadge } from "@/components/project/source-badge";
import { requireAdmin } from "@/lib/auth/guards";
import { isoDate } from "@/lib/catalog/product-for-calc";
import type { CharRow } from "@/lib/catalog/product-for-calc";
import { verificationReasons } from "@/lib/catalog/promote";
import { getCatalogProduct } from "@/lib/catalog/queries";
import type { CatalogCharacteristic } from "@/lib/catalog/queries";
import { catalogProduct } from "@/lib/data/organizer/catalog";
import { prisma } from "@/lib/db/client";
import { formatNum, formatRub } from "@/lib/format/rub";
import { CHARACTERISTIC_KEYS, CHAR_GROUP_LABELS } from "@/lib/tz/characteristics";
import type { CharGroup, CharKey } from "@/lib/tz/characteristics";
import { cn } from "@/lib/utils";
import { loadChangeEntries } from "../../_lib/changes";

export const metadata = { title: "Карточка продукта — администрирование — Платформа оценки роботизации" };

/** Строка характеристики из БД → CharRow (для причин «требует проверки»). */
function toCharRow(c: ProductCharacteristic): CharRow {
  return {
    key: c.key,
    valueNum: c.valueNum,
    valueMin: c.valueMin,
    valueMax: c.valueMax,
    qualifier: c.qualifier,
    valueText: c.valueText,
    valueList: c.valueList,
    unit: c.unit,
    scope: c.scope,
    origin: c.origin,
    sourceUrl: c.sourceUrl,
    sourceRef: c.sourceRef,
    verifiedAt: isoDate(c.verifiedAt),
    confirmed: c.confirmed,
    alternatives: c.alternatives,
  };
}

/** Ключи словаря по группам ТЗ §3.3.4 в порядке словаря. */
const KEYS_BY_GROUP: Readonly<Record<CharGroup, CharKey[]>> = (() => {
  const out = Object.fromEntries(Object.keys(CHAR_GROUP_LABELS).map((g) => [g, [] as CharKey[]])) as Record<
    CharGroup,
    CharKey[]
  >;
  for (const key of Object.keys(CHARACTERISTIC_KEYS) as CharKey[]) out[CHARACTERISTIC_KEYS[key].group].push(key);
  return out;
})();

/** Значение характеристики с источником — то, что видно в строке до «Изменить». */
function CharValue({ c }: { c: CatalogCharacteristic }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm tabular-nums">{c.display}</span>
        <SourceBadge
          origin={c.origin}
          sourceUrl={c.sourceUrl}
          sourceRef={c.sourceRef}
          date={c.verifiedAt}
          confirmed={c.confirmed}
          note={c.basis ?? c.note}
        />
        {c.hasConflict && (
          <span className={cn(CHIP_CLASS, "border-caution/40 bg-caution/10")}>⚠ источники расходятся</span>
        )}
      </div>
      {c.asInSource && (
        <p className="text-xs text-muted-foreground">
          Как в источнике: «{c.asInSource.length > 200 ? `${c.asInSource.slice(0, 199)}…` : c.asInSource}»
        </p>
      )}
      {c.alternatives.length > 0 && (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer text-muted-foreground underline underline-offset-2">
            Другие найденные значения: {c.alternatives.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pl-4">
            {c.alternatives.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{a.value}</span>
                <SourceBadge
                  origin={a.origin}
                  sourceUrl={a.sourceUrl}
                  sourceRef={a.sourceRef}
                  date={a.date}
                  confirmed={a.confirmed}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Карточка продукта для администратора (ТЗ §3.3.4 — характеристики по шести группам с
 * источником, датой и подтверждением; §3.3.5 — правка каталога): идентификация, все ключи
 * словаря характеристик (отсутствующие можно заполнить), вынесенные колонки и причины
 * «требует проверки», архив, возврат данных организатора, удаление и история правок.
 */
export default async function AdminProductPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  await requireAdmin();
  const { slug } = await params;

  const [detail, row, solutionTypes] = await Promise.all([
    getCatalogProduct(prisma, slug),
    prisma.catalogProduct.findUnique({
      where: { slug },
      select: { id: true, flags: true, updatedAt: true, characteristics: true },
    }),
    prisma.solutionType.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!detail || !row) notFound();
  const history = await loadChangeEntries(
    { projectId: null, entity: { in: ["product", "characteristic"] }, entityId: row.id },
    30,
  );
  const reasons = verificationReasons(row.characteristics.map(toCharRow), { flags: row.flags });
  const version = row.updatedAt.toISOString();
  const inOrganizerData = catalogProduct(slug) !== undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/admin/catalog" className="w-fit text-sm text-primary underline underline-offset-2">
          ← К списку каталога
        </Link>
        <h1>{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.manufacturer ?? "производитель не указан"} · <code>{detail.slug}</code>
          {detail.organizerCatalogId ? ` · id каталога организатора ${detail.organizerCatalogId}` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className={cn(CHIP_CLASS, detail.origin === "ADMIN" ? "bg-secondary" : "bg-primary/5")}>
            {PRODUCT_ORIGIN_LABELS[detail.origin]}
          </span>
          <span className={cn(CHIP_CLASS, "bg-muted")} title={LEVEL_HINTS[detail.level]}>
            {LEVEL_LABELS[detail.level]}
          </span>
          <span className={cn(CHIP_CLASS, "bg-muted")}>{STATUS_LABELS[detail.status]}</span>
          {detail.editedByAdmin && detail.origin === "ORGANIZER" && (
            <span className={cn(CHIP_CLASS, "border-caution/40 bg-caution/10")}>правка администратора</span>
          )}
          {detail.archived && <span className={cn(CHIP_CLASS, "bg-muted")}>в архиве</span>}
          {detail.excluded && <span className={cn(CHIP_CLASS, "bg-muted")}>исключён из подбора</span>}
        </div>
        {!detail.archived && (
          <Link
            href={`/catalog/${encodeURIComponent(detail.slug)}`}
            className="w-fit text-sm text-primary underline underline-offset-2"
          >
            Как карточку видят пользователи
          </Link>
        )}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="prod-summary">
        <h2 id="prod-summary" className="text-lg">
          Сводка карточки
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Цена</dt>
            <dd className="tabular-nums">{formatRub(detail.priceRub)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Производительность (в расчёт)</dt>
            <dd className="tabular-nums">
              {detail.throughputPerH !== null
                ? `${formatNum(detail.throughputPerH, 1)} ${detail.throughputUnit ?? ""}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Полнота карточки</dt>
            <dd className="tabular-nums">{detail.completenessPct} %</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Подтверждено первоисточником</dt>
            <dd className="tabular-nums">{detail.confirmedSharePct} % значений</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Колонки пересчитываются из характеристик при каждой правке — руками их не меняют.
        </p>
        {reasons.length > 0 ? (
          <div className="rounded-lg border border-caution/40 bg-caution/5 p-3 text-sm">
            <p className="font-medium">Требует проверки:</p>
            <ul className="list-disc pl-5">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-positive">Проверка не требуется: цена и производительность подтверждены.</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="prod-identity">
        <h2 id="prod-identity" className="text-lg">
          Идентификация
        </h2>
        <ProductForm
          values={{
            slug: detail.slug,
            name: detail.name,
            manufacturer: detail.manufacturer,
            country: detail.country,
            solutionType: detail.solutionType?.slug ?? "",
            status: detail.status,
            excluded: detail.excluded,
            excludedReason: detail.excludedReason,
            archived: detail.archived,
            version,
          }}
          solutionTypes={solutionTypes}
        />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="prod-chars">
        <div className="flex flex-col gap-1">
          <h2 id="prod-chars" className="text-lg">
            Характеристики
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Все ключи словаря ТЗ §3.3.4 по шести группам. Правка ставит значению происхождение «администратор» и
            сохраняется при «Обновить каталог». Новое или изменённое значение можно отметить «Подтверждено» только со
            ссылкой на первоисточник; у подтверждённого значения организатора отметка сохраняется и без ссылки.
            «Дата проверки» и «Подтверждение» в группе «Качество данных» пересчитываются после каждой правки.
          </p>
        </div>
        {(Object.keys(CHAR_GROUP_LABELS) as CharGroup[]).map((group) => {
          const existing = new Map(detail.characteristics[group].map((c) => [c.key, c]));
          const keys: string[] = [
            ...KEYS_BY_GROUP[group],
            ...detail.characteristics[group].map((c) => c.key).filter((k) => !(k in CHARACTERISTIC_KEYS)),
          ];
          return (
            <section key={group} className="rounded-lg border px-4 py-2" aria-labelledby={`grp-${group}`}>
              <h3 id={`grp-${group}`} className="py-2">
                {CHAR_GROUP_LABELS[group]}
              </h3>
              <ul>
                {keys.map((key) => {
                  const c = existing.get(key);
                  const def = (CHARACTERISTIC_KEYS as Record<string, (typeof CHARACTERISTIC_KEYS)[CharKey]>)[key];
                  return (
                    <CharacteristicRow
                      key={key}
                      slug={detail.slug}
                      charKey={key}
                      label={c?.label ?? def?.label ?? key}
                      kind={def?.kind ?? "text"}
                      dictUnit={def?.unit ?? null}
                      required={def?.required ?? false}
                      current={c ? charEditorValues(c) : null}
                      version={version}
                    >
                      {c ? <CharValue c={c} /> : <span className="text-sm text-muted-foreground">нет данных</span>}
                    </CharacteristicRow>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="prod-actions">
        <h2 id="prod-actions" className="text-lg">
          Действия с продуктом
        </h2>
        <ProductActions
          slug={detail.slug}
          origin={detail.origin}
          archived={detail.archived}
          editedByAdmin={detail.editedByAdmin}
          inOrganizerData={inOrganizerData}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="prod-history">
        <h2 id="prod-history" className="text-lg">
          История правок
        </h2>
        <ChangeTable entries={history} caption={`История правок продукта ${detail.name}`} />
      </section>
    </div>
  );
}
