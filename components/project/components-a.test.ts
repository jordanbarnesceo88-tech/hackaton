import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { processDef } from "@/lib/tz/processes";
import type { ComparisonRow, ParamSpec, ScoreContribution, SelectionResult, SelectionStatus } from "@/lib/tz/types";
import {
  bestColumnIndex,
  comparisonColumns,
  COMPARISON_METRICS,
  ComparisonTable,
  comparisonStatusText,
  COMPARISON_MAX_COLUMNS,
  fmtValue,
  metricPlaceholder,
  NOT_CALCULATED,
  NOT_SIMULATED,
  paybackText,
  prototypeNote,
  scenarioItemKey,
  scenarioItemKeys,
} from "./comparison-table";
import {
  formulaLine,
  interpretParamInput,
  isLockedChanged,
  liveParamDraft,
  outOfRangeText,
  ParamField,
  paramHelpLines,
  paramInputText,
  paramLabelText,
  paramWarningText,
  rangeLine,
} from "./param-field";
import {
  countersText,
  groupBySection,
  hasParamWarning,
  humanizeFormula,
  issueForKey,
  ParamsForm,
  paramsCounters,
  sectionSummaryText,
} from "./params-form";
import {
  contributionMax,
  contributionPoints,
  contributionSummary,
  formatPoints,
  ScoreBar,
  scoreAriaLabel,
  scoreSegments,
  scoreTotalText,
  SCORE_NOT_RATED,
} from "./score-bar";
import {
  canManualAdd,
  canUse,
  isInScenarios,
  isManualFormOpen,
  manualAddWarning,
  SelectionPanel,
  selectionSummaryText,
  STATUS_CHIP_LABELS,
  statusChipLabel,
} from "./selection-panel";
import { formatSourceDate, safeHttpUrl, SourceBadge, sourceBadgeText } from "./source-badge";
import { StepNav, stepHeading, stepLinkText, TZ_STEPS } from "./step-nav";

/** Разделители разрядов ru-RU — неразрывные пробелы; для сравнения приводим к обычным. */
const sp = (s: string) => s.replace(/\s/g, " ");

/**
 * Строки, которые e2e-тесты v1 ищут строго, — в новых текстах их быть не должно. Слова собраны
 * из частей, чтобы проверка шлюза `grep` по исходникам не находила их в самом этом тесте.
 */
const FORBIDDEN = [
  ["Рассч", "итать"],
  ["Да", "лее"],
  ["Сохранить ", "расчёт"],
  ["Сохран", "ено"],
  ["Открыть ", "отчёт"],
  ["Отчёт ", "ROI"],
  ["не ", "оферта"],
  ["Откуда ", "цифры"],
].map((parts) => parts.join(""));

function contribution(over: Partial<ScoreContribution> & Pick<ScoreContribution, "factor" | "label">): ScoreContribution {
  return { weight: 0.2, value01: 0.5, points: 10, explanation: `${over.label}: 10 из 20 — пояснение`, ...over };
}

const SCORE: SelectionResult["score"] = {
  total: 68,
  contributions: [
    contribution({ factor: "econ", label: "Экономика", weight: 0.4, value01: 0.8, points: 32, explanation: "Экономика: 32 из 40 — NPV покупки лучший" }),
    contribution({ factor: "data", label: "Данные", weight: 0.2, value01: 0.62, points: 12.4 }),
    contribution({ factor: "maturity", label: "Зрелость", weight: 0.15, value01: 1, points: 15 }),
    contribution({ factor: "margin", label: "Запас", weight: 0.15, value01: 0.0667, points: 1 }),
    contribution({ factor: "cases", label: "Кейсы", weight: 0.1, value01: 0.8, points: 8 }),
  ],
};

function result(over: Partial<SelectionResult> & Pick<SelectionResult, "productSlug" | "status">): SelectionResult {
  return {
    process: "pallet-transport",
    productName: over.productSlug,
    needsVerification: false,
    reasons: [],
    limitations: [],
    missing: [],
    score: { total: null, contributions: [] },
    ...over,
  };
}

function spec(over: Partial<ParamSpec> & Pick<ParamSpec, "key">): ParamSpec {
  return {
    facility: "warehouse",
    section: "Общие параметры объекта",
    label: over.key,
    unit: null,
    kind: "number",
    options: [],
    base: null,
    min: null,
    max: null,
    locked: false,
    required: false,
    tzMinimum: null,
    usedBy: [],
    hint: "",
    example: "",
    organizerNote: null,
    origin: "organizer",
    sourceRef: null,
    sourceUrl: null,
    basis: null,
    formula: null,
    order: 1,
    ...over,
  };
}

const AREA = spec({
  key: "totalAreaM2",
  label: "Общая площадь склада",
  unit: "м²",
  base: 20000,
  min: 10000,
  max: 100000,
  required: true,
  hint: "Типичный склад",
  example: "например, 20 000",
  organizerNote: "Типичный склад",
  sourceRef: "Датасеты_хакатон.xlsx › Склад › стр. 4",
  order: 1,
});

const ACTIVE = spec({
  key: "activeAreaM2",
  label: "Площадь активной зоны",
  unit: "м²",
  base: 10000,
  min: 5000,
  max: 50000,
  formula: "totalAreaM2 × 0,5",
  order: 2,
});

