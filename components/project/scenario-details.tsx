"use client";

import { pluralRu } from "@/lib/format/plural";
import { formatRub } from "@/lib/format/rub";
import { fx, share } from "@/lib/tz/econ/text";
import { DEFAULT_NORMS, type NormValues } from "@/lib/tz/norms";
import { processDef } from "@/lib/tz/processes";
import type { ItemResult, ProductForCalc, ScenarioItem, ScenarioKind, ScenarioResult, ScenarioSpec } from "@/lib/tz/types";
import { CashflowTable } from "./cashflow-table";
import { LineItems } from "./line-items";
import { OverrideInput } from "./override-input";
import { RefusalNote } from "./refusal-note";
import { TraceList } from "./trace-list";

/**
 * Подробности сценария (ТЗ §2.2 шаг 5, §3.5.2–3.5.4, §3.5.8): состав парка и как он получен,
 * ручные корректировки авто-значений, CAPEX и OPEX по статьям, денежный поток и трассировка
 * «Как посчитано».
 *
 * Корректировки уходят наверх через `onOverride(field, value, reason)`. `field` — в формате
 * журнала PendingChange: 'item:<процесс>:quantity|price|throughput|service|raasRate', плюс
 * 'item:<процесс>:raasEstimate' — кнопка «Подставить оценку»: `value` — уже посчитанная ставка,
 * ₽/мес за робота (цена × норматив raasMonthlyPctOfPrice, до рубля); рабочая область ставит
 * raasRubMonthOverride = value и raasFromEstimate = true и пишет в журнал поле
 * 'item:<процесс>:raasRate' с этой причиной. `value = null` — вернуть расчётное.
 *
 * Ставка, подставленная оценкой (`raasFromEstimate`), помечена не «задано вами», а «оценка
 * 5,2 % цены»: движок считает эту статью оценкой, и экран не приписывает число пользователю.
 * Ручной ввод ставки ('item:<процесс>:raasRate' с числом) или «вернуть расчётное» должны
 * сбросить raasFromEstimate в рабочей области — иначе ручная ставка осталась бы «оценкой».
 */

export type ItemOverrideKind = "quantity" | "price" | "throughput" | "service" | "raasRate" | "raasEstimate";

/** Поле корректировки позиции в формате журнала: 'item:<процесс>:<вид>'. */
export function itemOverrideField(process: string, kind: ItemOverrideKind): string {
  return `item:${process}:${kind}`;
}

/** Разбор поля 'item:<процесс>:<вид>'; null — не поле позиции. */
export function parseItemOverrideField(field: string): { process: string; kind: ItemOverrideKind } | null {
  const m = /^item:([^:]+):(quantity|price|throughput|service|raasRate|raasEstimate)$/.exec(field);
  return m && m[1] && m[2] ? { process: m[1], kind: m[2] as ItemOverrideKind } : null;
}

export const KIND_LABELS: Readonly<Record<ScenarioKind, string>> = {
  asis: "Как есть (текущий процесс)",
  purchase: "Покупка оборудования",
  raas: "Услуга (RaaS, подписка)",
};

