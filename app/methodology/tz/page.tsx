import Link from "next/link";
import { connection } from "next/server";
import { SourceBadge } from "@/components/project/source-badge";
import { getNormRows, latestDataRelease, type DataReleaseRow } from "@/lib/catalog/queries";
import { ORGANIZER_DATA_VERSION } from "@/lib/data/organizer/version.generated";
import { prisma } from "@/lib/db/client";
import { pluralRu } from "@/lib/format/plural";
import { LAYOUT_ASSUMPTIONS } from "@/lib/sim/layout";
import { BOTTLENECK_RULES, endQueueLimit } from "@/lib/sim/metrics";
import { originLabel } from "@/lib/tz/characteristics";
import {
  CAPEX_LINE_KEYS,
  FORMULAS,
  OPEX_LINE_KEYS,
  capexFormulaKey,
  opexFormulaKey,
  type FormulaKey,
  type FormulaSource,
} from "@/lib/tz/econ/formulas";
import { MODEL_LIMITATIONS } from "@/lib/tz/econ/limitations";
import { fx } from "@/lib/tz/econ/text";
import { NORM_DEFS, resolveNorms, type NormValues } from "@/lib/tz/norms";
import { processesForFacility, type FacilitySlug, type ProcessDef } from "@/lib/tz/processes";
import { facilityLabel } from "@/lib/tz/selection/text";
import type { Origin } from "@/lib/tz/types";
import { SIM_MODEL_VERSION, TZ_MODEL_VERSION } from "@/lib/tz/version";
import { cn } from "@/lib/utils";

export const metadata = { title: "Методика расчёта по ТЗ — Платформа оценки роботизации" };

/**
 * Методика модели tz-1.0.0 (ТЗ §3.5.1 — прозрачная модель без недокументированных
 * коэффициентов; §3.5.8 — формулы, единицы, источники и допущения доступны пользователю; §5.7 —
 * что реализовано полностью, а что прототип).
 *
 * Всё на странице выводится из тех же модулей, которыми считает движок: формулы — из FORMULAS
 * (они же в «Как посчитано», отчёте и листе формул Excel), нормативы — из таблицы Norm с
 * границами, происхождением и обоснованием (правки администратора видны сразу), процессы — из
 * PROCESS_DEFS, пороги имитации — из нормативов и правил lib/sim, ограничения — из
 * MODEL_LIMITATIONS. Числа руками здесь не пишутся: разойтись с расчётом страница не может.
 *
 * Прежняя страница /methodology (модель v1) не меняется.
 */

/** Группы формул в порядке расчёта: спрос → парк → труд → CAPEX → OPEX → финансы. */
const FORMULA_GROUPS: readonly { title: string; keys: readonly FormulaKey[] }[] = [
  { title: "Режим работы и спрос", keys: ["workHours", "demandDay", "peakPerHour"] },
  { title: "Производительность и парк", keys: ["thrNorm", "thrCycle", "thrEff", "fleet", "coverage", "chargers"] },
  { title: "Труд", keys: ["roleCost", "baselineLabour", "releasedFte", "remainingLabour", "operatingStaff"] },
  { title: "CAPEX", keys: [...CAPEX_LINE_KEYS.map(capexFormulaKey), "capexTotal"] },
  { title: "OPEX", keys: [...OPEX_LINE_KEYS.map(opexFormulaKey), "opexTotal"] },
  {
    title: "Эффект, окупаемость, ROI, NPV и TCO",
    keys: ["effect", "payback", "roiTz", "roiNet", "npv", "discountedPayback", "tco", "cashflow", "batteryYear", "reinvest", "breakEvenSalary"],
  },
];

/** Формулы, не попавшие ни в одну группу (новая формула не должна пропасть со страницы). */
function ungroupedFormulaKeys(): FormulaKey[] {
  const grouped = new Set<string>(FORMULA_GROUPS.flatMap((g) => g.keys));
  return (Object.keys(FORMULAS) as FormulaKey[]).filter((k) => !grouped.has(k));
}

