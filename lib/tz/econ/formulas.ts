/**
 * Формулы модели tz-1.0.0 — единственный источник для трассировки расчёта («Как посчитано»),
 * отчёта, страницы /methodology/tz и листа формул XLSX (ТЗ §3.5.8: все формулы, единицы,
 * источники и допущения доступны пользователю).
 *
 * `source` говорит, откуда формула: из ТЗ (§3.5.1 — прозрачная модель, §3.5.2 — рекомендуемые
 * расчётные зависимости), из легенды датасета организатора или это наш выбор (тогда в
 * методике объясняется почему).
 *
 * Ключи статей CAPEX и OPEX — с префиксом `capex:` / `opex:` (ключ строки LineItem — после
 * двоеточия): иначе статья «Зарядные станции» (`chargers`) совпала бы с формулой числа станций.
 * Помощники `capexFormulaKey` / `opexFormulaKey` делают это отображение.
 */

export type FormulaSource = "ТЗ §3.5.1" | "ТЗ §3.5.2" | "организатор" | "наш выбор";

export type Formula = {
  title: string;
  expression: string;
  units: string;
  source: FormulaSource;
};

/** Ключи строк CAPEX (LineItem.key в capexLines). */
export const CAPEX_LINE_KEYS = [
  "equipment",
  "chargers",
  "infrastructure",
  "software",
  "integration",
  "commissioning",
  "training",
  "reserve",
] as const;
export type CapexLineKey = (typeof CAPEX_LINE_KEYS)[number];

/** Ключи строк OPEX (LineItem.key в opexLines). */
export const OPEX_LINE_KEYS = [
  "subscription",
  "service",
  "licences",
  "electricity",
  "connectivity",
  "consumables",
  "repair",
  "battery",
  "operatingStaff",
  "remainingLabour",
  "uncoveredLabour",
  "baselineLabour",
] as const;
export type OpexLineKey = (typeof OPEX_LINE_KEYS)[number];

export type FormulaKey =
  | "workHours"
  | "demandDay"
  | "peakPerHour"
  | "thrNorm"
  | "thrCycle"
  | "thrEff"
  | "fleet"
  | "coverage"
  | "chargers"
  | "roleCost"
  | "baselineLabour"
  | "releasedFte"
  | "remainingLabour"
  | "operatingStaff"
  | `capex:${CapexLineKey}`
  | `opex:${OpexLineKey}`
  | "capexTotal"
  | "opexTotal"
  | "effect"
  | "payback"
  | "roiTz"
  | "roiNet"
  | "npv"
  | "discountedPayback"
  | "tco"
  | "cashflow"
  | "batteryYear"
  | "reinvest"
  | "breakEvenSalary";

export function capexFormulaKey(key: CapexLineKey): FormulaKey {
  return `capex:${key}`;
}

export function opexFormulaKey(key: OpexLineKey): FormulaKey {
  return `opex:${key}`;
}