/** Короткая единица потока: «паллет/сут» → «пал./сут». */
export function shortUnit(unit: string): string {
  return unit.replace(/^паллет\//, "пал./");
}

/** Расчётная производительность без ручной корректировки: min(норма; цикл) из известных. */
export function autoThroughput(r: Pick<ItemResult, "thrNorm" | "thrCycle">): number | null {
  const known = [r.thrNorm, r.thrCycle].filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  return known.length === 0 ? null : Math.min(...known);
}

/** Строки карточки парка позиции (ТЗ §3.5.2: число роботов = пиковая потребность / производительность). */
export function fleetCardLines(r: ItemResult): string[] {
  const p = processDef(r.process);
  const du = shortUnit(p?.demandUnit ?? "ед./сут");
  const tu = shortUnit(p?.throughputUnit ?? "ед./ч");
  const lines: string[] = [];
  lines.push(
    `Спрос: ${fx(r.demandPerDay)} ${du} → ${fx(r.avgPerHour, 1)} ${tu} в среднем, ${fx(r.peakPerHour, 1)} ${tu} в пик`,
  );
  const norm = r.thrNorm === null ? "норма — нет или неприменима" : `норма ${fx(r.thrNorm, 1)}`;
  const leg = r.routeLoadedM === null ? "" : ` (плечо ${fx(r.routeLoadedM, 1)} м, оценка по планировке)`;
  const cycle = r.thrCycle === null ? "по циклу — нет данных" : `по циклу ${fx(r.thrCycle, 1)}${leg}`;
  const eff = r.thrEff === null ? "принято — нет" : `принято ${fx(r.thrEff, 1)} ${tu}${r.thrSource ? ` (${r.thrSource})` : ""}`;
  lines.push(`Производительность: ${norm} · ${cycle} · ${eff}`);
  if (r.n !== null) {
    const exact = r.nExact === null ? null : `⌈${fx(r.nExact, 2)}⌉ = ${r.nAuto ?? "—"}`;
    lines.push(
      r.nOverridden
        ? `Роботов: ${r.n} — задано вами${exact ? ` (расчёт: ${exact})` : ""}`
        : `Роботов: ${exact ?? r.n}`,
    );
  }
  lines.push(`Охват спроса: ${fx(r.coverage * 100, 1)} %`);
  lines.push(`Зарядных станций: ${r.chargers}`);
  lines.push(`Постов диспетчера парка: ${r.operatorPosts}`);
  lines.push(`Высвобождается ставок: ${fx(r.releasedFte, 1)} из ${fx(r.headcount)}`);
  return lines;
}

type ItemView = {
  process: string;
  productSlug: string;
  productName: string;
  result?: ItemResult;
  spec?: ScenarioItem;
  product?: ProductForCalc;
};

function itemViews(result: ScenarioResult, spec: ScenarioSpec | undefined, products?: Readonly<Record<string, ProductForCalc>>): ItemView[] {
  if (spec && spec.items.length > 0) {
    return spec.items.map((it) => {
      const r = result.items.find((x) => x.process === it.process);
      const product = products?.[it.productSlug];
      return {
        process: it.process,
        productSlug: it.productSlug,
        productName: r?.productName ?? product?.name ?? it.productSlug,
        result: r,
        spec: it,
        product,
      };
    });
  }
  return result.items.map((r) => ({
    process: r.process,
    productSlug: r.productSlug,
    productName: r.productName,
    result: r,
    product: products?.[r.productSlug],
  }));
}

const BUTTON_CLASS =
  "rounded-md border border-input px-2.5 py-1.5 text-sm transition-colors hover:bg-accent " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50";

function ItemCard({
  view,
  kind,
  refusedRaas,
  norms,
  editable,
  onOverride,
}: {
  view: ItemView;
  kind: ScenarioKind;
  refusedRaas: boolean;
  norms: NormValues;
  editable: boolean;
  onOverride?: (field: string, value: number | null, reason?: string) => void;
}) {
  const { result: r, spec: it, product } = view;
  const p = processDef(view.process);
  const tu = shortUnit(p?.throughputUnit ?? "ед./ч");
  const price = it?.priceRubOverride ?? product?.priceRub ?? null;
  const serviceAuto =
    product?.serviceRubYear ?? (price !== null ? norms.servicePctOfPriceYear * price : null);
  const pct = norms.raasMonthlyPctOfPrice;
  const change = (k: ItemOverrideKind) => (v: number | null, reason?: string) =>
    onOverride?.(itemOverrideField(view.process, k), v, reason);

  // Поля корректировок. В режиме чтения показываются только заданные вручную значения.
  const fields: {
    k: ItemOverrideKind;
    label: string;
    unit: string;
    auto: number | null;
    value: number | undefined;
    integer?: boolean;
    minInclusive?: boolean;
    /** Бейдж заданного значения вместо «задано вами». */
    badge?: string;
  }[] = [
    {
      k: "quantity",
      label: "Количество роботов",
      unit: "шт.",
      auto: r?.nAuto ?? null,
      value: it?.quantityOverride ?? (r?.nOverridden && r.n !== null ? r.n : undefined),
      integer: true,
    },
    {
      k: "throughput",
      label: `Производительность, ${tu}`,
      unit: tu,
      auto: r ? autoThroughput(r) : null,
      value: it?.throughputPerHOverride ?? (r?.thrSource === "задано вами" && r.thrEff !== null ? r.thrEff : undefined),
    },
  ];
  if (kind === "purchase") {
    fields.push(
      {
        k: "price",
        label: "Цена робота, ₽",
        unit: "₽",
        auto: product?.priceRub ?? null,
        value: it?.priceRubOverride,
      },
      {
        k: "service",
        label: "Сервис, ₽/год за робота",
        unit: "₽/год",
        auto: serviceAuto,
        value: it?.serviceRubYearOverride,
        minInclusive: true,
      },
    );
  }
  if (kind === "raas") {
    fields.push({
      k: "raasRate",
      label: "Ставка RaaS, ₽/мес за робота",
      unit: "₽/мес",
      auto: product?.raasRubMonth ?? null,
      value: it?.raasRubMonthOverride,
      badge: it?.raasFromEstimate ? `оценка ${share(pct)} цены` : undefined,
    });
  }
  const shown = editable ? fields : fields.filter((f) => f.value !== undefined);

  return (
    <div className="flex flex-col gap-3 rounded-md border px-3 py-3">
      <p className="text-sm font-semibold">
        {view.productName}
        {p && <span className="font-normal text-muted-foreground"> · {p.name}</span>}
        {(it?.manuallyAdded || r?.manuallyAdded) && (
          <span className="ml-2 text-caution" title="Добавлено вручную, хотя подбор исключил решение">
            ⚠ добавлено вручную
          </span>
        )}
      </p>
      {it?.manuallyAdded && it.manualReason && (
        <p className="text-xs text-muted-foreground">Причина ручного добавления: {it.manualReason}</p>
      )}
      {r ? (
        <ul className="flex flex-col gap-0.5 text-sm tabular-nums">
          {fleetCardLines(r).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Парк не рассчитан: расчёт остановился раньше (см. причину выше).</p>
      )}
      {it?.raasFromEstimate && (
        <p className="rounded-md border border-caution/40 bg-caution/10 px-3 py-1.5 text-xs">
          Ставка RaaS — оценка {share(pct)} цены робота в месяц, а не тариф производителя: запросите коммерческое
          предложение.
        </p>
      )}
      {shown.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((f) => (
            <OverrideInput
              key={f.k}
              label={f.label}
              unit={f.unit}
              auto={f.auto}
              value={f.value}
              integer={f.integer}
              minInclusive={f.minInclusive}
              badge={f.badge}
              format={(n) => (f.unit.startsWith("₽") ? fx(n, 0) : fx(n))}
              readOnly={!editable}
              onChange={editable ? change(f.k) : undefined}
            />
          ))}
        </div>
      )}
      {editable && kind === "raas" && refusedRaas && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={price === null}
            onClick={() => {
              if (price === null) return;
              change("raasEstimate")(Math.round(price * pct), `оценка ${share(pct)} цены в месяц`);
            }}
          >
            Подставить оценку ({share(pct)} цены в месяц)
          </button>
          <span className="text-xs text-muted-foreground">
            {price === null
              ? "Цена робота неизвестна — оценку не из чего считать; укажите ставку вручную."
              : `${formatRub(price)} × ${share(pct)} = ${formatRub(Math.round(price * pct))}/мес за робота; сценарий получит риск «ставка — оценка».`}
          </span>
        </div>
      )}
    </div>
  );
}

