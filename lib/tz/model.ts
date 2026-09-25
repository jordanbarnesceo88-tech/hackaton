import { ORGANIZER_DATA_VERSION } from "../data/organizer/version.generated";
import { pluralRu } from "../format/plural";
import { handlingSecFor, toSimInput, type SimProvenance } from "../sim/adapter";
import { cycleThroughputPerH, expectedLegsM, type ExpectedLegs } from "../sim/analytic";
import { BOTTLENECK_LABELS } from "../sim/export-rows";
import { LAYOUT_LIMITS, buildWarehouseLayout, isWarehouseLike } from "../sim/layout";
import {
  SIM_MODEL_VERSION,
  type SimInput,
  type SimLayout,
  type SimLayoutParams,
  type SimSummaryStored,
} from "../sim/types";
import {
  buildConclusion,
  chargersNeeded,
  computeScenarios,
  computeScenariosCore,
  normsForSpec,
  sizeFleet,
  sortRisks,
  throughputFor,
  toNumber,
  type CycleInfo,
  type ScenarioContext,
} from "./econ";
import { fx, q, unitShort } from "./econ/text";
import type { NormValues } from "./norms";
import { applyDefaults } from "./params/schema";
import { validateParamValues } from "./params/validate";
import { processesForFacility, type ProcessDef } from "./processes";
import { relevantProducts, selectProducts, type SelectionEcon } from "./selection";
import type {
  ComparisonRow,
  Conclusion,
  ParamIssue,
  ParamSpec,
  ParamValues,
  ProductForCalc,
  ProjectResults,
  Risk,
  ScenarioItem,
  ScenarioOk,
  ScenarioRefused,
  ScenarioResult,
  ScenarioSpec,
  SelectionResult,
  SelectionStatus,
} from "./types";
import { TZ_MODEL_VERSION, dataVersionOf } from "./version";

/**
 * Сборка модели проекта tz-1.0.0: параметры объекта → проверка → планировка и цикл → подбор
 * решений → экономика сценариев → сравнение → входы имитации → риски имитации → вывод →
 * снимки и версии. Чистая функция без React, Prisma, часов и случайности: её вызывают сервер
 * (сохранение проекта, API, печать демо-чисел) и браузер (кнопка «Пересчитать» в рабочей
 * области), и одинаковый вход даёт одинаковый результат бит-в-бит — условие
 * воспроизводимости ТЗ §3.1.5.
 *
 * Производительность по циклу считается по той же планировке, что и имитация
 * (lib/sim/layout + lib/sim/analytic), поэтому расчёт и 2D-визуализация согласованы (§3.6.2).
 * Сами прогоны имитации здесь не выполняются: их запускает сервер (lib/projects/recalc) или
 * браузер, а сюда возвращаются сводки (`sims`), из которых добавляются риски SIM_*.
 *
 * Подбор выполняется ДО экономики: решение, которое подбор исключил жёстким правилом (ТЗ
 * §3.4), не может попасть в сценарий «молча». Такая позиция помечается как добавленная
 * вручную (риск MANUAL_ADD, значок ⚠ в сравнении и отчёте), а сценарий с ней не
 * рекомендуется — что бы ни прислал клиент.
 */

/** Вход сборки модели. */
export type BuildProjectModelInput = {
  /** Slug типа объекта: warehouse, airport, medical. */
  facility: string;
  /** Значения параметров объекта (введённые или сохранённые). */
  params: ParamValues;
  /** Описания параметров объекта (из БД или кода) — проверка, умолчания, границы, подписи. */
  paramDefs: readonly ParamSpec[];
  scenarios: readonly ScenarioSpec[];
  /** Продукты для подбора и расчёта (живой каталог или снимки проекта). */
  products: readonly ProductForCalc[];
  /** Итоговые нормативы (`resolveNorms`). */
  norms: NormValues;
  /** Сводки имитации по ключу сценария — для рисков SIM_NOT_CONFIRMED и SIM_OVERSIZED. */
  sims?: Readonly<Record<string, SimSummaryStored | null>>;
};

/**
 * Входы имитации сценария: парк по расчёту (или ручной) и парк по паспортной норме
 * организатора. null — имитация для сценария не выполняется (нет робота на процессе с
 * имитацией, сценарий не рассчитан, не хватает данных). `assumedUtilPct` — загрузка,
 * заложенная в расчёт парка, % (для сравнения с загрузкой по имитации); `provenance` —
 * «Откуда параметры» имитации по расчётному парку (адаптер toSimInput).
 */
export type ScenarioSimInputs = {
  calculated: SimInput | null;
  byNorm: SimInput | null;
  assumedUtilPct: number | null;
  provenance: SimProvenance[] | null;
};

/**
 * Модель проекта: всё, что сохраняется в Project.results, кроме момента расчёта и сводок
 * имитации, плюс планировка для схемы и входы имитации по сценариям.
 */
