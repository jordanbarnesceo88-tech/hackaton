import type { CharKey } from "../../tz/characteristics";
import type { FacilitySlug } from "../../tz/processes";
import type { CharValue, ParamKind, ProductFlag, Scope, SourceType } from "../../tz/types";

/**
 * Ручные решения по данным организатора — всё, что генератор scripts/gen-organizer-seed.ts не
 * может вывести из выгрузок сам: ключи параметров, дополнительные параметры, которых нет в
 * датасете, значения из «Примеров решений», отнесение продуктов к процессам и типам решений,
 * слияния дублей, исключения и выбор основного значения там, где исходная ячейка — текст.
 *
 * Правила, которые здесь закреплены (docs/data-provenance.md):
 * - приоритет источников при конфликте: организатор > PDF производителя > сайт производителя >
 *   дилер > агрегатор > пресса; проигравшие значения идут в `alternatives`;
 * - в расчёт парка идёт только производительность «на один робот / одну станцию / один канал»;
 *   цифры «на весь парк» и из кейсов уходят в характеристику «Кейсы»;
 * - значение «до X» хранится с оговоркой и не считается типичной производительностью;
 * - ни одно число не появляется без источника: либо ссылка и цитата (research), либо строка
 *   файла организатора (organizer), либо обоснование (estimate) или формула (derived).
 *
 * Файл правится руками; после правки запустить генератор (npm run gen:organizer).
 */

// ——————————————————————————— Общие константы ———————————————————————————

/** Дата выгрузок организатора (датасеты, каталог, «Примеры решений»). */
export const ORGANIZER_DATE = "2026-09-22";
/** Дата исследования открытых источников (свод и found_batch1–6). */
export const RESEARCH_DATE = "2026-09-23";

export const DATASET_FILE = "Датасеты_хакатон.xlsx";
export const CATALOG_FILE = "catalog_export_v4.csv";
export const EXAMPLES_DOC = "Примеры решений";

/** Листы датасета организатора по типам объектов. */
export const FACILITY_SHEETS: Readonly<Record<FacilitySlug, string>> = {
  warehouse: "Склад",
  airport: "Аэропорт",
  medical: "Медучреждение",
};

// ——————————————————————————— Параметры объектов ———————————————————————————

/**
 * Решение по строке датасета: ключ параметра и то, чего в датасете нет. `use` — буквы
 * использования: F — расчёт парка, L — труд (база ФОТ), C — ограничения подбора,
 * V — визуализация, E — экономика (горизонт, бюджет). `tz` — пункт минимума ТЗ §3.2.1.
 * `formula` + `basis` — у значений, которые организатор вывел из других строк, но записал
 * числом (интерфейс предупреждает, если правка нарушает связь).
 */
export type ParamDecision = {
  key: string;
  use: string;
  tz?: string;
  kind?: ParamKind;
  options?: string[];
  /** Единица вместо организаторской (опечатки, «м/п»); null — безразмерная величина. */
  unit?: string | null;
  required?: boolean;
  formula?: string;
  basis?: string;
  /** Подсказка, если у строки нет примечания организатора. */
  hint?: string;
};

const W_TZ = {
  area: "площадь и рабочие зоны",
  mode: "режим работы",
  inbound: "объём входящих операций",
  internal: "объём внутрискладских операций",
  outbound: "объём исходящих операций",
  storage: "тип хранения",
  sku: "количество SKU",
  load: "средняя масса и габариты грузовой единицы",
  staff: "численность и стоимость персонала",
  productivity: "производительность текущего процесса",
  routes: "протяжённость маршрутов",
  layout: "доступная площадь и ограничения планировки",
} as const;

const A_TZ = {
  zone: "тип и зона операции",
  mode: "режим работы",
  flow: "пассажиро- или грузопоток",
  ops: "количество операций и пиковая нагрузка",
  routes: "протяжённость маршрутов",
  load: "масса и габариты перемещаемых объектов",
  staff: "численность персонала",
  safety: "требования безопасности",
  zones: "наличие закрытых и открытых зон",
} as const;

const M_TZ = {
  kind: "тип учреждения",
  area: "площадь и этажность",
  mode: "режим работы",
  trips: "количество перевозок грузов, белья, питания, медикаментов или отходов",
  routes: "маршруты и лифты",
  sanitary: "требования к санитарной обработке",
  staff: "численность персонала",
  access: "ограничения доступа и безопасности",
} as const;

const YES_NO = ["Да", "Нет"];

/**
 * Строки датасета организатора → ключи параметров. Имя строки — дословно из листа (после
 * обрезки пробелов). Генератор падает, если в листе появилась строка без решения или решение
 * без строки: так расхождение с данными организатора не пройдёт незамеченным.
 */
