import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SimSummaryStored } from "@/lib/sim/types";
import { FIXTURE_CARRIER_P, FIXTURE_H1500, fixtureContext, fixtureSpecs } from "@/lib/tz/econ/fixtures";
import { computeScenarios } from "@/lib/tz/econ/scenario";
import { share } from "@/lib/tz/econ/text";
import { DEFAULT_NORMS, NORM_DEFS } from "@/lib/tz/norms";
import type { ScenarioOk, ScenarioResult, ScenarioSpec, TraceStep } from "@/lib/tz/types";
import { CashflowTable } from "./cashflow-table";
import { ChangeLog, formatLogValue } from "./change-log";
import { Conclusion } from "./conclusion";
import { LineItems, linesTotal } from "./line-items";
import { NormsPanel, normValueText } from "./norms-panel";
import { checkOverride, editableNumber, parseRuNumber, readOverride } from "./override-input";
import { RefusalNote, refusalFieldLabel, refusalMessage } from "./refusal-note";
import {
  ScenarioDetails,
  autoThroughput,
  fleetCardLines,
  itemOverrideField,
  parseItemOverrideField,
  shortUnit,
} from "./scenario-details";
import {
  RAAS_ROI_NOTE,
  SCENARIO_ROWS,
  ScenarioTable,
  compositionText,
  scenarioCell,
  scenarioRowLabel,
  simCellText,
} from "./scenario-table";
import { SensitivityPanel, leverValueText } from "./sensitivity-panel";
import { TraceList, formatTraceValue, traceParts, traceStepText } from "./trace-list";

/**
 * Компоненты рабочей области B (T2.6): порядок строк таблицы сценариев, пометка ROI у RaaS,
 * текст шагов трассировки, отказ без чисел и рендер всех компонентов на результатах
 * настоящего движка (фикстуры lib/tz/econ/fixtures — те же, что у тестов экономики).
 */

/** Пробелы ICU (неразрывный, узкий неразрывный) → обычные: строки сравниваются по смыслу. */
function plain(s: string): string {
  return s.replace(/\s/g, " ");
}

/** Текст HTML без тегов и сущностей — для поиска подписей в разметке. */
function text(html: string): string {
  return plain(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " "),
  );
}

function ok(results: ScenarioResult[], key: string): ScenarioOk {
  const r = results.find((x) => x.key === key);
  if (!r || r.status !== "ok") throw new Error(`сценарий ${key} не рассчитан`);
  return r;
}

const ctx = fixtureContext(20);
const specs = fixtureSpecs(FIXTURE_H1500);
const results = computeScenarios(ctx, specs);

/** Сценарии с отказом: услуга Carrier P без ставки RaaS. */
const refusedSpecs: ScenarioSpec[] = [
  ...specs,
  {
    key: "r2",
    name: `Услуга (RaaS) — ${FIXTURE_CARRIER_P.name}`,
    kind: "raas",
    items: [{ process: "pallet-transport", productSlug: FIXTURE_CARRIER_P.slug }],
  },
];
const withRefusal = computeScenarios(ctx, refusedSpecs);

describe("ScenarioTable: порядок строк", () => {
  it("SCENARIO_ROWS идут в порядке спецификации", () => {
    expect(SCENARIO_ROWS.map((r) => r.label)).toEqual([
      "Состав оборудования",
      "CAPEX",
      "OPEX в год",
      "ФОТ процесса",
      "Годовой эффект",
      "Окупаемость (простая)",
      "Интерпретация",
      "ROI по ТЗ",
      "ROI чистый",
      "NPV",
      "Дисконтированная окупаемость",
      "TCO за {T} лет",
      "Изменение TCO к «Как есть»",
      "Имитация",
      "Риски",
      "Вывод",
    ]);
  });

  it("подпись TCO согласуется с горизонтом", () => {
    expect(scenarioRowLabel("tco", 5)).toBe("TCO за 5 лет");
    expect(scenarioRowLabel("tco", 3)).toBe("TCO за 3 года");
    expect(scenarioRowLabel("tco", 21)).toBe("TCO за 21 год");
    expect(scenarioRowLabel("capex", 5)).toBe("CAPEX");
  });

  it("строки таблицы рендерятся в порядке SCENARIO_ROWS, колонки — сценарии", () => {
    const html = renderToStaticMarkup(createElement(ScenarioTable, { results, tcoYears: 5 }));
    const rowHeads = [...html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1] ?? "").trim());
    expect(rowHeads).toEqual(SCENARIO_ROWS.map((r) => scenarioRowLabel(r.key, 5)));
    const colHeads = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1] ?? "").trim());
    expect(colHeads[0]).toBe("Показатель");
    expect(colHeads.slice(1).map((h) => h.replace(/^★\s*/, ""))).toEqual(specs.map((s) => s.name));
  });

  it("рекомендуемый сценарий помечен ★ ровно один раз и совпадает с переданным ключом", () => {
    const html = renderToStaticMarkup(createElement(ScenarioTable, { results, tcoYears: 5, recommendedKey: "r1" }));
    expect(html.match(/★/g)?.length).toBe(2); // заголовок колонки и строка «Вывод»
    expect(text(html)).toContain("★ Рекомендуется");
    const none = renderToStaticMarkup(createElement(ScenarioTable, { results, tcoYears: 5, recommendedKey: null }));
    expect(none).not.toContain("★");
  });
});