export type ProjectModel = Omit<ProjectResults, "calculatedAt" | "sim"> & {
  layout: SimLayout | null;
  simInputs: Record<string, ScenarioSimInputs>;
};

/** Зерно генератора имитации для прогонов проекта: «Перезапуск» воспроизводит тот же поток. */
export const PROJECT_SIM_SEED = 1;

/**
 * Хвост причины ручного добавления, которую поставила платформа, а не пользователь: решение
 * исключено подбором, а в сценарии оно без пометки «добавлено вручную». По хвосту отметка
 * узнаётся при следующем расчёте и снимается, если продукт снова проходит подбор (например,
 * после правки параметров объекта). Причину, написанную пользователем, платформа не трогает.
 */
export const AUTO_MANUAL_SUFFIX = " [отмечено автоматически]";

/** Наибольшая длина текста причины в автоматической отметке (без хвоста), символов. */
const AUTO_REASON_MAX = 300;

/** Ключи параметров объекта, из которых строится планировка склада. */
const LAYOUT_KEYS = {
  activeAreaM2: "activeAreaM2",
  mainAisleWidthM: "mainAisleWidthM",
  rackAisleWidthM: "rackAisleWidthM",
  receivingDocksCount: "receivingDocksCount",
  shippingDocksCount: "shippingDocksCount",
} as const;

/**
 * Поля описания параметра, от которых зависит расчёт: проверка (вид, единица, варианты,
 * границы, фиксация, обязательность), умолчания (base), границы чувствительности (min/max) и
 * подписи в сообщениях. Подсказки, примеры и источники на числа не влияют и в версию не входят.
 */
function paramDefsDigest(defs: readonly ParamSpec[]): unknown[] {
  return [...defs]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((d) => ({
      key: d.key,
      label: d.label,
      unit: d.unit ?? null,
      kind: d.kind,
      options: [...(d.options ?? [])],
      base: d.base ?? null,
      min: d.min ?? null,
      max: d.max ?? null,
      locked: Boolean(d.locked),
      required: Boolean(d.required),
    }));
}

/**
 * Версия данных расчёта: хэш снимков продуктов, нормативов, описаний параметров объекта и
 * версии данных организатора. Описания параметров входят в версию, потому что от них зависят
 * проверка, умолчания, границы чувствительности и тексты отказов: правка администратором
 * границ параметра должна зажигать баннер «данные изменились» (§3.1.5), хотя снимком проекта
 * она не покрыта. `paramDefs` — описания ТОГО ЖЕ типа объекта (фильтр по facility делает
 * вызывающий код). Одна формула для сохранения проекта и для проверки расхождения с живыми
 * данными (lib/projects/recalc.liveDataVersion): иначе баннер горел бы всегда.
 */
export function projectDataVersion(
  productSnapshots: Readonly<Record<string, ProductForCalc | null>>,
  norms: NormValues,
  paramDefs: readonly ParamSpec[],
): string {
  return dataVersionOf({
    productSnapshots,
    normsUsed: norms,
    paramDefs: paramDefsDigest(paramDefs),
    organizer: ORGANIZER_DATA_VERSION,
  });
}

/**
 * Продукты для повторного расчёта проекта: снимки проекта заменяют одноимённые продукты
 * живого каталога, продукты, которых в каталоге уже нет, добавляются в конец (по slug).
 * Так сценарии считаются на тех же данных, что при сохранении, а подбор видит и новые
 * продукты каталога.
 */
export function withSnapshotProducts(
  live: readonly ProductForCalc[],
  snapshots: Readonly<Record<string, ProductForCalc>>,
): ProductForCalc[] {
  const snap = new Map<string, ProductForCalc>();
  for (const key of Object.keys(snapshots).sort()) {
    const p = snapshots[key];
    if (p && !snap.has(p.slug)) snap.set(p.slug, p);
  }
  const out = live.map((p) => snap.get(p.slug) ?? p);
  const seen = new Set(live.map((p) => p.slug));
  for (const [slug, p] of snap) if (!seen.has(slug)) out.push(p);
  return out;
}

/** Первый продукт с каждым slug: дубликат во входе не должен подменить уже выбранный. */
function uniqueBySlug(products: readonly ProductForCalc[]): ProductForCalc[] {
  const seen = new Set<string>();
  const out: ProductForCalc[] = [];
  for (const p of products) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    out.push(p);
  }
  return out;
}

/**
 * Проверка и умолчания параметров. Без описаний (данные ещё не синхронизированы) значения
 * берутся как есть — числа и непустые строки, — а проверка не выполняется.
 */
function resolveParams(defs: readonly ParamSpec[], params: ParamValues): { values: ParamValues; issues: ParamIssue[] } {
  if (defs.length === 0) {
    const values: ParamValues = {};
    for (const [key, v] of Object.entries(params ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) values[key] = v;
      else if (typeof v === "string" && v.trim() !== "") values[key] = v;
    }
    return { values, issues: [] };
  }
  const checked = validateParamValues(defs, params ?? {}, { origin: "manual" });
  return { values: applyDefaults(defs, checked.values), issues: checked.issues };
}