export function ScenarioDetails({
  result,
  spec,
  products,
  norms = DEFAULT_NORMS,
  horizonYears,
  paramLabels,
  readOnly = false,
  print = false,
  onOverride,
}: {
  result: ScenarioResult;
  /** Описание сценария — источник текущих ручных корректировок (цена, сервис, ставка). */
  spec?: ScenarioSpec;
  /** Снимки продуктов — источник авто-значений цены, сервиса и ставки. */
  products?: Readonly<Record<string, ProductForCalc>>;
  /** Нормативы расчёта (ProjectResults.normsUsed): доля сервиса, оценка ставки RaaS. */
  norms?: NormValues;
  /** Горизонт расчёта H — годы после него в денежном потоке входят только в TCO. */
  horizonYears?: number;
  /** Подписи параметров объекта — для полей отказа 'param:<ключ>'. */
  paramLabels?: Readonly<Record<string, string>>;
  readOnly?: boolean;
  /** Вариант для отчёта: без полей ввода, трассировка раскрыта. */
  print?: boolean;
  onOverride?: (field: string, value: number | null, reason?: string) => void;
}) {
  const editable = !print && !readOnly && onOverride !== undefined;
  const views = result.kind === "asis" ? [] : itemViews(result, spec, products);
  const refusedRaas = result.status === "refused" && result.refusal.reason === "raas_rate_required";
  const trace = result.trace;

  return (
    <article aria-label={result.name} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{result.name}</h3>
        <span className="text-xs text-muted-foreground">{KIND_LABELS[result.kind]}</span>
      </header>

      {result.status === "refused" && (
        <RefusalNote refusal={result.refusal} paramLabels={paramLabels} actionable={editable} />
      )}

      {views.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold">Состав оборудования и как он получен</h4>
          {views.map((v) => (
            <ItemCard
              key={v.process}
              view={v}
              kind={result.kind}
              refusedRaas={refusedRaas}
              norms={norms}
              editable={editable}
              onOverride={onOverride}
            />
          ))}
        </div>
      )}

      {result.status === "ok" && (
        <>
          {result.kind !== "asis" && (
            <LineItems
              title="CAPEX по статьям"
              lines={result.capexLines}
              total={result.capexRub}
              totalLabel="CAPEX, итого"
              print={print}
            />
          )}
          <LineItems
            title="OPEX за год по статьям"
            lines={result.opexLines}
            total={result.opexYearRub}
            totalLabel="OPEX за год, итого"
            print={print}
          />
          <CashflowTable rows={result.cashflows} horizonYears={horizonYears} print={print} />
        </>
      )}

      {print ? (
        <TraceList steps={trace} title="Как посчитано" print />
      ) : (
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Как посчитано ({trace.length} {pluralRu(trace.length, ["шаг", "шага", "шагов"])})</summary>
          <div className="mt-3">
            <TraceList steps={trace} />
          </div>
        </details>
      )}
    </article>
  );
}