describe("ScenarioTable: ячейки", () => {
  const bands = DEFAULT_NORMS;

  it("у RaaS ROI приглушён и подписан «ROI неинформативен…», у покупки — нет", () => {
    const raas = ok(results, "r1");
    const purchase = ok(results, "p1");
    for (const key of ["roiTz", "roiNet"] as const) {
      const c = scenarioCell(key, raas, { recommended: false, bands });
      expect(c.muted).toBe(true);
      expect(c.note).toBe(RAAS_ROI_NOTE);
      const p = scenarioCell(key, purchase, { recommended: false, bands });
      expect(p.note).toBeUndefined();
      expect(p.muted).toBeFalsy();
    }
    expect(RAAS_ROI_NOTE).toBe("ROI неинформативен при малом CAPEX — сравнивайте NPV и TCO");
    // ROI до десятых — как в трассировке и выгрузке (контрольный пример: 140,3 %).
    expect(plain(scenarioCell("roiTz", purchase, { recommended: false, bands }).text)).toBe("140,3 %");
    expect(plain(scenarioCell("roiNet", purchase, { recommended: false, bands }).text)).toBe("40,3 %");
    const html = renderToStaticMarkup(createElement(ScenarioTable, { results, tcoYears: 5 }));
    // В строках ROI пометка стоит ровно один раз — в колонке RaaS (порядок колонок: как есть,
    // покупка, RaaS). Ещё раз тот же текст встречается в строке «Риски» как риск
    // RAAS_ROI_UNINFORMATIVE — это ожидаемо.
    const rows = html.split("<tr>").map((r) => ({ head: /<th scope="row"[^>]*>(.*?)<\/th>/.exec(r)?.[1] ?? "", r }));
    for (const label of ["ROI по ТЗ", "ROI чистый"]) {
      const row = rows.find((x) => text(x.head).trim() === label);
      expect(row, label).toBeDefined();
      const cells = [...(row?.r ?? "").matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => text(m[1] ?? ""));
      expect(cells).toHaveLength(3);
      expect(cells[2]).toContain(RAAS_ROI_NOTE);
      expect(cells[1]).not.toContain(RAAS_ROI_NOTE);
    }
  });

  it("состав оборудования: «N роботов · C зарядка · P пост диспетчера»", () => {
    const p = ok(results, "p1");
    const it0 = p.items[0];
    expect(it0).toBeDefined();
    expect(compositionText(p)).toMatch(/^\d+ робот(а|ов)? · \d+ зарядк(а|и|ок) · \d+ пост(а|ов)? диспетчера$/);
    expect(compositionText(ok(results, "asis"))).toBe("Без роботов: текущий процесс");
  });

  it("«Как есть» — база сравнения, без NPV и окупаемости", () => {
    const a = ok(results, "asis");
    expect(scenarioCell("effect", a, { recommended: false, bands }).text).toBe("база сравнения");
    expect(scenarioCell("npv", a, { recommended: false, bands }).text).toBe("—");
    expect(scenarioCell("payback", a, { recommended: false, bands }).text).toBe("—");
    expect(scenarioCell("verdict", a, { recommended: false, bands }).text).toBe("База сравнения");
  });

  it("строка «Имитация»: подтверждено, не подтверждено с узким местом, прочерк", () => {
    const base: SimSummaryStored = {
      simModelVersion: "sim-1.0.0",
      seed: 1,
      scenarioKey: "p1",
      fleet: 11,
      requiredPerH: 129.5,
      achievedPerH: 128,
      servedShare: 0.99,
      fleetUtilPct: 70,
      assumedUtilPct: 77.5,
      idlePct: 10,
      chargingPct: 8,
      waitAtPointsPct: 2,
      queueMax: 3,
      waitP95Min: 2,
      verdict: "CONFIRMED",
      bottleneck: "none",
      oversized: false,
      minStableFleet: 9,
      fleetByNorm: 3,
      verdictByNorm: "NOT_CONFIRMED",
      durationMs: 0,
    };
    expect(simCellText(base)).toBe("✓ подтверждено");
    expect(simCellText({ ...base, verdict: "NOT_CONFIRMED", bottleneck: "fleet" })).toBe("✗ не подтверждено: парк роботов");
    expect(simCellText(null)).toBe("—");
    expect(simCellText(undefined)).toBe("—");
    const html = renderToStaticMarkup(createElement(ScenarioTable, { results, tcoYears: 5, sim: { p1: base, r1: null } }));
    expect(text(html)).toContain("✓ подтверждено");
  });
});