/** Числовой вид параметра: число, целое или процент. */
function isNumericDef(d: ParamSpec): boolean {
  return d.kind === "number" || d.kind === "integer" || d.kind === "percent";
}

/** Границы организатора для анализа чувствительности (только числовые параметры с границами). */
function boundsOf(defs: readonly ParamSpec[]): Record<string, { min: number | null; max: number | null }> {
  const out: Record<string, { min: number | null; max: number | null }> = {};
  for (const d of defs) {
    if (!isNumericDef(d) || (d.min === null && d.max === null)) continue;
    out[d.key] = { min: d.min, max: d.max };
  }
  return out;
}

/** Подписи параметров для сообщений движка. */
function labelsOf(defs: readonly ParamSpec[]): Record<string, string> {
  return Object.fromEntries(defs.map((d) => [d.key, d.label]));
}

/** Планировка склада построена — или параметр, из-за которого её нет, с подсказкой «как исправить». */
type LayoutCheck = { ok: true; params: SimLayoutParams } | { ok: false; key: string; message: string };

/**
 * Параметры планировки склада из параметров объекта. Значение вне пределов модели (площадь не
 * задана или больше LAYOUT_LIMITS, проход не шире 0 м, ворот меньше одного) — не повод
 * достраивать планировку запасными значениями: возвращается параметр и сообщение, и сценарии
 * с мобильными роботами получают отказ (см. `refusedForLayout`).
 */
function layoutOf(params: ParamValues, labels: Readonly<Record<string, string>>): LayoutCheck {
  const K = LAYOUT_KEYS;
  const name = (key: string) => q(labels[key] ?? key);
  const bad = (key: string, message: string): LayoutCheck => ({ ok: false, key, message });

  const area = toNumber(params[K.activeAreaM2]);
  const maxArea = LAYOUT_LIMITS.maxActiveAreaM2;
  if (area === null || !(area > 0)) {
    return bad(K.activeAreaM2, `${name(K.activeAreaM2)} не задана — укажите площадь больше 0 м², например 10 000`);
  }
  if (area > maxArea) {
    return bad(
      K.activeAreaM2,
      `${name(K.activeAreaM2)} ${fx(area)} м² больше предела модели планировки ${fx(maxArea)} м² — рассчитайте объект по зонам не больше ${fx(maxArea)} м²`,
    );
  }
  const widths: Record<string, number> = {};
  for (const key of [K.mainAisleWidthM, K.rackAisleWidthM]) {
    const v = toNumber(params[key]);
    if (v === null || !(v > 0)) {
      return bad(key, `${name(key)} ${v === null ? "не задана" : `${fx(v)} м`} — укажите ширину больше 0 м, например 3,5`);
    }
    widths[key] = v;
  }
  const maxPts = LAYOUT_LIMITS.maxPointsPerKind;
  const docks: Record<string, number> = {};
  for (const key of [K.receivingDocksCount, K.shippingDocksCount]) {
    const v = toNumber(params[key]);
    const n = v === null ? null : Math.round(v);
    if (n === null || n < 1 || n > maxPts) {
      return bad(key, `${name(key)} ${v === null ? "не задано" : fx(v)} — укажите целое число от 1 до ${fx(maxPts)}, например 4`);
    }
    docks[key] = n;
  }
  return {
    ok: true,
    params: {
      activeAreaM2: area,
      mainAisleWidthM: widths[K.mainAisleWidthM] as number,
      rackAisleWidthM: widths[K.rackAisleWidthM] as number,
      receivingDocksCount: docks[K.receivingDocksCount] as number,
      shippingDocksCount: docks[K.shippingDocksCount] as number,
      // Число зарядок на среднее плечо не влияет; на схеме зарядный угол — одна станция.
      chargers: 1,
    },
  };
}

/**
 * Производительность по циклу каждого мобильного продукта со скоростью на планировке объекта:
 * 3600 / (Lпорожн / v + Lгруз / (v × kгруз) + 2 × tзахв). Время захвата — норматив класса
 * погрузки (тот же, что в имитации); класс без норматива — цикл не считается.
 */
function cyclesOf(
  products: readonly ProductForCalc[],
  legs: ExpectedLegs | null,
  norms: NormValues,
): Record<string, CycleInfo | null> {
  const out: Record<string, CycleInfo | null> = {};
  for (const p of products) {
    out[p.slug] = null;
    if (!legs || !p.mobile) continue;
    const v = p.speedMps;
    if (v === null || !Number.isFinite(v) || !(v > 0)) continue;
    const h = handlingSecFor(p.handlingClass, norms);
    if (h === null) continue;
    const thr = cycleThroughputPerH({
      loadedM: legs.loadedM,
      emptyM: legs.emptyM,
      speedMps: v,
      loadedSpeedFactor: norms.loadedSpeedFactor,
      handlingSec: h,
    });
    out[p.slug] = thr === null ? null : { thrPerH: thr, loadedM: legs.loadedM, emptyM: legs.emptyM };
  }
  return out;
}

