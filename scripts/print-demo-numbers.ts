// Печать демонстрационных чисел склада организатора (ТЗ §5.6: числа презентации обязаны
// воспроизводиться в сданной сборке). Числа НЕ вписываются руками ни в презентацию, ни в
// сценарий демонстрации — их даёт только этот скрипт на тех же данных и той же модели, что
// рабочая область и /demo.
//
// Разделы вывода:
// 1) путь жюри (ТЗ §5.4) — основной: проект ровно такой, каким его строят «Новый проект» на
//    демо-данных организатора, засеянный проект demo-warehouse и гостевой /demo (одна функция
//    сценариев по умолчанию; вторая покупка — по константе DEMO_SECOND_PURCHASE из
//    scripts/seed-demo.ts, решение владельца — вариант «А», автоподбор). Таблица сценариев,
//    парк и имитация, риски сценариев, полная чувствительность NPV по всем рычагам, порог по
//    зарплате каждой покупки, вывод;
// 2) масштаб каталога текущего выпуска данных (счётчики из БД);
// 3) дополнительный пример — покупка DMR Carrier P из «Примеров решений» организатора вместо
//    второй покупки подбора. В путь жюри не входит: показывает паспортную норму второго
//    продукта организатора на той же планировке.
//
// Запуск (из Git Bash; в PowerShell `>` перекодирует вывод):
//   npx tsx scripts/print-demo-numbers.ts             — таблица в консоль;
//   npx tsx scripts/print-demo-numbers.ts --markdown  — только Markdown (для
//     docs/submission/demo-numbers.md; вывод детерминирован: без даты и длительностей, чтобы
//     повторный прогон давал тот же файл);
//   npx tsx scripts/print-demo-numbers.ts --offline   — без БД: данные организатора из кода
//     (lib/data/organizer) и нормативы по умолчанию. Для проверки до сева; для презентации —
//     только вариант из БД.
// Код выхода 1 — сценарий неожиданно не рассчитан, имитация не выполнена или нет продукта
// дополнительного примера; 2 — неверные аргументы.
//
// @prisma/client не читает .env сам — отсюда dotenv/config (как в scripts/seed.ts). Импорты
// относительные: tsx запускает скрипт без алиаса «@/».
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { LEVEL_LABELS } from "../components/catalog/labels";
import { latestDataRelease } from "../lib/catalog/queries";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { CATALOG } from "../lib/data/organizer/catalog";
import { paramSpecsFor } from "../lib/data/organizer/params";
import { ORGANIZER_DATA_VERSION } from "../lib/data/organizer/version.generated";
import { pluralRu } from "../lib/format/plural";
import { formatRub } from "../lib/format/rub";
import { asisScenario, initialScenarios, shortProductName } from "../lib/projects/defaults";
import { loadLiveInputs, resultsFromInputs, type LiveInputs } from "../lib/projects/recalc";
import { BOTTLENECK_LABELS } from "../lib/sim/export-rows";
import type { SimSummaryStored } from "../lib/sim/types";
import { originLabel } from "../lib/tz/characteristics";
import { interpretBand } from "../lib/tz/econ/interpret";
import { fx, rangeText } from "../lib/tz/econ/text";
import { resolveNorms } from "../lib/tz/norms";
import { applyDefaults } from "../lib/tz/params/schema";
import { processDef } from "../lib/tz/processes";
import type {
  Origin,
  ParamSpec,
  ProductForCalc,
  ProductLevel,
  ProjectResults,
  ScenarioOk,
  ScenarioResult,
  ScenarioSpec,
} from "../lib/tz/types";
import { stableJson } from "../lib/tz/version";
import { DEMO_PROJECT_ID, DEMO_PROJECT_NAME, DEMO_SECOND_PURCHASE, demoScenarios } from "./seed-demo";

const FACILITY = "warehouse";
const PT = "pallet-transport";
/** Продукты дополнительного примера: slug в данных организатора и запасной поиск по названию. */
const H1500 = { slug: "ronavi-h1500", name: /h1500/i };
const CARRIER_P = { slug: "dikom-dmr-carrier-p", name: /carrier\s*p\b/i };