const WORK_DAYS = spec({
  key: "workDaysPerYear",
  section: "Режим работы",
  label: "Рабочих дней в году",
  unit: "дн.",
  kind: "integer",
  base: 365,
  min: 365,
  max: 365,
  locked: true,
  order: 3,
});

const INTERNAL = spec({
  key: "internalPalletMovesPerDay",
  section: "Режим работы",
  label: "Внутренние перемещения",
  unit: "паллет/сут",
  kind: "integer",
  base: 0,
  min: 0,
  max: 5000,
  origin: "estimate",
  basis: "В датасете организатора нет числа внутренних перемещений; 0 — не учитываются.",
  order: 4,
});

function comparisonRow(over: Partial<ComparisonRow> & Pick<ComparisonRow, "productSlug">): ComparisonRow {
  return {
    process: "pallet-transport",
    productName: over.productSlug,
    status: "candidate",
    manuallyAdded: false,
    payloadKg: null,
    speedMps: null,
    thrNorm: null,
    thrCycle: null,
    thrEff: null,
    autonomyH: null,
    chargeMin: null,
    minAisleM: null,
    n: null,
    chargers: null,
    priceRub: null,
    capexPurchaseRub: null,
    npvPurchaseRub: null,
    paybackPurchaseYears: null,
    raasRubMonth: null,
    completenessPct: null,
    ...over,
  };
}

function expectClean(html: string) {
  for (const w of FORBIDDEN) expect(html, `в разметке не должно быть «${w}»`).not.toContain(w);
  expect(html).not.toMatch(/<h1[\s>]/);
}

// ——————————————————————————— Навигация по шагам ———————————————————————————

describe("stepHeading", () => {
  it("пишет «Шаг N из 8 · Название»", () => {
    expect(stepHeading(2, "Параметры")).toBe("Шаг 2 из 8 · Параметры");
    expect(stepHeading(8, "Сохранение и отчёт")).toBe("Шаг 8 из 8 · Сохранение и отчёт");
  });

  it("без названия берёт название шага из списка ТЗ", () => {
    expect(stepHeading(3)).toBe("Шаг 3 из 8 · Подбор");
    expect(stepHeading(7)).toBe("Шаг 7 из 8 · Имитация");
  });

  it("восемь шагов с якорями разделов в порядке ТЗ §2.2", () => {
    expect(TZ_STEPS.map(stepLinkText)).toEqual([
      "1 Объект",
      "2 Параметры",
      "3 Подбор",
      "4 Сравнение",
      "5 Экономика",
      "6 Сценарии",
      "7 Имитация",
      "8 Отчёт",
    ]);
    expect(TZ_STEPS.map((s) => s.id)).toEqual([
      "object",
      "params",
      "selection",
      "comparison",
      "economics",
      "scenarios",
      "simulation",
      "report",
    ]);
  });

  it("StepNav: подпись «Шаги по ТЗ», ссылки-якоря, текущий шаг отмечен", () => {
    const html = renderToStaticMarkup(createElement(StepNav, { active: 3 }));
    expect(html).toContain('aria-label="Шаги по ТЗ"');
    expect(html).toContain('href="#object"');
    expect(html).toContain('href="#report"');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/href="#selection" aria-current="step"/);
    expectClean(html);
  });
});

// ——————————————————————————— Балл подбора ———————————————————————————

describe("балл подбора: вклады факторов", () => {
  it("очки — с одним знаком без лишнего нуля, по-русски", () => {
    expect(formatPoints(32)).toBe("32");
    expect(formatPoints(12.44)).toBe("12,4");
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(Number.NaN)).toBe("—");
  });

  it("вклад: «Фактор: очки из максимума» — целые очки, как в объяснении модуля подбора", () => {
    expect(contributionMax({ weight: 0.4 })).toBe(40);
    expect(contributionMax({ weight: 0.15 })).toBe(15);
    expect(contributionPoints({ weight: 0.2, value01: 0.62 })).toBe(12);
    expect(contributionPoints({ weight: 0.2, value01: Number.NaN })).toBe(0);
    expect(contributionSummary({ label: "Экономика", weight: 0.4, value01: 0.8 })).toBe("Экономика: 32 из 40");
    expect(contributionSummary({ label: "Данные", weight: 0.2, value01: 0.62 })).toBe("Данные: 12 из 20");
  });

  it("отрезки полосы — по очкам фактора и не шире шкалы", () => {
    const segs = scoreSegments(SCORE.contributions);
    expect(segs.map((s) => s.widthPct)).toEqual([32, 12.4, 15, 1, 8]);
    expect(segs.map((s) => s.displayPoints)).toEqual([32, 12, 15, 1, 8]);
    expect(segs.map((s) => s.factor)).toEqual(["econ", "data", "maturity", "margin", "cases"]);
    expect(new Set(segs.map((s) => s.colorClass)).size).toBe(5);

    const broken = scoreSegments([
      contribution({ factor: "econ", label: "Экономика", points: 80 }),
      contribution({ factor: "data", label: "Данные", points: 50 }),
      contribution({ factor: "cases", label: "Кейсы", points: Number.NaN }),
    ]);
    expect(broken.map((s) => s.widthPct)).toEqual([80, 20, 0]);
  });

  it("итог и описание для скринридера; без балла — «не оценивается»", () => {
    expect(scoreTotalText(SCORE)).toBe("68 из 100");
    expect(scoreAriaLabel(SCORE)).toBe(
      "Балл 68 из 100: Экономика: 32 из 40, Данные: 12 из 20, Зрелость: 15 из 15, Запас: 1 из 15, Кейсы: 8 из 10",
    );
    expect(scoreTotalText({ total: null, contributions: [] })).toBe(SCORE_NOT_RATED);
    expect(scoreTotalText(null)).toBe("не оценивается");
    expect(scoreAriaLabel(null)).toBe("Балл: не оценивается");
  });

  it("ScoreBar показывает числа и объяснения, без балла — «не оценивается»", () => {
    const html = renderToStaticMarkup(createElement(ScoreBar, { score: SCORE }));
    expect(html).toContain("68");
    expect(html).toContain("Экономика 32");
    expect(html).toContain("Данные 12");
    expect(html).not.toContain("Данные 12,4");
    expect(html).toContain('style="width:12.4%"');
    expect(html).toContain("Экономика: 32 из 40 — NPV покупки лучший");
    expect(html).toContain("<details");
    expectClean(html);

    expect(renderToStaticMarkup(createElement(ScoreBar, { score: null }))).toContain("не оценивается");
    expect(renderToStaticMarkup(createElement(ScoreBar, { score: { total: null, contributions: [] } }))).toContain(
      "не оценивается",
    );
  });
});

