import type { ParamSpec } from "../types";

/**
 * Тестовые данные для проверки параметров и разбора файлов (только тесты lib/tz/params).
 *
 * WAREHOUSE_ROWS — 42 параметра листа «Склад» датасета организатора
 * (Датасеты_хакатон.xlsx › Склад, 2026-09-22): раздел, название, единица, базовое значение и
 * диапазон — ровно так, как они записаны в файле организатора (включая «Да » с пробелом,
 * «м/п» и «-» вместо пустых границ). Примечания организатора не копируются.
 *
 * Описания параметров (`warehouseDefs`) намеренно подписаны короче, как в карте данных плана
 * (orgdata §1): «Объём приёмки» вместо «Объём приёмки (поддоны/сутки)», «Отборщики
 * (комплектовщики)» вместо «Из них: отборщики (комплектовщики)». Так тест проверяет
 * сопоставление по названию, а не простое равенство строк. Это фикстура, а не данные модели:
 * настоящие описания генерирует T1.1 (lib/data/organizer).
 *
 * `encodeCp1251` имитирует CSV, сохранённый русским Excel в Windows-1251.
 */

/** Строка листа организатора: [раздел, название, единица, база, min, max]. */
export type OrganizerRow = [string, string, string, number | string, number | string, number | string];

/** Описание к строке организатора: ключ, вид, подпись описания, единица описания, варианты. */
type DefShape = {
  key: string;
  kind: ParamSpec["kind"];
  label: string;
  unit: string | null;
  options?: string[];
  required?: boolean;
};

const S1 = "ОБЩИЕ ПАРАМЕТРЫ ОБЪЕКТА";
const S2 = "РЕЖИМ РАБОТЫ";
const S3 = "ОПЕРАЦИИ: ОБЪЁМ И ПРОИЗВОДИТЕЛЬНОСТЬ";
const S4 = "ПЕРСОНАЛ";
const S5 = "МАРШРУТЫ И ПЛАНИРОВКА";
const S6 = "ХРАНЕНИЕ И ХАРАКТЕРИСТИКИ ГРУЗОВ";
const S7 = "ИНФРАСТРУКТУРА И ОГРАНИЧЕНИЯ";