describe("Отказ расчёта", () => {
  it("отказ занимает колонку целиком: сообщение и поля, никаких сумм", () => {
    const r2 = withRefusal.find((r) => r.key === "r2");
    expect(r2?.status).toBe("refused");
    if (!r2 || r2.status !== "refused") return;
    expect(r2.refusal.reason).toBe("raas_rate_required");

    const html = renderToStaticMarkup(createElement(ScenarioTable, { results: withRefusal, tcoYears: 5 }));
    const cell = new RegExp(`<td rowSpan="${SCENARIO_ROWS.length}"[^>]*>([\\s\\S]*?)</td>`).exec(html);
    expect(cell).not.toBeNull();
    const t = text(cell?.[1] ?? "");
    expect(t).toContain("Сценарий не рассчитан");
    expect(t).toContain(plain(r2.refusal.message));
    expect(t).toContain("Ставка RaaS, ₽/мес за робота");
    // Отказ — не ноль: в колонке нет ни одной суммы в рублях с цифрами.
    expect(t).not.toMatch(/\d[\d ]* ₽/);

    const note = text(renderToStaticMarkup(createElement(RefusalNote, { refusal: r2.refusal })));
    expect(note).toContain("Что заполнить:");
  });

  it("подписи полей отказа по формату журнала", () => {
    expect(refusalFieldLabel("item:pallet-transport:price")).toBe(
      "Цена робота, ₽ — процесс «Перемещение паллет: приёмка → хранение → отгрузка»",
    );
    expect(refusalFieldLabel("item:pallet-transport:throughput")).toMatch(/^Производительность, паллет\/ч/);
    expect(refusalFieldLabel("param:shiftsPerDay")).toBe("Количество рабочих смен в сутки");
    expect(refusalFieldLabel("param:shiftsPerDay", { shiftsPerDay: "Смен в сутки" })).toBe("Смен в сутки");
    expect(refusalFieldLabel("norm:utilization")).toBe("Норматив «Коэффициент загрузки робота»");
    expect(refusalFieldLabel("unknown")).toBe("unknown");
    expect(refusalFieldLabel("scenario:add")).toBe("Сценарий покупки или услуги");
    expect(refusalFieldLabel("scenario:items")).toBe("Решение (продукт) для сценария");
  });

  it("без кнопок (отчёт, чтение) отказ не зовёт нажать «Подставить оценку»", () => {
    const r2 = withRefusal.find((r) => r.key === "r2");
    if (!r2 || r2.status !== "refused") throw new Error("нет отказа");
    expect(r2.refusal.message).toContain("Подставить оценку");
    const cut = refusalMessage(r2.refusal, false);
    expect(cut).not.toContain("Подставить оценку");
    expect(cut).toMatch(/^Нет ставки RaaS для «.+»: укажите ставку, ₽\/мес за робота$/);
    expect(refusalMessage(r2.refusal, true)).toBe(r2.refusal.message);
    const printed = text(renderToStaticMarkup(createElement(ScenarioTable, { results: withRefusal, tcoYears: 5, print: true })));
    expect(printed).not.toContain("Подставить оценку");
    const ro = text(
      renderToStaticMarkup(
        createElement(ScenarioDetails, { result: r2, spec: refusedSpecs[3], products: ctx.products, readOnly: true }),
      ),
    );
    expect(ro).not.toContain("Подставить оценку");
  });
});

