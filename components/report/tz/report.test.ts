import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { baseValuesFor, paramSpecsFor } from "@/lib/data/organizer/params";
import type { ProjectChangeEntry, ProjectRecord } from "@/lib/projects/queries";
import { MANUAL_NOTE } from "@/lib/report/tz/rows";
import { fixtureChanges, fixtureDefs, fixtureResults } from "@/lib/report/tz/test-fixtures";
import { expectedLegsM } from "@/lib/sim/analytic";
import { DISCLAIMER } from "@/lib/tz/econ";
import { FIXTURE_H1500, FIXTURE_PRODUCTS, fixtureSpecs } from "@/lib/tz/econ/fixtures";
import { buildProjectModel } from "@/lib/tz/model";
import { resolveNorms } from "@/lib/tz/norms";
import { sortDefs } from "@/lib/tz/params/template";
import type { ParamSpec, ProjectResults, SelectionResult, SensitivityRow } from "@/lib/tz/types";
import { attachmentDisposition, exportBaseName, toReportChanges, type ReportData } from "./data";
import { EXPORT_CONTENT_TYPES, projectExportResponse } from "./export";
import { LAYOUT_LEGEND, WarehouseLayoutSvg, layoutParamsFrom, rackRects, reportLayout } from "./layout-svg";
import { ProjectReport, ReportNeedsSave, type ProjectReportProps } from "./project-report";
import {
  REPORT_TOP_LEVERS,
  displayUrl,
  fleetSoftwareText,
  groupInOrder,
  layoutGroups,
  missingText,
  paramNotes,
  paramsSourceText,
  scoreFactorsText,
  topLevers,
} from "./report-model";

/**
 * Печатный отчёт по проекту и выгрузки (T3.2): разделы отчёта из ТЗ §3.7.2, оговорка о
 * предварительной оценке, пометка ⚠ у ручного решения, схема склада в SVG, запрещённые для
 * e2e строки; коды ответов и заголовки выгрузок XLSX и CSV. Данные — фикстуры выгрузок T2.4
 * (настоящий движок на данных организатора), без БД.
 */

const PROJECT = {
  id: "proj-1",
  name: "Склад (демо) Север",
  objectName: "РЦ «Север»",
  facility: "warehouse",
  paramsSource: { kind: "demo" as const },
};

function renderReport(
  results: ProjectResults = fixtureResults(),
  defs: readonly ParamSpec[] = fixtureDefs(),
  extra: Partial<Pick<ProjectReportProps, "project" | "liveDataVersion">> = {},
): string {
  return renderToStaticMarkup(
    createElement(ProjectReport, { project: PROJECT, results, defs, changes: fixtureChanges(), ...extra }),
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** Текст без тегов и с обычными пробелами — для проверок фраз. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\s  ]+/g, " ");
}

/** Пробелы, неразрывные и узкие неразрывные пробелы — одним обычным пробелом (как в textOf). */
function spaces(s: string): string {
  return s.replace(/[\s  ]+/g, " ");
}