export const PARAM_DECISIONS: Readonly<Record<FacilitySlug, Readonly<Record<string, ParamDecision>>>> = {
  warehouse: {
    "Общая площадь склада": { key: "totalAreaM2", use: "VC", tz: W_TZ.area },
    "Площадь активной (роботизируемой) зоны": {
      key: "activeAreaM2",
      use: "VFC",
      tz: W_TZ.layout,
      formula: "totalAreaM2 × 0,5",
      basis: "Организатор задал активную зону как 50 % общей площади и записал результат числом.",
    },
    "Высота потолков в зоне хранения": { key: "storageCeilingHeightM", use: "C", tz: W_TZ.layout },
    "Количество этажей (мезонинов)": { key: "floorsCount", use: "CE", tz: W_TZ.layout },
    "Ширина главных проездов": { key: "mainAisleWidthM", use: "CV", tz: W_TZ.layout },
    "Ширина рабочих проходов между стеллажами": { key: "rackAisleWidthM", use: "CV", tz: W_TZ.layout },
    "Тип напольного покрытия": {
      key: "floorType",
      use: "C",
      tz: W_TZ.layout,
      kind: "enum",
      // Варианты — из примечания организатора «Альтернативы: эпоксид, асфальт».
      options: ["Промышленный бетон", "Эпоксидное покрытие", "Асфальт"],
    },
    "Ровность пола (отклонение)": { key: "floorFlatnessMmPer2m", use: "C", tz: W_TZ.layout, unit: "мм/2 м" },
    "Количество рабочих смен в сутки": { key: "shiftsPerDay", use: "FLV", tz: W_TZ.mode },
    "Рабочих дней в году": {
      key: "workDaysPerYear",
      use: "FLE",
      tz: W_TZ.mode,
      hint: "Склад работает без выходных; организатор зафиксировал 365 дней.",
    },
    "Продолжительность смены": { key: "shiftDurationH", use: "FLV", tz: W_TZ.mode },
    "Пиковый коэффициент нагрузки": { key: "peakFactor", use: "FV", tz: W_TZ.mode, unit: null },
    "Объём приёмки (поддоны/сутки)": { key: "inboundPalletsPerDay", use: "FLV", tz: W_TZ.inbound },
    "Объём отгрузки (поддоны/сутки)": { key: "outboundPalletsPerDay", use: "FLV", tz: W_TZ.outbound },
    "Объём отбора (строк/сутки, всего)": { key: "pickLinesPerDay", use: "FLV", tz: W_TZ.internal },
    "Объём отбора (штук/сутки, всего)": {
      key: "pickUnitsPerDay",
      use: "F",
      formula: "pickLinesPerDay × 1,5",
      basis: "Организатор указал в примечании «~1,5 штуки на строку» и записал произведение числом.",
    },
    "Доля мелкоштучного отбора (piece-pick)": { key: "piecePickSharePct", use: "FC" },
    "Количество SKU (активных)": { key: "activeSkuCount", use: "C", tz: W_TZ.sku },
    "Доля SKU с быстрым оборотом (A-класс)": {
      key: "fastMoverSkuSharePct",
      use: "",
      required: false,
      hint: "Доля ассортимента A-класса; в расчёте tz-1.0.0 не используется, нужна для слотирования.",
    },
    "Общая численность персонала склада": { key: "totalStaff", use: "L", tz: W_TZ.staff },
    "Из них: отборщики (комплектовщики)": { key: "pickersCount", use: "L", tz: W_TZ.staff },
    "Из них: операторы погрузчиков": { key: "forkliftOperatorsCount", use: "L", tz: W_TZ.staff },
    "Из них: операторы упаковочных линий": { key: "packingOperatorsCount", use: "L", tz: W_TZ.staff },
    "Средняя з/п отборщика (gross)": { key: "pickerSalaryRubMonth", use: "L", tz: W_TZ.staff },
    "Средняя з/п оператора погрузчика (gross)": { key: "forkliftSalaryRubMonth", use: "L", tz: W_TZ.staff },
    "Коэффициент начислений на ФОТ (страховые взносы)": {
      key: "payrollTaxMultiplier",
      use: "L",
      tz: W_TZ.staff,
      unit: null,
    },
    "Средняя выработка отборщика (строк/ч)": { key: "pickerLinesPerHour", use: "LFV", tz: W_TZ.productivity },
    "Коэффициент потерь рабочего времени (отпуск, болезнь, текучесть)": { key: "workTimeLossPct", use: "L" },
    "Средняя длина маршрута отборщика на 1 строку": { key: "pickRouteLengthPerLineM", use: "LVF", tz: W_TZ.routes },
    "Протяжённость конвейерной/транспортной системы": { key: "conveyorLengthM", use: "CV", tz: W_TZ.routes },
    "Тип стеллажной системы": {
      key: "rackType",
      use: "C",
      tz: W_TZ.storage,
      kind: "enum",
      // Варианты — из примечания организатора «Альтернативы: Shuttle, AutoStore, Miniload, Drive-in, Push-back».
      options: ["Фронтальные паллетные", "Shuttle", "AutoStore", "Miniload", "Drive-in", "Push-back"],
    },
    "Количество паллетомест": { key: "palletPositions", use: "FV", tz: W_TZ.storage, unit: "паллетомест" },
    "Средняя масса грузовой единицы (паллет)": { key: "avgPalletMassKg", use: "C", tz: W_TZ.load },
    "Средняя масса штучной единицы (SKU)": { key: "avgUnitMassKg", use: "C", tz: W_TZ.load },
    "Средние габариты паллеты (Д×Ш×В)": { key: "palletDimsMm", use: "CV", tz: W_TZ.load, kind: "dims" },
    "Средние габариты штучной единицы (Д×Ш×В)": { key: "unitDimsMm", use: "C", tz: W_TZ.load, kind: "dims" },
    "Доля негабаритных/нестандартных грузов": { key: "nonStandardCargoPct", use: "FL" },
    "Мощность электроснабжения (доступная)": { key: "availablePowerKw", use: "C", tz: W_TZ.layout },
    "Наличие WMS": { key: "hasWms", use: "C", tz: W_TZ.layout, kind: "enum", options: YES_NO },
    "Наличие ERP/1С": {
      key: "erpSystem",
      use: "",
      kind: "text",
      required: false,
    },
    "Планируемый бюджет на роботизацию (CAPEX)": { key: "capexBudgetMRub", use: "CE" },
    "Горизонт расчёта окупаемости": { key: "horizonYears", use: "E" },
  },

  airport: {
    "Суммарная площадь терминала (ов)": { key: "terminalAreaM2", use: "VF", tz: A_TZ.zone },
    "Площадь перрона и технических зон": { key: "apronTechAreaM2", use: "CV", tz: A_TZ.zones },
    "Количество терминалов": { key: "terminalsCount", use: "V", tz: A_TZ.zone },
    "Количество выходов на посадку (гейтов)": { key: "gatesCount", use: "FV", tz: A_TZ.zone },
    "Количество взлётно-посадочных полос": { key: "runwaysCount", use: "", required: false },
    "Пассажиропоток (млн пассажиров/год)": {
      key: "paxPerYearM",
      use: "F",
      tz: A_TZ.flow,
      hint: "Годовой пассажиропоток аэропорта, млн пассажиров.",
    },
    "Среднесуточное количество пассажиров": {
      key: "paxPerDay",
      use: "F",
      tz: A_TZ.flow,
      formula: "paxPerYearM × 1 000 000 ÷ 365",
      basis: "Организатор вывел среднесуточный поток из годового («= Годовой поток / 365») и записал числом.",
    },
    "Пиковое количество пассажиров в час (PHF)": {
      key: "peakPaxPerHour",
      use: "F",
      tz: A_TZ.ops,
      hint: "Пиковый часовой пассажиропоток (PHF).",
    },
    "Доля трансферных пассажиров": { key: "transferPaxPct", use: "" },
    "Количество стоек регистрации": { key: "checkInCounters", use: "V" },
    "Среднесуточное количество рейсов (взлёт+посадка)": {
      key: "flightsPerDay",
      use: "F",
      tz: A_TZ.ops,
      hint: "Взлёты и посадки за сутки.",
    },
    "Пиковое количество рейсов в час": { key: "peakFlightsPerHour", use: "F", tz: A_TZ.ops },
    "Среднее время оборота воздушного судна (TAT)": { key: "turnaroundMin", use: "", tz: A_TZ.ops },
    "Среднее количество операций наземного обслуживания на 1 рейс": {
      key: "groundOpsPerFlight",
      use: "F",
      tz: A_TZ.ops,
    },
    "Объём перемещения багажа (единиц/сутки)": { key: "baggagePerDay", use: "F", tz: A_TZ.flow },
    "Средняя масса единицы багажа": { key: "avgBaggageKg", use: "C", tz: A_TZ.load },
    "Количество стоек выдачи багажа (каруселей)": { key: "baggageCarousels", use: "V" },
    "Объём бортового питания (порций/сутки)": { key: "cateringPortionsPerDay", use: "", tz: A_TZ.ops },
    "Объём заправки воздушных судов (рейсов/сут)": { key: "refuelingFlightsPerDay", use: "", tz: A_TZ.ops },
    "Суточное количество рейсов внутренних грузовых тележек (внутри терминала)": {
      key: "terminalCartTripsPerDay",
      use: "F",
      tz: A_TZ.ops,
    },
    "Количество уборочных машин (терминал)": { key: "cleaningMachinesCount", use: "L" },
    "Площадь, убираемая роботизированной уборкой": {
      key: "robotCleanableAreaM2",
      use: "F",
      formula: "terminalAreaM2 × 0,6",
      basis: "В ячейке датасета организатора формула «=C4*0.6» — 60 % площади терминала без режимных зон.",
    },
    "Суточный объём вывоза мусора (контейнеров)": { key: "wasteContainersPerDay", use: "F", tz: A_TZ.ops },
    "Численность персонала наземного обслуживания (рамп)": { key: "rampStaffCount", use: "L", tz: A_TZ.staff },
    "Численность персонала внутри терминала (логистика, уборка)": {
      key: "terminalStaffCount",
      use: "L",
      tz: A_TZ.staff,
    },
    "Средняя з/п сотрудника наземного обслуживания (gross)": {
      key: "rampSalaryRubMonth",
      use: "L",
      tz: A_TZ.staff,
      hint: "Средняя зарплата сотрудника наземного обслуживания до вычета НДФЛ.",
    },
    "Средняя з/п уборщика терминала (gross)": { key: "terminalCleanerSalaryRubMonth", use: "L", tz: A_TZ.staff },
    "Коэффициент начислений на ФОТ": { key: "payrollTaxMultiplier", use: "L", unit: null },
    "Годовая текучесть (персонал терминала)": {
      key: "terminalTurnoverPct",
      use: "",
      hint: "Доля персонала терминала, сменившегося за год.",
    },
    "Зонирование (количество режимных зон)": { key: "securityZonesCount", use: "CV", tz: A_TZ.safety },
    "Наличие системы контроля доступа (СКУД)": { key: "accessControl", use: "C", tz: A_TZ.safety, kind: "text" },
    "Требования по сертификации оборудования для airside": {
      key: "airsideCertification",
      use: "C",
      tz: A_TZ.safety,
      kind: "text",
    },
    "Ограничения по уровню шума (зона)": { key: "noiseLimitDba", use: "C", tz: A_TZ.safety },
    "Температура в неотапливаемых зонах (перрон, зима)": { key: "apronWinterMinTempC", use: "C", tz: A_TZ.zones },
    "Наличие FIDS/AODB системы": { key: "hasFidsAodb", use: "C", kind: "enum", options: YES_NO },
    "Наличие BMS (системы управления зданием)": { key: "hasBms", use: "C", kind: "enum", options: YES_NO },
    "Доступная мощность для зарядной инфраструктуры": { key: "chargingPowerKw", use: "C" },
    "Планируемый бюджет на роботизацию (CAPEX)": {
      key: "capexBudgetMRub",
      use: "CE",
      hint: "Ориентир бюджета: решения дороже бюджета помечаются, но не исключаются.",
    },
    "Горизонт расчёта окупаемости": { key: "horizonYears", use: "E" },
  },

  medical: {
    "Тип медицинского учреждения": {
      key: "facilityKind",
      use: "C",
      tz: M_TZ.kind,
      kind: "enum",
      // Варианты — из примечания организатора.
      options: ["Поликлиника", "Многопрофильная больница", "Онкоцентр", "Диагностический центр"],
    },
    "Общая площадь здания(й)": { key: "totalAreaM2", use: "VF", tz: M_TZ.area },
    "Количество этажей (основной корпус)": { key: "floorsCount", use: "C", tz: M_TZ.area },
    "Количество лифтов (грузовых/медицинских)": { key: "elevatorsCount", use: "C", tz: M_TZ.routes },
    "Количество коек (стационар)": { key: "bedsCount", use: "F", tz: M_TZ.trips },
    "Коечный фонд в эксплуатации (средняя занятость)": { key: "bedOccupancyPct", use: "F" },
    "Количество операционных": { key: "operatingRoomsCount", use: "" },
    "Количество амбулаторных посещений в сутки": { key: "outpatientVisitsPerDay", use: "" },
    "Режим работы стационара": { key: "inpatientSchedule", use: "", tz: M_TZ.mode, kind: "text" },
    "Режим работы амбулатории": { key: "outpatientSchedule", use: "", tz: M_TZ.mode, kind: "text" },
    "Количество смен медперсонала (уход за пациентами)": { key: "careShiftsPerDay", use: "", tz: M_TZ.mode },
    "Пиковое время логистической нагрузки": { key: "peakLogisticsWindows", use: "", tz: M_TZ.mode, kind: "text" },
    "Количество кормлений в сутки": { key: "mealsPerDay", use: "F", tz: M_TZ.trips },
    "Общее количество порций питания в сутки": {
      key: "mealPortionsPerDay",
      use: "F",
      tz: M_TZ.trips,
      formula: "bedsCount × bedOccupancyPct ÷ 100 × mealsPerDay",
      basis:
        "Формула дана в примечании организатора, но базовое 1 950 = 650 × 3 не учитывает занятость " +
        "82 % (по формуле 1 599). Значение организатора сохранено как есть.",
    },
    "Среднее расстояние от пищеблока до отделения": { key: "kitchenToWardDistanceM", use: "FV", tz: M_TZ.routes },
    "Количество точек раздачи питания (отделений)": { key: "mealDeliveryPoints", use: "V", tz: M_TZ.trips },
    "Средняя масса тележки с питанием (брутто)": { key: "mealTrolleyMassKg", use: "C", tz: M_TZ.trips },
    "Норматив доставки питания (мин от пищеблока до отделения)": { key: "mealDeliveryNormMin", use: "C" },
    "Объём грязного белья (кг/сутки)": { key: "dirtyLinenKgPerDay", use: "F", tz: M_TZ.trips },
    "Объём чистого белья на раздачу (кг/сутки)": { key: "cleanLinenKgPerDay", use: "F", tz: M_TZ.trips },
    "Количество точек сбора/выдачи белья": { key: "linenPoints", use: "V", tz: M_TZ.trips },
    "Периодичность смены белья (раз в сутки, в среднем)": { key: "linenChangesPerDay", use: "F", tz: M_TZ.trips },
    "Средняя масса контейнера с бельём": { key: "linenContainerMassKg", use: "C", tz: M_TZ.trips },
    "Количество наименований медикаментов в обращении": { key: "drugItemsCount", use: "" },
    "Объём выдачи медикаментов (заявок/сутки)": { key: "drugRequestsPerDay", use: "F", tz: M_TZ.trips },
    "Количество аптечных точек выдачи (аптека, аптечные склады)": { key: "pharmacyPoints", use: "V", tz: M_TZ.routes },
    "Количество точек доставки (отделений + ОР + реанимация)": { key: "drugDeliveryPoints", use: "V", tz: M_TZ.routes },
    "Среднее время комплектации 1 заявки в аптеке": { key: "drugPickTimeMin", use: "" },
    "Доля срочных (STAT) доставок медикаментов": { key: "statDeliverySharePct", use: "" },
    "Объём доставки расходных материалов (рейсов/сутки)": { key: "suppliesTripsPerDay", use: "F", tz: M_TZ.trips },
    "Количество биоматериалов (проб) в сутки": { key: "samplesPerDay", use: "F", tz: M_TZ.trips },
    "Количество клинико-диагностических лабораторий (КДЛ)": { key: "labsCount", use: "V", tz: M_TZ.routes },
    "Среднее время доставки пробы (норматив)": { key: "sampleDeliveryNormMin", use: "C" },
    "Объём выдачи результатов анализов (рейсов/сутки)": { key: "labResultTripsPerDay", use: "F", tz: M_TZ.trips },
    "Объём медицинских отходов класса А (ненасыщенные)": { key: "wasteClassAKgPerDay", use: "F", tz: M_TZ.trips },
    "Объём медицинских отходов класса Б (инфицированные)": { key: "wasteClassBKgPerDay", use: "F", tz: M_TZ.trips },
    "Количество точек сбора отходов": { key: "wastePoints", use: "V", tz: M_TZ.trips },
    "Периодичность вывоза отходов из отделений": { key: "wastePickupsPerDay", use: "F", tz: M_TZ.trips },
    "Численность санитаров и транспортировщиков": { key: "orderliesCount", use: "L", tz: M_TZ.staff },
    "Численность сотрудников пищеблока (раздача)": { key: "kitchenStaffCount", use: "L", tz: M_TZ.staff },
    "Численность сотрудников прачечной (транспорт белья)": {
      key: "laundryStaffCount",
      use: "L",
      tz: M_TZ.staff,
      hint: "Сотрудники прачечной, занятые перевозкой белья; зарплата в датасете не задана.",
    },
    "Средняя з/п санитара/транспортировщика (gross)": { key: "orderlySalaryRubMonth", use: "L", tz: M_TZ.staff },
    "Средняя з/п сотрудника пищеблока (gross)": {
      key: "kitchenSalaryRubMonth",
      use: "L",
      tz: M_TZ.staff,
      hint: "Средняя зарплата сотрудника пищеблока до вычета НДФЛ.",
    },
    "Коэффициент начислений на ФОТ": { key: "payrollTaxMultiplier", use: "L", unit: null },
    "Годовая текучесть (немедицинский персонал)": {
      key: "nonMedicalTurnoverPct",
      use: "",
      hint: "Доля немедицинского персонала, сменившегося за год.",
    },
    "Обеззараживание робота между рейсами": {
      key: "robotDisinfection",
      use: "E",
      tz: M_TZ.sanitary,
      kind: "text",
    },
    "Требования к уровню шума в палатах (ночное время)": { key: "wardNightNoiseDba", use: "C", tz: M_TZ.access },
    "Наличие СКУД (контроль доступа по зонам)": {
      key: "accessControl",
      use: "C",
      tz: M_TZ.access,
      kind: "enum",
      options: YES_NO,
    },
    "Требования к материалу поверхностей робота": {
      key: "robotSurfaceMaterial",
      use: "C",
      tz: M_TZ.sanitary,
      kind: "text",
    },
    "Наличие МИС (медицинская информационная система)": { key: "hasMis", use: "C", kind: "text" },
    "Наличие ЛИС (лабораторная информационная система)": { key: "hasLis", use: "C", kind: "enum", options: YES_NO },
    "Наличие системы управления лифтами (BMS)": {
      key: "elevatorControl",
      use: "C",
      tz: M_TZ.routes,
      kind: "enum",
      options: ["Да", "Да (частично)", "Нет"],
    },
    "Ширина коридоров (основных)": { key: "corridorWidthM", use: "CV", tz: M_TZ.routes },
    "Наличие пандусов/подъёмников (для межэтажного AMR без лифта)": {
      key: "hasRampsOrLifts",
      use: "C",
      tz: M_TZ.routes,
      kind: "enum",
      options: YES_NO,
    },
    "Доступная мощность для зарядной инфраструктуры": { key: "chargingPowerKw", use: "C" },
    "Планируемый бюджет на роботизацию (CAPEX)": { key: "capexBudgetMRub", use: "CE" },
    "Горизонт расчёта окупаемости": {
      key: "horizonYears",
      use: "E",
      hint: "Горизонт расчёта окупаемости; TCO всё равно считается не менее чем за 5 лет (ТЗ).",
    },
  },
};