/** Заголовки разделов: на них ссылаются метки «ДЧ·…» в docs/DEMO-SCRIPT.md и плане презентации. */
const JURY_TITLE = "Путь жюри (ТЗ §5.4): новый проект на демо-данных склада";
const EXTRA_TITLE = "Дополнительный пример: DMR Carrier P из «Примеров решений» организатора (не путь жюри)";

type Table = { head: string[]; rows: string[][] };
type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "table"; table: Table }
  | { kind: "list"; items: string[] };

const DASH = "—";

function parseArgs(argv: readonly string[]): { markdown: boolean; offline: boolean } {
  const known = new Set(["--markdown", "--offline"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(`Неизвестные аргументы: ${unknown.join(" ")}. Допустимо: --markdown, --offline`);
    process.exit(2);
  }
  return { markdown: argv.includes("--markdown"), offline: argv.includes("--offline") };
}

/** Живые входы без БД: данные организатора из кода и нормативы по умолчанию. */
function offlineInputs(): LiveInputs {
  const products = CATALOG.filter((p) => p.level !== "identification")
    .filter((p) => p.processes.some((s) => processDef(s)?.facilityTypes.includes(FACILITY)))
    .map(productForCalcFromSeed)
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || (a.slug < b.slug ? -1 : 1));
  return { paramDefs: paramSpecsFor(FACILITY), products, norms: resolveNorms(), paramDefsFrom: "code" };
}

function findProduct(products: readonly ProductForCalc[], want: { slug: string; name: RegExp }): ProductForCalc | null {
  return products.find((p) => p.slug === want.slug) ?? products.find((p) => want.name.test(p.name)) ?? null;
}

const plural = (n: number, forms: [string, string, string]) => `${n} ${pluralRu(n, forms)}`;
const years = (v: number | null) => (v === null ? DASH : `${fx(v, 1)} г.`);
const rubOrDash = (v: number | null) => (v === null ? DASH : formatRub(v));
const quoted = (names: readonly string[]) => names.map((n) => `«${n}»`).join(", ");

function okOf(r: ScenarioResult | undefined): ScenarioOk | null {
  return r && r.status === "ok" ? r : null;
}

/** Рассчитанные сценарии роботизации (без «Как есть» и отказов) в порядке проекта. */
function robotsOf(results: ProjectResults): ScenarioOk[] {
  return results.results.map(okOf).filter((r): r is ScenarioOk => r !== null && r.kind !== "asis");
}

function simText(sim: SimSummaryStored | null | undefined, unit: string): string {
  if (!sim) return DASH;
  const flow = `${fx(sim.achievedPerH, 1)} из ${fx(sim.requiredPerH, 1)} ${unit}`;
  if (sim.verdict === "CONFIRMED") return `подтверждено: ${flow}${sim.oversized ? " (парк избыточен)" : ""}`;
  if (sim.verdict === "NOT_CONFIRMED") return `не подтверждено: ${flow}, узкое место — ${BOTTLENECK_LABELS[sim.bottleneck]}`;
  return "не поддерживается";
}

function verdictShort(v: "CONFIRMED" | "NOT_CONFIRMED" | "NOT_SUPPORTED" | null | undefined): string {
  if (v === "CONFIRMED") return "подтверждён";
  if (v === "NOT_CONFIRMED") return "не подтверждён";
  if (v === "NOT_SUPPORTED") return "не поддерживается";
  return DASH;
}

