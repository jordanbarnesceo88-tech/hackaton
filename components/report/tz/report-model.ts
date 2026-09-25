import { domainToUnicode } from "node:url";
import { contributionMax, contributionPoints, formatPoints } from "@/components/project/score-bar";
import type { ParamsSource } from "@/lib/projects/queries";
import { formatNum, formatRub } from "@/lib/format/rub";
import { facilityLabelOf, scenarioTitle, type ReportResults } from "@/lib/report/tz/rows";
import { fx } from "@/lib/tz/econ/text";
import { processDef } from "@/lib/tz/processes";
import type {
  ItemResult,
  LineItem,
  ParamIssue,
  ParamSpec,
  ScenarioResult,
  ScoreContribution,
  SelectionResult,
  SensitivityRow,
} from "@/lib/tz/types";

/**
 * Чистые помощники печатного отчёта по проекту: тексты и группировки, которых нет в общих
 * строках отчёта (lib/report/tz). Модуль без "use client": страница отчёта — серверный
 * компонент и не может вызывать функции из клиентских модулей рабочей области (там они
 * становятся клиентскими ссылками), поэтому нужные тексты собраны здесь заново по тем же
 * полям результата. Только сервер (displayUrl берёт node:url).
 */

/** Сколько сильнейших рычагов чувствительности печатать по каждому сценарию. */
export const REPORT_TOP_LEVERS = 5;

/**
 * Откуда параметры проекта — одной фразой. Демо-данные названы по датасету организатора того
 * типа объекта, для которого создан проект: у организатора отдельные листы «Склад»,
 * «Аэропорт» и «Медучреждение» (ТЗ §5.5 — демо-проекты всех трёх типов).
 */
export function paramsSourceText(ps: ParamsSource, facility: string): string {
  if (ps.kind === "demo") return `демо-данные организатора (датасет «${facilityLabelOf(facility)}»)`;
  if (ps.kind === "upload") return ps.fileName ? `загружены из файла «${ps.fileName}»` : "загружены из файла";
  if (ps.kind === "api") return "переданы через API";
  return "введены вручную";
}

/**
 * Названия сценариев для журнала корректировок: по ключу и по названию → название с ⚠ у
 * решения, добавленного вручную (как в XLSX).
 */
export function scenarioTitleMap(results: ReportResults): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of results.results) {
    const title = scenarioTitle(results, r);
    out[r.key] = title;
    out[r.name] = title;
  }
  return out;
}

/**
 * Сильнейшие рычаги сценария по размаху результата (движок уже сортирует; сортировка здесь —
 * страховка для результатов старой версии). Сортировка устойчивая: при равном размахе порядок
 * движка сохраняется.
 */
export function topLevers(rows: readonly SensitivityRow[], n = REPORT_TOP_LEVERS): SensitivityRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.swing - a.r.swing || a.i - b.i)
    .slice(0, Math.max(0, n))
    .map((x) => x.r);
}