/** Что означает метка источника формулы. */
const FORMULA_SOURCE_NOTES: Readonly<Record<FormulaSource, string>> = {
  "ТЗ §3.5.1": "требование прозрачной модели расчёта",
  "ТЗ §3.5.2": "рекомендуемые расчётные зависимости ТЗ",
  организатор: "легенда датасета организатора",
  "наш выбор": "решение модели; почему — в нормативах и ограничениях ниже",
};

const FORMULA_SOURCE_TONE: Readonly<Record<FormulaSource, string>> = {
  "ТЗ §3.5.1": "border-primary/30 bg-primary/5",
  "ТЗ §3.5.2": "border-primary/30 bg-primary/5",
  организатор: "border-primary/30 bg-primary/5",
  "наш выбор": "border-border bg-muted",
};

/** Строка таблицы нормативов: описание, значение из таблицы и значение, которое применяет расчёт. */
type NormDisplayRow = {
  key: string;
  label: string;
  unit: string;
  group: string;
  origin: Origin;
  basis: string;
  sourceRef: string | null;
  sourceUrl: string | null;
  min: number | null;
  max: number | null;
  /** Значение в таблице Norm (или в коде, если таблица пуста). */
  stored: number;
  /** Значение, которое получает расчёт: после прижатия к границам и взаимных ограничений. */
  applied: number;
  editedByAdmin: boolean;
};

type NormsSource = "db" | "code" | "db-error";

/**
 * Нормативы для страницы. Основной источник — таблица Norm (её правит администратор); если
 * таблица пуста (данные не синхронизированы) или БД недоступна, показываются значения из кода —
 * те, которыми таблица засевается, — с пометкой.
 */
async function loadNorms(): Promise<{ rows: NormDisplayRow[]; applied: NormValues; from: NormsSource }> {
  let from: NormsSource = "db";
  let dbRows: Awaited<ReturnType<typeof getNormRows>> = [];
  try {
    dbRows = await getNormRows(prisma);
  } catch (e) {
    console.error("/methodology/tz: нормативы из БД не прочитаны, показаны значения из кода", e);
    from = "db-error";
  }
  if (from === "db" && dbRows.length === 0) from = "code";

  if (from === "db") {
    const applied = resolveNorms(dbRows);
    const rows = dbRows.map((r) => ({
      key: r.key,
      label: r.label,
      unit: r.unit ?? "",
      group: r.group,
      origin: r.origin,
      basis: r.basis,
      sourceRef: r.sourceRef,
      sourceUrl: r.sourceUrl,
      min: r.min,
      max: r.max,
      stored: r.value,
      applied: (applied as Record<string, number>)[r.key] ?? r.value,
      editedByAdmin: r.editedByAdmin,
    }));
    return { rows, applied, from };
  }
  const applied = resolveNorms();
  const rows = NORM_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    unit: d.unit,
    group: d.group,
    origin: d.origin,
    basis: d.basis,
    sourceRef: "sourceRef" in d ? d.sourceRef : null,
    sourceUrl: "sourceUrl" in d ? d.sourceUrl : null,
    min: d.min,
    max: d.max,
    stored: d.value,
    applied: applied[d.key],
    editedByAdmin: false,
  }));
  return { rows, applied, from };
}

/** Выпуск данных из БД; при недоступной БД — null (страница покажет версии сборки). */
async function loadRelease(): Promise<DataReleaseRow | null> {
  try {
    return await latestDataRelease(prisma);
  } catch (e) {
    console.error("/methodology/tz: выпуск данных не прочитан", e);
    return null;
  }
}

/** Единица-доля: «доля», «доля в год». */
function isShareUnit(unit: string): boolean {
  return unit === "доля" || unit.startsWith("доля ");
}