/** Копия сценария: результат модели не должен ссылаться на объекты вызывающего кода. */
function cloneSpec(spec: ScenarioSpec): ScenarioSpec {
  return structuredClone(spec);
}

/** Отказ invalid_inputs для сценария: поля, которые нужно исправить, и сообщение. */
function refusedInvalid(spec: ScenarioSpec, fields: string[], message: string): ScenarioRefused {
  return {
    key: spec.key,
    name: spec.name,
    kind: spec.kind,
    status: "refused",
    refusal: { reason: "invalid_inputs", fields, message },
    items: [],
    risks: [],
    trace: [],
  };
}

/**
 * Отказ всех сценариев при ошибках в параметрах объекта. Отказывает и «Как есть»: его ФОТ и
 * TCO на подставленных вместо ошибочных базовых значениях выглядели бы как расчёт по
 * введённым данным, которых на самом деле нет.
 */
function refusedForParams(spec: ScenarioSpec, errors: readonly ParamIssue[]): ScenarioRefused {
  const labels: string[] = [];
  const fields: string[] = [];
  for (const i of errors) {
    if (!labels.includes(i.label)) labels.push(i.label);
    const f = `param:${i.key}`;
    if (!fields.includes(f)) fields.push(f);
  }
  return refusedInvalid(spec, fields, `В параметрах объекта есть ошибки — исправьте: ${labels.map(q).join(", ")}`);
}

/**
 * Отказ сценария роботизации, когда планировку склада построить нельзя. Парк мобильных роботов
 * считается по циклу на планировке (та же геометрия, что в имитации); без неё осталась бы
 * только паспортная норма, которая на реальных плечах завышена в разы, — парк был бы занижен
 * молча, а имитация не смогла бы это поймать.
 */
function refusedForLayout(spec: ScenarioSpec, problem: { key: string; message: string }): ScenarioRefused {
  return refusedInvalid(
    spec,
    [`param:${problem.key}`],
    `Планировка склада не строится: ${problem.message}. Парк мобильных роботов считается по циклу на планировке — без неё расчёт по паспортной норме занизил бы парк`,
  );
}

/**
 * Риски имитации для рассчитанного сценария роботизации. Сводка учитывается, только если она
 * относится к текущему расчёту — тот же парк и тот же пиковый поток; устаревшая сводка (после
 * правки параметров) рисков не добавляет.
 */
function simRisks(ctx: ScenarioContext, spec: ScenarioSpec, result: ScenarioOk, sim: SimSummaryStored | null | undefined): Risk[] {
  if (!sim || result.kind === "asis") return [];
  const item = result.items.find((r) => ctx.processes[r.process]?.simSupported);
  if (!item || item.n === null || sim.fleet !== item.n) return [];
  const tol = 1e-6 * Math.max(1, Math.abs(item.peakPerHour));
  if (!(Math.abs(sim.requiredPerH - item.peakPerHour) <= tol)) return [];
  const unit = unitShort(ctx.processes[item.process]?.throughputUnit ?? "ед./ч");
  const robots = (n: number) => `${n} ${pluralRu(n, ["робот", "робота", "роботов"])}`;
  if (sim.verdict === "NOT_CONFIRMED") {
    const min = sim.minStableFleet !== null ? `; минимальный устойчивый парк по имитации — ${robots(sim.minStableFleet)}` : "";
    return [
      {
        code: "SIM_NOT_CONFIRMED",
        severity: "high",
        text: `Имитация не подтвердила расчёт: достигнуто ${fx(sim.achievedPerH, 1)} из ${fx(sim.requiredPerH, 1)} ${unit}; узкое место — ${BOTTLENECK_LABELS[sim.bottleneck]}${min}`,
      },
    ];
  }
  if (sim.verdict === "CONFIRMED" && sim.oversized) {
    const threshold = normsForSpec(ctx, spec).simOversizedIdleShare * 100;
    const min =
      sim.minStableFleet !== null && sim.minStableFleet < item.n
        ? `; пиковый поток держит и парк из ${robots(sim.minStableFleet)}`
        : "";
    return [
      {
        code: "SIM_OVERSIZED",
        severity: "low",
        text: `Имитация показывает избыточный парк: простой ${fx(sim.idlePct, 0)} % при пороге ${fx(threshold, 0)} %${min} — проверьте, можно ли уменьшить число роботов`,
      },
    ];
  }
  return [];
}

// ——————————————————————————— Подбор, исключения, сравнение ———————————————————————————

/** Подбор по одному процессу объекта с временными покупками кандидатов. */
type ProcessSelection = {
  process: ProcessDef;
  /** Результаты подбора по продуктам, относящимся к процессу (relevantProducts). */
  results: SelectionResult[];
  /** Временная покупка каждого продукта пула (кандидаты и продукты сценариев), по slug. */
  temp: Map<string, ScenarioResult>;
  /** Продукты, выбранные на этот процесс в сценариях роботизации, в порядке появления. */
  referenced: string[];
};