/** Строка датасета → ключ параметра (производная от PARAM_DECISIONS, для сверки и загрузки). */
export const PARAM_KEYS: Readonly<Record<FacilitySlug, Readonly<Record<string, string>>>> = {
  warehouse: keysOf(PARAM_DECISIONS.warehouse),
  airport: keysOf(PARAM_DECISIONS.airport),
  medical: keysOf(PARAM_DECISIONS.medical),
};

function keysOf(rows: Readonly<Record<string, ParamDecision>>): Record<string, string> {
  return Object.fromEntries(Object.entries(rows).map(([name, d]) => [name, d.key]));
}

/**
 * Дополнительный параметр — его нет в датасете организатора, но на него ссылаются процессы
 * (PROCESS_DEFS) или визуализация. Происхождение — оценка с обоснованием или вывод с формулой;
 * обоснование не короче 40 символов (проверяется тестом).
 */
export type ParamExtra = {
  key: string;
  section: string;
  label: string;
  unit: string | null;
  kind: ParamKind;
  options?: string[];
  base: number | string | null;
  min: number | null;
  max: number | null;
  required: boolean;
  tz?: string;
  use: string;
  hint: string;
  origin: "estimate" | "derived";
  basis: string;
  formula?: string;
  /** Для оценки по аналогу — строка датасета организатора, откуда взят аналог. */
  sourceRef?: string;
};