// ——————————————————————————— Статусы подбора ———————————————————————————

describe("чипы статуса подбора", () => {
  it("подпись для каждого статуса", () => {
    const expected: Record<SelectionStatus, string> = {
      recommended: "Рекомендуется",
      candidate: "Подходит",
      "insufficient-data": "Недостаточно данных",
      excluded: "Исключён",
    };
    for (const [status, label] of Object.entries(expected) as [SelectionStatus, string][]) {
      expect(statusChipLabel(status)).toBe(label);
    }
    expect(Object.keys(STATUS_CHIP_LABELS).sort()).toEqual(Object.keys(expected).sort());
  });

  it("действия: использовать — рекомендуемый и подходящие, вручную — исключённые и без данных", () => {
    expect(canUse({ status: "recommended" })).toBe(true);
    expect(canUse({ status: "candidate" })).toBe(true);
    expect(canUse({ status: "excluded" })).toBe(false);
    expect(canManualAdd({ status: "excluded" })).toBe(true);
    expect(canManualAdd({ status: "insufficient-data" })).toBe(true);
    expect(canManualAdd({ status: "candidate" })).toBe(false);
  });

  it("предупреждение ручного добавления называет причины", () => {
    expect(
      manualAddWarning({
        status: "excluded",
        reasons: ["DMR 600: грузоподъёмность 600 кг < масса паллеты 800 кг"],
        missing: [],
      }),
    ).toBe(
      "Решение не прошло проверку ограничений: DMR 600: грузоподъёмность 600 кг < масса паллеты 800 кг. " +
        "Оно будет добавлено с пометкой ⚠ и записью в журнал",
    );
    const insufficient = manualAddWarning({
      status: "insufficient-data",
      reasons: ["Недостаточно данных для расчёта парка: паспортная производительность не опубликована", "Проход подходит"],
      missing: [{ key: "throughput", label: "Производительность", howToFix: "укажите" }],
    });
    expect(insufficient).toMatch(/^Решение не прошло проверку данных: Недостаточно данных для расчёта парка/);
    expect(insufficient).not.toContain("Проход подходит");
  });

  it("сводка по статусам", () => {
    expect(
      selectionSummaryText([
        { status: "recommended" },
        { status: "candidate" },
        { status: "candidate" },
        { status: "excluded" },
      ]),
    ).toBe("Рекомендуется: 1 · Подходит: 2 · Недостаточно данных: 0 · Исключено: 1");
  });

  it("SelectionPanel: таблица процесса, чипы, исключённые свёрнуты, ссылка на каталог", () => {
    const process = processDef("pallet-transport");
    expect(process).toBeDefined();
    if (!process) return;
    const results: SelectionResult[] = [
      result({
        productSlug: "ronavi-h1500",
        productName: "Ronavi H1500",
        status: "recommended",
        needsVerification: true,
        reasons: ["Рекомендуется: лучший балл"],
        score: SCORE,
      }),
      result({
        productSlug: "moros-800",
        productName: "Moros 800",
        status: "insufficient-data",
        reasons: ["Недостаточно данных для расчёта парка: паспортная производительность не опубликована"],
        missing: [{ key: "throughput", label: "Производительность", howToFix: "укажите производительность вручную" }],
      }),
      result({ productSlug: "dmr-600", productName: "DMR 600", status: "excluded", reasons: ["грузоподъёмность мала"] }),
      result({ productSlug: "other-process", status: "candidate", process: "storage" }),
    ];
    const html = renderToStaticMarkup(
      createElement(SelectionPanel, {
        process,
        results,
        inScenarios: scenarioItemKeys([]),
        onUse: () => {},
        onManualAdd: () => {},
        products: [{ slug: "ronavi-h1500", manufacturer: "Ronavi Robotics" }],
      }),
    );
    expect(html).toContain(process.name);
    expect(html).toContain(process.demandFormula);
    expect(html).toContain("Рекомендуется");
    expect(html).toContain("требует проверки");
    expect(html).toContain("Недостаточно данных");
    expect(html).toContain('href="/catalog/ronavi-h1500"');
    expect(html).toContain("Ronavi Robotics");
    expect(html).toContain("Использовать в сценариях");
    expect(html).toContain("Добавить вручную…");
    expect(html).toContain("Исключённые решения (1)");
    expect(html).toContain("укажите производительность вручную");
    // Продукт другого процесса в таблицу не попадает.
    expect(html).not.toContain("other-process");
    expectClean(html);

    const readOnly = renderToStaticMarkup(
      createElement(SelectionPanel, {
        process,
        results,
        inScenarios: new Set([scenarioItemKey("pallet-transport", "ronavi-h1500")]),
        onUse: () => {},
        onManualAdd: () => {},
        readOnly: true,
      }),
    );
    expect(readOnly).not.toContain("Использовать в сценариях");
    expect(readOnly).not.toContain("Действия");

    // Без обработчиков (серверная страница отчёта) — тоже только чтение, без колонки действий.
    const noHandlers = renderToStaticMarkup(createElement(SelectionPanel, { process, results }));
    expect(noHandlers).not.toContain("Действия");
    expect(noHandlers).not.toContain("Добавить вручную…");
    expect(noHandlers).toContain("Ronavi H1500");
  });

  it("«в сценариях» — по паре процесс:продукт, а не по slug", () => {
    const storage = processDef("storage");
    const pallet = processDef("pallet-transport");
    expect(storage).toBeDefined();
    expect(pallet).toBeDefined();
    if (!storage || !pallet) return;
    // MULE и AK-2000-2 стоят в сценарии перемещения паллет.
    const keys = scenarioItemKeys([
      { items: [] },
      {
        items: [
          { process: "pallet-transport", productSlug: "mule" },
          { process: "pallet-transport", productSlug: "ak-2000-2" },
        ],
      },
    ]);
    expect([...keys]).toEqual(["pallet-transport:mule", "pallet-transport:ak-2000-2"]);
    expect(isInScenarios(keys, { process: "pallet-transport", productSlug: "mule" })).toBe(true);
    expect(isInScenarios(keys, { process: "storage", productSlug: "mule" })).toBe(false);

    const storageResults: SelectionResult[] = [
      result({ process: "storage", productSlug: "ak-2000-2", productName: "AK-2000-2", status: "candidate" }),
      result({ process: "storage", productSlug: "mule", productName: "MULE", status: "excluded", reasons: ["не для хранения"] }),
    ];
    const storageHtml = renderToStaticMarkup(
      createElement(SelectionPanel, {
        process: storage,
        results: storageResults,
        inScenarios: keys,
        onUse: () => {},
        onManualAdd: () => {},
      }),
    );
    // В таблице хранения ни «✓ В сценариях», ни ложного «⚠ Добавлено вручную» у MULE.
    expect(storageHtml).not.toContain("✓ В сценариях");
    expect(storageHtml).not.toContain("⚠ Добавлено вручную");
    expect(storageHtml).toContain("Использовать в сценариях");
    expect(storageHtml).toContain("Добавить вручную…");

    const palletHtml = renderToStaticMarkup(
      createElement(SelectionPanel, {
        process: pallet,
        results: [result({ productSlug: "ak-2000-2", productName: "AK-2000-2", status: "candidate" })],
        inScenarios: keys,
        onUse: () => {},
        onManualAdd: () => {},
      }),
    );
    expect(palletHtml).toContain("✓ В сценариях");
  });

  it("форма ручного добавления закрывается, если продукт стал кандидатом или уже в сценариях", () => {
    const dmr = { productSlug: "dmr-600", status: "excluded" as const };
    expect(isManualFormOpen("dmr-600", dmr, false)).toBe(true);
    expect(isManualFormOpen(null, dmr, false)).toBe(false);
    expect(isManualFormOpen("moros-800", dmr, false)).toBe(false);
    // После правки массы паллеты DMR 600 прошёл ограничения — форма больше не показывается.
    expect(isManualFormOpen("dmr-600", { productSlug: "dmr-600", status: "candidate" }, false)).toBe(false);
    // Продукт уже поставили в сценарии в другом месте.
    expect(isManualFormOpen("dmr-600", dmr, true)).toBe(false);
  });
});

