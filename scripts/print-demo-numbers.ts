// Печать демонстрационных чисел склада организатора (ТЗ §5.6: числа презентации обязаны
// воспроизводиться в сданной сборке). Числа НЕ вписываются руками ни в презентацию, ни в
// сценарий демонстрации — их даёт только этот скрипт на тех же данных и той же модели, что
// рабочая область и /demo.
//
// Два блока: (1) демонстрация — «Как есть», покупка и услуга Ronavi H1500, покупка DMR Carrier P
// (вторая покупка зафиксирована); (2) новый проект со сценариями по умолчанию — ровно то, что
// увидит член жюри, создав проект на демо-данных (§5.4). Если подбор по умолчанию предлагает
// те же сценарии, второй блок сводится к одной строке.
//
// Запуск:
//   npx tsx scripts/print-demo-numbers.ts             — таблица в консоль;
//   npx tsx scripts/print-demo-numbers.ts --markdown  — только Markdown (для
//     docs/submission/demo-numbers.md; вывод детерминирован: без даты и длительностей, чтобы
//     повторный прогон давал тот же файл);
//   npx tsx scripts/print-demo-numbers.ts --offline   — без БД: данные организатора из кода
//     (lib/data/organizer) и нормативы по умолчанию. Для проверки до сева; для презентации —
//     только вариант из БД.
// Код выхода 1 — сценарий неожиданно не рассчитан или имитация не выполнена; 2 — неверные
// аргументы.
//
// @prisma/client не читает .env сам — отсюда dotenv/config (как в scripts/seed.ts). Импорты
// относительные: tsx запускает скрипт без алиаса «@/».
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { latestDataRelease } from "../lib/catalog/queries";
import { productForCalcFromSeed } from "../lib/catalog/product-for-calc";
import { CATALOG } from "../lib/data/organizer/catalog";
import { paramSpecsFor } from "../lib/data/organizer/params";
import { ORGANIZER_DATA_VERSION } from "../lib/data/organizer/version.generated";
import { pluralRu } from "../lib/format/plural";
import { formatRub } from "../lib/format/rub";
import { asisScenario, defaultScenarios, shortProductName } from "../lib/projects/defaults";
import { loadLiveInputs, resultsFromInputs, type LiveInputs } from "../lib/projects/recalc";
import { BOTTLENECK_LABELS } from "../lib/sim/export-rows";
import type { SimSummaryStored } from "../lib/sim/types";
import { interpretBand } from "../lib/tz/econ/interpret";
import { fx, rangeText } from "../lib/tz/econ/text";
import { buildProjectModel } from "../lib/tz/model";
import { resolveNorms } from "../lib/tz/norms";
import { processDef } from "../lib/tz/processes";
import type { ProductForCalc, ProjectResults, ScenarioOk, ScenarioResult, ScenarioSpec } from "../lib/tz/types";
import { stableJson } from "../lib/tz/version";

const FACILITY = "warehouse";
const PT = "pallet-transport";
/** Продукты демонстрации: slug в данных организатора и запасной поиск по названию. */
const H1500 = { slug: "ronavi-h1500", name: /h1500/i };
const CARRIER_P = { slug: "dikom-dmr-carrier-p", name: /carrier\s*p\b/i };

type Table = { head: string[]; rows: string[][] };
type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
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

