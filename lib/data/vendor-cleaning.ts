import type { CharValue, ProductSeed, Sourced } from "../tz/types";

export const CLEANING_SOURCE_DATE = "2026-10-18";
export const CLEANING_VENDOR_SOURCES = {
  pudu: "https://www.pudurobotics.com/en/products/puduCC1",
  agibot: "https://www.agibot.com/products/C5",
  viggo: "https://www.viggorobot.com/autonomous-cleaning-machines/viggo-sc80.html",
} as const;

function official(value: CharValue, sourceUrl: string, asInSource: string, extra: Partial<Sourced<CharValue>> = {}): Sourced<CharValue> {
  return { value, origin: "research", sourceType: "manufacturer", sourceUrl, date: CLEANING_SOURCE_DATE, confirmed: true, confidence: "high", asInSource, granularity: "field", ...extra };
}
function unknown(value: string, basis: string): Sourced<CharValue> {
  return { value, origin: "estimate", sourceType: "team-estimate", sourceUrl: null, date: CLEANING_SOURCE_DATE, confirmed: false, confidence: "low", basis };
}
function product(slug: string, name: string, manufacturer: string, sourceUrl: string, characteristics: ProductSeed["characteristics"], description: string): ProductSeed {
  return {
    slug, name, manufacturer, country: null, organizerCatalogId: null, organizerRows: [], level: "enriched", solutionType: "cleaner", status: "unknown",
    processes: ["cleaning", "terminal-cleaning", "hospital-cleaning"], facilityTypes: ["warehouse", "airport", "medical"], industries: [], description,
    characteristics: {
      modelName: official(name, sourceUrl, name),
      manufacturer: official(manufacturer, sourceUrl, manufacturer),
      purpose: official("Автономная уборка пола", sourceUrl, "Cleaning"),
      solutionType: unknown("Робот-уборщик", "Класс сопоставлен по назначению в официальной карточке производителя."),
      availabilityStatus: unknown("Статус эксплуатации не подтверждён", "Наличие коммерческой карточки не доказывает ни пилотную, ни серийную эксплуатацию. Глобальные внедрения и готовность поставки в РФ требуют отдельного подтверждения."),
      countryOfOrigin: unknown("Страна производства конкретной поставки не подтверждена", "Страна регистрации бренда и язык сайта не подтверждают происхождение конкретной поставки. Запросить паспорт и документы поставщика."),
      priceRub: unknown("Цена не подтверждена", "Коммерческое предложение на покупку с комплектацией не предоставлено; числовая цена не подставляется."),
      raasRubMonth: unknown("Тариф аренды / RaaS не подтверждён", "Предложение аренды с периодом, составом услуг и условиями пилота не предоставлено; отсутствующий тариф не равен нулю."),
      serviceRegion: unknown("Сервис на объекте в РФ не подтверждён", "Глобальная поддержка производителя не доказывает местный сервис, наличие запасных частей или время реакции."),
      warrantyTerms: unknown("Гарантия конкретной поставки не подтверждена", "Нужны договор, срок, территория, исключения и применимость к комплектации. Гарантия не равна ресурсу оборудования."),
      maintenanceTerms: unknown("Регламент и стоимость ТО не подтверждены", "Нужен регламент по выбранной модификации и режиму, перечень расходников, периодичность и коммерческий состав сервиса."),
      primarySourceUrl: official(sourceUrl, sourceUrl, name),
      ...characteristics,
    },
    flags: ["no-price"], excludedReason: null,
  };
}