// ——————————————————————————— Бейдж источника ———————————————————————————

describe("SourceBadge", () => {
  it("текст — происхождение; короткое примечание в бейдже, длинное — в раскрытии", () => {
    expect(sourceBadgeText("organizer")).toBe("Организатор");
    expect(sourceBadgeText("estimate", "аналог: Ronavi")).toBe("Оценка · аналог: Ronavi");
    expect(sourceBadgeText("estimate", "x".repeat(41))).toBe("Оценка");
    expect(sourceBadgeText("user")).toBe("Задано вами");
  });

  it("ссылка только http(s), дата по-русски", () => {
    expect(safeHttpUrl("https://ronavi.ru/h1500")).toBe("https://ronavi.ru/h1500");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(formatSourceDate("2026-09-12")).toBe("12.09.2026");
    expect(formatSourceDate("")).toBeNull();
  });

  it("раскрытие: ссылка в новой вкладке, место, дата, подтверждение", () => {
    const html = renderToStaticMarkup(
      createElement(SourceBadge, {
        origin: "research",
        sourceUrl: "https://example.com/spec.pdf",
        sourceRef: "стр. 3",
        date: "2026-09-12",
        confirmed: true,
      }),
    );
    expect(html).toContain("<details");
    expect(html).toContain("Открытый источник");
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="noopener[^"]*"/);
    expect(html).toContain("12.09.2026");
    expect(html).toContain("✓ подтверждено");

    const unconfirmed = renderToStaticMarkup(createElement(SourceBadge, { origin: "organizer", confirmed: false }));
    expect(unconfirmed).toContain("не подтверждено");

    // Без подробностей — простой бейдж без раскрытия.
    const plain = renderToStaticMarkup(createElement(SourceBadge, { origin: "user" }));
    expect(plain).not.toContain("<details");
    expect(plain).toContain("Задано вами");
  });
});