describe("Трассировка «Как посчитано»", () => {
  const p1 = ok(results, "p1");
  const r1 = ok(results, "r1");
  const asis = ok(results, "asis");
  const stepOf = (r: ScenarioOk, key: string): TraceStep => {
    const s = r.trace.find((x) => x.key === key);
    if (!s) throw new Error(`нет шага ${key}`);
    return s;
  };

  it("подстановка движка уже содержит результат — он не повторяется, единица дописывается", () => {
    const effect = plain(traceStepText(stepOf(p1, "effect")));
    expect(effect.startsWith("Чистый годовой эффект: E = OPEXкак есть − OPEXсценария")).toBe(true);
    expect(effect.endsWith("= 46 872 000 ₽ − 37 067 494 ₽ = 9 804 506 ₽/год")).toBe(true);
    expect(plain(traceStepText(stepOf(p1, "fleet")))).toMatch(/ = 10 шт\.$/);
    expect(plain(traceStepText(stepOf(p1, "coverage")))).toMatch(/\/ 129,55\) = 1$/);
    expect(plain(traceStepText(stepOf(p1, "releasedFte")))).toMatch(/ = 11,875 ставок$/);
    expect(plain(traceStepText(stepOf(p1, "demandDay")))).toMatch(/ = 1 900 паллет\/сут$/);
    expect(plain(traceStepText(stepOf(p1, "workHours")))).toMatch(/ = 8 030 ч\/год$/);
    expect(plain(traceStepText(stepOf(p1, "payback")))).toMatch(/ = 3,61 г\.$/);
    expect(plain(traceStepText(stepOf(r1, "payback")))).toMatch(/ = 0,67 г\.$/);
    expect(plain(traceStepText(stepOf(p1, "thrNorm")))).toMatch(/ = 90 паллет\/ч \(не подтверждена производителем\)$/);
    expect(plain(traceStepText(stepOf(p1, "roiTz")))).toMatch(/ = 140,3 %$/);
  });

  it("на настоящей трассировке нет «= X = X» и «лет» после дробного числа", () => {
    const parse = (t: string) => Number(t.replace(/ /g, "").replace("−", "-").replace(",", "."));
    for (const r of [asis, p1, r1]) {
      expect(r.trace.length).toBeGreaterThan(2);
      for (const s of r.trace) {
        // Результат каждого шага движка найден в подстановке — в конце ничего не приписано.
        expect(traceParts(s).appended, `${r.key}:${s.key}`).toBe(false);
        const t = plain(traceStepText(s));
        const segs = t.split("=").map((x) => x.trim());
        const last = segs[segs.length - 1] ?? "";
        const prev = segs[segs.length - 2] ?? "";
        // Предпоследний отрезок — голое число (с единицей), и последний начинается с него же:
        // это и есть дубль «… = 9 804 506 ₽ = 9 804 506 ₽/год».
        const bare = /^([-−]?\d+(?: \d{3})*(?:,\d+)?)(?: \S+)?$/.exec(prev);
        const lead = /^([-−]?\d+(?: \d{3})*(?:,\d+)?)/.exec(last);
        if (bare?.[1] && lead?.[1]) {
          const a = parse(bare[1]);
          const b = parse(lead[1]);
          expect(Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b)), `${r.key}:${s.key}: ${t}`).toBe(false);
        }
        expect(t, `${r.key}:${s.key}`).not.toMatch(/\d,\d+ лет/);
      }
    }
  });

  it("если результата в подстановке нет — он приписывается «= результат единица»", () => {
    const step: TraceStep = {
      key: "baselineLabour",
      label: "ФОТ персонала процесса (как есть)",
      formula: "ФОТбаз = численность × c",
      substituted: "25 × 1 874 880 ₽",
      value: 46_872_000,
      unit: "₽/год",
      origin: "derived",
    };
    expect(plain(traceStepText(step))).toBe(
      "ФОТ персонала процесса (как есть): ФОТбаз = численность × c = 25 × 1 874 880 ₽ = 46 872 000 ₽/год",
    );
    expect(traceParts(step).appended).toBe(true);
  });

  it("результат форматируется по единице; сроки — с согласованием", () => {
    expect(plain(formatTraceValue(35_420_000.4, "₽"))).toBe("35 420 000 ₽");
    expect(formatTraceValue(140.31, "%")).toBe("140,3 %");
    expect(formatTraceValue(0.98765, "доля")).toBe("0,988");
    expect(formatTraceValue(11, "шт.")).toBe("11 шт.");
    expect(formatTraceValue(3.6123, "лет")).toBe("3,6 года");
    expect(formatTraceValue(0.6726, "лет")).toBe("0,7 года");
    expect(formatTraceValue(5, "лет")).toBe("5,0 лет");
  });

  it("каждый шаг движка отображается в списке по порядку, результат выделен", () => {
    expect(p1.trace.length).toBeGreaterThan(5);
    const html = renderToStaticMarkup(createElement(TraceList, { steps: p1.trace }));
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1] ?? "").trim());
    expect(items).toHaveLength(p1.trace.length);
    p1.trace.forEach((s, i) => {
      expect(items[i]).toContain(`${plain(s.label)}:`);
      expect(items[i]).toContain(plain(traceStepText(s)).replace(/\s+/g, " "));
    });
    const bold = [...html.matchAll(/<span class="[^"]*font-semibold[^"]*">([^<]*)<\/span>/g)].map((m) => plain(m[1] ?? ""));
    expect(bold).toContain("9 804 506 ₽/год");
  });
});