/** Ключ позиции «процесс + продукт». */
function itemKey(process: string, productSlug: string): string {
  return `${process}\u0000${productSlug}`;
}

/**
 * Подбор по каждому процессу объекта. NPV покупки для балла — временный сценарий покупки на
 * каждого кандидата: один прогон ядра на все продукты процесса (охват сравнения у них общий).
 * `econSkip` — продукты, для которых экономику считать нельзя (нет планировки для мобильного
 * робота): их NPV не участвует в балле, а строка сравнения остаётся без чисел.
 */
function selectByProcess(
  ctx: ScenarioContext,
  facilityProcesses: readonly ProcessDef[],
  products: readonly ProductForCalc[],
  specs: readonly ScenarioSpec[],
  econAllowed: boolean,
  econSkip: (product: ProductForCalc, process: ProcessDef) => boolean,
): ProcessSelection[] {
  return facilityProcesses.map((process) => {
    const candidates = relevantProducts(process, ctx.facility, products);
    const referenced: string[] = [];
    for (const s of specs) {
      if (s.kind === "asis") continue;
      for (const it of s.items ?? []) {
        if (it.process === process.slug && !referenced.includes(it.productSlug)) referenced.push(it.productSlug);
      }
    }

    const pool: ProductForCalc[] = [...candidates];
    for (const slug of referenced) {
      const p = ctx.products[slug];
      if (p && !pool.some((x) => x.slug === slug)) pool.push(p);
    }
    const priced = pool.filter((p) => !econSkip(p, process));
    const temp = new Map<string, ScenarioResult>();
    if (econAllowed && process.calcSupported && priced.length > 0) {
      const tempSpecs: ScenarioSpec[] = priced.map((p, i) => ({
        key: `sel-${i}`,
        name: p.name,
        kind: "purchase",
        items: [{ process: process.slug, productSlug: p.slug }],
      }));
      computeScenariosCore(ctx, tempSpecs).forEach((r, i) => {
        const p = priced[i];
        if (p) temp.set(p.slug, r);
      });
    }
    const econ: Record<string, { npvPurchaseRub: number | null }> = {};
    for (const [slug, r] of temp) econ[slug] = { npvPurchaseRub: r.status === "ok" ? r.npvRub : null };

    const results = selectProducts({
      facility: ctx.facility,
      params: ctx.params,
      process,
      products: candidates,
      norms: ctx.norms,
      econ: econ as SelectionEcon,
    });
    return { process, results, temp, referenced };
  });
}

/**
 * Решения сценариев, которые подбор исключил жёсткими правилами R1–R6 (ТЗ §3.4): ключ позиции
 * → причины без повтора названия продукта. Продукт сценария, не относящийся к процессу
 * (его нет среди relevantProducts), проверяется теми же правилами отдельно — его исключит R6.
 * Статус «не хватает данных» исключением не считается: без производительности расчёт сам
 * откажет (throughput_required), а с производительностью, заданной пользователем, он законен.
 */
function exclusionsOf(ctx: ScenarioContext, sels: readonly ProcessSelection[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const ps of sels) {
    for (const slug of ps.referenced) {
      const product = ctx.products[slug];
      if (!product) continue;
      const r =
        ps.results.find((x) => x.productSlug === slug) ??
        selectProducts({
          facility: ctx.facility,
          params: ctx.params,
          process: ps.process,
          products: [product],
          norms: ctx.norms,
        })[0];
      if (!r || r.status !== "excluded") continue;
      const prefix = `${product.name}: `;
      const reasons = r.reasons.map((s) => (s.startsWith(prefix) ? s.slice(prefix.length) : s)).filter((s) => s.trim() !== "");
      out.set(itemKey(ps.process.slug, slug), reasons.length > 0 ? reasons : ["исключён подбором"]);
    }
  }
  return out;
}

/** Текст причины автоматической отметки: причины подбора одной строкой, с ограничением длины. */
function autoReasonText(reasons: readonly string[]): string {
  const text = reasons.join("; ").replace(/\s+/g, " ").trim();
  return text.length > AUTO_REASON_MAX ? `${text.slice(0, AUTO_REASON_MAX - 1).trimEnd()}…` : text;
}

/** Отметка «добавлено вручную» поставлена платформой (по хвосту причины). */
function isAutoManual(it: ScenarioItem): boolean {
  return it.manuallyAdded === true && typeof it.manualReason === "string" && it.manualReason.endsWith(AUTO_MANUAL_SUFFIX);
}

/**
 * Позиции с исключённым подбором решением получают отметку «добавлено вручную» с причиной
 * подбора и хвостом AUTO_MANUAL_SUFFIX, если пользователь не отметил их сам. Автоматическая
 * отметка у решения, которое снова проходит подбор, снимается; отметка пользователя остаётся
 * как есть. Функция идемпотентна: повторный расчёт по сохранённым сценариям даёт то же.
 */