// ——————————————————————————— Параметры ———————————————————————————

describe("ParamField и ParamsForm", () => {
  it("подпись с единицей, текст значения по-русски", () => {
    expect(paramLabelText(AREA)).toBe("Общая площадь склада, м²");
    expect(paramLabelText(spec({ key: "x", label: "Коэффициент", unit: "-" }))).toBe("Коэффициент");
    expect(sp(paramInputText(20000))).toBe("20 000");
    expect(paramInputText(1.302)).toBe("1,302");
    expect(paramInputText(null)).toBe("");
    expect(paramInputText("1С:ERP")).toBe("1С:ERP");
  });

  it("подсказки: пример, диапазон организатора, формула; у оценки — «допустимый диапазон»", () => {
    const lines = paramHelpLines(AREA).map(sp);
    expect(lines).toEqual(["Типичный склад", "например, 20 000 · диапазон организатора: 10 000–100 000 м²"]);
    expect(paramHelpLines(spec({ key: "x", example: "например, 5" }))).toEqual(["например, 5"]);
    expect(sp(rangeLine(INTERNAL) ?? "")).toBe("допустимый диапазон: 0–5 000 паллет/сут");
    expect(rangeLine(WORK_DAYS)).toBeNull();
    // Формула описывает базовое значение, а не живую связь, — и строка так и говорит.
    expect(formulaLine("«Общая площадь склада» × 0,5")).toBe(
      "базовое значение по формуле: «Общая площадь склада» × 0,5 (не пересчитывается при правке других полей)",
    );
    expect(paramHelpLines(ACTIVE, "«Общая площадь склада» × 0,5")).toContain(
      formulaLine("«Общая площадь склада» × 0,5"),
    );
    expect(paramHelpLines(ACTIVE).join("\n")).not.toMatch(/^формула:/m);
  });

  it("вне диапазона: у организатора — «диапазона организатора», у оценки — «допустимого диапазона»", () => {
    expect(sp(outOfRangeText(AREA, 150000))).toBe(
      "Общая площадь склада: 150 000 вне диапазона организатора 10 000–100 000 м² — проверьте значение",
    );
    expect(sp(outOfRangeText(INTERNAL, 6000))).toBe(
      "Внутренние перемещения: 6 000 вне допустимого диапазона 0–5 000 паллет/сут — проверьте значение",
    );
    // Сообщение общего модуля про оценочный параметр переписывается, чужие коды — нет.
    const libIssue = {
      key: INTERNAL.key,
      label: INTERNAL.label,
      code: "out_of_range" as const,
      severity: "warning" as const,
      message: "Внутренние перемещения: 6 000 вне диапазона организатора 0–5 000 паллет/сут — проверьте значение",
    };
    expect(paramWarningText(INTERNAL, 6000, libIssue)).not.toContain("организатора");
    expect(paramWarningText(INTERNAL, 6000, { ...libIssue, code: "unknown_key", message: "другое" })).toBe("другое");
    expect(paramWarningText(INTERNAL, 100, null)).toBeNull();
    expect(paramWarningText(WORK_DAYS, 300, null)).toBeNull();
    expect(isLockedChanged(WORK_DAYS, 300)).toBe(true);
    expect(isLockedChanged(WORK_DAYS, 365)).toBe(false);

    const html = renderToStaticMarkup(
      createElement(ParamField, { def: INTERNAL, value: 6000, changed: true, onChange: () => {}, onReset: () => {} }),
    );
    expect(sp(html)).toContain("вне допустимого диапазона 0–5 000 паллет/сут");
    expect(html).not.toContain("диапазона организатора");
  });

  it("ввод разбирается по-русски, нераспознанный — не уходит в модель", () => {
    // «25 000,5» с пробелом-разделителем и запятой → число.
    const ok = interpretParamInput(AREA, 20000, "25 000,5");
    expect(ok.emit).toEqual({ value: 25000.5 });
    expect(ok.draft).toEqual({ text: "25 000,5", against: 25000.5, issue: null });
    // Дописанная единица параметра срезается.
    expect(interpretParamInput(AREA, 20000, "30 000 м²").emit).toEqual({ value: 30000 });
    // То же значение наверх не уходит.
    expect(interpretParamInput(AREA, 20000, "20000").emit).toBeNull();
    // Не число — ошибка с подсказкой, модель держит прежнее значение.
    const bad = interpretParamInput(AREA, 20000, "abc");
    expect(bad.emit).toBeNull();
    expect(bad.draft.against).toBe(20000);
    expect(bad.draft.issue?.severity).toBe("error");
    expect(bad.draft.issue?.message).toContain("не число");
    // Дробное у целочисленного — ошибка.
    expect(interpretParamInput(INTERNAL, 0, "1,5").draft.issue?.code).toBe("not_integer");
    // Пустое поле у параметра с базовым значением — модель держит значение.
    expect(interpretParamInput(AREA, 20000, "").emit).toBeNull();
    // Пустое поле у параметра без базового значения — «не задано».
    const noBase = spec({ key: "cleanersCount", kind: "integer", base: null });
    expect(interpretParamInput(noBase, 12, " ").emit).toEqual({ value: null });
    // Черновик живёт, пока модель держит значение, против которого он набран.
    expect(liveParamDraft(bad.draft, 20000)).toBe(bad.draft);
    expect(liveParamDraft(bad.draft, 10000)).toBeNull();
    expect(liveParamDraft(null, 20000)).toBeNull();
  });

  it("поле: id p-{key}, демо-значение организатора, вне диапазона — предупреждение", () => {
    const base = renderToStaticMarkup(
      createElement(ParamField, { def: AREA, value: 20000, changed: false, onChange: () => {}, onReset: () => {} }),
    );
    expect(base).toContain('id="p-totalAreaM2"');
    expect(base).toContain('inputMode="decimal"');
    expect(base).toContain("Организатор · демо-значение организатора");
    expect(base).not.toContain("вернуть базовое");
    expectClean(base);

    const out = renderToStaticMarkup(
      createElement(ParamField, { def: AREA, value: 150000, changed: true, onChange: () => {}, onReset: () => {} }),
    );
    expect(out).toContain("Задано вами");
    expect(out).toContain("вернуть базовое");
    expect(sp(out)).toContain("вне диапазона организатора 10 000–100 000 м²");
    expect(out).toContain("border-caution");

    const err = renderToStaticMarkup(
      createElement(ParamField, {
        def: AREA,
        value: 20000,
        changed: false,
        onChange: () => {},
        onReset: () => {},
        issue: {
          key: "totalAreaM2",
          label: "Общая площадь склада",
          code: "wrong_type",
          severity: "error",
          message: "Общая площадь склада: «abc» — не число. Введите число, дробную часть через запятую",
        },
      }),
    );
    expect(err).toContain('role="alert"');
    expect(err).toContain('aria-invalid="true"');

    // Пустому полю источник не приписывается.
    const empty = renderToStaticMarkup(
      createElement(ParamField, {
        def: spec({ key: "cleanersCount", kind: "integer", origin: "estimate", basis: "в датасете нет" }),
        value: null,
        changed: false,
        onChange: () => {},
        onReset: () => {},
      }),
    );
    expect(empty).toContain("не задано");
    expect(empty).not.toContain("Оценка");

    const locked = renderToStaticMarkup(
      createElement(ParamField, { def: WORK_DAYS, value: 365, changed: false, onChange: () => {}, onReset: () => {} }),
    );
    expect(locked).toContain("значение зафиксировано организатором; изменение будет записано в журнал");

    // Без обработчиков поле только для чтения: серверная страница не передаёт функций.
    const view = renderToStaticMarkup(createElement(ParamField, { def: AREA, value: 30000, changed: true }));
    expect(view).toMatch(/readOnly=""/);
    expect(view).toContain("Задано вами");
    expect(view).not.toContain("вернуть базовое");
  });

  it("форма: разделы h3 в порядке параметров, счётчик изменений и предупреждений", () => {
    const defs = [INTERNAL, WORK_DAYS, ACTIVE, AREA];
    expect(groupBySection(defs).map((s) => [s.section, s.defs.map((d) => d.key)])).toEqual([
      ["Общие параметры объекта", ["totalAreaM2", "activeAreaM2"]],
      ["Режим работы", ["workDaysPerYear", "internalPalletMovesPerDay"]],
    ]);

    const base = { totalAreaM2: 20000, activeAreaM2: 10000, workDaysPerYear: 365, internalPalletMovesPerDay: 0 };
    const values = { ...base, totalAreaM2: 150000, activeAreaM2: 10000.0000000001 };
    const issues = [
      { key: "totalAreaM2", label: "Общая площадь склада", code: "out_of_range" as const, severity: "warning" as const, message: "вне" },
      { key: "totalAreaM2", label: "Общая площадь склада", code: "wrong_type" as const, severity: "error" as const, message: "не число" },
    ];
    const c = paramsCounters(defs, values, base, issues);
    expect(c).toEqual({ changed: 1, warnings: 1, errors: 1 });
    expect(countersText(c)).toBe("Изменено параметров: 1 · Предупреждений: 1 · Ошибок: 1");
    // Без issues счётчик видит то же, что подсвечивает поле: 150 000 вне диапазона.
    expect(paramsCounters(defs, values, base, [])).toEqual({ changed: 1, warnings: 1, errors: 0 });
    expect(hasParamWarning(AREA, values, base, [])).toBe(true);
    expect(hasParamWarning(ACTIVE, values, base, [])).toBe(false);
    // Изменённый зафиксированный параметр — тоже предупреждение; параметр считается один раз.
    const lockedValues = { ...values, workDaysPerYear: 300 };
    expect(paramsCounters(defs, lockedValues, base, issues)).toEqual({ changed: 2, warnings: 2, errors: 1 });
    // Замечание без поля в форме (строка файла) считается отдельно.
    const orphan = { key: "Непонятная строка", label: "Непонятная строка", code: "unknown_key" as const, severity: "warning" as const, message: "x" };
    expect(paramsCounters(defs, values, base, [orphan]).warnings).toBe(2);
    expect(countersText({ changed: 2, warnings: 0, errors: 0 })).toBe("Изменено параметров: 2 · Предупреждений: 0");
    expect(issueForKey(issues, "totalAreaM2")?.severity).toBe("error");
    expect(issueForKey(issues, "activeAreaM2")).toBeNull();
    expect(humanizeFormula("totalAreaM2 × 0,5", defs)).toBe("«Общая площадь склада» × 0,5");
    expect(humanizeFormula(null, defs)).toBeNull();
    expect(sectionSummaryText(6, 0)).toBe("6 параметров");
    expect(sectionSummaryText(1, 1, 2)).toBe("1 параметр, изменено 1, замечаний 2");
    expect(sectionSummaryText(3, 0, 1)).toBe("3 параметра, замечаний 1");

    const html = renderToStaticMarkup(
      createElement(ParamsForm, { defs, values, issues: [], baseValues: base, onChange: () => {}, onReset: () => {} }),
    );
    expect(html.match(/<h3[\s>]/g)).toHaveLength(2);
    // Поле totalAreaM2 = 150 000 подсвечено само — счётчик и раздел это видят.
    expect(html).toContain("Изменено параметров: 1 · Предупреждений: 1");
    expect(html).toContain("2 параметра, изменено 1, замечаний 1");
    expect(html).toContain(formulaLine("«Общая площадь склада» × 0,5"));
    expectClean(html);

    // Без обработчиков форма только для чтения.
    const view = renderToStaticMarkup(createElement(ParamsForm, { defs, values, issues: [], baseValues: base }));
    expect(view).not.toContain("вернуть базовое");
    expect(view).toMatch(/readOnly=""/);
  });
});