const WAREHOUSE_EXTRAS: readonly ParamExtra[] = [
  {
    key: "internalPalletMovesPerDay",
    section: "Операции: объём и производительность",
    label: "Внутренние перемещения паллет (подпитка, перестановки)",
    unit: "паллет/сут",
    kind: "integer",
    base: 0,
    min: 0,
    max: 5000,
    required: true,
    tz: W_TZ.internal,
    use: "FV",
    hint: "Перемещения паллет внутри склада сверх приёмки и отгрузки; 0 — не учитываются.",
    origin: "estimate",
    basis:
      "В датасете организатора нет числа внутренних перемещений; 0 — внутренние перемещения не " +
      "учитываются, спрос на перевозку паллет считается только по приёмке и отгрузке.",
  },
  {
    key: "receivingDocksCount",
    section: "Маршруты и планировка",
    label: "Количество ворот приёмки",
    unit: "шт.",
    kind: "integer",
    base: 4,
    min: 1,
    max: 40,
    required: true,
    tz: W_TZ.area,
    use: "V",
    hint: "Число ворот приёмки на схеме склада; влияет на планировку и длину маршрутов.",
    origin: "estimate",
    basis:
      "Датасет организатора не задаёт число ворот. 4 — допущение для схемы визуализации: при " +
      "1 000 паллет/сут за 22 ч это около 11 паллет в час на ворота. Уточняется пользователем.",
  },
  {
    key: "shippingDocksCount",
    section: "Маршруты и планировка",
    label: "Количество ворот отгрузки",
    unit: "шт.",
    kind: "integer",
    base: 4,
    min: 1,
    max: 40,
    required: true,
    tz: W_TZ.area,
    use: "V",
    hint: "Число ворот отгрузки на схеме склада; влияет на планировку и длину маршрутов.",
    origin: "estimate",
    basis:
      "Датасет организатора не задаёт число ворот. 4 — допущение для схемы визуализации, " +
      "симметричное приёмке (объём отгрузки у организатора равен объёму приёмки).",
  },
  {
    key: "storageTempRegime",
    section: "Хранение и характеристики грузов",
    label: "Температурный режим хранения",
    unit: null,
    kind: "enum",
    options: ["Нормальный (+5…+25 °C)", "Охлаждаемый (0…+5 °C)", "Морозильный (ниже −18 °C)"],
    base: "Нормальный (+5…+25 °C)",
    min: null,
    max: null,
    required: true,
    tz: W_TZ.layout,
    use: "C",
    hint: "Роботы, не рассчитанные на холод, исключаются из подбора для охлаждаемых зон.",
    origin: "estimate",
    basis:
      "Датасет организатора не задаёт температурный режим и не содержит признаков холодного " +
      "склада; по умолчанию принят нормальный режим. Нужен подбору: ТТХ роботов ограничены по температуре.",
  },
  {
    key: "maxStorageLevelM",
    section: "Хранение и характеристики грузов",
    label: "Высота верхнего яруса хранения",
    unit: "м",
    kind: "number",
    base: 9,
    min: 4,
    max: 15,
    required: true,
    tz: W_TZ.storage,
    use: "C",
    hint: "Отметка верхней балки стеллажа; робот с меньшей высотой подъёма не размещает паллеты наверх.",
    origin: "derived",
    formula: "storageCeilingHeightM − 1",
    basis:
      "В датасете есть только высота потолка (10 м). Верхний ярус принят на 1 м ниже потолка — " +
      "допущение о зазоре под спринклеры и освещение; границы 4–15 м следуют из диапазона потолка 5–16 м.",
  },
  {
    key: "inventoryCountsPerYear",
    section: "Хранение и характеристики грузов",
    label: "Инвентаризаций в год",
    unit: "раз/год",
    kind: "integer",
    base: 12,
    min: 1,
    max: 52,
    required: true,
    use: "F",
    hint: "Сколько раз в год пересчитываются все паллетоместа; нужна процессу «Инвентаризация».",
    origin: "estimate",
    basis:
      "Датасет организатора не задаёт частоту инвентаризаций. 12 — допущение «ежемесячная " +
      "инвентаризация»; процесс в tz-1.0.0 не рассчитывается, значение нужно для показа спроса.",
  },
  {
    key: "cleaningAreaM2",
    section: "Уборка склада",
    label: "Площадь уборки",
    unit: "м²",
    kind: "number",
    base: 10000,
    min: 5000,
    max: 50000,
    required: true,
    use: "F",
    hint: "Площадь пола, которую убирают ежедневно; по умолчанию — активная зона склада.",
    origin: "derived",
    formula: "activeAreaM2",
    basis:
      "Датасет организатора не задаёт площадь уборки; принята равной активной (роботизируемой) " +
      "зоне 10 000 м², диапазон — как у активной зоны.",
  },
  {
    key: "cleaningsPerDay",
    section: "Уборка склада",
    label: "Уборок в сутки",
    unit: "раз/сут",
    kind: "integer",
    base: 2,
    min: 1,
    max: 6,
    required: true,
    use: "F",
    hint: "Сколько раз в сутки убирается вся площадь уборки.",
    origin: "estimate",
    basis:
      "Датасет организатора не задаёт частоту уборки; принята одна уборка за смену при двух " +
      "сменах в сутки из датасета (shiftsPerDay = 2).",
  },
  {
    key: "cleanersCount",
    section: "Уборка склада",
    label: "Численность уборщиков склада",
    unit: "чел.",
    kind: "integer",
    base: null,
    min: 0,
    max: 200,
    required: false,
    use: "L",
    hint: "Нужна для расчёта процесса «Уборка склада»; в датасете организатора не задана — укажите.",
    origin: "estimate",
    basis:
      "Организатор включает уборку в общую численность (180 чел.), но не выделяет её; число " +
      "уборщиков не оценивается, пока пользователь его не введёт.",
  },
  {
    key: "cleanerSalaryRubMonth",
    section: "Уборка склада",
    label: "Средняя з/п уборщика склада (gross)",
    unit: "руб./мес.",
    kind: "number",
    base: 65000,
    min: 38000,
    max: 85000,
    required: true,
    use: "L",
    hint: "Зарплата уборщика до вычета НДФЛ; по умолчанию — аналог из датасета аэропорта.",
    origin: "estimate",
    basis:
      "В датасете склада зарплаты уборщика нет; взят аналог организатора — средняя з/п уборщика " +
      "терминала аэропорта 65 000 ₽ (диапазон 38 000–85 000 ₽).",
    sourceRef: `${DATASET_FILE} › Аэропорт › стр. 34`,
  },
];

/** Режим работы аэропорта и больницы: в датасетах организатора его нет в числах. */
function modeExtras(facility: "airport" | "medical"): ParamExtra[] {
  const tz = facility === "airport" ? A_TZ.mode : M_TZ.mode;
  const why =
    facility === "airport"
      ? "Датасет аэропорта не задаёт режим работы в часах; терминал и перрон работают круглосуточно"
      : "Датасет медучреждения задаёт режим стационара текстом «24/7/365»; для расчётов он переведён в часы";
  return [
    {
      key: "operatingHoursPerDay",
      section: "Режим работы",
      label: "Часов работы в сутки",
      unit: "ч",
      kind: "number",
      base: 24,
      min: 1,
      max: 24,
      required: true,
      tz,
      use: "F",
      hint: "Сколько часов в сутки объект обслуживается роботами.",
      origin: "estimate",
      basis: `${why}: принято 24 ч в сутки.`,
    },
    {
      key: "workDaysPerYear",
      section: "Режим работы",
      label: "Рабочих дней в году",
      unit: "дн.",
      kind: "integer",
      base: 365,
      min: 1,
      max: 365,
      required: true,
      tz,
      use: "F",
      hint: "Дней работы в году.",
      origin: "estimate",
      basis: `${why}: принято 365 дней в году без выходных.`,
    },
  ];
}

/** Дополнительные параметры по типам объектов (порядок показа — после строк датасета). */
export const PARAM_EXTRAS: Readonly<Record<FacilitySlug, readonly ParamExtra[]>> = {
  warehouse: WAREHOUSE_EXTRAS,
  airport: modeExtras("airport"),
  medical: modeExtras("medical"),
};

/** Буква использования → область применения параметра (ParamSpec.usedBy). */
export const USE_LETTERS: Readonly<Record<string, string>> = {
  F: "fleet",
  L: "labour",
  C: "constraints",
  V: "visualization",
  E: "economics",
};

// ——————————————————————————— «Примеры решений» организатора ———————————————————————————

/** Значение из «Примеров решений»: ключ характеристики, значение и дословная строка документа. */
export type ExampleValue = {
  key: CharKey;
  value: CharValue;
  unit?: string;
  scope?: Scope;
  asInSource: string;
  /** Для значений, пересчитанных из других единиц (км/ч → м/с). */
  formula?: string;
};

/**
 * Модель из «Примеров решений» (Примеры_решений_типы_объектов.docx, 2026-09-22). `rows` —
 * строки кураторского свода с этой моделью; пустой список — модели нет в каталоге организатора
 * (PuduBot 2), генератор создаёт для неё продукт уровня «examples».
 */
export type OrganizerExample = {
  model: string;
  /** Разделы документа, где модель приведена (Склад, Аэропорт, Медучреждение). */
  sections: string[];
  rows: number[];
  values: ExampleValue[];
};

const KMH = "км/ч ÷ 3,6";

/**
 * Значения «Примеров решений», набранные вручную с документа организатора. Производительность
 * «до 80–100 паллет/час (при типовой конфигурации зоны)» записана диапазоном с типичным
 * значением посередине (90) без оговорки «до»: организатор даёт её как типовую норму проекта.
 * Одиночное «до X» (MARK 2 SE, «до 1000 м²/ч») сохраняет оговорку и в расчёт как норма не идёт.
 */