function markExcludedItems(specs: readonly ScenarioSpec[], exclusions: ReadonlyMap<string, string[]>): ScenarioSpec[] {
  return specs.map((spec) => {
    if (spec.kind === "asis") return spec;
    let changed = false;
    const items = (spec.items ?? []).map((it): ScenarioItem => {
      const reasons = exclusions.get(itemKey(it.process, it.productSlug));
      const auto = isAutoManual(it);
      if (!reasons) {
        if (!auto) return it;
        changed = true;
        const next: ScenarioItem = { ...it };
        delete next.manuallyAdded;
        delete next.manualReason;
        return next;
      }
      if (it.manuallyAdded === true && !auto) return it;
      const manualReason = `${autoReasonText(reasons)}${AUTO_MANUAL_SUFFIX}`;
      if (auto && it.manualReason === manualReason) return it;
      changed = true;
      return { ...it, manuallyAdded: true, manualReason };
    });
    return changed ? { ...spec, items } : spec;
  });
}

/** Строки сравнения по всем процессам: рекомендуемый и кандидаты плюс решения сценариев. */
function comparisonOf(
  ctx: ScenarioContext,
  sels: readonly ProcessSelection[],
  specs: readonly ScenarioSpec[],
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  for (const ps of sels) {
    const manual = new Set<string>();
    for (const s of specs) {
      if (s.kind === "asis") continue;
      for (const it of s.items ?? []) if (it.process === ps.process.slug && it.manuallyAdded) manual.add(it.productSlug);
    }
    const statusOf = new Map<string, SelectionStatus>(ps.results.map((r) => [r.productSlug, r.status]));
    const slugs = ps.results.filter((r) => r.status === "recommended" || r.status === "candidate").map((r) => r.productSlug);
    for (const slug of ps.referenced) if (!slugs.includes(slug)) slugs.push(slug);
    for (const slug of slugs) {
      const product = ctx.products[slug];
      if (!product) continue;
      rows.push(
        comparisonRow(ctx, ps.process, product, statusOf.get(slug) ?? "excluded", manual.has(slug), ps.temp.get(slug) ?? null),
      );
    }
  }
  return rows;
}

/** Строка сравнения по единым характеристикам (ТЗ §2.2 шаг 4). */
function comparisonRow(
  ctx: ScenarioContext,
  process: ProcessDef,
  product: ProductForCalc,
  status: SelectionStatus,
  manuallyAdded: boolean,
  temp: ScenarioResult | null,
): ComparisonRow {
  const item = temp?.items.find((i) => i.process === process.slug) ?? null;
  const thr = item
    ? { thrNorm: item.thrNorm, thrCycle: item.thrCycle, thrEff: item.thrEff }
    : throughputFor(ctx, { process: process.slug, productSlug: product.slug });
  const ok = temp && temp.status === "ok" ? temp : null;
  return {
    process: process.slug,
    productSlug: product.slug,
    productName: product.name,
    status,
    manuallyAdded,
    payloadKg: product.payloadKg,
    speedMps: product.speedMps,
    thrNorm: thr.thrNorm,
    thrCycle: thr.thrCycle,
    thrEff: thr.thrEff,
    autonomyH: product.autonomyH,
    chargeMin: product.chargeMin,
    minAisleM: product.minAisleM,
    n: item?.n ?? null,
    chargers: item ? item.chargers : null,
    priceRub: product.priceRub,
    capexPurchaseRub: ok ? ok.capexRub : null,
    npvPurchaseRub: ok ? ok.npvRub : null,
    paybackPurchaseYears: ok ? ok.paybackYears : null,
    raasRubMonth: product.raasRubMonth,
    completenessPct: product.completenessPct,
  };
}

/**
 * Сценарии роботизации с решением, которое подбор исключил: ключ сценария → пояснения по
 * позициям («DMR 600 — грузоподъёмность 600 кг < масса груза 800 кг»).
 */
function blockedScenarios(
  ctx: ScenarioContext,
  specs: readonly ScenarioSpec[],
  exclusions: ReadonlyMap<string, string[]>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of specs) {
    if (s.kind === "asis") continue;
    const notes: string[] = [];
    for (const it of s.items ?? []) {
      const reasons = exclusions.get(itemKey(it.process, it.productSlug));
      if (!reasons) continue;
      notes.push(`${ctx.products[it.productSlug]?.name ?? it.productSlug} — ${autoReasonText(reasons)}`);
    }
    if (notes.length > 0) out.set(s.key, notes);
  }
  return out;
}

/**
 * Вывод по проекту. Сценарий с решением, исключённым подбором, не рекомендуется (ТЗ §3.4: «не
 * рекомендовать, если ключевое ограничение делает применение невозможным»): вывод строится по
 * остальным сценариям, а первым пунктом объясняется, почему такой сценарий не рассматривается.
 * Его расчёт при этом остаётся в таблице сценариев — для сравнения.
 */