export const FORMULAS: Readonly<Record<FormulaKey, Formula>> = {
  // ——— Режим и спрос ———
  workHours: {
    title: "Часы работы объекта",
    expression: "Hсут = смен в сутки × длительность смены (не более 24 ч); Hгод = Hсут × рабочих дней в году",
    units: "ч/сут; ч/год",
    source: "организатор",
  },
  demandDay: {
    title: "Суточный спрос процесса",
    expression:
      "Qсут = Σ объёмов процесса × (доля процесса / 100) × Π множителей × (1 − доля негабарита / 100)",
    units: "ед./сут",
    source: "наш выбор",
  },
  peakPerHour: {
    title: "Пиковый часовой поток",
    expression: "λср = Qсут / Hсут; λпик = λср × пиковый коэффициент",
    units: "ед./ч",
    source: "организатор",
  },

  // ——— Производительность и парк ———
  thrNorm: {
    title: "Паспортная производительность",
    expression:
      "thrнорм = производительность из карточки продукта, если она на один робот или станцию, в " +
      "единицах процесса и не «до X» (предел, а не типичное значение)",
    units: "ед./ч",
    source: "наш выбор",
  },
  thrCycle: {
    title: "Производительность по циклу на планировке объекта",
    expression: "thrцикл = 3600 / (Lпорож / v + Lгруз / (v × kгруз) + 2 × tзахв)",
    units: "ед./ч; м; м/с; с",
    source: "наш выбор",
  },
  thrEff: {
    title: "Принятая производительность робота",
    expression: "thrэфф = значение, заданное вами, иначе min(thrнорм; thrцикл) из известных",
    units: "ед./ч",
    source: "наш выбор",
  },
  fleet: {
    title: "Число роботов",
    expression:
      "Nточн = λпик / (thrэфф × U × A) × (1 + резерв); N = значение, заданное вами, иначе max(1; ⌈Nточн⌉)",
    units: "шт.",
    source: "ТЗ §3.5.2",
  },
  coverage: {
    title: "Доля пикового спроса, которую закрывает парк",
    expression: "κ = min(1; N × thrэфф × U × A / λпик)",
    units: "доля",
    source: "наш выбор",
  },
  chargers: {
    title: "Число зарядных станций",
    expression:
      "C = max(1; ⌈N × tзар / (автономность × 60 + tзар) × kзапас⌉); без данных о зарядке " +
      "C = max(1; ⌈N / роботов на станцию⌉); для стационарных систем C = 0",
    units: "шт.",
    source: "наш выбор",
  },

  // ——— Труд ———
  roleCost: {
    title: "Годовая стоимость одной ставки",
    expression: "c = зарплата × 12 × коэффициент начислений на ФОТ",
    units: "₽/год",
    source: "организатор",
  },
  baselineLabour: {
    title: "ФОТ персонала процесса (как есть)",
    expression: "ФОТбаз = численность × c",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  releasedFte: {
    title: "Высвобождаемые ставки",
    expression:
      "F = численность × доля автоматизируемого труда × (1 − доля негабарита / 100) × κ " +
      "(негабарит перевозят только люди, поэтому он исключён и из спроса роботов, и из " +
      "высвобождаемого труда — это не двойной учёт)",
    units: "ставок",
    source: "наш выбор",
  },
  remainingLabour: {
    title: "ФОТ оставшегося персонала процесса",
    expression: "ФОТост = (численность − F) × c",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  operatingStaff: {
    title: "Персонал эксплуатации (диспетчер парка)",
    expression: "посты = ⌈N / роботов на пост⌉; ФОТэксп = посты × Hсут × дней в году / фонд ставки в год × c",
    units: "₽/год",
    source: "наш выбор",
  },

  // ——— CAPEX ———
  "capex:equipment": {
    title: "Оборудование (роботы)",
    expression: "N × цена за единицу",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:chargers": {
    title: "Зарядные станции",
    expression: "C × цена зарядной станции",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:infrastructure": {
    title: "Инфраструктура площадки (разметка, Wi-Fi)",
    expression: "площадь активной зоны × удельная стоимость инфраструктуры (для мобильных роботов)",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:software": {
    title: "ПО управления парком",
    expression: "разовая цена ПО из карточки продукта, иначе норматив на объект",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:integration": {
    title: "Интеграция с WMS/ERP",
    expression: "стоимость внедрения из карточки продукта, иначе норматив на объект",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:commissioning": {
    title: "Пусконаладка",
    expression: "N × пусконаладка на один робот",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:training": {
    title: "Обучение персонала",
    expression: "стоимость обучения из карточки продукта, иначе норматив на объект",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  "capex:reserve": {
    title: "Резерв",
    expression: "доля резерва CAPEX × сумма остальных статей CAPEX",
    units: "₽",
    source: "организатор",
  },
  capexTotal: {
    title: "CAPEX",
    expression:
      "оборудование + зарядные станции + инфраструктура + ПО + интеграция + пусконаладка + обучение + резерв",
    units: "₽",
    source: "ТЗ §3.5.2",
  },

  // ——— OPEX ———
  "opex:subscription": {
    title: "Подписка RaaS",
    expression: "N × 12 × ставка за робота в месяц",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:service": {
    title: "Сервисное обслуживание",
    expression: "N × сервис за робота в год (из карточки продукта, иначе доля сервиса × цена)",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:licences": {
    title: "Лицензии ПО",
    expression: "годовая плата за ПО из карточки продукта (на объект), иначе 0",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:electricity": {
    title: "Электроэнергия",
    expression: "N × средняя мощность робота × Hгод × U × тариф",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:connectivity": {
    title: "Связь и сеть",
    expression: "N × связь на один робот в год",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:consumables": {
    title: "Расходные материалы",
    expression: "N × расходники за робота в год (из карточки продукта, иначе доля × цена)",
    units: "₽/год",
    source: "организатор",
  },
  "opex:repair": {
    title: "Ремонт вне сервисного договора",
    expression: "доля ремонта в год × стоимость оборудования",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:battery": {
    title: "Замена АКБ (в среднем за год)",
    expression:
      "N × стоимость комплекта АКБ / срок замены; в денежном потоке — фактическая замена в годы, кратные сроку",
    units: "₽/год",
    source: "организатор",
  },
  "opex:operatingStaff": {
    title: "Персонал эксплуатации (диспетчер парка)",
    expression: "посты = ⌈N / роботов на пост⌉; посты × Hсут × дней в году / фонд ставки в год × c",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:remainingLabour": {
    title: "ФОТ оставшегося персонала процесса",
    expression: "(численность − F) × c",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  "opex:uncoveredLabour": {
    title: "ФОТ процессов без роботов (охват сравнения)",
    expression: "Σ ФОТбаз процессов охвата сравнения, которые этот сценарий не роботизирует",
    units: "₽/год",
    source: "наш выбор",
  },
  "opex:baselineLabour": {
    title: "ФОТ персонала процессов (как есть)",
    expression: "Σ численность × c по процессам охвата сравнения",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  opexTotal: {
    title: "OPEX за год",
    expression: "сумма статей OPEX сценария",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },

  // ——— Финансы ———
  effect: {
    title: "Чистый годовой эффект",
    expression: "E = OPEXкак есть − OPEXсценария (охват сравнения один для всех сценариев)",
    units: "₽/год",
    source: "ТЗ §3.5.2",
  },
  payback: {
    title: "Простой срок окупаемости",
    expression: "PB = CAPEX / E при E > 0",
    units: "лет",
    source: "ТЗ §3.5.2",
  },
  roiTz: {
    title: "ROI по ТЗ",
    expression: "ROI = Σ CFt (t = 1…H) / CAPEX × 100 %, при CAPEX > 0",
    units: "%",
    source: "ТЗ §3.5.2",
  },
  roiNet: {
    title: "Чистый ROI",
    expression: "ROIчист = ROI по ТЗ − 100 % (доход сверх возврата вложений)",
    units: "%",
    source: "наш выбор",
  },
  npv: {
    title: "Чистая приведённая стоимость (NPV)",
    expression: "NPV = Σ CFt / (1 + r)^t, t = 0…H",
    units: "₽",
    source: "наш выбор",
  },
  discountedPayback: {
    title: "Дисконтированный срок окупаемости",
    expression:
      "год, в котором накопленный дисконтированный поток становится неотрицательным и остаётся таким до конца горизонта H",
    units: "лет",
    source: "наш выбор",
  },
  tco: {
    title: "Совокупная стоимость владения (TCO)",
    expression: "TCO = CAPEX + Σ (OPEXt + докупкаt), t = 1…T; T = max(H; минимальный горизонт TCO)",
    units: "₽",
    source: "ТЗ §3.5.2",
  },
  cashflow: {
    title: "Денежный поток года",
    expression: "CF0 = −CAPEX; CFt = OPEXкак есть − OPEXt − докупкаt",
    units: "₽",
    source: "наш выбор",
  },
  batteryYear: {
    title: "Замена АКБ в году t",
    expression:
      "АКБt = N × стоимость комплекта, если t кратно сроку замены и t < T; OPEXt = OPEX − АКБср + АКБt",
    units: "₽",
    source: "организатор",
  },
  reinvest: {
    title: "Докупка оборудования",
    expression: "докупкаt = N × цена, если t кратно сроку службы и t < T (только оборудование)",
    units: "₽",
    source: "наш выбор",
  },
  breakEvenSalary: {
    title: "Пороговая зарплата",
    expression:
      "зарплата, при которой NPV покупки = 0; NPV линеен по зарплате, поэтому порог находится по двум расчётам",
    units: "₽/мес",
    source: "наш выбор",
  },
};