function okOf(r: ScenarioResult | undefined): ScenarioOk | null {
  return r && r.status === "ok" ? r : null;
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
  for (const r of results.results) {
    const ok = okOf(r);
    if (!ok || ok.kind === "asis") continue;
    const sim = results.sim[r.key];
    for (const i of ok.items) {
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

/** Три сильнейших рычага каждого рассчитанного сценария роботизации. */
function leversTable(results: ProjectResults): Table {
  const rows: string[][] = [];
  for (const r of results.results) {
    const ok = okOf(r);
    if (!ok || ok.kind === "asis") continue;
    for (const s of ok.sensitivity.slice(0, 3)) {
      rows.push([
        r.name,
        s.label,
        `${rangeText(s.low, s.high, s.unit)} (${s.boundsSource})`,
        formatRub(s.npvLow),
        formatRub(s.npvHigh),
        formatRub(s.swing),
        s.signFlip ? "да" : "нет",
      ]);
    }
  }
  return { head: ["Сценарий", "Рычаг", "Диапазон (границы)", "NPV при нижней", "NPV при верхней", "Размах NPV", "Смена знака NPV"], rows };
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
    else if (b.kind === "h2") out.push(b.text, "-".repeat(Math.min(100, b.text.length)));
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
    if (args.offline) {
      live = offlineInputs();
    } else {
      db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
      live = await loadLiveInputs(db, FACILITY);
      release = (await latestDataRelease(db))?.version ?? null;
      if (live.products.length === 0) {
        console.error("Каталог продуктов в БД пуст: выполните `npm run db:seed` или запустите с --offline (данные из кода).");
        return 1;
      }
    }

    const h = findProduct(live.products, H1500);
    const c = findProduct(live.products, CARRIER_P);
    if (!h || !c) {
      console.error(`Нет продуктов демонстрации в каталоге: ${[!h ? "Ronavi H1500" : null, !c ? "DMR Carrier P" : null].filter(Boolean).join(", ")}.`);
      return 1;
    }

    const defs = live.paramDefs.filter((d) => d.facility === FACILITY);
    const params = Object.fromEntries(defs.map((d) => [d.key, d.base]));
    const hName = shortProductName(h.name);
    const cName = shortProductName(c.name);
    const scenarios: ScenarioSpec[] = [
      asisScenario(),
      { key: "p1", name: `Покупка — ${hName}`, kind: "purchase", items: [{ process: PT, productSlug: h.slug }] },
      { key: "r1", name: `Услуга (RaaS) — ${hName}`, kind: "raas", items: [{ process: PT, productSlug: h.slug }] },
      { key: "p2", name: `Покупка — ${cName}`, kind: "purchase", items: [{ process: PT, productSlug: c.slug }] },
    ];
    // Что предложил бы подбор сам — для прозрачности: вторая покупка зафиксирована вручную.
    const probe = buildProjectModel({ facility: FACILITY, params, paramDefs: live.paramDefs, scenarios: [asisScenario()], products: live.products, norms: live.norms });
    const defaults = defaultScenarios(probe.selection, FACILITY, live.products);
    const defaultName = (key: string) => defaults.find((s) => s.key === key)?.name ?? DASH;

    // Часы не нужны: длительность прогонов в вывод не попадает, а вывод должен повторяться.
    const { results } = resultsFromInputs(live, { facility: FACILITY, params, scenarios, now: () => 0 });
    // Проект, который получит член жюри по §5.4 («Новый проект» → демо-данные): сценарии выбирает
    // подбор, без фиксации Carrier P. Его числа тоже печатаются, чтобы презентация и сценарий
    // демонстрации не расходились с тем, что человек увидит в сборке.
    const sameAsDemo = stableJson(defaults) === stableJson(scenarios);
    const fresh = sameAsDemo ? null : resultsFromInputs(live, { facility: FACILITY, params, now: () => 0 }).results;

    const unit = "пал./ч";
    const problems: string[] = [];
    const check = (res: ProjectResults, where: string) => {
      for (const r of res.results) {
        if (r.status !== "ok") problems.push(`${where}«${r.name}» не рассчитан: ${r.refusal.message}`);
        else if (r.kind !== "asis" && !res.sim[r.key]) problems.push(`${where}«${r.name}»: имитация не выполнена`);
      }
    };
    check(results, "");
    if (fresh) check(fresh, "новый проект: ");

    const ov = ORGANIZER_DATA_VERSION;
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
        text: `Версии: модель ${results.modelVersion} · имитация ${results.simModelVersion} · данные расчёта ${results.dataVersion}. Данные организатора: датасеты ${ov.datasets}, каталог ${ov.catalog}, примеры решений ${ov.examples}; исследование открытых источников: ${ov.research}.`,
      },
      {
        kind: "p",
        text:
          `Объект: базовые значения датасета организатора, лист «Склад» (${plural(defs.length, ["параметр", "параметра", "параметров"])} вместе с дополнениями). ` +
          `Сценарии: «Как есть», покупка и услуга (RaaS) ${hName}, покупка ${cName}. Подбор по умолчанию предлагает: ${defaultName("p1")}; ${defaultName("r1")}; ${defaultName("p2")} — ` +
          `вторая покупка для демонстрации зафиксирована как ${cName} из «Примеров решений» организатора.`,
      },
      { kind: "h2", text: "Сценарии" },
      { kind: "table", table: scenarioTable(results, unit) },
      { kind: "h2", text: "Парк, производительность и имитация" },
      { kind: "table", table: fleetTable(results, unit) },
      {
        kind: "p",
        text: "λпик — пиковый поток заданий; норма — паспортная производительность; цикл — по плечам на планировке объекта (та же геометрия, что в имитации); N по норме — парк, рассчитанный только по паспортной норме; минимальный устойчивый парк — перебор имитацией в диапазоне [1; 2N], зерно 1.",
      },
      { kind: "h2", text: "Сильнейшие рычаги (чувствительность NPV)" },
      { kind: "table", table: leversTable(results) },
      { kind: "h2", text: "Вывод" },
      { kind: "p", text: results.conclusion.headline },
      { kind: "list", items: results.conclusion.bullets },
      { kind: "quote", text: results.conclusion.disclaimer },
      { kind: "h2", text: "Новый проект со сценариями по умолчанию (путь жюри, ТЗ §5.4)" },
    ];
    if (!fresh) {
      blocks.push({ kind: "p", text: "Подбор по умолчанию предлагает те же сценарии, что выше: числа нового проекта совпадают с таблицами демонстрации." });
    } else {
      blocks.push(
        {
          kind: "p",
          text:
            `Так выглядит проект, созданный кнопкой «Новый проект» на демо-данных организатора: сценарии выбирает подбор — ${fresh.scenarios.map((s) => `«${s.name}»`).join(", ")}. ` +
            `Числа сценариев с теми же решениями совпадают с таблицами выше; вывод может отличаться, потому что сравниваются другие варианты. Версия данных расчёта ${fresh.dataVersion}.`,
        },
        { kind: "table", table: scenarioTable(fresh, unit) },
        { kind: "table", table: fleetTable(fresh, unit) },
        { kind: "p", text: fresh.conclusion.headline },
        { kind: "list", items: fresh.conclusion.bullets },
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