/** Таблица сценариев: строки — показатели, столбцы — сценарии (как ScenarioTable в интерфейсе). */
function scenarioTable(results: ProjectResults, unit: string): Table {
  const rs = results.results;
  const norms = results.normsUsed;
  const col = (fn: (r: ScenarioOk) => string, asis: (r: ScenarioOk) => string = () => DASH) =>
    rs.map((r) => {
      const ok = okOf(r);
      if (!ok) return r.status === "refused" ? `отказ: ${r.refusal.message}` : DASH;
      return ok.kind === "asis" ? asis(ok) : fn(ok);
    });
  const tcoYears = okOf(rs[0])?.tcoYears ?? 5;
  const rows: string[][] = [
    [
      "Состав оборудования",
      ...col(
        (r) =>
          r.items
            .map((i) => `${plural(i.n ?? 0, ["робот", "робота", "роботов"])} · ${plural(i.chargers, ["зарядка", "зарядки", "зарядок"])} · ${plural(i.operatorPosts, ["пост диспетчера", "поста диспетчера", "постов диспетчера"])}`)
            .join("; "),
        () => "текущий процесс, без роботов",
      ),
    ],
    ["CAPEX", ...col((r) => formatRub(r.capexRub), (r) => formatRub(r.capexRub))],
    ["OPEX в год", ...col((r) => formatRub(r.opexYearRub), (r) => formatRub(r.opexYearRub))],
    ["Годовой эффект", ...col((r) => formatRub(r.effectYearRub))],
    [
      "Окупаемость (простая)",
      ...col((r) => (r.paybackYears === null ? interpretBand(null, norms).text : `${years(r.paybackYears)} — ${interpretBand(r.paybackYears, norms).text}`)),
    ],
    ["ROI по ТЗ", ...col((r) => (r.roiTzPct === null ? DASH : `${fx(r.roiTzPct, 1)} %${r.kind === "raas" ? " (неинформативен при малом CAPEX)" : ""}`))],
    ["NPV", ...col((r) => formatRub(r.npvRub))],
    ["Дисконтированная окупаемость", ...col((r) => (r.discountedPaybackYears === null ? "за горизонтом расчёта" : years(r.discountedPaybackYears)))],
    [`TCO за ${plural(tcoYears, ["год", "года", "лет"])}`, ...col((r) => formatRub(r.tcoRub), (r) => formatRub(r.tcoRub))],
    ["Имитация", ...rs.map((r) => (r.kind === "asis" ? DASH : simText(results.sim[r.key], unit)))],
  ];
  return { head: ["Показатель", ...rs.map((r) => r.name)], rows };
}

/** Парк и производительность: откуда N и что говорит имитация. */
function fleetTable(results: ProjectResults, unit: string): Table {
  const rows: string[][] = [];
  for (const r of robotsOf(results)) {
    const sim = results.sim[r.key];
    for (const i of r.items) {
      rows.push([
        r.name,
        fx(i.peakPerHour, 2),
        i.thrNorm === null ? DASH : fx(i.thrNorm),
        i.thrCycle === null ? DASH : fx(i.thrCycle, 4),
        i.thrEff === null ? DASH : `${fx(i.thrEff, 4)} (${i.thrSource ?? DASH})`,
        i.routeLoadedM === null || i.routeEmptyM === null ? DASH : `${fx(i.routeLoadedM, 2)} / ${fx(i.routeEmptyM, 2)}`,
        i.nExact === null ? DASH : fx(i.nExact, 4),
        String(i.n ?? DASH),
        String(i.chargers),
        sim?.fleetByNorm === null || sim?.fleetByNorm === undefined ? DASH : String(sim.fleetByNorm),
        sim ? `${verdictShort(sim.verdict)} (${fx(sim.achievedPerH, 1)} ${unit})` : DASH,
        verdictShort(sim?.verdictByNorm ?? null),
        sim?.minStableFleet === null || sim?.minStableFleet === undefined ? DASH : String(sim.minStableFleet),
      ]);
    }
  }
  return {
    head: [
      "Сценарий",
      `λпик, ${unit}`,
      `Норма, ${unit}`,
      `Цикл, ${unit}`,
      `Принято, ${unit}`,
      "Плечо с грузом / порожнее, м",
      "Nточн",
      "N",
      "Зарядки",
      "N по норме",
      "Имитация при N",
      "Имитация при N по норме",
      "Мин. устойчивый парк",
    ],
    rows,
  };
}

const FLEET_NOTE =
  "λпик — пиковый поток заданий; норма — паспортная производительность; цикл — по плечам на планировке объекта (та же геометрия, что в имитации); N по норме — парк, рассчитанный только по паспортной норме; минимальный устойчивый парк — перебор имитацией в диапазоне [1; 2N], зерно 1.";