/** Manufacturer specifications only. No prices, field measurements, life or Russian SLA are inferred. */
export const VENDOR_CLEANING_PRODUCTS: readonly ProductSeed[] = [
  product("pudu-cc1", "PUDU CC1", "Pudu Robotics", CLEANING_VENDOR_SOURCES.pudu, {
    manufacturerCountry: official("Китай — штаб-квартира в Шэньчжэне; происхождение конкретной поставки уточняется отдельно", "https://www.pudurobotics.com/en/contact-us", "Shenzhen, China"),
    throughput: official({ min: 700, max: 1000, typical: 700 }, CLEANING_VENDOR_SOURCES.pudu, "700-1000 ㎡/h", { unit: "м²/ч", scope: "per-robot", basis: "Опубликованный диапазон; нижняя граница выбрана консервативно для справки. Это паспортная оценка, не полевой замер." }),
    autonomyH: official(5, CLEANING_VENDOR_SOURCES.pudu, "Scrubbing: 5 h", { unit: "ч", basis: "Для режима мойки. Другие режимы имеют другую автономность; не использовать 9 ч сухой протирки для мойки." }),
    chargeMin: official({ max: 180, typical: 180, qualifier: "до" }, CLEANING_VENDOR_SOURCES.pudu, "< 3 h", { unit: "мин", basis: "180 мин — верхняя граница времени зарядки из заявления <3 ч, не измеренное типичное время." }),
    speedMps: official({ max: 1.2, typical: 1.2, qualifier: "до" }, CLEANING_VENDOR_SOURCES.pudu, "Max 1.2 m/s", { unit: "м/с", basis: "Максимальная скорость перемещения; не подтверждает скорость влажной уборки." }),
    operatingConditions: official("Мойка, подметание, уборка пылесосом и сухая протирка; режим и насадки выбираются отдельно.", CLEANING_VENDOR_SOURCES.pudu, "Sweeping/Mopping/Scrubbing/Vacuuming"),
    limitations: unknown("Не смешивать CC1 и CC1 Pro. Станции и насадки зависят от комплектации; производительность и локальный сервис подтвердить на объекте.", "Официальная карточка CC1 отдельно указывает приобретаемые станции; полевые замеры и КП не предоставлены."),
  }, "Уборщик PUDU CC1. Паспорт производителя показан отдельно от ещё не предоставленных полевых замеров; цены покупки и аренды требуют КП."),
  product("agibot-c5", "AGIBOT C5", "AGIBOT Innovation (Shanghai) Technology Co., Ltd.", CLEANING_VENDOR_SOURCES.agibot, {
    manufacturerCountry: official("Китай — адрес производителя в Шанхае; происхождение конкретной поставки уточняется отдельно", "https://store.agibot.com/policies/contact-information", "Shanghai, China"),
    throughput: official({ max: 1980, typical: 1980, qualifier: "до" }, CLEANING_VENDOR_SOURCES.agibot, "1980 m²/h", { unit: "м²/ч", scope: "per-robot", basis: "Производитель указывает максимум; без измерения или явной оценки это не рабочая выработка." }),
    autonomyH: official(3, CLEANING_VENDOR_SOURCES.agibot, "3 h", { unit: "ч", basis: "Заявленная автономность в режиме мойки. Время зарядки на просмотренной карточке не установлено." }),
    navigation: official(["Лазерная и визуальная локализация"], CLEANING_VENDOR_SOURCES.agibot, "Laser-Vision Fusion Positioning Technology"),
    operatingConditions: official("Мойка, подметание и сухая протирка; рабочая станция может выполнять зарядку, подачу и слив воды.", CLEANING_VENDOR_SOURCES.agibot, "Sweeping, Scrubing, Dust mopping"),
    limitations: unknown("Ресурс вентилятора 10 000 ч не равен сроку службы робота. Размеры рабочей станции не являются размерами C5. Цены, зарядку и сервис подтвердить.", "Разделы официальной страницы отдельно описывают вентилятор и рабочую станцию. Полевые замеры и КП не предоставлены."),
  }, "Промышленный уборщик AGIBOT C5. Сохранён паспортный максимум; фактическая выработка, цены и местные условия обслуживания пока не подтверждены."),
  product("viggo-sc80", "VIGGO SC80", "VIGGO", CLEANING_VENDOR_SOURCES.viggo, {
    manufacturerCountry: official("Китай — китайский бренд компании из Пекина; происхождение конкретной поставки уточняется отдельно", "https://www.viggorobot.com/about-viggo/", "one of the first brands in China"),
    throughput: official({ max: 4000, typical: 4000, qualifier: "до" }, CLEANING_VENDOR_SOURCES.viggo, "4000㎡/h", { unit: "м²/ч", scope: "per-robot", basis: "Паспортный максимум, а не замер Альфа-Сервис." }),
    dimensionsMm: official("1340 × 1024 × 1350", CLEANING_VENDOR_SOURCES.viggo, "1340（L）*1024（W）*1350（H）mm", { unit: "мм", basis: "Именно столбец SC80; SC80S/SC80Pro не объединены с этой моделью." }),
    massKg: official(400, CLEANING_VENDOR_SOURCES.viggo, "400Kg", { unit: "кг" }),
    autonomyH: official({ min: 4, max: 6, typical: 4 }, CLEANING_VENDOR_SOURCES.viggo, "4~6h", { unit: "ч", basis: "Для справочной оценки взята нижняя граница опубликованной автономности; режим и фактический цикл не подтверждены." }),
    limitations: unknown("Не отождествлять с АК-SC80/Автомакон без подтверждения. На странице противоречат друг другу общий объём баков 210 л и таблица 140+170 л; водяной цикл не рассчитан.", "Официальная страница содержит несколько модификаций и противоречие по бакам. Нужны паспорт конкретной комплектации, КП и полевые измерения."),
  }, "Уборщик VIGGO SC80 по официальной карточке. Отдельная модель без автоматического отождествления с АК-SC80; цены и фактические циклы требуют проверки."),
];
