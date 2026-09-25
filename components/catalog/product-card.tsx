import Link from "next/link";
import { SourceBadge } from "@/components/project/source-badge";
import { buttonVariants } from "@/components/ui/button";
import { asQualifier, asScope, compareCharKeys, type CharRow } from "@/lib/catalog/product-for-calc";
import { verificationReasons } from "@/lib/catalog/promote";
import type { CatalogCharacteristic, CatalogProductDetail } from "@/lib/catalog/queries";
import { REQUIRED_CHARACTERISTIC_KEYS } from "@/lib/tz/characteristics";
import { normThroughput } from "@/lib/tz/econ/fleet";
import { processDef, type ProcessDef } from "@/lib/tz/processes";
import type { ProductForCalc } from "@/lib/tz/types";
import { formatNum, formatPct } from "@/lib/format/rub";
import { cn } from "@/lib/utils";
import { fmtValue } from "@/components/project/comparison-table";
import { CompletenessBar } from "./chips";
import { CHAR_GROUP_ORDER, groupStats } from "./group-section";
import { LEVEL_HINTS, NO_DATA } from "./labels";

/**
 * Сводные блоки карточки продукта (ТЗ §3.3.4): ключевые значения с источниками, почему продукт
 * требует проверки, описание из каталога организатора, сводка качества данных и ссылки в демо.
 * Всё считается из той же карточки, что и группы характеристик ниже, — сводка не может
 * разойтись с таблицами.
 */

type Detail = CatalogProductDetail;

/** Все характеристики карточки в порядке групп и словаря. */
export function allCharacteristics(product: Pick<Detail, "characteristics">): CatalogCharacteristic[] {
  return CHAR_GROUP_ORDER.flatMap((g) => product.characteristics[g]);
}

/** Характеристика по ключу; нет — undefined. */
export function findChar(product: Pick<Detail, "characteristics">, key: string): CatalogCharacteristic | undefined {
  return allCharacteristics(product).find((c) => c.key === key);
}

/** Сколько обязательных характеристик ТЗ §3.3.4 заполнено — числитель полноты. */
export function requiredFilled(product: Pick<Detail, "characteristics">): { filled: number; required: number } {
  let filled = 0;
  for (const g of CHAR_GROUP_ORDER) filled += groupStats(g, product.characteristics[g]).filled;
  return { filled, required: REQUIRED_CHARACTERISTIC_KEYS.length };
}

/**
 * Почему продукт «требует проверки» — те же правила, по которым синхронизация ставит колонку
 * needsVerification (`verificationReasons` из lib/catalog/promote): пометки качества, цена и
 * производительность, полнота, расхождения источников. Расхождения берутся из готового признака
 * `hasConflict` характеристики: альтернативы в карточке уже разобраны для показа.
 */
export function cardVerificationReasons(product: Pick<Detail, "characteristics" | "flags">): string[] {
  const all = allCharacteristics(product);
  const rows: CharRow[] = all.map((c) => ({ ...c, alternatives: [] }));
  const reasons = verificationReasons(rows, { flags: product.flags });
  const conflicts = all
    .filter((c) => c.hasConflict)
    .sort((a, b) => compareCharKeys(a.key, b.key))
    .map((c) => c.label);
  const unique = [...new Set(conflicts)];
  if (unique.length > 0) reasons.push(`источники расходятся: ${unique.join(", ")}`);
  return reasons;
}

/** Поля продукта, по которым решается, входит ли он в подбор. */
export type ParticipationInput = Pick<Detail, "archived" | "level" | "excluded" | "excludedReason"> & {
  processes: readonly { slug: string }[];
};

/** Участвует ли продукт в подборе; `reason` — почему нет (без точки в конце), `text` — «да» или «нет: …». */
export type Participation = { ok: boolean; reason: string | null; text: string };

/**
 * Участвует ли продукт в подборе — по тем же условиям, по которым `getCalcProducts`
 * (lib/catalog/queries) отдаёт продукты в подбор: не в архиве, описан глубже идентификации и
 * привязан хотя бы к одному процессу модели. Исключённый продукт подбор показывает только с
 * причиной исключения, поэтому для каталога он тоже «нет». «Да» не значит, что продукт подходит
 * объекту: это решает подбор по параметрам объекта.
 */
export function selectionParticipation(p: ParticipationInput): Participation {
  let reason: string | null = null;
  if (p.archived) reason = "в архиве";
  else if (p.level === "identification") reason = "только идентификация — технических характеристик с источниками нет";
  else if (p.excluded) reason = (p.excludedReason ?? "").trim().replace(/[.\s]+$/u, "") || "исключён, причина не указана";
  else if (p.processes.length === 0) reason = "не привязан ни к одному процессу модели";
  return reason === null ? { ok: true, reason: null, text: "да" } : { ok: false, reason, text: `нет: ${reason}` };
}

/** Поля продукта для пояснения к производительности. */
type ThroughputNoteInput = ParticipationInput &
  Pick<Detail, "throughputPerH" | "throughputUnit"> & { solutionType: { mobile: boolean } | null };