export const ORGANIZER_EXAMPLES: readonly OrganizerExample[] = [
  {
    model: "Ronavi H1500",
    sections: ["Склад", "Аэропорт"],
    rows: [21, 22],
    values: [
      { key: "payloadKg", value: { max: 1500, typical: 1500, qualifier: "до" }, unit: "кг", asInSource: "Грузоподъёмность: до 1500 кг." },
      { key: "massKg", value: 250, unit: "кг", asInSource: "Масса робота: 250 кг." },
      { key: "dimensionsMm", value: "1044 × 654 × 380", unit: "мм", asInSource: "Габариты (ДхШхВ): 1044 × 654 × 380 мм." },
      { key: "speedMps", value: { max: 1.5, typical: 1.5, qualifier: "до" }, unit: "м/с", asInSource: "Максимальная скорость: до 1,5 м/с." },
      { key: "navigation", value: ["QR-метки", "SLAM"], asInSource: "Тип навигации: QR-метки и SLAM (карта помещения)." },
      { key: "chargeMin", value: { typical: 18, qualifier: "≈" }, unit: "мин", asInSource: "Время зарядки: около 18 минут на станции." },
      { key: "autonomyH", value: { max: 6, typical: 6, qualifier: "до" }, unit: "ч", asInSource: "Время работы: до 6 часов." },
      {
        key: "throughput",
        value: { min: 80, max: 100, typical: 90 },
        unit: "паллет/ч",
        scope: "per-robot",
        asInSource: "Производительность: до 80–100 паллет/час (при типовой конфигурации зоны).",
      },
      { key: "positioningMm", value: { typical: 3, qualifier: "≈" }, unit: "мм", asInSource: "Точность позиционирования: около ±3 мм." },
      {
        key: "operatingConditions",
        value: "+5…+25 °C, ровный промышленный пол",
        asInSource: "Допустимые условия эксплуатации: работа при температуре примерно +5…+25 °C, ровный промышленный пол.",
      },
    ],
  },
  {
    model: "DMR Carrier P",
    sections: ["Склад", "Аэропорт"],
    rows: [58],
    values: [
      { key: "payloadKg", value: 1500, unit: "кг", asInSource: "Грузоподъемность: 1500 кг" },
      {
        key: "liftHeightMm",
        value: { max: 1600, typical: 1600, qualifier: "до" },
        unit: "мм",
        asInSource: "Высота подъема вил (для EUR-паллет): до 1600 мм",
      },
      { key: "speedMps", value: 1.5, unit: "м/с", asInSource: "Максимальная скорость движения: 1,5 м/с" },
      { key: "autonomyH", value: { max: 10, typical: 10, qualifier: "до" }, unit: "ч", asInSource: "Время автономной работы: до 10 часов" },
      { key: "navigation", value: ["SLAM на базе лидаров"], asInSource: "Тип навигации: SLAM на базе лидаров (без магнитных лент и QR-меток)" },
      {
        key: "massKg",
        value: { min: 2000, max: 2500, typical: 2250, qualifier: "≈" },
        unit: "кг",
        asInSource: "Масса робота: около 2000–2500 кг.",
      },
      {
        key: "dimensionsMm",
        value: "≈ 2050 × 1975 × 1000 (В × Ш × Г)",
        unit: "мм",
        asInSource: "Габариты (В×Ш×Г): примерно 2050 × 1975 × 1000 мм.",
      },
      {
        key: "throughput",
        value: { min: 40, max: 60, typical: 50 },
        unit: "паллет/ч",
        scope: "per-robot",
        asInSource: "Производительность: до 40–60 паллет/час (типичный проект).",
      },
      {
        key: "operatingConditions",
        value: "стандартный склад и производственный цех с ровным бетонным покрытием",
        asInSource: "Допустимые условия эксплуатации: стандартный склад и производственный цех с ровным бетонным покрытием.",
      },
    ],
  },
  {
    model: "MARK 2 SE",
    sections: ["Склад", "Аэропорт", "Медучреждение"],
    rows: [7],
    values: [
      {
        key: "autonomyH",
        value: { max: 3, typical: 3, qualifier: "до" },
        unit: "ч",
        asInSource: "Время работы: до 3 часов на одном заряде (в некоторых режимах до 4 часов со станцией).",
      },
      { key: "chargeMin", value: { typical: 120, qualifier: "≈" }, unit: "мин", asInSource: "Время зарядки: около 2 часов." },
      {
        key: "throughput",
        value: { max: 1000, typical: 1000, qualifier: "до" },
        unit: "м²/ч",
        scope: "per-robot",
        asInSource: "Эффективность уборки: до 1000 м2/ч.",
      },
      { key: "dimensionsMm", value: "≈ 860 × 610 × 980", unit: "мм", asInSource: "Габариты (Д×Ш×В): около 860 × 610 × 980 мм." },
      {
        key: "massKg",
        value: { min: 130, max: 200, typical: 165, qualifier: "≈" },
        unit: "кг",
        asInSource: "Масса робота: порядка 130–200 кг.",
      },
      {
        key: "speedMps",
        value: { min: 0.83, max: 1.11, typical: 0.97, qualifier: "до" },
        unit: "м/с",
        asInSource: "Скорость движения: до 3–4 км/ч.",
        formula: KMH,
      },
      {
        key: "navigation",
        value: ["лидар", "камеры"],
        asInSource: "Тип навигации: лидар + камеры (автоматическое построение маршрутов и карты помещения).",
      },
    ],
  },
  {
    model: "Pallet Shuttle",
    sections: ["Склад"],
    rows: [50],
    values: [
      { key: "payloadKg", value: { max: 1500, typical: 1500, qualifier: "до" }, unit: "кг", asInSource: "Грузоподъемность: До 1500 кг" },
      {
        key: "speedMps",
        value: { min: 0.75, max: 1, typical: 0.875, qualifier: "до" },
        unit: "м/с",
        asInSource: "Скорость перемещения (с грузом / без груза): До 0,75–1,0 м/с.",
      },
      {
        key: "autonomyH",
        value: { min: 8, max: 10, typical: 9 },
        unit: "ч",
        asInSource:
          "Автономность работы: Аккумуляторные батареи (АКБ) обеспечивают полноценную работу от одной зарядки в течение рабочей смены (в среднем 8–10+ часов).",
      },
      {
        key: "dimensionsMm",
        value: "≈ 1200 × 800 × 200 (под размер паллеты)",
        unit: "мм",
        asInSource: "Габариты шаттла: под размер паллеты, ориентировочно 1200 × 800 × 200 мм.",
      },
      {
        key: "throughput",
        value: { min: 80, max: 120, typical: 100 },
        unit: "паллет/ч",
        scope: "per-channel",
        asInSource: "Производительность: до 80–120 паллет/час на канал.",
      },
      {
        key: "operatingConditions",
        value: "канальные стеллажи высотой до 12–15 м; возможны исполнения для холодильных и морозильных складов",
        asInSource:
          "Высота складов: До 12–15 метров. Допустимые условия эксплуатации: работа в канальных стеллажах, возможны исполнения для холодильных и морозильных складов.",
      },
    ],
  },
  {
    model: "Беспилотный тягач Cognitive Pilot",
    sections: ["Аэропорт"],
    rows: [36],
    values: [
      { key: "payloadKg", value: { max: 3000, typical: 3000, qualifier: "до" }, unit: "кг", asInSource: "Грузоподъемность: до 3 000 кг." },
      {
        key: "autonomyH",
        value: { max: 24, typical: 24, qualifier: "до" },
        unit: "ч",
        asInSource: "Автономность: До 24 часов работы без дозаправки / подзарядки",
      },
      {
        key: "dimensionsMm",
        value: "≈ 2300 × 1400 × 1500",
        unit: "мм",
        asInSource: "Габариты (Д×Ш×В): ориентировочно 2300 × 1400 × 1500 мм (компактный багажный тягач).",
      },
      {
        key: "massKg",
        value: { min: 1000, max: 1500, typical: 1250, qualifier: "≈" },
        unit: "кг",
        asInSource: "Масса машины: около 1000–1500 кг.",
      },
      {
        key: "navigation",
        value: ["камеры", "лидары", "радары", "нейросети"],
        asInSource: "Тип навигации: мультисенсорный автопилот (камеры, лидары, радары, нейросети).",
      },
      {
        key: "operatingConditions",
        value: "круглогодичная работа на перроне и в багажных зонах, в дождь, снег и туман",
        asInSource:
          "Допустимые условия эксплуатации: круглогодичная работа на перроне и в багажных зонах, в дождь, снег и туман.",
      },
    ],
  },
  {
    model: "EVOCARGO N1",
    sections: ["Аэропорт"],
    rows: [40],
    values: [
      {
        key: "payloadKg",
        value: { max: 2000, typical: 2000, qualifier: "до" },
        unit: "кг",
        asInSource: "Грузоподъёмность: до 2 тонн. Вместимость: до 6 европаллет.",
      },
      { key: "chargeMin", value: { min: 30, typical: 30, qualifier: "от" }, unit: "мин", asInSource: "Время зарядки: от 30 минут от быстрой зарядки" },
      { key: "dimensionsMm", value: "≈ 5000 × 1800 × 2200", unit: "мм", asInSource: "Габариты (Д×Ш×В): примерно 5000 × 1800 × 2200 мм." },
      {
        key: "speedMps",
        value: { min: 5.56, max: 6.94, typical: 6.25, qualifier: "до" },
        unit: "м/с",
        asInSource: "Скорость движения: до 20–25 км/ч на территории объекта.",
        formula: KMH,
      },
      {
        key: "navigation",
        value: ["камеры", "лидары", "сенсоры"],
        asInSource: "Тип навигации: автономный автопилот с камерами, лидарами и сенсорами (уровень автоматизации 4–5).",
      },
      {
        key: "operatingConditions",
        value: "работа 24/7 при температуре примерно −40…+50 °C",
        asInSource: "Допустимые условия эксплуатации: работа 24/7 при температуре примерно −40…+50 °C.",
      },
    ],
  },
  {
    model: "Ronavi SD",
    sections: ["Медучреждение"],
    rows: [27],
    values: [
      { key: "payloadKg", value: { max: 10, typical: 10, qualifier: "до" }, unit: "кг", asInSource: "Грузоподъёмность: до 10 кг." },
      { key: "massKg", value: 20, unit: "кг", asInSource: "Масса робота: 20 кг." },
      { key: "dimensionsMm", value: "420 × 400 × 200", unit: "мм", asInSource: "Габариты (ДхШхВ): 420x400x200 мм." },
      { key: "speedMps", value: { max: 2.5, typical: 2.5, qualifier: "до" }, unit: "м/с", asInSource: "Максимальная скорость: до 2,5 м/с." },
      { key: "navigation", value: ["QR-метки"], asInSource: "Тип навигации: QR-метки." },
      { key: "autonomyH", value: { max: 10, typical: 10, qualifier: "до" }, unit: "ч", asInSource: "Время работы: до 10 часов." },
      { key: "minAisleM", value: { typical: 0.7, qualifier: "≈" }, unit: "м", asInSource: "Минимальная ширина проезда: около 700 мм." },
      { key: "positioningMm", value: { typical: 3, qualifier: "≈" }, unit: "мм", asInSource: "Точность позиционирования: порядка ±3 мм." },
    ],
  },
  {
    model: "PuduBot 2",
    sections: ["Медучреждение"],
    rows: [],
    values: [
      { key: "dimensionsMm", value: "580 × 535 × 1290", unit: "мм", asInSource: "Габариты: 580*535*1290мм" },
      { key: "massKg", value: 39, unit: "кг", asInSource: "Вес: 39кг" },
      { key: "payloadKg", value: 10, unit: "кг", asInSource: "Грузоподъемность: 10кг на полку" },
      { key: "chargeMin", value: 240, unit: "мин", asInSource: "Время зарядки/работы: 4 часа/12 часов" },
      { key: "autonomyH", value: 12, unit: "ч", asInSource: "Время зарядки/работы: 4 часа/12 часов" },
      { key: "minAisleM", value: 0.8, unit: "м", asInSource: "Ширина проезда: 80см" },
      {
        key: "speedMps",
        value: { min: 0.5, max: 1.2, typical: 0.85 },
        unit: "м/с",
        asInSource: "Скорость: 0.5~1.2м/с（регулируется）",
      },
      {
        key: "navigation",
        value: ["VSLAM", "лазерный SLAM"],
        asInSource: "Тип навигации: VSLAM + лазерный SLAM (камера + лидар, 3D‑датчики глубины).",
      },
    ],
  },
];

/**
 * Продукт уровня «examples»: модели нет в каталоге организатора, она есть только в «Примерах
 * решений». Цены у организатора нет — покупка не рассчитывается (флаг no-price).
 */