function conclusionOf(
  results: readonly ScenarioResult[],
  ctx: ScenarioContext,
  specs: readonly ScenarioSpec[],
  blocked: ReadonlyMap<string, string[]>,
): Conclusion {
  if (blocked.size === 0) return buildConclusion(results, ctx, specs);
  const eligible = results.filter((r) => !blocked.has(r.key));
  const base = buildConclusion(eligible, ctx, specs.filter((s) => !blocked.has(s.key)));
  const notes = specs
    .filter((s) => blocked.has(s.key))
    .map((s) => `${q(s.name)} не рекомендуется: подбор исключил решение (${(blocked.get(s.key) ?? []).join("; ")}); расчёт показан только для сравнения`);
  const headline = eligible.some((r) => r.kind !== "asis")
    ? base.headline
    : "Рекомендации нет: во всех сценариях роботизации выбраны решения, которые подбор исключил, — выберите применимое решение";
  return { ...base, headline, bullets: [...notes, ...base.bullets] };
}

/**
 * Входы имитации по сценариям: для рассчитанного сценария роботизации с роботом на процессе,
 * который моделируется имитацией, — парк по расчёту (или ручной) и парк по паспортной норме
 * (размер парка по той же формуле ТЗ, но только по норме производителя).
 */
function simInputsOf(
  ctx: ScenarioContext,
  specs: readonly ScenarioSpec[],
  results: readonly ScenarioResult[],
  defs: readonly ParamSpec[],
): Record<string, ScenarioSimInputs> {
  const out: Record<string, ScenarioSimInputs> = {};
  for (const spec of specs) {
    out[spec.key] = { calculated: null, byNorm: null, assumedUtilPct: null, provenance: null };
    if (spec.kind === "asis") continue;
    const result = results.find((r) => r.key === spec.key);
    if (!result || result.status !== "ok") continue;
    const item = (spec.items ?? []).find((it) => ctx.processes[it.process]?.simSupported);
    if (!item) continue;
    const ir = result.items.find((r) => r.process === item.process);
    const product = ctx.products[item.productSlug];
    if (!ir || !product || ir.n === null) continue;
    const norms = normsForSpec(ctx, spec);
    const base = {
      params: ctx.params,
      product,
      peakPerH: ir.peakPerHour,
      avgPerH: ir.avgPerHour,
      norms,
      seed: PROJECT_SIM_SEED,
      paramSpecs: defs,
    };
    const calculated = toSimInput({ ...base, fleet: ir.n, chargers: ir.chargers, fleetOrigin: ir.nOverridden ? "user" : "derived" });
    let byNorm: SimInput | null = null;
    if (ir.thrNorm !== null && ir.thrNorm > 0) {
      const { nAuto } = sizeFleet({
        peakPerH: ir.peakPerHour,
        thrEff: ir.thrNorm,
        utilization: norms.utilization,
        availability: norms.availability,
        reservePct: norms.reservePct,
      });
      const chargers = chargersNeeded(nAuto, product, norms).count;
      const res = toSimInput({ ...base, fleet: nAuto, chargers, fleetOrigin: "derived" });
      byNorm = res.ok ? res.input : null;
    }
    out[spec.key] = {
      calculated: calculated.ok ? calculated.input : null,
      byNorm,
      assumedUtilPct: calculated.ok ? calculated.assumedUtilPct : null,
      provenance: calculated.ok ? calculated.provenance : null,
    };
  }
  return out;
}

/** Снимки продуктов, на которые ссылаются сценарии (по slug, в алфавитном порядке). */
function snapshotsOf(
  specs: readonly ScenarioSpec[],
  products: Readonly<Record<string, ProductForCalc>>,
): Record<string, ProductForCalc> {
  const slugs = new Set<string>();
  for (const s of specs) for (const it of s.items ?? []) slugs.add(it.productSlug);
  const out: Record<string, ProductForCalc> = {};
  for (const slug of [...slugs].sort()) {
    const p = products[slug];
    if (p) out[slug] = structuredClone(p);
  }
  return out;
}

/**
 * Модель проекта по входу. Шаги:
 * 1. параметры: проверка (`validateParamValues`) и базовые значения (`applyDefaults`); при
 *    ошибках все сценарии — отказ invalid_inputs с перечнем полей;
 * 2. для складоподобного объекта — планировка и средние плечи, по ним цикл каждого продукта;
 *    планировку построить нельзя — сценарии с мобильными роботами получают отказ с полем;
 * 3. подбор по каждому процессу объекта с NPV покупки временным сценарием на каждого
 *    кандидата; исключённые подбором решения сценариев помечаются как добавленные вручную;
 * 4. экономика сценариев (`computeScenarios`), риски имитации по переданным сводкам;
 * 5. строки сравнения, входы имитации (парк по расчёту и по норме);
 * 6. вывод (сценарии с исключёнными решениями не рекомендуются), снимки продуктов из
 *    сценариев, версия данных.
 */