/** «процесса «А»» или «процессов «А», «Б»» — для пояснений. */
function processesPhrase(processes: readonly { name: string }[]): string {
  const names = processes.map((p) => `«${p.name}»`).join(", ");
  return processes.length === 1 ? `процесса ${names}` : `процессов ${names}`;
}

/**
 * Как паспортная производительность используется в расчёте парка. Правила — те же, что у
 * движка: норма проходит `normThroughput` (lib/tz/econ/fleet: на робота или станцию, в единицах
 * процесса, не «до X»), экономика считается только для процессов с `calcSupported`, а у
 * мобильного робота в процессе с имитацией в расчёт идёт меньшее из нормы и цикла по планировке
 * объекта (`throughputFor`). Поэтому карточка не называет паспортную норму числом расчёта: на
 * демо-складе цикл H1500 меньше нормы, и парк считается по циклу.
 * Продукт вне подбора — пояснения нет: его цифры в расчёт не попадают вовсе.
 */
export function throughputCalcNote(product: ThroughputNoteInput, c: CatalogCharacteristic | undefined): string | null {
  if (!selectionParticipation(product).ok) return null;
  if (product.throughputPerH === null) {
    if (!c || c.display === "—") return null;
    if (c.valueNum === null) return "в расчёт парка не идёт: числа для расчёта нет";
    if (c.qualifier === "до" && c.valueMin === null) return "в расчёт парка не идёт: указан только предел «до», а не типичное значение";
    if (c.scope === "per-fleet") return "в расчёт парка не идёт: значение на весь парк, а не на одного робота";
    return null;
  }

  const defs = product.processes.map((p) => processDef(p.slug)).filter((d): d is ProcessDef => d !== undefined);
  const calcDefs = defs.filter((d) => d.calcSupported);
  if (calcDefs.length === 0) {
    return defs.length === 0 ? null : `в расчёт парка не идёт: экономика ${processesPhrase(defs)} в прототипе не рассчитывается`;
  }

  const view = {
    throughputPerH: product.throughputPerH,
    throughputUnit: product.throughputUnit,
    throughputScope: asScope(c?.scope),
    throughputQualifier: asQualifier(c?.qualifier),
  } satisfies Pick<ProductForCalc, "throughputPerH" | "throughputUnit" | "throughputScope" | "throughputQualifier">;
  // normThroughput читает у продукта только эти четыре поля.
  const checks = calcDefs.map((d) => ({ def: d, norm: normThroughput(view as ProductForCalc, d) }));
  const accepted = checks.find((x) => x.norm.value !== null);
  if (accepted && accepted.norm.value !== null) {
    const unit = product.throughputUnit ? ` ${product.throughputUnit}` : "";
    const per = view.throughputScope === "per-station" ? "на станцию" : "на робота";
    const rule =
      accepted.def.simSupported && product.solutionType?.mobile === true
        ? "в расчёте берётся меньшее из нормы и цикла по планировке объекта"
        : "цикл по планировке для него не считается, парк считается по норме";
    return `норма для расчёта парка: ${fmtValue(accepted.norm.value)}${unit} ${per}; ${rule}`;
  }
  const skipped = checks.map((x) => x.norm.skipped).find((r) => r !== null);
  return skipped ? `в расчёт парка не идёт: ${skipped}` : null;
}

/** Ключевое значение со ссылкой на его характеристику. */
function Fact({ label, c, extra }: { label: string; c: CatalogCharacteristic | undefined; extra?: string | null }) {
  const empty = !c || c.display === "—";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm", empty ? "text-muted-foreground" : "font-semibold")}>{empty ? NO_DATA : c.display}</dd>
      {extra && <dd className="text-[11px] text-muted-foreground">{extra}</dd>}
      {c && !empty && (
        <dd>
          <SourceBadge
            origin={c.origin}
            sourceUrl={c.sourceUrl}
            sourceRef={c.sourceRef}
            date={c.verifiedAt}
            confirmed={c.confirmed}
            note={c.basis}
          />
        </dd>
      )}
    </div>
  );
}

/** Ключевые значения карточки: цена, аренда, производительность, грузоподъёмность, скорость. */
export function KeyFacts({ product }: { product: Detail }) {
  const throughput = findChar(product, "throughput");
  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <Fact label="Цена оборудования" c={findChar(product, "priceRub")} />
      <Fact label="Ставка RaaS (аренда)" c={findChar(product, "raasRubMonth")} />
      <Fact label="Производительность" c={throughput} extra={throughputCalcNote(product, throughput)} />
      <Fact label="Грузоподъёмность" c={findChar(product, "payloadKg")} />
      <Fact label="Скорость" c={findChar(product, "speedMps")} />
    </dl>
  );
}