describe("Корректировки", () => {
  it("русская запись числа", () => {
    expect(parseRuNumber("2 700 000")).toBe(2_700_000);
    const nbsp = String.fromCharCode(0xa0);
    expect(parseRuNumber(`2${nbsp}700${nbsp}000`)).toBe(2_700_000);
    expect(parseRuNumber("0,775")).toBe(0.775);
    expect(parseRuNumber("")).toBeNull();
    expect(parseRuNumber("abc")).toBeNull();
  });

  it("проверка значения: целое для числа роботов, диапазон норматива без молчаливого прижатия", () => {
    expect(checkOverride(12, { integer: true })).toEqual({ ok: true, value: 12 });
    expect(checkOverride(1.5, { integer: true }).ok).toBe(false);
    expect(checkOverride(0, {}).ok).toBe(false);
    expect(checkOverride(0, { minInclusive: true })).toEqual({ ok: true, value: 0 });
    expect(checkOverride(null, {}).ok).toBe(false);
    const out = checkOverride(95, { range: [70, 85], unit: "%", percent: true });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toBe("Допустимо 70–85 %: введите число в этом диапазоне.");
  });

  it("норматив-доля вводится в процентах: «80» у загрузки — это 0,8", () => {
    const def = NORM_DEFS.find((d) => d.key === "utilization");
    if (!def) throw new Error("нет норматива");
    const opts = { percent: true, range: [def.min, def.max] as const, unit: "%" };
    expect(readOverride("80", opts)).toEqual({ ok: true, value: 0.8 });
    expect(readOverride("77,5", opts)).toEqual({ ok: true, value: 0.775 });
    const high = readOverride("95", opts);
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.message).toContain("70–85 %");
    // «0,8» вместо «80»: не прижимается к 70 %, а объясняет, что ввод — в процентах.
    const asShare = readOverride("0,8", opts);
    expect(asShare.ok).toBe(false);
    if (!asShare.ok) expect(asShare.message).toContain("Значение вводится в процентах: 80 означает 80 %.");
    // Ставка дисконтирования «12» — 12 % в год.
    expect(readOverride("12", { percent: true, range: [0.08, 0.2], unit: "% в год" })).toEqual({ ok: true, value: 0.12 });
    // Без процентов — число как есть.
    expect(readOverride("2 700 000", {})).toEqual({ ok: true, value: 2_700_000 });
  });

  it("подсказка в поле — без хвостов двоичной дроби и без разделителей разрядов", () => {
    expect(editableNumber(19.059720457433293)).toBe("19,06");
    expect(editableNumber(2_700_000)).toBe("2700000");
    expect(editableNumber(0.775)).toBe("0,775");
    expect(editableNumber(77.5)).toBe("77,5");
  });

  it("поле корректировки в формате журнала и обратно", () => {
    const f = itemOverrideField("pallet-transport", "raasEstimate");
    expect(f).toBe("item:pallet-transport:raasEstimate");
    expect(parseItemOverrideField(f)).toEqual({ process: "pallet-transport", kind: "raasEstimate" });
    expect(parseItemOverrideField("param:shiftsPerDay")).toBeNull();
  });

  it("карточка парка: спрос, производительность, ⌈Nточн⌉ = N", () => {
    const it0 = ok(results, "p1").items[0];
    if (!it0) throw new Error("нет позиции");
    const lines = fleetCardLines(it0).map(plain);
    expect(lines[0]).toMatch(/^Спрос: 1 900 пал\.\/сут → [\d,]+ пал\.\/ч в среднем, [\d,]+ пал\.\/ч в пик$/);
    expect(lines[1]).toMatch(/^Производительность: норма .* · по циклу .* · принято /);
    expect(lines.some((l) => new RegExp(`^Роботов: ⌈[\\d,]+⌉ = ${it0.n}$`).test(l))).toBe(true);
    expect(lines).toContain(`Зарядных станций: ${it0.chargers}`);
    expect(autoThroughput({ thrNorm: 90, thrCycle: 20 })).toBe(20);
    expect(autoThroughput({ thrNorm: null, thrCycle: null })).toBeNull();
    expect(shortUnit("паллет/сут")).toBe("пал./сут");
  });
});