/** Лист «Склад» организатора (42 строки) и соответствующие описания. */
const WAREHOUSE: readonly [OrganizerRow, DefShape][] = [
  [[S1, "Общая площадь склада", "м²", 20000, 10000, 100000], { key: "totalAreaM2", kind: "number", label: "Общая площадь склада", unit: "м²" }],
  [[S1, "Площадь активной (роботизируемой) зоны", "м²", 10000, 5000, 50000], { key: "activeAreaM2", kind: "number", label: "Площадь активной (роботизируемой) зоны", unit: "м²" }],
  [[S1, "Высота потолков в зоне хранения", "м", 10, 5, 16], { key: "storageCeilingHeightM", kind: "number", label: "Высота потолков в зоне хранения", unit: "м" }],
  [[S1, "Количество этажей (мезонинов)", "шт.", 1, 1, 3], { key: "floorsCount", kind: "integer", label: "Количество этажей (мезонинов)", unit: "шт." }],
  [[S1, "Ширина главных проездов", "м", 3.5, 2.5, 6], { key: "mainAisleWidthM", kind: "number", label: "Ширина главных проездов", unit: "м" }],
  [[S1, "Ширина рабочих проходов между стеллажами", "м", 2.8, 1.5, 4.5], { key: "rackAisleWidthM", kind: "number", label: "Ширина рабочих проходов между стеллажами", unit: "м" }],
  [[S1, "Тип напольного покрытия", "-", "Промышленный бетон", "-", "-"], { key: "floorType", kind: "enum", label: "Тип напольного покрытия", unit: null, options: ["Промышленный бетон", "Эпоксидное покрытие", "Асфальт"] }],
  [[S1, "Ровность пола (отклонение)", "мм/2м", 3, 1, 8], { key: "floorFlatnessMmPer2m", kind: "number", label: "Ровность пола (отклонение)", unit: "мм/2 м" }],
  [[S2, "Количество рабочих смен в сутки", "смен", 2, 1, 3], { key: "shiftsPerDay", kind: "integer", label: "Количество рабочих смен в сутки", unit: "смен" }],
  [[S2, "Рабочих дней в году", "дн.", 365, 365, 365], { key: "workDaysPerYear", kind: "integer", label: "Рабочих дней в году", unit: "дн." }],
  [[S2, "Продолжительность смены", "ч", 11, 10, 11], { key: "shiftDurationH", kind: "number", label: "Продолжительность смены", unit: "ч" }],
  [[S2, "Пиковый коэффициент нагрузки", "-", 1.5, 1.2, 2.5], { key: "peakFactor", kind: "number", label: "Пиковый коэффициент нагрузки", unit: null }],
  [[S3, "Объём приёмки (поддоны/сутки)", "поддон/сут", 1000, 500, 5000], { key: "inboundPalletsPerDay", kind: "integer", label: "Объём приёмки", unit: "поддон/сут" }],
  [[S3, "Объём отгрузки (поддоны/сутки)", "поддон/сут", 1000, 500, 5000], { key: "outboundPalletsPerDay", kind: "integer", label: "Объём отгрузки", unit: "поддон/сут" }],
  [[S3, "Объём отбора (строк/сутки, всего)", "строк/сут", 100000, 50000, 500000], { key: "pickLinesPerDay", kind: "integer", label: "Объём отбора (строк/сутки)", unit: "строк/сут" }],
  [[S3, "Объём отбора (штук/сутки, всего)", "шт./сут", 150000, 75000, 750000], { key: "pickUnitsPerDay", kind: "integer", label: "Объём отбора (штук/сутки)", unit: "шт./сут" }],
  [[S3, "Доля мелкоштучного отбора (piece-pick)", "%", 30, 10, 80], { key: "piecePickSharePct", kind: "percent", label: "Доля мелкоштучного отбора", unit: "%" }],
  [[S3, "Количество SKU (активных)", "SKU", 2000, 1000, 10000], { key: "activeSkuCount", kind: "integer", label: "Количество SKU (активных)", unit: "SKU" }],
  [[S3, "Доля SKU с быстрым оборотом (A-класс)", "%", 20, 10, 40], { key: "fastMoverSkuSharePct", kind: "percent", label: "Доля SKU A-класса", unit: "%" }],
  [[S4, "Общая численность персонала склада", "чел.", 180, 30, 700], { key: "totalStaff", kind: "integer", label: "Общая численность персонала", unit: "чел." }],
  [[S4, "Из них: отборщики (комплектовщики)", "чел.", 100, 15, 500], { key: "pickersCount", kind: "integer", label: "Отборщики (комплектовщики)", unit: "чел." }],
  [[S4, "Из них: операторы погрузчиков", "чел.", 25, 5, 80], { key: "forkliftOperatorsCount", kind: "integer", label: "Операторы погрузчиков", unit: "чел." }],
  [[S4, "Из них: операторы упаковочных линий", "чел.", 20, 5, 60], { key: "packingOperatorsCount", kind: "integer", label: "Операторы упаковочных линий", unit: "чел." }],
  [[S4, "Средняя з/п отборщика (gross)", "руб./мес.", 100000, 70000, 150000], { key: "pickerSalaryRubMonth", kind: "number", label: "Средняя з/п отборщика (gross)", unit: "руб./мес." }],
  [[S4, "Средняя з/п оператора погрузчика (gross)", "руб./мес.", 120000, 80000, 170000], { key: "forkliftSalaryRubMonth", kind: "number", label: "Средняя з/п оператора погрузчика (gross)", unit: "руб./мес." }],
  [[S4, "Коэффициент начислений на ФОТ (страховые взносы)", "-", 1.302, 1.302, 1.302], { key: "payrollTaxMultiplier", kind: "number", label: "Коэффициент начислений на ФОТ", unit: null }],
  [[S4, "Средняя выработка отборщика (строк/ч)", "строк/ч·чел", 150, 80, 200], { key: "pickerLinesPerHour", kind: "number", label: "Средняя выработка отборщика", unit: "строк/ч·чел" }],
  [[S4, "Коэффициент потерь рабочего времени (отпуск, болезнь, текучесть)", "%", 25, 15, 35], { key: "workTimeLossPct", kind: "percent", label: "Коэффициент потерь рабочего времени", unit: "%" }],
  [[S5, "Средняя длина маршрута отборщика на 1 строку", "м", 25, 15, 60], { key: "pickRouteLengthPerLineM", kind: "number", label: "Средняя длина маршрута отборщика на 1 строку", unit: "м" }],
  [[S5, "Протяжённость конвейерной/транспортной системы", "м", 350, 0, 2000], { key: "conveyorLengthM", kind: "number", label: "Протяжённость конвейерной/транспортной системы", unit: "м" }],
  [[S6, "Тип стеллажной системы", "-", "Фронтальные паллетные", "-", "-"], { key: "rackType", kind: "enum", label: "Тип стеллажной системы", unit: null, options: ["Фронтальные паллетные", "Shuttle", "AutoStore", "Miniload", "Drive-in", "Push-back"] }],
  [[S6, "Количество паллетомест", "м/п", 20000, 10000, 100000], { key: "palletPositions", kind: "integer", label: "Количество паллетомест", unit: "паллетомест" }],
  [[S6, "Средняя масса грузовой единицы (паллет)", "кг", 800, 200, 1500], { key: "avgPalletMassKg", kind: "number", label: "Средняя масса грузовой единицы (паллет)", unit: "кг" }],
  [[S6, "Средняя масса штучной единицы (SKU)", "кг", 1.8, 0.1, 20], { key: "avgUnitMassKg", kind: "number", label: "Средняя масса штучной единицы", unit: "кг" }],
  [[S6, "Средние габариты паллеты (Д×Ш×В)", "мм", "1200×800×1600", "-", "-"], { key: "palletDimsMm", kind: "dims", label: "Средние габариты паллеты (Д×Ш×В)", unit: "мм" }],
  [[S6, "Средние габариты штучной единицы (Д×Ш×В)", "мм", "300×200×150", "-", "-"], { key: "unitDimsMm", kind: "dims", label: "Средние габариты штучной единицы", unit: "мм" }],
  [[S6, "Доля негабаритных/нестандартных грузов", "%", 5, 0, 30], { key: "nonStandardCargoPct", kind: "percent", label: "Доля негабаритных грузов", unit: "%" }],
  [[S7, "Мощность электроснабжения (доступная)", "кВт", 500, 100, 3000], { key: "availablePowerKw", kind: "number", label: "Мощность электроснабжения (доступная)", unit: "кВт" }],
  [[S7, "Наличие WMS", "-", "Да ", "Да", "Да"], { key: "hasWms", kind: "enum", label: "Наличие WMS", unit: null, options: ["Да", "Нет"] }],
  [[S7, "Наличие ERP/1С", "-", "1С:ERP", "-", "-"], { key: "erpSystem", kind: "text", label: "Наличие ERP/1С", unit: null, required: false }],
  [[S7, "Планируемый бюджет на роботизацию (CAPEX)", "млн руб.", 80, 10, 500], { key: "capexBudgetMRub", kind: "number", label: "Планируемый бюджет (CAPEX)", unit: "млн руб.", required: false }],
  [[S7, "Горизонт расчёта окупаемости", "лет", 5, 3, 10], { key: "horizonYears", kind: "integer", label: "Горизонт расчёта окупаемости", unit: "лет" }],
];