export const EXAMPLE_ONLY_PRODUCTS: readonly {
  model: string;
  slug: string;
  name: string;
  manufacturer: string;
  solutionType: string;
  processes: string[];
  description: string;
}[] = [
  {
    model: "PuduBot 2",
    slug: "pudubot-2",
    name: "PuduBot 2",
    // Производитель назван в списке источников «Примеров решений»: «Pudu Robotics — страница сервиса-робота PuduBot 2».
    manufacturer: "Pudu Robotics",
    solutionType: "delivery",
    processes: ["hospital-delivery"],
    description:
      "Робот-доставщик из «Примеров решений» организатора для медучреждения: полки по 10 кг, 12 ч работы, проезд от 80 см.",
  },
];

// ——————————————————————————— Каталог: классификация ———————————————————————————

/**
 * «Подтип» каталога организатора → тип решения. Ключ — подтип в нижнем регистре без пробелов по
 * краям. Для кураторских продуктов тип задаёт PRODUCT_DECISIONS; эта таблица — для уровня
 * идентификации. Неизвестный подтип → «other».
 */
export const SUBTYPE_TO_SOLUTION_TYPE: Readonly<Record<string, string>> = {
  amr: "pallet-amr",
  fmr: "fmr",
  "робот-штабелер": "fmr",
  "робот-штабелёр": "fmr",
  "беспилотный погрузчик": "fmr",
  "беспилотный тягач": "tug",
  "беспилотный грузовик": "yard",
  шаттл: "pallet-shuttle",
  "кран-штабелёр": "pallet-asrs",
  "умная система хранения": "g2p",
  "робот-уборщик": "cleaner",
  "робот уборщик": "cleaner",
  "робот инвентаризатор": "inventory",
  "робот-инвентаризатор": "inventory",
  "робот-сортировщик": "sorter",
  "охранный робот": "patrol",
};

/** «Тип» каталога организатора → тип решения, если подтип пуст или неизвестен. */
export const TYPE_TO_SOLUTION_TYPE: Readonly<Record<string, string>> = {
  "мобильные роботы": "other",
  "автономные наземные транспортные средства": "other",
  "стационарные роботизированные системы": "other",
};

/**
 * «Сценарий» каталога организатора → процессы модели. Только наземные роботы (тип brs, не
 * «Морские роботы»): БАС и морские аппараты к процессам склада, аэропорта и больницы не
 * относятся. Сценарий через запятую разбирается по частям. Неизвестный сценарий → [].
 */
export const SCENARIO_TO_PROCESS: Readonly<Record<string, readonly string[]>> = {
  "внутрискладская логистика": ["pallet-transport"],
  "уборка помещений": ["cleaning", "terminal-cleaning", "hospital-cleaning"],
  "сортировка грузов": ["sorting"],
  "инвентаризация склада": ["inventory"],
  "патрулирование территории": ["patrol"],
  "мониторинг и патрулирование": ["patrol"],
};

/** Цены, которые в каталоге встречаются подозрительно часто (5 млн — 19 раз, 3,5 и 2,5 млн — по 16). */
export const PLACEHOLDER_PRICES: readonly number[] = [5_000_000, 3_500_000, 2_500_000];

// ——————————————————————————— Кураторский свод ———————————————————————————

/**
 * Пары строк свода с одним id каталога (продукт × сценарий у организатора). Генератор
 * сверяет их с фактическими повторами id и падает при расхождении.
 */
export const DUPLICATE_ROW_MERGES: readonly (readonly [number, number])[] = [
  [16, 17],
  [21, 22],
  [23, 24],
  [51, 52],
];

/** Колонки свода «Справочник» → ключи характеристик. Колонки без ключа не переносятся. */
export const SVOD_COLUMN_TO_KEY: Readonly<Record<string, CharKey>> = {
  "Производительность (ед./ч)": "throughput",
  "Грузоподъёмность, кг": "payloadKg",
  "Габариты Д×Ш×В, мм": "dimensionsMm",
  "Масса, кг": "massKg",
  "Скорость, м/с": "speedMps",
  "Автономность, ч": "autonomyH",
  "Время зарядки, мин": "chargeMin",
  "Навигация": "navigation",
  "Точность позиционирования, мм": "positioningMm",
  "Условия эксплуатации": "operatingConditions",
  "Мин. ширина прохода, м": "minAisleM",
  "Требования к покрытию": "floorRequirements",
  "Связь/интеграция": "connectivity",
  "Срок службы, лет": "serviceLifeYears",
  "Замена АКБ: раз в N лет": "batteryReplacementYears",
  "Замена АКБ: стоимость, руб": "batteryCostRub",
  "Сервис, руб/год": "serviceRubYear",
  "Расходники, руб/год": "consumablesRubYear",
  "ПО/подписка, руб/год": "softwareRubYear",
  "Внедрение, руб": "implementationRub",
  "Обучение, руб": "trainingRub",
  "Ставка аренды/RaaS, руб/мес": "raasRubMonth",
  // Колонки второго прохода исследования (found_batch), которых нет в своде.
  "Страна происхождения": "countryOfOrigin",
  "Модель приобретения": "acquisitionModels",
};

/** Единицы характеристик, которые переносятся из свода числом. */
export const NUMERIC_KEY_UNITS: Readonly<Partial<Record<CharKey, string>>> = {
  payloadKg: "кг",
  massKg: "кг",
  speedMps: "м/с",
  autonomyH: "ч",
  chargeMin: "мин",
  positioningMm: "мм",
  minAisleM: "м",
  serviceLifeYears: "лет",
  batteryReplacementYears: "лет",
  batteryCostRub: "₽",
  serviceRubYear: "₽/год",
  consumablesRubYear: "₽/год",
  softwareRubYear: "₽/год",
  implementationRub: "₽",
  trainingRub: "₽",
  raasRubMonth: "₽/мес",
};

/** Тип источника в своде и в found_batch (по-русски) → SourceType. */
export const RU_SOURCE_TYPE: Readonly<Record<string, SourceType>> = {
  производитель: "manufacturer",
  "документация (PDF)": "manufacturer-doc",
  "дилер/интегратор": "dealer",
  дилер: "dealer",
  "каталог-агрегатор": "aggregator",
  "пресса/прочее": "press",
};

/** Уверенность исследователя (по-русски) → confidence. */
export const RU_CONFIDENCE: Readonly<Record<string, "high" | "medium" | "low">> = {
  высокая: "high",
  средняя: "medium",
  низкая: "low",
};

/**
 * Текст производительности, который описывает парк, пилот или кейс, а не один робот: такие
 * цифры в расчёт парка не идут и переносятся в «Кейсы».
 */
export const FLEET_FIGURE_RE = /парк|флот|кейс|пилот|на \d+ робот|\d+ робот|роботов|за месяц|рейсов\/сутки|не на 1 робота/i;

// ——————————————————————————— Решения по продуктам ———————————————————————————

/** Уверенность исследователя. */
export type Confidence = "high" | "medium" | "low";

/**
 * Источник значения, выбранного вручную:
 * - finding — находка found_batch (ссылка, цитата, уверенность с поправкой по вердикту
 *   проверки verify_result); по умолчанию находка «расходуется» и не переносится повторно
 *   общим путём (`keepGeneric` оставляет её и для общего пути);
 * - row — строка свода (ссылка и дата строки, цитата — текст ячейки `column`);
 * - conflict — конфликт found_batch по колонке `column` (ссылка и найденное значение);
 * - web — страница, проверенная при подготовке данных (кэш исследования от 2026-09-23).
 */
export type DecisionSource =
  | { from: "finding"; ref: string; keepGeneric?: boolean }
  | { from: "row"; column: string }
  | { from: "conflict"; batch: number; column: string }
  | {
      from: "web";
      url: string;
      sourceType: SourceType;
      confidence: Confidence;
      asInSource: string;
    };

/**
 * Значение, выбранное вручную. `role: "alternative"` — значение не становится основным, а
 * служит для подтверждения и показа расхождений (например, цена с сайта производителя).
 */
export type DecidedValue = {
  key: CharKey;
  value: CharValue;
  unit?: string;
  scope?: Scope;
  source: DecisionSource;
  role?: "primary" | "alternative";
  /** Пояснение к выбору (попадает в basis значения). */
  basis?: string;
};

/**
 * Решение по продукту кураторского свода (ключ — номер строки; для слитых пар — меньший).
 * `processes` — процессы модели (PROCESS_DEFS); типы объектов выводятся из них.
 */
export type ProductDecision = {
  slug?: string;
  solutionType: string;
  processes: string[];
  flags?: ProductFlag[];
  excludedReason?: string;
  values?: DecidedValue[];
  /** Колонки свода, значения которых относятся к другому продукту и не переносятся. */
  dropRowColumns?: string[];
  /** Домены из «Источник (ссылка)», которые относятся к другой компании. */
  dropRowUrlHosts?: string[];
};

const CLEANING_ALL = ["cleaning", "terminal-cleaning", "hospital-cleaning"];
const RONAVI_TCO = "https://ronavi-robotics.ru/media/tpost/l8s0fty3m1-kak-schitat-stoimost-vladeniya-tco-logis";
const RND_REASON = "Статус «НИОКР» в каталоге организатора — опытный образец, в расчёт не включается";

/**
 * ПО управления парком Ronavi: 1 млн ₽ за одну установку на объект (лицензионный договор) —
 * тариф компании, общий для всех моделей. Колонка свода «ПО/подписка, руб/год» для него не
 * подходит: это разовый платёж, поэтому значение переносится в «ПО (разово)».
 */
function ronaviSoftware(ref: string): DecidedValue {
  return {
    key: "softwareRubOneTime",
    value: 1000000,
    unit: "₽",
    source: { from: "finding", ref },
    basis: "За одну установку ПО управления парком роботов на объект (лицензионный договор), не за робота.",
  };
}