describe("Рендер компонентов на результатах движка", () => {
  it("подробности покупки: CAPEX и OPEX по статьям, поток, «Как посчитано»", () => {
    const p = ok(results, "p1");
    const html = renderToStaticMarkup(
      createElement(ScenarioDetails, {
        result: p,
        spec: specs[1],
        products: ctx.products,
        norms: ctx.norms,
        onOverride: () => {},
      }),
    );
    const t = text(html);
    expect(t).toContain("CAPEX по статьям");
    expect(t).toContain("OPEX за год по статьям");
    expect(t).toContain("Денежный поток по годам");
    expect(t).toContain("Как посчитано");
    expect(t).toContain("Количество роботов");
    expect(t).toContain("Цена робота, ₽");
    expect(t).not.toContain("Ставка RaaS, ₽/мес за робота");
    expect(linesTotal(p.capexLines)).toBeCloseTo(p.capexRub, 6);
  });

  it("отказ RaaS: кнопка «Подставить оценку» с нормативом, только чтение — без полей", () => {
    const r2 = withRefusal.find((r) => r.key === "r2");
    if (!r2) throw new Error("нет сценария");
    const pct = share(DEFAULT_NORMS.raasMonthlyPctOfPrice);
    const html = renderToStaticMarkup(
      createElement(ScenarioDetails, {
        result: r2,
        spec: refusedSpecs[3],
        products: ctx.products,
        norms: ctx.norms,
        onOverride: () => {},
      }),
    );
    const button = /<button[^>]*>(.*?)<\/button>/g;
    expect([...html.matchAll(button)].map((m) => text(m[1] ?? "").trim())).toContain(
      `Подставить оценку (${pct} цены в месяц)`,
    );
    // Оценка из цены Carrier P: цена × норматив, до рубля.
    expect(text(html)).toContain(
      plain(`${new Intl.NumberFormat("ru-RU").format(Math.round(FIXTURE_CARRIER_P.priceRub! * DEFAULT_NORMS.raasMonthlyPctOfPrice))} ₽/мес`),
    );
    const ro = renderToStaticMarkup(
      createElement(ScenarioDetails, { result: r2, spec: refusedSpecs[3], products: ctx.products, readOnly: true }),
    );
    expect(ro).not.toContain("<input");
    expect(ro).not.toContain("<button");
  });

  it("чувствительность: заголовок, строки с нулевым размахом приглушены, но не выброшены", () => {
    const p = ok(results, "p1");
    expect(p.sensitivity.length).toBeGreaterThanOrEqual(3);
    const rows = [...p.sensitivity, { ...p.sensitivity[0]!, lever: "zero", label: "Нулевой рычаг", swing: 0 }];
    const html = renderToStaticMarkup(createElement(SensitivityPanel, { scenarioName: p.name, rows, metric: "npv" }));
    const t = text(html);
    expect(t).toContain(`Чувствительность: ${p.name}`);
    expect(t).toContain("Нулевой рычаг");
    expect(html).toContain("opacity-50");
    expect(t).toContain("⚠ смена знака");
    expect(html).toContain("<svg");
    const asis = ok(results, "asis");
    const tco = text(
      renderToStaticMarkup(
        createElement(SensitivityPanel, { scenarioName: asis.name, rows: asis.sensitivity, metric: "tco", baseValue: asis.tcoRub }),
      ),
    );
    expect(tco).toContain("TCO при нижнем");
    expect(tco).not.toContain("смена знака");
    expect(leverValueText(0.775, "доля")).toBe("77,5 %");
  });

  it("чувствительность: отказ на границе — не «не влияет», размах — прочерк", () => {
    const p = ok(results, "p1");
    const first = p.sensitivity[0];
    if (!first) throw new Error("нет рычагов");
    const refused = { ...first, lever: "refused", label: "Рычаг с отказом", npvHigh: null, swing: 0 };
    const html = renderToStaticMarkup(createElement(SensitivityPanel, { scenarioName: p.name, rows: [refused], metric: "npv" }));
    const body = html.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
    expect(text(body)).toContain("Рычаг с отказом");
    expect(text(body)).toContain("отказ расчёта");
    expect(text(body)).not.toContain("не влияет");
    expect(body).not.toContain("opacity-50");
    expect(text(html)).not.toContain("— не влияет");
  });

  it("нормативы: таблица с источниками и пять переопределений с прижатием", () => {
    const rows = NORM_DEFS.map((d) => ({ ...d, value: d.value }));
    const html = renderToStaticMarkup(
      createElement(NormsPanel, { rows, overrides: { utilization: 0.8 }, onOverride: () => {}, scenarioName: "Покупка" }),
    );
    const t = text(html);
    expect(t).toContain("Нормативы и допущения");
    expect(t).toContain("Коэффициент загрузки робота");
    expect(t).toContain("задано вами");
    expect(html.match(/<input/g)?.length).toBe(10); // 5 полей значения + 5 полей причины
    const printed = renderToStaticMarkup(createElement(NormsPanel, { rows, overrides: { utilization: 0.8 }, print: true }));
    expect(printed).not.toContain("<input");
    expect(printed).not.toContain("<details class=\"group\"");
    expect(normValueText(0.775, "доля")).toBe("0,775 (77,5 %)");
    // Поле норматива-доли — в процентах: авто, подсказка-плейсхолдер и диапазон в одних единицах.
    expect(t).toContain("авто: 77,5 %");
    expect(t).toContain("диапазон 70–85 %");
    expect(t).toContain("80 %"); // заданное значение 0,8
    expect(html).toContain('placeholder="80"');
    expect(t).toContain("авто: 12 % в год");
    expect(html).toContain('placeholder="12"');
  });

  it("нормативы в печати: без раскрытий, место в источнике и ссылка — текстом", () => {
    const rows = NORM_DEFS.map((d) => ({ ...d, value: d.value }));
    const refs = rows
      .map((r): string | undefined => ("sourceRef" in r ? r.sourceRef : undefined))
      .filter((x): x is string => !!x);
    const urls = rows
      .map((r): string | undefined => ("sourceUrl" in r ? r.sourceUrl : undefined))
      .filter((x): x is string => !!x);
    expect(refs.length).toBeGreaterThan(0);
    expect(urls.length).toBeGreaterThan(0);
    const printed = renderToStaticMarkup(createElement(NormsPanel, { rows, print: true }));
    for (const tag of ["<details", "<input", "<button"]) expect(printed, tag).not.toContain(tag);
    const t = text(printed);
    for (const ref of refs) expect(t).toContain(plain(ref).replace(/\s+/g, " "));
    for (const url of urls) expect(t).toContain(url);
  });

  it("журнал: гостевой заголовок, значения по-русски", () => {
    const entries = [
      {
        at: "2026-09-25T09:30:00.000Z",
        scenario: "Покупка",
        fieldLabel: "Количество роботов",
        auto: 11,
        old: null,
        new: 12,
        unit: "шт.",
        reason: "принят парк по имитации",
      },
    ];
    const guest = text(renderToStaticMarkup(createElement(ChangeLog, { entries, guest: true })));
    expect(guest).toContain("Журнал корректировок (не сохраняется)");
    expect(guest).toContain("25.09.2026, 12:30 МСК");
    expect(guest).not.toContain("Кто");
    const owner = text(renderToStaticMarkup(createElement(ChangeLog, { entries: [] })));
    expect(owner).toContain("Журнал корректировок");
    expect(owner).not.toContain("не сохраняется");
    expect(formatLogValue(0.8)).toBe("0,8");
    expect(formatLogValue(null)).toBe("—");
  });

  it("вывод: заголовок h3, пункты и оговорка в выделенном блоке", () => {
    const html = renderToStaticMarkup(
      createElement(Conclusion, {
        conclusion: { recommendedScenarioKey: "p1", headline: "Рекомендуется покупка", bullets: ["пункт"], disclaimer: "Оговорка." },
      }),
    );
    expect(html).toContain("<h3");
    expect(html).toContain("Оговорка.");
    expect(html).toContain("border-caution/40");
  });

  it("статьи в печати: без раскрытий, длинное примечание к источнику — текстом", () => {
    const p = ok(results, "p1");
    const long = p.opexLines.find((l) => (l.originNote ?? "").length > 40);
    if (!long?.originNote) throw new Error("нет статьи с длинным примечанием");
    const screen = renderToStaticMarkup(createElement(LineItems, { title: "OPEX", lines: p.opexLines }));
    expect(screen).toContain("<details");
    const printed = renderToStaticMarkup(createElement(LineItems, { title: "OPEX", lines: p.opexLines, print: true }));
    expect(printed).not.toContain("<details");
    expect(text(printed)).toContain(plain(long.originNote));
  });

  it("подробности и таблица в печати: ни полей, ни кнопок, ни раскрытий", () => {
    const p = ok(results, "p1");
    const details = renderToStaticMarkup(
      createElement(ScenarioDetails, {
        result: p,
        spec: specs[1],
        products: ctx.products,
        norms: ctx.norms,
        print: true,
        onOverride: () => {},
      }),
    );
    for (const tag of ["<details", "<input", "<button"]) expect(details, tag).not.toContain(tag);
    expect(text(details)).toContain("проверить в договоре: годовая лицензия может быть платной");
    const table = renderToStaticMarkup(createElement(ScenarioTable, { results, tcoYears: 5, print: true }));
    for (const tag of ["<details", "<input", "<button"]) expect(table, tag).not.toContain(tag);
  });

  it("ставка RaaS из оценки помечена «оценка …», а не «задано вами»", () => {
    const pct = DEFAULT_NORMS.raasMonthlyPctOfPrice;
    const rate = Math.round(FIXTURE_CARRIER_P.priceRub! * pct);
    const base = refusedSpecs[3];
    const first = base?.items[0];
    if (!base || !first) throw new Error("нет сценария");
    const spec: ScenarioSpec = { ...base, items: [{ ...first, raasRubMonthOverride: rate, raasFromEstimate: true }] };
    const res = computeScenarios(ctx, [...specs, spec]).find((r) => r.key === "r2");
    expect(res?.status).toBe("ok");
    if (!res) return;
    const t = text(
      renderToStaticMarkup(
        createElement(ScenarioDetails, { result: res, spec, products: ctx.products, norms: ctx.norms, onOverride: () => {} }),
      ),
    );
    expect(t).toContain(`оценка ${plain(share(pct))} цены`);
    expect(t).not.toContain("задано вами");
    const manual: ScenarioSpec = { ...base, items: [{ ...first, raasRubMonthOverride: rate }] };
    const t2 = text(
      renderToStaticMarkup(
        createElement(ScenarioDetails, { result: res, spec: manual, products: ctx.products, norms: ctx.norms, onOverride: () => {} }),
      ),
    );
    expect(t2).toContain("задано вами");
  });

  it("статьи и поток рендерятся без ошибок", () => {
    const r = ok(results, "r1");
    const li = text(renderToStaticMarkup(createElement(LineItems, { title: "CAPEX", lines: r.capexLines })));
    expect(li).toContain("входит в подписку");
    const cf = renderToStaticMarkup(createElement(CashflowTable, { rows: r.cashflows, horizonYears: 3 }));
    expect(text(cf)).toContain("(только TCO)");
  });
});

describe("Тексты интерфейса", () => {
  it("нет строк, которые ищут e2e старой модели, и нет второго h1", () => {
    const files = [
      "scenario-table",
      "scenario-details",
      "line-items",
      "cashflow-table",
      "trace-list",
      "sensitivity-panel",
      "conclusion",
      "change-log",
      "norms-panel",
      "override-input",
      "refusal-note",
    ];
    const forbidden = [
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
      "<h1",
    ];
    for (const f of files) {
      const src = readFileSync(path.join(import.meta.dirname, `${f}.tsx`), "utf8");
      for (const s of forbidden) expect(src.includes(s), `${f}.tsx содержит «${s}»`).toBe(false);
    }
  });
});