/** Блок «требует проверки» с причинами; проверка не нужна — ничего. */
export function VerificationNotice({ product }: { product: Detail }) {
  if (!product.needsVerification) return null;
  const reasons = cardVerificationReasons(product);
  return (
    <div className="rounded-lg border border-caution/40 bg-caution/10 px-4 py-3 text-sm">
      <p className="font-medium">Требует проверки перед использованием в расчёте</p>
      {reasons.length > 0 ? (
        <ul className="mt-1 grid gap-0.5 pl-5">
          {reasons.map((r) => (
            <li key={r} className="list-disc">
              {r}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">Пометка поставлена при синхронизации каталога.</p>
      )}
    </div>
  );
}

/** Источник описания продукта: каталог организатора или правка администратора. */
export function descriptionSourceRef(product: Pick<Detail, "origin" | "organizerCatalogId">): string {
  if (product.origin === "ADMIN") return "добавлено администратором";
  return product.organizerCatalogId ? `каталог организатора › id ${product.organizerCatalogId}` : "каталог организатора";
}

/** Описание продукта (не длиннее 200 знаков) с бейджем источника. */
export function ProductDescription({ product }: { product: Detail }) {
  const text = product.description.trim();
  if (text === "") return null;
  return (
    <div className="flex max-w-4xl flex-col items-start gap-1">
      <p className="text-sm">{text}</p>
      <SourceBadge
        origin={product.origin === "ADMIN" ? "admin" : "organizer"}
        sourceRef={descriptionSourceRef(product)}
      />
    </div>
  );
}

/** Дата обновления карточки по-русски. */
const UPDATED_AT = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" });

/**
 * Строка «Участие в подборе» сводки качества: «нет» с причиной или «да» с процессами, для
 * которых продукт попадает в подбор, и оговоркой, что пригодность для объекта решает подбор.
 */
export function participationSummary(product: ParticipationInput & { processes: readonly { name: string }[] }): string {
  const part = selectionParticipation(product);
  if (!part.ok) return part.text;
  return `да — входит в подбор для ${processesPhrase(product.processes)}; подходит ли продукт объекту, решает подбор по параметрам объекта`;
}

/** Сводка группы «Качество данных»: полнота, подтверждение, глубина описания, участие в подборе, происхождение карточки. */
export function DataQualitySummary({ product }: { product: Detail }) {
  const { filled, required } = requiredFilled(product);
  const conflicts = allCharacteristics(product).filter((c) => c.hasConflict).length;
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">Полнота карточки</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <CompletenessBar pct={product.completenessPct} />
          <span className="text-xs text-muted-foreground">
            заполнено {formatNum(filled)} из {formatNum(required)} обязательных характеристик
          </span>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Подтверждено первоисточником</dt>
        <dd>
          <span className="font-medium tabular-nums">{formatPct(product.confirmedSharePct)}</span>
          <span className="text-xs text-muted-foreground"> заполненных значений</span>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Расхождения источников</dt>
        <dd>{conflicts === 0 ? "нет" : `${formatNum(conflicts)} — отмечены ⚠ в таблицах`}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Требует проверки</dt>
        <dd>{product.needsVerification ? "да — причины в начале карточки" : "нет"}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted-foreground">Глубина описания</dt>
        <dd>{LEVEL_HINTS[product.level]}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted-foreground">Участие в подборе</dt>
        <dd>{participationSummary(product)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted-foreground">Происхождение карточки</dt>
        <dd>
          {product.origin === "ADMIN" ? "добавлена администратором" : "каталог организатора"}
          {product.organizerRows.length > 0 && ` · строки кураторского свода ${product.organizerRows.join(", ")}`}
          {product.editedByAdmin && " · правилась администратором"}
          {` · версия данных ${product.dataVersion || "—"} · обновлена ${UPDATED_AT.format(product.updatedAt)}`}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Подпись ссылки в демо-расчёт для типа объекта. Глагол подобран так, чтобы не совпасть с
 * подписями кнопок, которые e2e v1 ищут строго (список — в плане, раздел «Страницы и UX»).
 */
export function demoLinkText(facilitySlug: string, facilityName: string): string {
  return facilitySlug === "warehouse" ? "Открыть в демо-расчёте склада" : `Открыть демо для объекта «${facilityName}»`;
}

/**
 * Ссылки в гостевой демо-расчёт (/demo) по типам объектов продукта. Продукт, который в подбор
 * не входит (`selectionParticipation`), ссылки не получает — вместо неё причина.
 */
export function DemoLinks({ product }: { product: Detail }) {
  const part = selectionParticipation(product);
  if (!part.ok) {
    return <p className="text-sm text-muted-foreground">В подбор демо-расчёта продукт не входит: {part.reason}.</p>;
  }
  const facilities = product.facilityTypes.filter((f) => ["warehouse", "airport", "medical"].includes(f.slug));
  if (facilities.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {facilities.map((f) => (
        <Link
          key={f.slug}
          href={`/demo?facility=${encodeURIComponent(f.slug)}`}
          prefetch={false}
          className={cn(buttonVariants({ variant: f.slug === "warehouse" ? "default" : "outline", size: "lg" }), "px-4")}
        >
          {demoLinkText(f.slug, f.name)}
        </Link>
      ))}
    </div>
  );
}