const LEVERS_HEAD = ["Сценарий", "Рычаг", "Диапазон (границы)", "NPV при нижней", "NPV при верхней", "Размах NPV", "Смена знака NPV"];

/**
 * Рычаги чувствительности NPV сценариев роботизации (ТЗ §3.5.6) в порядке движка — по убыванию
 * размаха. `limit` — сколько рычагов каждого сценария печатать; без него — все.
 */
function leversTable(results: ProjectResults, limit?: number): Table {
  const rows: string[][] = [];
  for (const r of robotsOf(results)) {
    for (const s of limit === undefined ? r.sensitivity : r.sensitivity.slice(0, limit)) {
      rows.push([
        r.name,
        s.label,
        `${rangeText(s.low, s.high, s.unit)} (${s.boundsSource})`,
        rubOrDash(s.npvLow),
        rubOrDash(s.npvHigh),
        formatRub(s.swing),
        s.signFlip ? "да" : "нет",
      ]);
    }
  }
  return { head: LEVERS_HEAD, rows };
}

/** Код риска «NPV меняет знак в диапазоне рычага»: он печатается столбцом таблицы чувствительности. */
const SIGN_FLIP = "SIGN_FLIP";

/**
 * Риски каждого сценария роботизации по убыванию важности, кроме смены знака NPV — её
 * показывает таблица чувствительности (столбец «Смена знака NPV») по каждому рычагу.
 */
function risksTable(results: ProjectResults): Table {
  const severity = { high: "высокий", medium: "средний", low: "низкий" } as const;
  const rows: string[][] = [];
  for (const r of robotsOf(results)) {
    for (const k of r.risks) if (k.code !== SIGN_FLIP) rows.push([r.name, severity[k.severity], k.text]);
  }
  return { head: ["Сценарий", "Важность", "Риск"], rows };
}

/**
 * Порог по зарплате каждой покупки: зарплата роли процесса, при которой NPV покупки равен нулю.
 * Считает движок (`breakEvenSalary` в lib/tz/econ/conclusion.ts → `breakEvenSalaryRubMonth`);
 * здесь только печать. Вывод проекта называет порог одной покупки — с лучшим NPV.
 */
function breakEvenTable(results: ProjectResults, defs: readonly ParamSpec[]): Table {
  const rows: string[][] = [];
  for (const r of robotsOf(results)) {
    if (r.kind !== "purchase") continue;
    const process = r.items[0] ? processDef(r.items[0].process) : undefined;
    const key = process?.salaryParam ?? null;
    const def = key === null ? undefined : defs.find((d) => d.key === key);
    const salary = key === null ? null : results.paramsUsed[key];
    rows.push([
      r.name,
      def?.label ?? DASH,
      typeof salary === "number" ? `${formatRub(salary)}/мес` : DASH,
      formatRub(r.npvRub),
      r.breakEvenSalaryRubMonth === null ? "не определён" : `${formatRub(r.breakEvenSalaryRubMonth)}/мес`,
    ]);
  }
  return { head: ["Сценарий", "Параметр зарплаты", "Зарплата в расчёте", "NPV при ней", "NPV = 0 при зарплате"], rows };
}

/** Вывод проекта: заголовок, пункты и оговорка. */
function conclusionBlocks(results: ProjectResults): Block[] {
  return [
    { kind: "p", text: results.conclusion.headline },
    { kind: "list", items: results.conclusion.bullets },
    { kind: "quote", text: results.conclusion.disclaimer },
  ];
}

// ——————————————————————————— Каталог ———————————————————————————

/** Масштаб каталога: продукты по глубине описания и характеристики по происхождению. */
type CatalogStats = {
  from: "db" | "code";
  release: string | null;
  products: number;
  byLevel: Record<ProductLevel, number>;
  withOrganizerId: number;
  addedByAdmin: number;
  archived: number;
  characteristics: number;
  charsByOrigin: [string, number][];
  charsConfirmed: number;
};

const LEVELS: readonly ProductLevel[] = ["identification", "enriched", "examples"];