/** Единица потока процесса в коротком виде: «паллет/ч» → «пал./ч» (как в рабочей области). */
function shortUnit(unit: string): string {
  return unit.replace(/^паллет\//, "пал./");
}

/**
 * Как получен парк позиции (ТЗ §3.5.2: число роботов = пиковая потребность / эффективная
 * производительность с загрузкой, доступностью и резервом): спрос, производительность по
 * норме, циклу и принятая, парк, охват спроса, персонал.
 */
export function fleetLines(r: ItemResult): string[] {
  const p = processDef(r.process);
  const du = shortUnit(p?.demandUnit ?? "ед./сут");
  const tu = shortUnit(p?.throughputUnit ?? "ед./ч");
  const lines: string[] = [];
  lines.push(`Спрос: ${fx(r.demandPerDay)} ${du} → ${fx(r.avgPerHour, 1)} ${tu} в среднем, ${fx(r.peakPerHour, 1)} ${tu} в пик`);
  const norm = r.thrNorm === null ? "норма — нет или неприменима" : `норма ${fx(r.thrNorm, 1)}`;
  const leg = r.routeLoadedM === null ? "" : ` (плечо ${fx(r.routeLoadedM, 1)} м, оценка по планировке)`;
  const cycle = r.thrCycle === null ? "по циклу — нет данных" : `по циклу ${fx(r.thrCycle, 1)}${leg}`;
  const eff = r.thrEff === null ? "принято — нет" : `принято ${fx(r.thrEff, 1)} ${tu}${r.thrSource ? ` (${r.thrSource})` : ""}`;
  lines.push(`Производительность: ${norm} · ${cycle} · ${eff}`);
  if (r.n !== null) {
    const exact = r.nExact === null ? null : `⌈${fx(r.nExact, 2)}⌉ = ${r.nAuto ?? "—"}`;
    lines.push(
      r.nOverridden ? `Роботов: ${r.n} — задано вручную${exact ? ` (расчёт: ${exact})` : ""}` : `Роботов: ${exact ?? r.n}`,
    );
  }
  lines.push(`Охват пикового спроса: ${fx(r.coverage * 100, 1)} %`);
  lines.push(`Высвобождается ставок: ${fx(r.releasedFte, 1)} из ${fx(r.headcount)}`);
  return lines;
}

/** Статья сценария по ключу (статьи позиций уже сложены движком по ключу). */
function lineOf(lines: readonly LineItem[], key: string): LineItem | undefined {
  return lines.find((l) => l.key === key);
}

/**
 * ПО управления парком одной строкой: разовая статья CAPEX и годовые лицензии OPEX с
 * происхождением. У услуги (RaaS) ПО принято входящим в подписку — это допущение, оно
 * названо прямо.
 */
export function fleetSoftwareText(r: ScenarioResult): string {
  if (r.kind === "asis") return "—";
  if (r.status !== "ok") return "не рассчитано";
  const sw = lineOf(r.capexLines, "software");
  const lic = lineOf(r.opexLines, "licences");
  if (sw?.includedInSubscription) return "входит в подписку (допущение — проверить в договоре)";
  const parts: string[] = [];
  if (sw) parts.push(`${formatRub(sw.valueRub)} разово${sw.originNote ? ` (${sw.originNote})` : ""}`);
  if (lic && !lic.includedInSubscription) {
    parts.push(lic.valueRub > 0 ? `лицензии ${formatRub(lic.valueRub)} в год` : "годовые лицензии не опубликованы — приняты 0 ₽");
  }
  return parts.join("; ") || "—";
}

/** Позиция сценария, которую проверяет имитация: первый процесс с поддержкой имитации. */
export function simItemOf(r: ScenarioResult): ItemResult | null {
  return r.items.find((it) => processDef(it.process)?.simSupported === true) ?? null;
}

/** Группа сценариев с одинаковой схемой: планировка зависит только от параметров объекта и числа зарядок. */
export type LayoutGroup = { chargers: number; titles: string[]; item: ItemResult };

/**
 * Сценарии роботизации, у которых есть позиция для имитации, сгруппированные по числу зарядных
 * станций: у сценариев с одинаковым числом зарядок схема совпадает до линии, печатать её
 * дважды незачем.
 */
export function layoutGroups(results: ReportResults): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  for (const r of results.results) {
    if (r.kind === "asis") continue;
    const item = simItemOf(r);
    if (!item) continue;
    const title = scenarioTitle(results, r);
    const g = groups.find((x) => x.chargers === item.chargers);
    if (g) g.titles.push(title);
    else groups.push({ chargers: item.chargers, titles: [title], item });
  }
  return groups;
}

/**
 * Группы по имени в порядке первого появления: элементы одной группы собираются вместе, даже
 * если во входе они идут не подряд. Так раздел параметров печатается одним блоком, как в
 * форме параметров рабочей области (groupBySection в components/project/params-form.tsx —
 * алгоритм тот же; модуль формы клиентский, поэтому здесь своя копия): дополнения к
 * параметрам организатора имеют большие номера `order` и иначе открывали бы раздел повторно.
 */
export function groupInOrder<T>(items: readonly T[], nameOf: (item: T) => string): { name: string; items: T[] }[] {
  const out: { name: string; items: T[] }[] = [];
  const index = new Map<string, { name: string; items: T[] }>();
  for (const item of items) {
    const name = nameOf(item);
    let g = index.get(name);
    if (!g) {
      g = { name, items: [] };
      index.set(name, g);
      out.push(g);
    }
    g.items.push(item);
  }
  return out;
}