/** Число без потери знаков норматива: 1,302 не превращается в 1,3. */
function num(v: number): string {
  if (Number.isInteger(v) || Math.abs(v) >= 1000) return fx(v, 0);
  return fx(v, 4);
}

/** Значение норматива с единицей; доли — процентом: 0,775 → «77,5 %», 0,12 «доля в год» → «12 % в год». */
function valueText(v: number, unit: string): string {
  if (isShareUnit(unit)) return `${fx(v * 100, 2)} %${unit.slice("доля".length)}`;
  // «лет» в описании норматива — единица диапазона («3–5 лет»); у одного числа — по счёту: «4 года».
  if (unit === "лет") return `${num(v)} ${Number.isInteger(v) ? pluralRu(v, ["год", "года", "лет"]) : "года"}`;
  return unit === "" ? num(v) : `${num(v)} ${unit}`;
}

/** Подпись происхождения в середине фразы: «оценка», «открытый источник», но «ТЗ». */
function originInline(origin: Origin): string {
  const label = originLabel(origin);
  return label === label.toUpperCase() ? label : label.toLowerCase();
}

/** Допустимый диапазон норматива в тех же единицах. */
function boundsText(min: number | null, max: number | null, unit: string): string {
  if (min !== null && max !== null) {
    if (min === max) return `закреплено: ${valueText(min, unit)}`;
    return isShareUnit(unit)
      ? `${fx(min * 100, 2)}–${fx(max * 100, 2)} %${unit.slice("доля".length)}`
      : `${num(min)}–${num(max)}${unit === "" ? "" : ` ${unit}`}`;
  }
  if (min !== null) return `не меньше ${valueText(min, unit)}`;
  if (max !== null) return `не больше ${valueText(max, unit)}`;
  return "без границ";
}

/** Нормативы подряд одной группы — для подзаголовков таблицы. */
function groupRows(rows: readonly NormDisplayRow[]): { name: string; rows: NormDisplayRow[] }[] {
  const groups: { name: string; rows: NormDisplayRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.name === r.group) last.rows.push(r);
    else groups.push({ name: r.group, rows: [r] });
  }
  return groups;
}

/** Происхождения нормативов в порядке показа сводки. */
const ORIGIN_ORDER: readonly Origin[] = ["tz", "organizer", "research", "derived", "estimate", "choice", "admin", "user"];

/** Статус процесса в модели tz-1.0.0 (§5.7). */
function processStatus(p: ProcessDef): { text: string; tone: string } {
  if (p.calcSupported && p.simSupported) return { text: "экономика и имитация", tone: "text-positive" };
  if (p.calcSupported) return { text: "экономика, без имитации", tone: "text-foreground" };
  return { text: "прототип: параметры и подбор решений", tone: "text-caution" };
}

const FACILITIES: readonly FacilitySlug[] = ["warehouse", "airport", "medical"];

const SECTIONS = [
  { id: "formulas", title: "Формулы" },
  { id: "norms", title: "Нормативы и допущения" },
  { id: "processes", title: "Процессы и спрос" },
  { id: "simulation", title: "Имитация" },
  { id: "versions", title: "Версии" },
  { id: "limitations", title: "Ограничения" },
] as const;

/**
 * Обёртка широкой таблицы: прокрутка внутри рамки. `relative` делает её содержащим блоком для
 * абсолютно позиционированных потомков (sr-only-подписи в бейджах источника) — иначе они
 * выходят из-под прокрутки и на узком экране растягивают страницу по горизонтали.
 */
const TABLE_WRAP = "relative overflow-x-auto rounded-md border";

const TH = "px-3 py-2 text-left font-medium text-muted-foreground";
const TD = "border-t px-3 py-1.5 align-top";