export function buildProjectModel(input: BuildProjectModelInput): ProjectModel {
  const facility = input.facility;
  const norms = input.norms;
  const defs = input.paramDefs.filter((d) => d.facility === facility);
  const { values: paramsUsed, issues: paramIssues } = resolveParams(defs, input.params);
  const paramErrors = paramIssues.filter((i) => i.severity === "error");
  const paramLabels = labelsOf(defs);

  const facilityProcesses = processesForFacility(facility);
  const processes: Record<string, ProcessDef> = Object.fromEntries(facilityProcesses.map((p) => [p.slug, p]));
  const products = uniqueBySlug(input.products);
  const productsBySlug: Record<string, ProductForCalc> = Object.fromEntries(products.map((p) => [p.slug, p]));

  const layoutCheck = isWarehouseLike(facility) ? layoutOf(paramsUsed, paramLabels) : null;
  const layout = layoutCheck?.ok ? buildWarehouseLayout(layoutCheck.params) : null;
  const legs = layout ? expectedLegsM(layout) : null;
  const layoutProblem = layoutCheck && !layoutCheck.ok ? layoutCheck : null;
  /** Позиции, которым нужна планировка: мобильный робот на процессе с расчётом экономики. */
  const needsLayout = (product: ProductForCalc | undefined, process: ProcessDef | undefined): boolean =>
    layoutProblem !== null && product?.mobile === true && process?.calcSupported === true;

  const ctx: ScenarioContext = {
    facility,
    params: paramsUsed,
    norms,
    products: productsBySlug,
    processes,
    cycle: cyclesOf(products, legs, norms),
    paramBounds: boundsOf(defs),
    paramLabels,
  };

  const specsIn = input.scenarios.map(cloneSpec);
  const econAllowed = paramErrors.length === 0;
  const sels = selectByProcess(ctx, facilityProcesses, products, specsIn, econAllowed, needsLayout);
  const selection = sels.flatMap((ps) => ps.results);
  // При ошибках в параметрах подбор идёт на подставленных базовых значениях — отметки по нему
  // не ставятся (все сценарии и так получают отказ).
  const exclusions = econAllowed ? exclusionsOf(ctx, sels) : new Map<string, string[]>();
  const specs = econAllowed ? markExcludedItems(specsIn, exclusions) : specsIn;

  const layoutBlocked = (s: ScenarioSpec) =>
    s.kind !== "asis" && (s.items ?? []).some((it) => needsLayout(productsBySlug[it.productSlug], processes[it.process]));
  let results: ScenarioResult[];
  if (!econAllowed) {
    results = specs.map((s) => refusedForParams(s, paramErrors));
  } else {
    const computed = computeScenarios(ctx, specs);
    results = computed.map((r, i) => {
      const spec = specs[i];
      return spec && layoutProblem && layoutBlocked(spec) ? refusedForLayout(spec, layoutProblem) : r;
    });
  }

  const sims = input.sims;
  if (sims) {
    results = results.map((r, i) => {
      const spec = specs[i];
      if (!spec || r.status !== "ok") return r;
      const extra = simRisks(ctx, spec, r, sims[r.key]);
      return extra.length > 0 ? { ...r, risks: sortRisks([...r.risks, ...extra]) } : r;
    });
  }

  const comparison = comparisonOf(ctx, sels, specs);
  const simInputs = simInputsOf(ctx, specs, results, defs);
  // Смена вывода по горизонту пересчитывает сценарии по их описаниям: сценарий с отказом из-за
  // планировки туда не передаётся, иначе он посчитался бы по паспортной норме.
  const conclusionSpecs = layoutProblem ? specs.filter((s) => !layoutBlocked(s)) : specs;
  const conclusion = conclusionOf(results, ctx, conclusionSpecs, blockedScenarios(ctx, conclusionSpecs, exclusions));
  const productSnapshots = snapshotsOf(specs, productsBySlug);
  const normsUsed = { ...norms };

  return {
    modelVersion: TZ_MODEL_VERSION,
    simModelVersion: SIM_MODEL_VERSION,
    dataVersion: projectDataVersion(productSnapshots, normsUsed, defs),
    facility,
    paramsUsed,
    normsUsed,
    productSnapshots,
    scenarios: specs,
    results,
    selection,
    comparison,
    conclusion,
    paramIssues,
    layout,
    simInputs,
  };
}

/** Модель без планировки и входов имитации — та часть, что сохраняется в Project.results. */
export function storedPartOf(model: ProjectModel): Omit<ProjectResults, "calculatedAt" | "sim"> {
  // Деструктуризация отбрасывает поля, которых нет в ProjectResults.
  const { layout: _layout, simInputs: _simInputs, ...rest } = model;
  void _layout;
  void _simInputs;
  return rest;
}