/** Разметка раздела отчёта по id: от его <section> до следующего <section> (или до конца). */
function sectionHtml(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = html.indexOf("<section id=", start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

/** Подписи строк-заголовков групп (th scope="colgroup") в разметке — по порядку. */
function colgroupHeadings(html: string): string[] {
  return [...html.matchAll(/<th scope="colgroup"[^>]*>([^<]*)<\/th>/g)].map((m) => textOf(m[1] ?? "").trim());
}

const SECTION_TITLES = [
  "Параметры объекта",
  "Подобранные решения",
  "Состав оборудования",
  "Экономика сценариев",
  "CAPEX и OPEX по статьям",
  "Денежный поток",
  "Чувствительность",
  "Имитация",
  "Вывод и риски",
  "Формулы",
  "Нормативы и допущения",
  "Ограничения модели",
  "Источники данных",
  "Журнал корректировок",
];

/** Строки, которые e2e ищут строго на других страницах (план §6) — в отчёте их быть не должно. */
const FORBIDDEN = [
  "Рассчитать",
  "Далее",
  "Сохранить расчёт",
  "Сохранено",
  "Открыть отчёт",
  "Отчёт ROI",
  "не оферта",
  "Проверить свой объект",
  "Посмотреть на готовом примере",
  "Откуда цифры",
];

describe("ProjectReport — печатный отчёт", () => {
  const html = renderReport();
  const text = textOf(html);

  it("один заголовок h1 с названием проекта и строка даты и версий", () => {
    expect(count(html, "<h1")).toBe(1);
    expect(text).toContain("Отчёт по проекту: Склад (демо) Север");
    const r = fixtureResults();
    expect(text).toContain(
      `Дата расчёта: 25.09.2026 13:05 МСК · модель ${r.modelVersion} · имитация ${r.simModelVersion} · данные ${r.dataVersion}`,
    );
  });

  it("все разделы ТЗ §3.7.2 — заголовками h2 в заданном порядке", () => {
    const h2 = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(h2).toEqual(SECTION_TITLES);
  });

  it("оговорка о предварительной оценке — дословно и один раз", () => {
    expect(DISCLAIMER).toBe("Результат является предварительной оценкой и требует верификации при обследовании объекта.");
    expect(count(text, DISCLAIMER)).toBe(1);
  });

  it("панель действий не печатается: печать, Excel и CSV — ссылками на выгрузки", () => {
    expect(html).toContain("no-print");
    expect(text).toContain("Печать / Сохранить PDF");
    expect(html).toMatch(/<a href="\/projects\/proj-1\/export\.xlsx" download=""[^>]*>Скачать Excel<\/a>/);
    expect(html).toMatch(/<a href="\/projects\/proj-1\/export\.csv" download=""[^>]*>Скачать CSV<\/a>/);
  });

  it("нет строк, которые e2e ищут строго на других страницах", () => {
    for (const s of FORBIDDEN) expect(text.toLowerCase()).not.toContain(s.toLowerCase());
  });

  it("все таблицы — print-table; длинные таблицы не внутри .report-block", () => {
    const tables = count(html, "<table");
    expect(tables).toBeGreaterThan(10);
    expect(count(html, '<table class="print-table')).toBe(tables);
    // Блоки с запретом разрыва — шапка, оговорка, краткий вывод и схемы; таблиц внутри них нет.
    for (const m of html.matchAll(/<(header|p|div|figure) [^>]*class="report-block[^"]*"/g)) {
      const start = m.index ?? 0;
      const tag = m[1] as string;
      const end = html.indexOf(`</${tag}>`, start);
      expect(html.slice(start, end)).not.toContain("<table");
    }
  });

  it("решение, добавленное вручную, помечено ⚠ и пояснено", () => {
    expect(text).toContain("Покупка — DMR Carrier P ⚠");
    expect(text).toContain(MANUAL_NOTE);
  });

  it("имитация: вердикт, показатели и серверная схема склада в SVG", () => {
    expect(text).toContain("✗ не подтверждено: парк роботов");
    expect(text).toContain("Достигнуто, пал./ч");
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Схема склада/);
    expect(text).toContain("Схема склада:");
    for (const l of LAYOUT_LEGEND) expect(text).toContain(l.label);
  });

  it("параметры: все описания, источник значения и ⚠ за диапазоном", () => {
    const defs = fixtureDefs();
    for (const d of defs.slice(0, 5)) expect(text).toContain(d.label);
    const results = fixtureResults();
    const def = defs.find((d) => d.kind === "number" && d.max !== null && !d.locked);
    expect(def).toBeDefined();
    if (!def || def.max === null) return;
    results.paramsUsed = { ...results.paramsUsed, [def.key]: def.max * 10 };
    const t = textOf(renderReport(results, defs));
    expect(t).toMatch(/⚠ вне (диапазона организатора|допустимого диапазона)/);
    expect(t).toContain("Задано вами");
  });

  it("параметры: каждый раздел — один раз, хотя дополнения к данным организатора идут не подряд", () => {
    // Предпосылка: в описаниях склада после сортировки по order есть раздел, разорванный другими.
    const sections = sortDefs(fixtureDefs()).map((d) => d.section);
    const split = sections.some((s, i) => i > 0 && s !== sections[i - 1] && sections.slice(0, i - 1).includes(s));
    expect(split).toBe(true);
    const headings = colgroupHeadings(sectionHtml(html, "params"));
    expect(headings.length).toBeGreaterThan(1);
    expect(new Set(headings).size).toBe(headings.length);
    expect(new Set(headings)).toEqual(new Set(sections));
    // Все параметры на месте: строк столько же, сколько описаний.
    const rows = count(sectionHtml(html, "params"), '<th scope="row"');
    expect(rows).toBe(fixtureDefs().length);
  });

  it("нормативы: каждая группа — один раз", () => {
    const headings = colgroupHeadings(sectionHtml(html, "norms"));
    expect(headings.length).toBeGreaterThan(1);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("чувствительность — не больше пяти рычагов в таблице каждого сценария", () => {
    const r = fixtureResults();
    // Предпосылка: у сценария фикстуры рычагов больше, чем печатается.
    const withMore = r.results.find((x) => x.status === "ok" && x.sensitivity.length > REPORT_TOP_LEVERS);
    expect(withMore).toBeDefined();
    if (!withMore || withMore.status !== "ok") return;
    expect(text).toContain(`Показано ${REPORT_TOP_LEVERS} из ${withMore.sensitivity.length} рычагов`);
    const section = sectionHtml(html, "sensitivity");
    const bodies = [...section.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((m) => m[1] ?? "");
    const withLevers = r.results.filter((x) => x.status === "ok" && x.sensitivity.length > 0).length;
    expect(bodies).toHaveLength(withLevers);
    for (const b of bodies) {
      const rows = count(b, "<tr");
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThanOrEqual(REPORT_TOP_LEVERS);
    }
  });

  it("журнал корректировок и подбор выводятся", () => {
    expect(text).toContain("принят парк по имитации");
    expect(text).toMatch(/Рекомендуется|Подходит/);
    expect(text).toContain("Решения в сценариях");
    expect(text).toContain("Все результаты подбора по процессам");
    expect(text).toContain("Формулы модели");
  });

  it("подбор: у решения в сценарии — вклады факторов балла", () => {
    const r = fixtureResults();
    const used = r.selection.find((s) => s.productSlug === r.scenarios[1]?.items[0]?.productSlug && s.score.total !== null);
    expect(used).toBeDefined();
    if (used) expect(text).toContain(scoreFactorsText(used.score.contributions));
  });

  it("подбор по процессам: у каждого решения вне сценариев — причины, ограничения и недостающие данные целиком", () => {
    const r = fixtureResults();
    const used = new Set(r.scenarios.flatMap((s) => s.items.map((it) => `${it.process}:${it.productSlug}`)));
    const others = r.selection.filter((s) => !used.has(`${s.process}:${s.productSlug}`));
    expect(others.length).toBeGreaterThan(0);
    // Предпосылка: в фикстуре есть и ограничения, и недостающие данные у решений вне сценариев.
    expect(others.some((s) => s.limitations.length > 0) || others.some((s) => s.missing.length > 0)).toBe(true);
    const section = textOf(sectionHtml(html, "selection"));
    for (const s of others) {
      for (const t of [...s.reasons, ...s.limitations]) expect(section).toContain(spaces(t));
      if (s.missing.length > 0) expect(section).toContain(spaces(missingText(s)));
    }
    expect(section).toContain("в таблице «Решения в сценариях» выше");
  });

  it("отказ сценария показан сообщением, а не нулями", () => {
    expect(text).toContain("Не рассчитан:");
  });

  it("источники: кириллический домен ссылки и значения-ссылки — без punycode, href как есть", () => {
    const r = fixtureResults();
    const slug = Object.keys(r.productSnapshots)[0] as string;
    const p = r.productSnapshots[slug];
    expect(p).toBeDefined();
    if (!p) return;
    const puny = "https://xn--l1aeahg.xn--p1ai/amr-1500/";
    r.productSnapshots = {
      ...r.productSnapshots,
      [slug]: {
        ...p,
        sources: [
          ...p.sources,
          {
            key: "mainSource",
            label: "Основной источник",
            value: puny,
            origin: "research",
            sourceUrl: puny,
            sourceRef: null,
            date: "2026-09-23",
            confirmed: false,
          },
        ],
      },
    };
    const out = renderReport(r);
    const section = sectionHtml(out, "sources");
    expect(section).toContain(`href="${puny}"`);
    expect(textOf(section)).not.toContain("xn--");
    expect(count(textOf(section), "https://морос.рф/amr-1500/")).toBe(2);
  });

  it("шапка: демо-данные названы по датасету типа объекта", () => {
    expect(text).toContain("демо-данные организатора (датасет «Склад»)");
    const airport = textOf(
      renderReport({ ...fixtureResults(), facility: "airport" }, fixtureDefs(), {
        project: { ...PROJECT, facility: "airport" },
      }),
    );
    expect(airport).toContain("демо-данные организатора (датасет «Аэропорт»)");
    expect(airport).not.toContain("датасет «Склад»");
  });

  it("шапка: предупреждение, если данные изменились после расчёта", () => {
    const r = fixtureResults();
    const notice = "изменились после расчёта";
    expect(text).not.toContain(notice);
    expect(textOf(renderReport(r, fixtureDefs(), { liveDataVersion: r.dataVersion }))).not.toContain(notice);
    const stale = textOf(renderReport(r, fixtureDefs(), { liveDataVersion: "0badc0de" }));
    expect(stale).toContain(`Данные каталога, нормативов или описаний параметров ${notice}`);
    expect(stale).toContain(`в расчёте — ${r.dataVersion}, сейчас — 0badc0de`);
  });
});

describe("ReportNeedsSave — проект без сохранённого расчёта", () => {
  it("просит сохранить проект и ведёт обратно", () => {
    const html = renderToStaticMarkup(createElement(ReportNeedsSave, { projectId: "p9", projectName: "Новый" }));
    expect(textOf(html)).toContain("Сохраните проект, чтобы построить отчёт");
    expect(html).toContain('href="/projects/p9"');
    expect(count(html, "<h1")).toBe(1);
  });
});

describe("report-model — помощники отчёта", () => {
  it("topLevers: по размаху, устойчиво, не больше n", () => {
    const row = (lever: string, swing: number) => ({ lever, swing }) as unknown as SensitivityRow;
    const rows = [row("a", 1), row("b", 5), row("c", 5), row("d", 3), row("e", 0), row("f", 2)];
    expect(topLevers(rows, 3).map((r) => r.lever)).toEqual(["b", "c", "d"]);
    expect(topLevers(rows).length).toBe(REPORT_TOP_LEVERS);
  });

  it("paramNotes: выход за диапазон не дублируется замечанием проверки", () => {
    const def = fixtureDefs().find((d) => d.max !== null) as ParamSpec;
    const v = (def.max as number) + 1;
    const notes = paramNotes(
      def,
      v,
      [{ key: def.key, label: def.label, code: "out_of_range", severity: "warning", message: "дубль" }],
      "0–1",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("⚠ вне");
    const estimate = paramNotes({ ...def, origin: "estimate" }, v, [], "0–1");
    expect(estimate[0]).toContain("допустимого диапазона");
  });

  it("missingText: недостающие данные с подсказкой, у кандидата тоже; нет — прочерк", () => {
    const base: SelectionResult = {
      process: "pallet-transport",
      productSlug: "x",
      productName: "X",
      status: "candidate",
      needsVerification: true,
      reasons: ["подходит по грузоподъёмности"],
      limitations: [],
      missing: [],
      score: { total: null, contributions: [] },
    };
    expect(missingText(base)).toBe("—");
    expect(
      missingText({
        ...base,
        missing: [
          { key: "speed", label: "Скорость", howToFix: "укажите скорость по паспорту" },
          { key: "priceRub", label: "Цена", howToFix: "запросите цену у поставщика" },
        ],
      }),
    ).toBe("Скорость: укажите скорость по паспорту; Цена: запросите цену у поставщика");
  });

  it("groupInOrder: группа по имени один раз, в порядке первого появления", () => {
    const items = [
      { s: "A", k: 1 },
      { s: "B", k: 2 },
      { s: "A", k: 3 },
      { s: "C", k: 4 },
      { s: "B", k: 5 },
    ];
    const g = groupInOrder(items, (x) => x.s);
    expect(g.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(g.map((x) => x.items.map((i) => i.k))).toEqual([[1, 3], [2, 5], [4]]);
  });

  it("displayUrl: кириллица без %-кодов и punycode, битая последовательность — как есть", () => {
    expect(displayUrl("https://example.ru/%D0%A4%D0%B0%D0%B9%D0%BB.pdf")).toBe("https://example.ru/Файл.pdf");
    expect(displayUrl("https://example.ru/%E0%A4%A")).toBe("https://example.ru/%E0%A4%A");
    expect(displayUrl("https://xn--l1aeahg.xn--p1ai/amr-1500/")).toBe("https://морос.рф/amr-1500/");
    expect(displayUrl("https://xn--l1aeahg.xn--p1ai")).toBe("https://морос.рф");
    expect(displayUrl("https://example.com:8443/a?b=1#c")).toBe("https://example.com:8443/a?b=1#c");
    expect(displayUrl("не ссылка")).toBe("не ссылка");
  });

  it("paramsSourceText различает демо по типу объекта, файл, API и ручной ввод", () => {
    expect(paramsSourceText({ kind: "demo" }, "warehouse")).toBe("демо-данные организатора (датасет «Склад»)");
    expect(paramsSourceText({ kind: "demo" }, "airport")).toBe("демо-данные организатора (датасет «Аэропорт»)");
    expect(paramsSourceText({ kind: "demo" }, "medical")).toBe("демо-данные организатора (датасет «Медучреждение»)");
    expect(paramsSourceText({ kind: "upload", fileName: "a.xlsx" }, "warehouse")).toContain("«a.xlsx»");
    expect(paramsSourceText({ kind: "api" }, "warehouse")).toContain("API");
    expect(paramsSourceText({ kind: "manual" }, "warehouse")).toContain("вручную");
  });

  it("fleetSoftwareText: у услуги ПО входит в подписку, у покупки — сумма", () => {
    const r = fixtureResults();
    const purchase = r.results.find((x) => x.kind === "purchase" && x.status === "ok");
    const raas = r.results.find((x) => x.kind === "raas" && x.status === "ok");
    expect(purchase && fleetSoftwareText(purchase)).toMatch(/₽ разово/);
    expect(raas && fleetSoftwareText(raas)).toContain("входит в подписку");
  });

  it("layoutGroups: сценарии с одинаковым числом зарядок — одна схема", () => {
    const groups = layoutGroups(fixtureResults());
    expect(groups.length).toBeGreaterThan(0);
    const chargers = groups.map((g) => g.chargers);
    expect(new Set(chargers).size).toBe(chargers.length);
  });
});

describe("layout-svg — схема склада", () => {
  const params = baseValuesFor("warehouse");

  it("параметры планировки из параметров объекта; неполные — без схемы", () => {
    const p = layoutParamsFrom(params, 2);
    expect(p).not.toBeNull();
    expect(p?.chargers).toBe(2);
    expect(layoutParamsFrom({ ...params, activeAreaM2: null }, 1)).toBeNull();
    expect(layoutParamsFrom({ ...params, rackAisleWidthM: 0 }, 1)).toBeNull();
    expect(layoutParamsFrom({ ...params, receivingDocksCount: 0 }, 1)).toBeNull();
    expect(layoutParamsFrom({ ...params, activeAreaM2: "5 000,5" }, 1)?.activeAreaM2).toBe(5000.5);
  });

  it("схема отчёта — та же планировка, по которой модель посчитала плечо перевозки (§3.6.2)", () => {
    // Настоящая модель проекта (lib/tz/model) на данных организатора и фикстурах продуктов:
    // плечи позиций посчитаны по её собственной планировке (layoutOf → buildWarehouseLayout).
    const model = buildProjectModel({
      facility: "warehouse",
      params: baseValuesFor("warehouse"),
      paramDefs: paramSpecsFor("warehouse"),
      scenarios: fixtureSpecs(FIXTURE_H1500),
      products: FIXTURE_PRODUCTS,
      norms: resolveNorms(),
    });
    const groups = layoutGroups(model);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.item.routeLoadedM).not.toBeNull();
      expect(g.item.routeEmptyM).not.toBeNull();
      const layout = reportLayout(model.paramsUsed, g.item.chargers);
      expect(layout).not.toBeNull();
      if (!layout) continue;
      const legs = expectedLegsM(layout);
      expect(legs.loadedM).toBe(g.item.routeLoadedM);
      expect(legs.emptyM).toBe(g.item.routeEmptyM);
    }
  });

  it("SVG содержит зоны, стеллажи, ворота и зарядки планировки", () => {
    const layout = reportLayout(params, 3);
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(layout.chargers).toHaveLength(3);
    const racks = rackRects(layout);
    expect(racks.length).toBeGreaterThan(0);
    for (const r of racks) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(layout.widthM + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(layout.heightM + 1e-9);
    }
    const html = renderToStaticMarkup(createElement(WarehouseLayoutSvg, { layout, label: "Схема" }));
    const points = layout.receiving.length + layout.shipping.length + layout.chargers.length;
    expect(count(html, "<rect")).toBe(1 + layout.zones.length + racks.length + points);
    expect(count(html, "Зарядная станция C")).toBe(3);
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

// ——————————————————————————— Выгрузки ———————————————————————————

function reportData(results: ProjectResults | null, name = "Склад (демо) Север"): ReportData {
  const project = {
    id: "proj-1",
    userId: "u1",
    name,
    objectName: null,
    facility: "warehouse",
    params: {},
    paramsSource: { kind: "demo" },
    results,
    modelVersion: results?.modelVersion ?? null,
    dataVersion: results?.dataVersion ?? null,
    calculatedAt: results ? new Date(results.calculatedAt) : null,
    copiedFromId: null,
    isDemo: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    scenarios: results?.scenarios ?? [],
    scenarioRows: [],
  } satisfies ProjectRecord;
  return { project, defs: fixtureDefs(), changes: fixtureChanges(), liveDataVersion: results?.dataVersion ?? null };
}

async function bodyBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

describe("projectExportResponse — выгрузки XLSX и CSV", () => {
  it("гость — 401, чужой или несуществующий проект — 404, без расчёта — 409", async () => {
    const load = async () => reportData(fixtureResults());
    const r401 = await projectExportResponse("xlsx", "proj-1", { userId: null, load });
    expect(r401.status).toBe(401);
    expect(await r401.text()).toBe("Требуется вход");

    const r404 = await projectExportResponse("csv", "nope", { userId: "u1", load: async () => null });
    expect(r404.status).toBe(404);
    expect(await r404.text()).toBe("Проект не найден");

    const r409 = await projectExportResponse("xlsx", "proj-1", { userId: "u1", load: async () => reportData(null) });
    expect(r409.status).toBe(409);
    expect(await r409.text()).toBe("Сначала сохраните проект");
    expect(r409.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("загрузчик получает id проекта и пользователя из сессии", async () => {
    const calls: [string, string][] = [];
    await projectExportResponse("csv", "proj-7", {
      userId: "user-42",
      load: async (id, userId) => {
        calls.push([id, userId]);
        return null;
      },
    });
    expect(calls).toEqual([["proj-7", "user-42"]]);
  });

  it("XLSX: zip-книга, тип, имя файла по RFC 5987 и запрет кеширования", async () => {
    const res = await projectExportResponse("xlsx", "proj-1", { userId: "u1", load: async () => reportData(fixtureResults()) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(EXPORT_CONTENT_TYPES.xlsx);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toBe(attachmentDisposition("Склад (демо) Север", "xlsx"));
    expect(cd).toMatch(/^attachment; filename="project\.xlsx"; filename\*=UTF-8''/);
    expect(cd).toContain("%28"); // «(» закодирована
    expect(decodeURIComponent(cd.split("''")[1] ?? "")).toBe("Склад (демо) Север.xlsx");
    const bytes = await bodyBytes(res);
    expect(bytes.length).toBeGreaterThan(1000);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // «PK» — zip
  });

  it("CSV: BOM, разделитель «;», оговорка последней строкой", async () => {
    const res = await projectExportResponse("csv", "proj-1", { userId: "u1", load: async () => reportData(fixtureResults()) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/filename\*=UTF-8''.+\.csv$/);
    const bytes = await bodyBytes(res);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain("Сравнение сценариев");
    expect(csv).toContain(";");
    expect(csv.trimEnd().endsWith(DISCLAIMER)).toBe(true);
  });

  it("ошибка сборки файла — 500 с подсказкой, без трассировки", async () => {
    const broken = reportData({ ...fixtureResults(), results: null } as unknown as ProjectResults);
    const origError = console.error;
    console.error = () => {};
    try {
      const res = await projectExportResponse("csv", "proj-1", { userId: "u1", load: async () => broken });
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Не удалось сформировать файл");
    } finally {
      console.error = origError;
    }
  });
});

describe("data — журнал и имена файлов", () => {
  it("toReportChanges: сценарий по названию, у удалённого — ключ; подпись поля сохраняется", () => {
    const entries: ProjectChangeEntry[] = [
      {
        id: "c1",
        at: new Date("2026-09-25T09:30:00Z"),
        userEmail: "demo@demo.local",
        scenarioKey: "p1",
        scenarioName: "Покупка — Ronavi H1500",
        field: "item:pallet-transport:quantity",
        fieldLabel: "количество роботов (Перемещение паллет)",
        auto: 11,
        old: 11,
        new: 12,
        unit: "шт.",
        reason: "принят парк по имитации",
      },
      {
        id: "c2",
        at: new Date("2026-09-25T09:31:00Z"),
        userEmail: null,
        scenarioKey: "p9",
        scenarioName: null,
        field: "scenario:remove",
        fieldLabel: "Сценарий удалён",
        auto: null,
        old: null,
        new: null,
        unit: null,
        reason: null,
      },
    ];
    const out = toReportChanges(entries);
    expect(out[0]).toMatchObject({ user: "demo@demo.local", scenario: "Покупка — Ronavi H1500", fieldLabel: entries[0]?.fieldLabel, new: 12 });
    expect(out[1]?.scenario).toBe("p9");
  });

  it("exportBaseName: запрещённые символы, точки в конце, пустое имя", () => {
    expect(exportBaseName('Склад: А/Б "север"?.')).toBe("Склад_ А_Б _север_");
    expect(exportBaseName("   ")).toBe("Проект");
    expect(exportBaseName("x".repeat(300)).length).toBe(100);
    expect(attachmentDisposition("Отчёт", "csv")).toBe(
      `attachment; filename="project.csv"; filename*=UTF-8''${encodeURIComponent("Отчёт.csv")}`,
    );
  });
});