export default async function TzMethodologyPage() {
  // Нормативы правит администратор, выпуск данных меняется при синхронизации: страница
  // считается на запросе, а не застывает на сборке.
  await connection();
  const [{ rows: normRows, applied, from }, release] = await Promise.all([loadNorms(), loadRelease()]);

  const formulaCount = Object.keys(FORMULAS).length;
  const formulaBySource = new Map<FormulaSource, number>();
  for (const f of Object.values(FORMULAS)) formulaBySource.set(f.source, (formulaBySource.get(f.source) ?? 0) + 1);
  const usedSources = (Object.keys(FORMULA_SOURCE_NOTES) as FormulaSource[]).filter((s) => formulaBySource.has(s));
  const extraFormulas = ungroupedFormulaKeys();

  const originCounts = ORIGIN_ORDER.map((o) => ({ origin: o, n: normRows.filter((r) => r.origin === o).length })).filter(
    (c) => c.n > 0,
  );
  const editedCount = normRows.filter((r) => r.editedByAdmin).length;

  const endQueueMin = endQueueLimit(0);
  const endQueueSharePct = (endQueueLimit(1_000_000) / 1_000_000) * 100;

  return (
    <div className="surface-data flex flex-col gap-10 py-12">
      <div className="flex max-w-3xl flex-col gap-3">
        <h1>Методика расчёта по ТЗ</h1>
        <p className="text-muted-foreground">
          По этой методике (модель {TZ_MODEL_VERSION}) считаются проекты и демо-расчёт склада: подбор решений,
          CAPEX, OPEX, эффект, окупаемость, ROI, NPV, TCO и сценарии «как есть / покупка / услуга». Здесь собраны
          все формулы, нормативы с источниками и допущения — те же, что показываются в разделе «Как посчитано» у
          каждого числа, в отчёте и в выгрузке Excel. Результат расчёта — предварительная оценка и требует
          верификации при обследовании объекта.
        </p>
        <nav aria-label="Разделы методики" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="tap-target text-primary underline-offset-4 hover:underline">
              {s.title}
            </a>
          ))}
          <Link href="/glossary" className="tap-target text-primary underline-offset-4 hover:underline">
            Словарь терминов
          </Link>
        </nav>
      </div>

      {/* ——— Формулы ——— */}
      <section id="formulas" className="flex scroll-mt-16 flex-col gap-4">
        <h2>Формулы</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {formulaCount} {pluralRu(formulaCount, ["формула", "формулы", "формул"])} модели. У каждой — единицы и
          метка источника:{" "}
          {usedSources.map((s, i) => (
            <span key={s}>
              «{s}» — {FORMULA_SOURCE_NOTES[s]} ({formulaBySource.get(s) ?? 0})
              {i < usedSources.length - 1 ? "; " : "."}
            </span>
          ))}{" "}
          Спрос и численность персонала берутся из параметров объекта, коэффициенты — из нормативов ниже.
        </p>
        {[...FORMULA_GROUPS, ...(extraFormulas.length > 0 ? [{ title: "Прочие", keys: extraFormulas }] : [])].map((g) => (
          <div key={g.title} className="flex flex-col gap-2">
            <h3>{g.title}</h3>
            <dl className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
              {g.keys.map((key) => {
                const f = FORMULAS[key];
                return (
                  <div key={key} className="flex flex-col gap-1 rounded-md border px-3 py-2">
                    <dt className="flex flex-wrap items-baseline justify-between gap-2 font-medium">
                      <span>{f.title}</span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-normal leading-tight",
                          FORMULA_SOURCE_TONE[f.source],
                        )}
                      >
                        {f.source}
                      </span>
                    </dt>
                    <dd className="font-mono text-sm break-words">{f.expression}</dd>
                    <dd className="text-xs text-muted-foreground">Единицы: {f.units}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </section>

      {/* ——— Нормативы ——— */}
      <section id="norms" className="flex scroll-mt-16 flex-col gap-4">
        <h2>Нормативы и допущения</h2>
        <div className="flex max-w-3xl flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Всё, что участвует в расчёте, но не является параметром объекта. У каждого норматива — допустимый
            диапазон, происхождение и обоснование; у значений организатора и ТЗ указано место в источнике, у
            открытых источников — ссылка. Оценка всегда помечена как оценка и говорит, на чём держится.
          </p>
          <p>
            Всего нормативов: {normRows.length}; по происхождению:{" "}
            {originCounts.map((c, i) => (
              <span key={c.origin}>
                {originInline(c.origin)} — {c.n}
                {i < originCounts.length - 1 ? ", " : "."}
              </span>
            ))}
            {editedCount > 0 && ` Изменено администратором: ${editedCount}.`}
          </p>
          <p>
            Значения правит администратор; выйти за границы нельзя — расчёт прижимает значение к диапазону. Проект
            хранит нормативы, по которым он посчитан, поэтому правка не меняет уже сохранённые расчёты: при
            повторном открытии проект предложит пересчитать на актуальных данных.
          </p>
          {from !== "db" && (
            <p className="text-caution">
              {from === "code"
                ? "Таблица нормативов в базе пуста (данные ещё не синхронизированы) — показаны значения из кода, которыми она засевается."
                : "База данных недоступна — показаны значения из кода, которыми засевается таблица нормативов."}
            </p>
          )}
        </div>
        <div className={TABLE_WRAP}>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th scope="col" className={TH}>
                  Норматив
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Значение
                </th>
                <th scope="col" className={TH}>
                  Допустимый диапазон
                </th>
                <th scope="col" className={TH}>
                  Происхождение и источник
                </th>
                <th scope="col" className={TH}>
                  Обоснование
                </th>
              </tr>
            </thead>
            {groupRows(normRows).map((g, gi) => (
              <tbody key={`${g.name}-${gi}`}>
                <tr>
                  <th scope="colgroup" colSpan={5} className="border-t bg-muted/20 px-3 py-1.5 text-left text-xs font-semibold">
                    {g.name}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className={`${TD} min-w-48 text-left font-normal`}>
                      {r.label}
                      {r.editedByAdmin && <span className="block text-xs text-muted-foreground">изменено администратором</span>}
                    </th>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                      {valueText(r.applied, r.unit)}
                      {r.applied !== r.stored && (
                        <span className="block text-xs text-caution">
                          в таблице {valueText(r.stored, r.unit)} — приведено к ограничениям
                        </span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{boundsText(r.min, r.max, r.unit)}</td>
                    <td className={`${TD} min-w-40`}>
                      <SourceBadge origin={r.origin} sourceUrl={r.sourceUrl} sourceRef={r.sourceRef} />
                    </td>
                    <td className={`${TD} min-w-80 text-xs text-muted-foreground`}>{r.basis}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {/* ——— Процессы ——— */}
      <section id="processes" className="flex scroll-mt-16 flex-col gap-4">
        <h2>Процессы и спрос</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Иерархия каталога ТЗ — отрасль, тип объекта, процесс, тип решения, продукт. Процесс говорит, из каких
          параметров объекта считается суточный спрос, какой персонал он занимает и какие параметры ограничивают
          выбор робота. Экономика и имитация в этой версии реализованы для перемещения паллет на складе; остальные
          процессы и типы объектов показаны на уровне параметров, подбора и доступных решений.
        </p>
        {FACILITIES.map((facility) => (
          <div key={facility} className="flex flex-col gap-2">
            <h3>{facilityLabel(facility)}</h3>
            <div className={TABLE_WRAP}>
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th scope="col" className={TH}>
                      Процесс
                    </th>
                    <th scope="col" className={TH}>
                      Суточный спрос
                    </th>
                    <th scope="col" className={TH}>
                      Единицы спроса и производительности
                    </th>
                    <th scope="col" className={TH}>
                      В модели
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {processesForFacility(facility).map((p) => {
                    const status = processStatus(p);
                    return (
                      <tr key={p.slug}>
                        <th scope="row" className={`${TD} min-w-56 text-left font-normal`}>
                          <span className="font-medium">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">{p.description}</span>
                        </th>
                        <td className={`${TD} min-w-64`}>{p.demandFormula}</td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {p.demandUnit}; {p.throughputUnit}
                        </td>
                        <td className={cn(TD, "min-w-40", status.tone)}>{status.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      {/* ——— Имитация ——— */}
      <section id="simulation" className="flex max-w-3xl scroll-mt-16 flex-col gap-4">
        <h2>Имитация</h2>
        <p className="text-sm text-muted-foreground">
          Имитация (модель {SIM_MODEL_VERSION}) проверяет, выдерживает ли рассчитанный парк пиковый поток на
          планировке объекта (ТЗ §3.6.2: визуализация подтверждает расчёт, а не украшает его). Экономика берёт
          производительность робота по циклу с той же планировки, поэтому схема на экране и расчёт не расходятся.
        </p>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-medium">Планировка</dt>
            <dd className="text-muted-foreground">
              Прямоугольник 2 : 1 площадью активной зоны A: ширина √(2A), глубина √(A/2). Вдоль одной стены — полоса
              приёмки с воротами шириной {num(LAYOUT_ASSUMPTIONS.dockStripM)} м, в её углу — зарядка{" "}
              {num(LAYOUT_ASSUMPTIONS.chargingCornerM)} × {num(LAYOUT_ASSUMPTIONS.chargingCornerM)} м, вдоль
              противоположной — полоса отгрузки; между ними хранение с тремя поперечными проездами и стеллажными
              проходами (шаг — ширина прохода + {num(LAYOUT_ASSUMPTIONS.rackRowDepthM)} м двойного ряда стеллажей,
              отступ от стены {num(LAYOUT_ASSUMPTIONS.rackMarginM)} м, места хранения через{" "}
              {num(LAYOUT_ASSUMPTIONS.slotPitchM)} м). Площадь, ширина проездов и число ворот — параметры объекта;
              размеры полос и шагов — допущения модели. Маршрут идёт по проходам.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Поток и роботы</dt>
            <dd className="text-muted-foreground">
              Дискретное время с шагом 1 с. Задания поступают как испытания Бернулли от генератора с зерном: сначала{" "}
              {num(applied.simWarmupMin)} мин прогрева на среднем потоке, затем {num(applied.simPeakMin)} мин на
              пиковом; показатели считаются по пиковому окну. Задание получает ближайший свободный робот, очередь —
              по порядку поступления. Робот уходит на зарядку при {valueText(applied.chargeStartSoc, "доля")} заряда и
              возвращается в работу при {valueText(applied.chargeStopSoc, "доля")}. Ворота и зарядная станция
              обслуживают одного робота за раз.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Вердикт</dt>
            <dd className="text-muted-foreground">
              «Подтверждено», если за пиковое окно обслужено не меньше {valueText(applied.simServedShareMin, "доля")}{" "}
              заданий, очередь в конце окна не больше max({num(endQueueMin)}; {num(endQueueSharePct)} % часового
              пикового потока), 95-й перцентиль ожидания не больше {num(applied.simP95WaitMaxMin)} мин и ни один
              робот не разрядился до нуля. Иначе — «не подтверждено» с узким местом: парк (роботы заняты не меньше{" "}
              {num(BOTTLENECK_RULES.fleetBusyShare * 100)} % времени и очередь растёт), ворота (заняты не меньше{" "}
              {num(BOTTLENECK_RULES.pointUtilShare * 100)} % окна при ожидании у ворот от{" "}
              {num(BOTTLENECK_RULES.pointWaitShare * 100)} % времени) или зарядка (ожидание станции от{" "}
              {num(BOTTLENECK_RULES.chargerWaitShare * 100)} % времени парка). Подтверждённый парк с простоем от{" "}
              {valueText(applied.simOversizedIdleShare, "доля")} помечается как избыточный.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Три варианта парка</dt>
            <dd className="text-muted-foreground">
              Парк по расчёту, парк по паспортной норме производителя и минимальный устойчивый парк — наименьшее
              число роботов, при котором имитация ещё подтверждает расчёт (перебор двоичным поиском в диапазоне от 1
              до удвоенного расчётного парка). Расхождение нормы и цикла показывается как риск.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Воспроизводимость</dt>
            <dd className="text-muted-foreground">
              Прогон детерминирован: одинаковые входы и зерно дают одинаковый результат на сервере и в браузере.
              В движке нет часов и функций, которые разные движки JavaScript могут округлять по-разному: случайность
              — только от генератора с зерном (mulberry32), время — счётчик шагов модели, корень считается методом
              Ньютона с фиксированным числом шагов. При сохранении проекта имитация выполняется на сервере и
              хранится вместе с расчётом; в браузере запуск идёт по частям со строкой состояния и пределом 60 с.
              Ничего не запускается само.
            </dd>
          </div>
        </dl>
      </section>

      {/* ——— Версии ——— */}
      <section id="versions" className="flex max-w-3xl scroll-mt-16 flex-col gap-4">
        <h2>Версии</h2>
        <p className="text-sm text-muted-foreground">
          Проект хранит версию модели, версию имитации и хэш использованных данных (продукты сценариев,
          нормативы, описания параметров и версия данных организатора). Если при повторном открытии что-то из этого изменилось, проект
          показывает сохранённый расчёт и предлагает пересчитать на актуальных данных — числа не подменяются
          молча (ТЗ §3.1.5).
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium">Модель расчёта</dt>
          <dd className="font-mono">{TZ_MODEL_VERSION}</dd>
          <dt className="font-medium">Модель имитации</dt>
          <dd className="font-mono">{SIM_MODEL_VERSION}</dd>
          <dt className="font-medium">Датасеты организатора</dt>
          <dd className="font-mono">{ORGANIZER_DATA_VERSION.datasets}</dd>
          <dt className="font-medium">Каталог организатора</dt>
          <dd className="font-mono">{ORGANIZER_DATA_VERSION.catalog}</dd>
          <dt className="font-medium">«Примеры решений» организатора</dt>
          <dd className="font-mono">{ORGANIZER_DATA_VERSION.examples}</dd>
          <dt className="font-medium">Исследование открытых источников</dt>
          <dd className="font-mono break-words">{ORGANIZER_DATA_VERSION.research}</dd>
          <dt className="font-medium">Выпуск данных в базе</dt>
          <dd>
            {release ? (
              <>
                <span className="font-mono">{release.version}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — синхронизирован{" "}
                  {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" }).format(
                    release.seededAt,
                  )}{" "}
                  (МСК)
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">данные ещё не синхронизированы</span>
            )}
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Версия данных организатора — дата выгрузки и начало контрольной суммы исходного файла. Сами файлы
          организатора в репозиторий не входят: из них извлекаются только нужные поля со ссылкой на источник.
        </p>
      </section>

      {/* ——— Ограничения ——— */}
      <section id="limitations" className="flex max-w-3xl scroll-mt-16 flex-col gap-4">
        <h2>Ограничения</h2>
        <p className="text-sm text-muted-foreground">
          Чего модель не учитывает и где она упрощает. Те же ограничения печатаются в отчёте и выгрузке Excel рядом
          с результатом.
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {MODEL_LIMITATIONS.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm">
        <Link href="/glossary" className="tap-target font-medium underline underline-offset-4">
          Словарь терминов
        </Link>
        <Link href="/methodology" className="tap-target font-medium underline underline-offset-4">
          Методика прежней модели v1
        </Link>
      </footer>
    </div>
  );
}