/** Результаты подбора по процессам в порядке движка подбора. */
export function selectionByProcess(selection: readonly SelectionResult[]): { process: string; rows: SelectionResult[] }[] {
  return groupInOrder(selection, (s) => s.process).map((g) => ({ process: g.name, rows: g.items }));
}

/** Недостающие данные результата подбора одной строкой: «что — как исправить»; нет — «—». */
export function missingText(s: SelectionResult): string {
  return s.missing.map((m) => `${m.label}: ${m.howToFix}`).join("; ") || "—";
}

/**
 * Ограничения подбора для решений, которые стоят в сценариях (ТЗ §3.4: ограничения по каждому
 * результату) — для раздела «Ограничения модели». Без повторов.
 */
export function scenarioSelectionLimitations(results: ReportResults): { product: string; text: string }[] {
  const used = new Set<string>();
  for (const s of results.scenarios) for (const it of s.items) used.add(`${it.process}:${it.productSlug}`);
  const out: { product: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const s of results.selection) {
    if (!used.has(`${s.process}:${s.productSlug}`)) continue;
    for (const text of s.limitations) {
      const k = `${s.productName}\u0001${text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ product: s.productName, text });
    }
  }
  return out;
}

/**
 * Замечания к параметру для отчёта. Выход за диапазон назван по происхождению диапазона:
 * «организатора» — только если описание от организатора, иначе «допустимого». Замечание
 * проверки о том же выходе за диапазон (`out_of_range`) не повторяется.
 */
export function paramNotes(def: ParamSpec, value: number | string | null, issues: readonly ParamIssue[], rangeText: string): string[] {
  const out: string[] = [];
  const outOfRange =
    typeof value === "number" && ((def.min !== null && value < def.min) || (def.max !== null && value > def.max));
  if (outOfRange) {
    out.push(`⚠ вне ${def.origin === "organizer" ? "диапазона организатора" : "допустимого диапазона"} (${rangeText})`);
  }
  for (const i of issues) {
    if (i.key !== def.key) continue;
    if (outOfRange && i.code === "out_of_range") continue;
    out.push(i.message);
  }
  return out;
}

/**
 * Вклады факторов балла подбора одной строкой для печати: «Экономика 27/40 · Данные 5/20 · …»
 * (ТЗ §3.4.5 — видны критерии и вклад каждого фактора). Очки — те же, что на полосе балла в
 * рабочей области (`contributionPoints`, `contributionMax`).
 */
export function scoreFactorsText(contributions: readonly ScoreContribution[]): string {
  return contributions.map((c) => `${c.label} ${formatNum(contributionPoints(c))}/${formatPoints(contributionMax(c))}`).join(" · ");
}

/**
 * Ссылка для чтения человеком: кириллический домен без punycode («xn--l1aeahg.xn--p1ai» →
 * «морос.рф») и кириллический путь без %-кодов («…/pdf/%D0%A4…» → «…/pdf/Ф…»). Сама ссылка
 * (href) остаётся как есть. Домен, который не раскодировать, остаётся в ASCII; путь с битой
 * %-последовательностью — как есть; не URL вовсе — как есть.
 */
export function displayUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return decodeOrKeep(url);
  }
  const host = domainToUnicode(parsed.hostname) || parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : "";
  const auth = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@` : "";
  const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // Корневой путь «/» у ссылки без пути URL добавляет сам — в подписи его не было.
  const tail = rest === "/" && !url.endsWith("/") ? "" : rest;
  return `${parsed.protocol}//${auth}${host}${port}${decodeOrKeep(tail)}`;
}

/** decodeURI без исключения: битая %-последовательность — строка как есть. */
function decodeOrKeep(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** Значение норматива: доли — ещё и процентом («0,775 (77,5 %)»). */
export function normValueText(value: number, unit: string): string {
  if (unit === "доля" || unit.startsWith("доля ")) return `${fx(value)} (${fx(value * 100, 1)} %)`;
  return fx(value);
}