/** Строки листа «Склад» организатора в порядке файла. */
export const WAREHOUSE_ROWS: readonly OrganizerRow[] = WAREHOUSE.map(([row]) => row);

/** Описание параметра с разумными значениями по умолчанию для тестов. */
export function spec(p: Partial<ParamSpec> & Pick<ParamSpec, "key">): ParamSpec {
  return {
    facility: "warehouse",
    section: "Тест",
    label: p.key,
    unit: null,
    kind: "number",
    options: [],
    base: null,
    min: null,
    max: null,
    locked: false,
    required: true,
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
    order: 0,
    ...p,
  };
}

/** Знаки Windows-1251 вне ASCII и кириллицы, которые встречаются в наших таблицах. */
const CP1251_EXTRA: Readonly<Record<string, number>> = {
  "№": 0xb9,
  "°": 0xb0,
  "·": 0xb7,
  "…": 0x85,
  "«": 0xab,
  "»": 0xbb,
  "–": 0x96,
  "—": 0x97,
  "›": 0x9b,
  " ": 0xa0,
};

/**
 * Кодирует строку в Windows-1251, как «Сохранить как → CSV (разделители — точки с запятой)»
 * русского Excel: символы вне кодовой страницы («²», «×», «−», «₽», «▌») становятся «?».
 */
export function encodeCp1251(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    const extra = CP1251_EXTRA[ch];
    if (c < 0x80) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else if (c === 0x401) out.push(0xa8);
    else if (c === 0x451) out.push(0xb8);
    else if (extra !== undefined) out.push(extra);
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}

/** Граница из строки организатора: «-» — нет границы, строка «Да» — не числовая граница. */
function bound(v: number | string): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * 42 описания склада по строкам организатора: базовые значения и диапазоны из файла,
 * «Да » обрезано, строки с min = max зафиксированы.
 */
export function warehouseDefs(): ParamSpec[] {
  return WAREHOUSE.map(([row, shape], i) => {
    const [section, , , base, min, max] = row;
    const locked = (typeof min === "number" && min === max) || (typeof min === "string" && min !== "-" && min === max);
    return spec({
      key: shape.key,
      section: section.charAt(0) + section.slice(1).toLowerCase(),
      label: shape.label,
      unit: shape.unit,
      kind: shape.kind,
      options: shape.options ?? [],
      base: typeof base === "string" ? base.trim() : base,
      min: bound(min),
      max: bound(max),
      locked,
      required: shape.required ?? true,
      example: typeof base === "number" ? `например, ${base}` : "",
      sourceRef: "Датасеты_хакатон.xlsx › Склад",
      order: i + 1,
    });
  });
}