function levelCounts(pairs: readonly { level: string; n: number }[]): Record<ProductLevel, number> {
  const out: Record<ProductLevel, number> = { identification: 0, enriched: 0, examples: 0 };
  for (const { level, n } of pairs) if ((LEVELS as readonly string[]).includes(level)) out[level as ProductLevel] += n;
  return out;
}

/** Происхождения по убыванию числа характеристик, при равенстве — по коду. */
function sortOrigins(m: ReadonlyMap<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Счётчики каталога в БД. Действующие продукты — не архивные, как «всего в каталоге» на /catalog;
 * характеристики — у действующих продуктов. Запросы по очереди: одно соединение.
 */
async function catalogStatsDb(db: PrismaClient, release: string | null): Promise<CatalogStats> {
  const active = { archived: false };
  const products = await db.catalogProduct.count({ where: active });
  const levels = await db.catalogProduct.groupBy({ by: ["level"], where: active, _count: { _all: true } });
  const withOrganizerId = await db.catalogProduct.count({ where: { ...active, organizerCatalogId: { not: null } } });
  const addedByAdmin = await db.catalogProduct.count({ where: { ...active, origin: "ADMIN" } });
  const archived = await db.catalogProduct.count({ where: { archived: true } });
  const characteristics = await db.productCharacteristic.count({ where: { product: active } });
  const origins = await db.productCharacteristic.groupBy({ by: ["origin"], where: { product: active }, _count: { _all: true } });
  const charsConfirmed = await db.productCharacteristic.count({ where: { product: active, confirmed: true } });
  return {
    from: "db",
    release,
    products,
    byLevel: levelCounts(levels.map((l) => ({ level: l.level, n: l._count._all }))),
    withOrganizerId,
    addedByAdmin,
    archived,
    characteristics,
    charsByOrigin: sortOrigins(new Map(origins.map((o) => [o.origin, o._count._all]))),
    charsConfirmed,
  };
}

/** Те же счётчики по данным организатора в коде (режим --offline). */
function catalogStatsCode(): CatalogStats {
  const origins = new Map<string, number>();
  let characteristics = 0;
  let charsConfirmed = 0;
  for (const p of CATALOG) {
    for (const c of Object.values(p.characteristics)) {
      characteristics += 1;
      if (c.confirmed) charsConfirmed += 1;
      origins.set(c.origin, (origins.get(c.origin) ?? 0) + 1);
    }
  }
  return {
    from: "code",
    release: null,
    products: CATALOG.length,
    byLevel: levelCounts(CATALOG.map((p) => ({ level: p.level, n: 1 }))),
    withOrganizerId: CATALOG.filter((p) => p.organizerCatalogId !== null).length,
    addedByAdmin: 0,
    archived: 0,
    characteristics,
    charsByOrigin: sortOrigins(origins),
    charsConfirmed,
  };
}

/** Подпись происхождения как на бейджах; неизвестный код (строка из БД) печатается как есть. */
function originText(origin: string): string {
  return originLabel(origin as Origin) ?? origin;
}

function catalogBlocks(s: CatalogStats, calcProducts: number): Block[] {
  const rows: string[][] = [
    ["Выпуск данных", s.release ?? (s.from === "code" ? "без БД (данные из кода)" : "не записан")],
    ["Продуктов в каталоге (без архивных)", fx(s.products)],
    ...LEVELS.map((l) => [`— ${LEVEL_LABELS[l]}`, fx(s.byLevel[l])]),
    ["С id каталога организатора", fx(s.withOrganizerId)],
    ["Добавлено администратором", fx(s.addedByAdmin)],
    ["В архиве (нет в текущих данных организатора)", fx(s.archived)],
    ["Продуктов в подборе и расчёте склада", fx(calcProducts)],
    ["Характеристик с источником (у продуктов без архивных)", fx(s.characteristics)],
    ...s.charsByOrigin.map(([origin, n]) => [`— происхождение «${originText(origin)}»`, fx(n)]),
    ["— подтверждены первоисточником", fx(s.charsConfirmed)],
  ];
  return [
    { kind: "h2", text: "Каталог" },
    {
      kind: "p",
      text:
        (s.from === "db" ? "Счётчики из БД текущего выпуска данных. " : "Счётчики по данным организатора в коде (lib/data/organizer) — проверочный прогон без БД. ") +
        "Продукты без архивных — как «всего в каталоге» на странице /catalog. «Только идентификация» — поля каталога организатора, в расчёт не идут; в подбор склада идут продукты с характеристиками, привязанные к процессам склада.",
    },
    { kind: "table", table: { head: ["Показатель", "Значение"], rows } },
  ];
}

// ——————————————————————————— Вывод ———————————————————————————

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderMarkdown(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "h1") out.push(`# ${b.text}`, "");
    else if (b.kind === "h2") out.push(`## ${b.text}`, "");
    else if (b.kind === "h3") out.push(`### ${b.text}`, "");
    else if (b.kind === "p") out.push(b.text, "");
    else if (b.kind === "quote") out.push(`> ${b.text}`, "");
    else if (b.kind === "list") out.push(...b.items.map((i) => `- ${i}`), "");
    else {
      out.push(`| ${b.table.head.map(mdCell).join(" | ")} |`);
      out.push(`|${b.table.head.map(() => "---").join("|")}|`);
      for (const row of b.table.rows) out.push(`| ${row.map(mdCell).join(" | ")} |`);
      out.push("");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** Таблица для консоли: столбцы выровнены пробелами. */
function renderTextTable(t: Table): string[] {
  const all = [t.head, ...t.rows];
  const widths = t.head.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
  const line = (r: string[]) => r.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join(" │ ").trimEnd();
  return [line(t.head), widths.map((w) => "─".repeat(w)).join("─┼─"), ...t.rows.map(line)];
}

function renderText(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "h1") out.push(b.text.toUpperCase(), "=".repeat(Math.min(100, b.text.length)), "");
    else if (b.kind === "h2") out.push(b.text, "=".repeat(Math.min(100, b.text.length)));
    else if (b.kind === "h3") out.push(b.text, "-".repeat(Math.min(100, b.text.length)));
    else if (b.kind === "p" || b.kind === "quote") out.push(b.text, "");
    else if (b.kind === "list") out.push(...b.items.map((i) => `  • ${i}`), "");
    else out.push(...renderTextTable(b.table), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// ——————————————————————————— Сборка ———————————————————————————

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  let db: PrismaClient | null = null;
  try {
    let live: LiveInputs;
    let release: string | null = null;
    let catalog: CatalogStats;
    if (args.offline) {
      live = offlineInputs();
      catalog = catalogStatsCode();
    } else {
      db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
      live = await loadLiveInputs(db, FACILITY);
      release = (await latestDataRelease(db))?.version ?? null;
      if (live.products.length === 0) {
        console.error("Каталог продуктов в БД пуст: выполните `npm run db:seed` или запустите с --offline (данные из кода).");
        return 1;
      }
      catalog = await catalogStatsDb(db, release);
    }

    // Параметры — как у «Нового проекта» на демо-данных (createProjectAction) и у засеянного
    // demo-warehouse (scripts/seed-demo.ts): базовые значения описаний параметров.
    const defs = live.paramDefs.filter((d) => d.facility === FACILITY);
    const params = applyDefaults(live.paramDefs, {});
    const common = { facility: FACILITY, params, paramDefs: live.paramDefs, products: live.products, norms: live.norms };
    const unit = "пал./ч";
    // Часы не нужны: длительность прогонов в вывод не попадает, а вывод должен повторяться.
    const now = () => 0;

    // 1) Путь жюри: сценарии засеянного проекта (demoScenarios с DEMO_SECOND_PURCHASE) — при
    // 'auto' это ровно сценарии «Нового проекта» (initialScenarios); расхождение печатается.
    const demo = demoScenarios(live, params);
    const auto = initialScenarios(common);
    const sameAsNew = stableJson(demo.scenarios) === stableJson(auto);
    const jury = resultsFromInputs(live, { facility: FACILITY, params, scenarios: demo.scenarios, now }).results;

    // 3) Дополнительный пример: вторая покупка — DMR Carrier P вместо кандидата подбора.
    const h = findProduct(live.products, H1500);
    const c = findProduct(live.products, CARRIER_P);
    const extraScenarios: ScenarioSpec[] | null =
      h && c
        ? [
            asisScenario(),
            { key: "p1", name: `Покупка — ${shortProductName(h.name)}`, kind: "purchase", items: [{ process: PT, productSlug: h.slug }] },
            { key: "r1", name: `Услуга (RaaS) — ${shortProductName(h.name)}`, kind: "raas", items: [{ process: PT, productSlug: h.slug }] },
            { key: "p2", name: `Покупка — ${shortProductName(c.name)}`, kind: "purchase", items: [{ process: PT, productSlug: c.slug }] },
          ]
        : null;
    const extra = extraScenarios ? resultsFromInputs(live, { facility: FACILITY, params, scenarios: extraScenarios, now }).results : null;

    const problems: string[] = [];
    const check = (res: ProjectResults, where: string) => {
      for (const r of res.results) {
        if (r.status !== "ok") problems.push(`${where}«${r.name}» не рассчитан: ${r.refusal.message}`);
        else if (r.kind !== "asis" && !res.sim[r.key]) problems.push(`${where}«${r.name}»: имитация не выполнена`);
      }
    };
    check(jury, "путь жюри: ");
    if (extra) check(extra, "дополнительный пример: ");
    else {
      const missing = [!h ? "Ronavi H1500" : null, !c ? "DMR Carrier P" : null].filter(Boolean).join(", ");
      problems.push(`дополнительный пример не рассчитан — нет продуктов в каталоге: ${missing}`);
    }

    const ov = ORGANIZER_DATA_VERSION;
    const choice =
      DEMO_SECOND_PURCHASE === "auto"
        ? "Решение владельца от 2026-09-25 — вариант «А»: сценарии целиком выбирает автоподбор, вторая покупка не закреплена (DEMO_SECOND_PURCHASE = 'auto' в scripts/seed-demo.ts)."
        : `Вторая покупка засеянного проекта закреплена: DEMO_SECOND_PURCHASE = { slug: "${DEMO_SECOND_PURCHASE.slug}" } в scripts/seed-demo.ts — это не вариант «А» (автоподбор), подписанный владельцем 2026-09-25.`;
    const blocks: Block[] = [
      { kind: "h1", text: "Демо-числа: склад организатора" },
      {
        kind: "p",
        text:
          `Сгенерировано командой \`npx tsx scripts/print-demo-numbers.ts${args.markdown ? " --markdown" : ""}${args.offline ? " --offline" : ""}\` — не править руками. ` +
          `Источник данных: ${args.offline ? "код (lib/data/organizer), нормативы по умолчанию — проверочный прогон без БД" : `БД, выпуск данных ${release ?? "не записан"}`}; ` +
          `описания параметров — ${live.paramDefsFrom === "db" ? "таблица ParamDefinition" : "код (lib/data/organizer)"}.`,
      },
      {
        kind: "p",
        text: `Версии: модель ${jury.modelVersion} · имитация ${jury.simModelVersion} · данные расчёта пути жюри ${jury.dataVersion}. Данные организатора: датасеты ${ov.datasets}, каталог ${ov.catalog}, примеры решений ${ov.examples}; исследование открытых источников: ${ov.research}.`,
      },
      {
        kind: "p",
        text:
          `Объект: базовые значения датасета организатора, лист «Склад» (${plural(defs.length, ["параметр", "параметра", "параметров"])} вместе с дополнениями). ` +
          `Разделы: путь жюри — основной, его видит член жюри; каталог — масштаб данных; дополнительный пример с DMR Carrier P — справочно, в путь жюри не входит.`,
      },

      { kind: "h2", text: JURY_TITLE },
      {
        kind: "p",
        text:
          `Так выглядит проект, созданный кнопкой «Новый проект» с источником «Демо-данные организатора». ${choice} ` +
          `Засеянный проект «${DEMO_PROJECT_NAME}» (/projects/${DEMO_PROJECT_ID}) и гостевой /demo строятся той же функцией сценариев по умолчанию (lib/projects/defaults.ts). ` +
          `Сценарии, выбранные подбором: ${quoted(jury.scenarios.map((s) => s.name))}. Версия данных расчёта ${jury.dataVersion}.`,
      },
    ];
    if (!sameAsNew) {
      blocks.push({
        kind: "p",
        text: `Внимание: засеянный проект отличается от «Нового проекта» — новый проект получит сценарии ${quoted(auto.map((s) => s.name))}.`,
      });
    }
    if (demo.warning) blocks.push({ kind: "p", text: `Внимание: ${demo.warning}.` });
    blocks.push(
      { kind: "h3", text: "Сценарии" },
      { kind: "table", table: scenarioTable(jury, unit) },
      { kind: "h3", text: "Парк, производительность и имитация" },
      { kind: "table", table: fleetTable(jury, unit) },
      { kind: "p", text: FLEET_NOTE },
      { kind: "h3", text: "Риски сценариев" },
      {
        kind: "p",
        text: "Риски каждого сценария роботизации по убыванию важности; вывод ниже называет три главных риска рекомендуемого сценария. Смена знака NPV в диапазоне рычага — в таблице чувствительности.",
      },
      { kind: "table", table: risksTable(jury) },
      { kind: "h3", text: "Чувствительность NPV: все рычаги" },
      {
        kind: "p",
        text: "Каждая граница — полный пересчёт модели; рычаги каждого сценария — по убыванию размаха NPV. Границы — у организатора, где он их дал, иначе норматив или ±20 %. Смена знака NPV внутри диапазона выносится в риски.",
      },
      { kind: "table", table: leversTable(jury) },
      { kind: "h3", text: "Порог по зарплате" },
      {
        kind: "p",
        text: "Зарплата роли процесса, при которой NPV покупки равен нулю (NPV линеен по зарплате, порог считает движок по двум расчётам). Вывод проекта называет порог только у покупки с лучшим NPV; здесь — у каждой покупки.",
      },
      { kind: "table", table: breakEvenTable(jury, defs) },
      { kind: "h3", text: "Вывод" },
      ...conclusionBlocks(jury),
    );

    blocks.push(...catalogBlocks(catalog, live.products.length));

    blocks.push({ kind: "h2", text: EXTRA_TITLE });
    if (!extra) {
      blocks.push({ kind: "p", text: "Не рассчитан: в каталоге нет продуктов Ronavi H1500 или DMR Carrier P." });
    } else {
      blocks.push(
        {
          kind: "p",
          text:
            `Те же параметры объекта, но вторая покупка — ${shortProductName(c?.name ?? "")} из «Примеров решений» организатора (продукт с паспортной нормой организатора) вместо кандидата подбора. ` +
            `Набор задан этим скриптом, а не подбором, и в путь жюри не входит: новый проект, засеянный проект и /demo показывают сценарии раздела «${JURY_TITLE}». ` +
            `Сценарии: ${quoted(extra.scenarios.map((s) => s.name))}. Числа сценариев с теми же решениями совпадают с путём жюри; вывод другой, потому что сравниваются другие варианты. Версия данных расчёта ${extra.dataVersion}.`,
        },
        { kind: "h3", text: "Сценарии" },
        { kind: "table", table: scenarioTable(extra, unit) },
        { kind: "h3", text: "Парк, производительность и имитация" },
        { kind: "table", table: fleetTable(extra, unit) },
        { kind: "h3", text: "Сильнейшие рычаги (чувствительность NPV)" },
        { kind: "table", table: leversTable(extra, 3) },
        { kind: "h3", text: "Вывод" },
        ...conclusionBlocks(extra),
      );
    }
    if (problems.length > 0) {
      blocks.push({ kind: "h2", text: "Неожиданные отказы" }, { kind: "list", items: problems });
    }

    process.stdout.write(args.markdown ? renderMarkdown(blocks) : renderText(blocks));
    if (problems.length > 0) {
      console.error(`Демо-числа неполные: ${problems.join("; ")}`);
      return 1;
    }
    return 0;
  } finally {
    await db?.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error("print-demo-numbers: ошибка", e);
    process.exit(1);
  });