// ——————————————————————————— Сравнение ———————————————————————————

describe("ComparisonTable", () => {
  it("значения без лишних нулей, «нет данных» вместо null", () => {
    expect(sp(fmtValue(1500))).toBe("1 500");
    expect(fmtValue(1.5)).toBe("1,5");
    expect(fmtValue(0.75)).toBe("0,75");
    expect(fmtValue(null)).toBe("нет данных");
    expect(paybackText({ paybackPurchaseYears: 3.6, capexPurchaseRub: 35420000 })).toBe("3,6 года");
    expect(paybackText({ paybackPurchaseYears: null, capexPurchaseRub: 35420000 })).toBe("не окупается");
    expect(paybackText({ paybackPurchaseYears: null, capexPurchaseRub: null })).toBe("нет данных");
    expect(comparisonStatusText({ status: "excluded", manuallyAdded: true })).toBe("Исключён · ⚠ добавлено вручную");
  });

  it("лучшее значение выделяется, только если оно одно", () => {
    expect(bestColumnIndex([1, 3, 2], "max")).toBe(1);
    expect(bestColumnIndex([1, 3, 2], "min")).toBe(0);
    expect(bestColumnIndex([3, null, 3], "max")).toBeNull();
    expect(bestColumnIndex([null, 5], "max")).toBeNull();
  });

  it("продукты — столбцы (не больше шести), группы строк ТЗ, ⚠ у добавленных вручную", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      comparisonRow({ productSlug: `p${i}`, productName: `Продукт ${i}`, thrEff: 10 + i, priceRub: 2700000 }),
    );
    rows[1] = comparisonRow({ productSlug: "manual", productName: "DMR 600", status: "excluded", manuallyAdded: true });
    const html = renderToStaticMarkup(createElement(ComparisonTable, { rows }));
    expect(html).toContain("Технические");
    expect(html).toContain("Эксплуатация");
    expect(html).toContain("Экономика");
    expect(html).toContain("⚠ DMR 600");
    expect(html).toContain("паллет/ч");
    expect(html).toContain(`Показаны ${COMPARISON_MAX_COLUMNS} из 7 решений`);
    expect(html).not.toContain("Продукт 6");
    expect(sp(html)).toContain("2 700 000 ₽");
    expect(html).toContain("нет данных");
    expectClean(html);

    expect(renderToStaticMarkup(createElement(ComparisonTable, { rows: [] }))).toContain("Нет решений для сравнения");
  });

  it("добавленные вручную и выбранные в сценарии не уходят за шестой столбец", () => {
    // Как в модели на складе: восемь кандидатов перемещения паллет, продукт из подбора вручную —
    // в конце списка (lib/tz/model.ts добавляет упомянутые в сценариях после кандидатов).
    const candidates = Array.from({ length: 8 }, (_, i) =>
      comparisonRow({ productSlug: `p${i}`, productName: `Продукт ${i}`, thrEff: 20 + i }),
    );
    const manual = comparisonRow({ productSlug: "dmr-600", productName: "DMR 600", status: "excluded", manuallyAdded: true });
    const rows = [...candidates, manual];

    const cols = comparisonColumns(rows);
    expect(cols.map((r) => r.productSlug)).toEqual(["p0", "p1", "p2", "p3", "p4", "dmr-600"]);

    // Продукт из сценария (Carrier P на восьмом месте) тоже остаётся; порядок столбцов исходный.
    const pinned = scenarioItemKeys([{ items: [{ process: "pallet-transport", productSlug: "p7" }] }]);
    expect(comparisonColumns(rows, pinned).map((r) => r.productSlug)).toEqual(["p0", "p1", "p2", "p3", "p7", "dmr-600"]);
    // Ключ другого процесса не закрепляет столбец.
    const otherProcess = scenarioItemKeys([{ items: [{ process: "storage", productSlug: "p7" }] }]);
    expect(comparisonColumns(rows, otherProcess).map((r) => r.productSlug)).not.toContain("p7");
    // Закреплённых больше шести — показываются все закреплённые.
    const manyManual = Array.from({ length: 7 }, (_, i) =>
      comparisonRow({ productSlug: `m${i}`, manuallyAdded: true, status: "excluded" }),
    );
    expect(comparisonColumns([...candidates, ...manyManual])).toHaveLength(7);

    const html = renderToStaticMarkup(createElement(ComparisonTable, { rows, pinned }));
    expect(html).toContain("⚠ DMR 600");
    expect(html).toContain("Продукт 7");
    expect(html).not.toContain("Продукт 5");
    expect(html).toContain("Показаны 6 из 9 решений: добавленные вручную и выбранные в сценарии — всегда");
    expectClean(html);
  });

  it("процесс без экономики и имитации: «не рассчитывается (прототип)», а не «нет данных»", () => {
    const storage = processDef("storage");
    const pallet = processDef("pallet-transport");
    expect(storage?.calcSupported).toBe(false);
    expect(pallet?.calcSupported).toBe(true);
    const byKey = (k: string) => COMPARISON_METRICS.find((m) => m.key === k) ?? { requires: undefined };
    expect(metricPlaceholder(byKey("capexPurchaseRub"), storage)).toBe(NOT_CALCULATED);
    expect(metricPlaceholder(byKey("n"), storage)).toBe(NOT_CALCULATED);
    expect(metricPlaceholder(byKey("thrCycle"), storage)).toBe(NOT_SIMULATED);
    // Значения каталога от процесса не зависят.
    expect(metricPlaceholder(byKey("priceRub"), storage)).toBeNull();
    expect(metricPlaceholder(byKey("completenessPct"), storage)).toBeNull();
    // Перемещение паллет считается полностью.
    expect(metricPlaceholder(byKey("capexPurchaseRub"), pallet)).toBeNull();
    expect(metricPlaceholder(byKey("thrCycle"), pallet)).toBeNull();
    expect(prototypeNote(pallet)).toBeNull();
    expect(prototypeNote(storage)).toContain("не рассчитываются (прототип)");
    expect(metricPlaceholder(byKey("n"), undefined)).toBeNull();

    const rows = [
      comparisonRow({ process: "storage", productSlug: "shuttle", productName: "Pallet Shuttle", priceRub: 5000000, thrNorm: 100 }),
      comparisonRow({ process: "storage", productSlug: "ak", productName: "AK-2000-2", priceRub: null }),
    ];
    const html = renderToStaticMarkup(createElement(ComparisonTable, { rows }));
    expect(html).toContain(NOT_CALCULATED);
    expect(html).toContain(NOT_SIMULATED);
    expect(html).toContain('colSpan="2"');
    expect(html).toContain(prototypeNote(storage) ?? "—");
    // «нет данных» остаётся только там, где значения действительно нет (цена AK-2000-2 и т. п.).
    expect(html).toContain("нет данных");
    expectClean(html);
  });

  it("единица печатается один раз: в значении денежных строк и полноты, а не в подписи", () => {
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        rows: [
          comparisonRow({
            productSlug: "h1500",
            priceRub: 2700000,
            capexPurchaseRub: 35420000,
            npvPurchaseRub: 640375,
            raasRubMonth: 150000,
            completenessPct: 80,
          }),
        ],
      }),
    );
    const text = sp(html);
    expect(text).toContain("2 700 000 ₽");
    expect(text).toContain("35,4 млн ₽");
    expect(text).toContain("150 000 ₽/мес");
    expect(text).toContain("80 %");
    // Подпись строки не несёт «, ₽» / «, %» / «, ₽/мес».
    expect(html).not.toMatch(/, (<!-- -->)?(₽|%)/);
    // Единицы технических строк остаются в подписи.
    expect(html).toMatch(/, (<!-- -->)?кг/);
  });
});