/** Цена с сайта производителя Ronavi (страница модели, кэш исследования 2026-09-23). */
function ronaviPrice(model: string, path: string, min: number, max: number, quote: string): DecidedValue {
  return {
    key: "priceRub",
    value: { min, max, typical: Math.round((min + max) / 2) },
    unit: "₽",
    role: "alternative",
    source: {
      from: "web",
      url: `https://ronavi-robotics.ru/catalogue/${path}`,
      sourceType: "manufacturer",
      confidence: "high",
      asInSource: quote,
    },
    basis: `Диапазон цены ${model} на сайте производителя; нижняя граница — при покупке от 100 шт.`,
  };
}

export const PRODUCT_DECISIONS: Readonly<Record<number, ProductDecision>> = {
  // ——— Уборка улиц и территорий: к процессам склада, аэропорта и больницы не относится ———
  1: { slug: "168robotics-bro-2-1", solutionType: "cleaner", processes: [] },
  2: { slug: "168robotics-bro-3-0", solutionType: "cleaner", processes: [] },
  // Сценарий «Уборка улиц» не соответствует продукту: по данным производителя — сухая уборка складов.
  3: { slug: "astramis-surfexunit", solutionType: "cleaner", processes: ["cleaning"] },
  4: { slug: "depesha-3", solutionType: "cleaner", processes: [] },
  5: { slug: "avtonomika-piksel", solutionType: "cleaner", processes: [] },
  12: { slug: "viafor-mark", solutionType: "cleaner", processes: [] },
  13: { slug: "robkom-venom-sarancha", solutionType: "cleaner", processes: [] },

  // ——— Уборка помещений ———
  6: {
    slug: "avtomakon-ak-sc80",
    solutionType: "cleaner",
    processes: CLEANING_ALL,
    // Страница производителя недоступна; на рынке есть китайская платформа SC80 с тем же индексом.
    flags: ["manufacturer-disputed"],
    values: [
      {
        key: "throughput",
        value: 3000,
        unit: "м²/ч",
        scope: "per-robot",
        source: { from: "row", column: "Производительность (ед./ч)" },
      },
    ],
  },
  7: {
    slug: "r2b-mark-2-se",
    solutionType: "cleaner",
    processes: CLEANING_ALL,
    values: [
      {
        key: "serviceRubYear",
        value: { typical: 240000, qualifier: "≈" },
        unit: "₽/год",
        source: { from: "finding", ref: "1:33" },
        basis: "≈20 000 ₽ в месяц, включая расходники и техподдержку (блог производителя).",
      },
      {
        key: "priceRub",
        value: 2200000,
        unit: "₽",
        role: "alternative",
        source: { from: "finding", ref: "1:39", keepGeneric: true },
      },
    ],
  },
  8: { slug: "robo-rubi-s-03", solutionType: "cleaner", processes: CLEANING_ALL, flags: ["case-unconfirmed"] },
  9: { slug: "yaku-unit", solutionType: "cleaner", processes: CLEANING_ALL },
  10: {
    slug: "waybot-klinbotiks-400-pro",
    solutionType: "cleaner",
    processes: CLEANING_ALL,
    values: [
      {
        key: "throughput",
        value: { min: 700, max: 1200, typical: 950 },
        unit: "м²/ч",
        scope: "per-robot",
        source: { from: "row", column: "Производительность (ед./ч)" },
      },
      {
        key: "serviceRubYear",
        value: 360000,
        unit: "₽/год",
        source: { from: "finding", ref: "1:48" },
        basis: "30 000 ₽ в месяц — тариф обслуживания производителя.",
      },
      {
        key: "raasRubMonth",
        value: 100000,
        unit: "₽/мес",
        source: { from: "row", column: "Ставка аренды/RaaS, руб/мес" },
        basis: "Ставка со 2-го месяца; первый месяц — 260 000 ₽.",
      },
      {
        key: "implementationRub",
        value: { min: 100000, typical: 100000, qualifier: "от" },
        unit: "₽",
        source: { from: "row", column: "Внедрение, руб" },
      },
    ],
  },
  11: {
    slug: "waybot-klinbotiks-600",
    solutionType: "cleaner",
    processes: CLEANING_ALL,
    values: [
      {
        key: "throughput",
        value: { min: 1000, max: 2300, typical: 1000 },
        unit: "м²/ч",
        scope: "per-robot",
        source: { from: "row", column: "Производительность (ед./ч)" },
        basis: "Типичное значение — практическая производительность 1 000 м²/ч (2 300 — теоретическая).",
      },
      {
        key: "serviceRubYear",
        value: 360000,
        unit: "₽/год",
        source: { from: "finding", ref: "1:51" },
        basis: "30 000 ₽ в месяц — тариф обслуживания производителя.",
      },
      {
        key: "raasRubMonth",
        value: 120000,
        unit: "₽/мес",
        source: { from: "row", column: "Ставка аренды/RaaS, руб/мес" },
        basis: "Ставка со 2-го месяца; первый месяц — 400 000 ₽.",
      },
      {
        key: "implementationRub",
        value: { min: 150000, typical: 150000, qualifier: "от" },
        unit: "₽",
        source: { from: "row", column: "Внедрение, руб" },
      },
    ],
  },

  // ——— Перевозка паллет ———
  14: {
    slug: "dikom-dmr-1200",
    solutionType: "pallet-amr",
    processes: ["pallet-transport"],
    values: [
      {
        key: "priceRub",
        value: { min: 4250000, typical: 4250000, qualifier: "от" },
        unit: "₽",
        role: "alternative",
        source: { from: "finding", ref: "2:6", keepGeneric: true },
      },
    ],
  },
  15: {
    slug: "dikom-dmr-300-carrier-b",
    solutionType: "tote-amr",
    processes: ["piece-picking", "hospital-delivery"],
    values: [
      {
        key: "priceRub",
        value: { min: 10800000, typical: 10800000, qualifier: "от" },
        unit: "₽",
        role: "alternative",
        source: { from: "finding", ref: "2:12", keepGeneric: true },
      },
    ],
  },
  // Строки 16 и 17 — одна модель в двух сценариях каталога.
  16: {
    slug: "dikom-dmr-600",
    solutionType: "pallet-amr",
    processes: ["pallet-transport"],
    values: [
      {
        key: "priceRub",
        value: { min: 3750000, typical: 3750000, qualifier: "от" },
        unit: "₽",
        role: "alternative",
        source: { from: "finding", ref: "2:7", keepGeneric: true },
      },
    ],
  },
  18: { slug: "moros-amr-100", solutionType: "tote-amr", processes: ["piece-picking", "hospital-delivery"] },
  19: { slug: "moros-amr-1500", solutionType: "pallet-amr", processes: ["pallet-transport"] },
  20: { slug: "moros-amr-800", solutionType: "pallet-amr", processes: ["pallet-transport"] },
  // Строки 21 и 22 — Ronavi H1500 в двух сценариях каталога. Лучше всех документированный продукт:
  // пример организатора, цена и тариф RaaS, сервис, ПО и внедрение из статьи производителя о TCO.
  21: {
    slug: "ronavi-h1500",
    solutionType: "pallet-amr",
    processes: ["pallet-transport"],
    // «Срок службы 10 лет» в своде: публичного источника второй проход не нашёл (row_notes
    // found_batch3) — значение не переносится, расчёт берёт норматив serviceLifeYearsDefault.
    dropRowColumns: ["Срок службы, лет"],
    values: [
      ronaviPrice(
        "Ronavi H1500",
        "h1500",
        2160000,
        2700000,
        "Цена за единицу при покупке от 100 шт. Ronavi H1500: от 2 160 000 ₽ … Стоимость (2 160 000 — 2 700 000 ₽) зависит от дополнительного оборудования",
      ),
      {
        key: "serviceRubYear",
        value: { typical: 300000, qualifier: "≈" },
        unit: "₽/год",
        source: { from: "finding", ref: "3:23" },
        basis: "Около 10 % стоимости робота в год — пример H1500 в статье производителя о TCO.",
      },
      ronaviSoftware("3:0"),
      {
        key: "implementationRub",
        value: { min: 500000, max: 2000000, typical: 1250000 },
        unit: "₽",
        source: { from: "finding", ref: "3:7" },
        basis: "Внедрение RMS и интеграция с WMS/ERP на проект; типичное значение — середина диапазона.",
      },
      {
        key: "raasRubMonth",
        value: { min: 100000, typical: 100000, qualifier: "от" },
        unit: "₽/мес",
        source: {
          from: "web",
          url: "https://robotrends.ru/robopedia/ronavi-robotics",
          sourceType: "aggregator",
          confidence: "low",
          asInSource:
            "Стоимость «подписки» на роботизацию склада — от 100 тысяч рублей в месяц за одного робота.",
        },
        basis: "Тариф компании Ronavi за одного робота; модель в тексте не названа, поэтому уверенность низкая.",
      },
    ],
  },
  23: {
    slug: "ronavi-h2000",
    solutionType: "pallet-amr",
    processes: ["pallet-transport"],
    // Кейс «гибкий конвейер на автопроизводстве» выполнен на H1500, а не на H2000.
    flags: ["case-unconfirmed"],
    values: [
      ronaviPrice(
        "Ronavi H2000",
        "h2000",
        2805000,
        3300000,
        "Цена за единицу при покупке от 100 шт. Ronavi H2000: от 2 805 000 ₽ … Стоимость (2 805 000 — 3 300 000 ₽) зависит от дополнительного оборудования",
      ),
      ronaviSoftware("3:2"),
    ],
  },
  25: {
    slug: "ronavi-m",
    solutionType: "tote-amr",
    processes: ["piece-picking", "hospital-delivery"],
    values: [
      ronaviPrice(
        "Ronavi M",
        "m",
        1785000,
        2400000,
        "Цена за единицу при покупке от 100 шт. Ronavi M: от 1 785 000 ₽ … Стоимость (1 785 000 — 2 400 000 ₽) зависит от дополнительного оборудования",
      ),
      ronaviSoftware("3:4"),
      {
        key: "throughput",
        value: { min: 400, typical: 400, qualifier: "от" },
        unit: "шт./ч",
        scope: "per-station",
        source: { from: "finding", ref: "3:39" },
        basis: "Скорость комплектации «товар к человеку» для конфигурации M500 (дилер).",
      },
    ],
  },
  26: {
    slug: "ronavi-rcm",
    solutionType: "pallet-amr",
    processes: ["pallet-transport"],
    flags: ["model-not-found"],
    excludedReason:
      "Модель Ronavi RCM не найдена у производителя: в каталоге ronavi-robotics.ru семь моделей, " +
      "страница /catalogue/rcm отвечает 404 (проверено 2026-09-23)",
  },
  27: {
    slug: "ronavi-sd",
    solutionType: "sorter",
    processes: ["sorting", "hospital-delivery"],
    // Цена организатора 1,4 млн ₽ против 360–400 тыс. ₽ на сайте производителя.
    flags: ["price-disputed"],
    values: [
      ronaviPrice(
        "Ronavi SD",
        "sd",
        360000,
        400000,
        "Цена за единицу при покупке от 100 шт. Ronavi SD: от 360 000 ₽ … Стоимость (360 000 — 400 000 ₽) зависит от дополнительного оборудования",
      ),
      ronaviSoftware("3:5"),
    ],
  },
  28: { slug: "ronavi-sr", solutionType: "sorter", processes: ["sorting"], values: [ronaviSoftware("3:6")] },
  // Кейсы строки описывают Сёмабот, а не Tagarka; производственная платформа, не склад.
  29: { slug: "semargl-tagarka-6t", solutionType: "pallet-amr", processes: [], flags: ["case-unconfirmed"] },
  30: { slug: "semargl-semabot-1500", solutionType: "pallet-amr", processes: ["pallet-transport"] },
  // Производительность 350 паллет/ч — на парк из 67 роботов (кейс X5), в расчёт парка не идёт.
  31: { slug: "avtomakon-ak-2000-2", solutionType: "fmr", processes: ["pallet-transport", "storage"] },
  // В «Источник (ссылка)» указан smprobotics.ru — это другая компания (уличные охранные роботы).
  32: {
    slug: "sm-robotics-mule",
    solutionType: "fmr",
    processes: ["pallet-transport"],
    dropRowUrlHosts: ["www.smprobotics.ru", "smprobotics.ru"],
  },
  33: {
    slug: "robocv-shtabeler",
    solutionType: "fmr",
    processes: ["pallet-transport", "storage"],
    values: [
      // Конфликт found_batch4: в своде 1,9 м — ширина дороги для набора максимальной скорости;
      // для разворота с паллетой производитель требует 2,9 м (спецификация PDF 2021 — 2900 мм).
      {
        key: "turnAisleM",
        value: 2.9,
        unit: "м",
        source: { from: "conflict", batch: 4, column: "Мин. ширина прохода, м" },
        basis: "«Минимальная ширина проезда для разворота» на странице производителя; в спецификации PDF 2021 — 2900 мм.",
      },
      {
        key: "throughput",
        value: { min: 30, max: 40, typical: 30 },
        unit: "паллет/ч",
        scope: "per-robot",
        source: { from: "finding", ref: "4:0" },
        basis: "«До 40 паллет в час» на одного робота; типичное — средняя 30 паллет/ч в пилоте 2016 г.",
      },
    ],
  },
  34: { slug: "dikom-as-rs-b", solutionType: "g2p", processes: ["piece-picking"] },
  // Организатор указывает МФТИ; по исследованию разработчик — компания «Беспилотный погрузчик»,
  // аффилированная с МФТИ (autoforklift.ru). Основным остаётся значение организатора.
  35: {
    slug: "bespilotnyy-pogruzchik",
    solutionType: "fmr",
    processes: ["pallet-transport"],
    flags: ["manufacturer-disputed"],
    values: [
      {
        key: "manufacturer",
        value: "«Беспилотный погрузчик» (компания, аффилированная с МФТИ)",
        role: "alternative",
        source: { from: "finding", ref: "4:22", keepGeneric: true },
      },
    ],
  },
  36: { slug: "cognitive-pilot-tyagach", solutionType: "tug", processes: ["baggage-transport", "apron-towing"] },
  37: { slug: "avtotekh-l5", solutionType: "tug", processes: [] },
  // Строка смешана с данными аэродромного тягача из «Примеров решений» (Cognitive Pilot):
  // габариты, скорость 5–25 км/ч, 24 ч, масса 1 250 кг (середина «1000–1500 кг»),
  // «мультисенсорный автопилот» и «перрон» производителем RoboCV не подтверждаются.
  38: {
    slug: "robocv-tyagach",
    solutionType: "tug",
    processes: ["pallet-transport"],
    flags: ["values-from-other-product"],
    dropRowColumns: [
      "Габариты Д×Ш×В, мм",
      "Скорость, м/с",
      "Автономность, ч",
      "Условия эксплуатации",
      "Масса, кг",
      "Навигация",
    ],
    values: [
      {
        key: "speedMps",
        value: { max: 2.2, typical: 2.2, qualifier: "до" },
        unit: "м/с",
        source: { from: "conflict", batch: 4, column: "Скорость, м/с" },
      },
      {
        key: "dimensionsMm",
        value: "1600 × 800 × 2200",
        unit: "мм",
        source: { from: "conflict", batch: 4, column: "Габариты Д×Ш×В, мм" },
      },
    ],
  },
  39: { slug: "amt-6x6", solutionType: "yard", processes: [] },
  40: {
    slug: "evocargo-n1",
    solutionType: "yard",
    processes: ["apron-towing"],
    // Грузовики продаются как сервис по подписке; цена организатора не подтверждена.
    flags: ["price-may-be-subscription"],
  },
  41: { slug: "odk-star-telezhka", solutionType: "other", processes: [] },
  42: { slug: "avrora-kompleks-obsledovaniya-grunta", solutionType: "other", processes: [] },
  43: { slug: "dronskhab-belka", solutionType: "delivery", processes: [] },
  44: { slug: "yandex-robot-komplektovshchik", solutionType: "other", processes: ["piece-picking"] },
  // Цена 2 млн ₽, вероятно, годовая подписка (RaaS 1–2 млн ₽/год по данным прессы).
  45: {
    slug: "yandex-robot-inventarizator",
    solutionType: "inventory",
    processes: ["inventory"],
    flags: ["price-may-be-subscription"],
  },
  46: { slug: "avtomakon-ai-stock-counter-12m", solutionType: "inventory", processes: ["inventory"] },
  // «Свеза» — заказчик, производитель робота не установлен; линия фанеры, не склад.
  47: { slug: "sveza-yasha", solutionType: "sorter", processes: [], flags: ["manufacturer-disputed"] },
  48: {
    slug: "ars-smartcube",
    solutionType: "g2p",
    processes: ["piece-picking"],
    // Единица цены неясна: малый модуль системы стоит около 30 млн ₽, крупная система — 300–400 млн ₽.
    flags: ["price-disputed"],
    values: [
      {
        key: "throughput",
        value: 200,
        unit: "ящиков/ч",
        scope: "per-station",
        source: { from: "conflict", batch: 5, column: "Производительность (ед./ч)" },
        basis: "200 ящиков в час на одну рабочую станцию UC-01 («18 секунд на ящик с учётом пикинга»).",
      },
    ],
  },
  49: { slug: "dikom-as-rs-p", solutionType: "pallet-asrs", processes: ["storage"] },
  // Стелкон — производитель стеллажей; тележка названа «radioshuttle bt» (бренд BT / Toyota MH).
  // Кейс «Святой Источник» на сайте производителя не найден.
  50: {
    slug: "stelkon-pallet-shuttle",
    solutionType: "pallet-shuttle",
    processes: ["pallet-transport", "storage"],
    flags: ["manufacturer-disputed", "case-unconfirmed"],
  },
  // Строки 51 и 52 — одна модель в двух сценариях с разной ценой (3,6 и 3,0 млн ₽).
  51: { slug: "mai-patrulirovanie", solutionType: "patrol", processes: ["patrol"] },
  53: { slug: "gumich-spasatel", solutionType: "other", processes: [] },
  54: { slug: "gumich-gorodovoy", solutionType: "patrol", processes: ["patrol"] },
  55: { slug: "smp-tral-patrul-5", solutionType: "patrol", processes: ["patrol"] },
  56: { slug: "dgtu-traktor", solutionType: "other", processes: [] },
  57: { slug: "dikom-dmp-15000", solutionType: "pallet-amr", processes: [] },
  58: {
    slug: "dikom-dmr-carrier-p",
    solutionType: "fmr",
    processes: ["pallet-transport", "storage"],
    values: [
      {
        key: "priceRub",
        value: { min: 4300000, typical: 4300000, qualifier: "от" },
        unit: "₽",
        role: "alternative",
        source: { from: "finding", ref: "2:14", keepGeneric: true },
      },
    ],
  },
  59: {
    slug: "semargl-tagarka-35t",
    solutionType: "pallet-amr",
    processes: ["pallet-transport"],
    flags: ["variant-unpublished"],
    excludedReason:
      "Вариант Tagarka 35 т не опубликован производителем: на сайте Семаргл линейка 2 / 6 / 9 т, " +
      "большие грузоподъёмности — только под заказ (проверено 2026-09-23)",
  },
  60: { slug: "sber-vorker", solutionType: "other", processes: ["piece-picking"] },
  61: { slug: "rosatom-zaryadnaya-stantsiya", solutionType: "other", processes: [] },
};

/** Причина исключения для строк со статусом НИОКР (флаг rnd-exclude). */
export const RND_EXCLUDED_REASON = RND_REASON;

/** Ссылка на статью Ronavi о стоимости владения — источник сервиса, ПО и внедрения. */
export const RONAVI_TCO_URL = RONAVI_TCO;
