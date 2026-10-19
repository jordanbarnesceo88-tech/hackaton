/** Public OEM material is evidence of its own scope, never a site acceptance or service contract. */
export type ImplementationResource = {
  id: string;
  title: string;
  kind: "manual" | "specification" | "brochure" | "case-study";
  url: string;
  checkedAt: string;
  manufacturer: string;
  models: string[];
  solutionTypes: string[];
  summary: string;
  sections: string[];
  limits: string[];
};

export const RESOURCE_KIND_LABELS: Record<ImplementationResource["kind"], string> = {
  manual: "Руководство производителя",
  specification: "Спецификация производителя",
  brochure: "Брошюра производителя",
  "case-study": "Кейс производителя",
};

type Entry = { resource: ImplementationResource; manufacturerAliases: string[]; modelAliases: string[] };
const checkedAt = "2026-10-18";
const ronavi = ["Ronavi", "Ronavi Robotics", 'ООО "Ронави Роботикс"'];
const pudu = ["Pudu", "Pudu Robotics", "Shenzhen Pudu Technology Co., Ltd."];
const robocv = ["RoboCV", 'ООО "Робосиви"'];
const dikom = ["ДиКом", "Диком-Сервис", 'ООО "Диком-Сервис"'];
const specificationLimit = "Публичная спецификация не заменяет руководство эксплуатации, обследование объекта или согласованную программу испытаний.";

const entries: Entry[] = [
  {
    manufacturerAliases: ronavi,
    modelAliases: ["Ronavi H1500 (грузоподъемность до 1 500 кг)"],
    resource: {
      id: "ronavi-h1500-spec", title: "Ronavi H1500: назначение и технические характеристики", kind: "specification",
      url: "https://ronavi-robotics.ru/catalogue/h1500", checkedAt, manufacturer: "Ronavi Robotics", models: ["Ronavi H1500"], solutionTypes: ["pallet-amr"],
      summary: "Перемещение паллет, мобильных стеллажей, тележек и конвейерных модулей; опубликованы масса, габариты, нагрузка, навигация и связь.",
      sections: ["Технические характеристики Ronavi H1500", "Назначение и интеграция с WMS/MES"],
      limits: [specificationLimit, "Проезд 750 мм указан для робота; пригодность прохода для полного носителя и встречного движения этим не доказана. До 10 ч относится к окну заряда 80–20%, а не к гарантированной смене."],
    },
  },
  {
    manufacturerAliases: ronavi,
    modelAliases: ["Ronavi H2000 (грузоподъемность до 2 000 кг)"],
    resource: {
      id: "ronavi-h2000-spec", title: "Ronavi H2000: производственные грузы и гибкий конвейер", kind: "specification",
      url: "https://ronavi-robotics.ru/catalogue/h2000", checkedAt, manufacturer: "Ronavi Robotics", models: ["Ronavi H2000"], solutionTypes: ["pallet-amr"],
      summary: "Модель для грузов до 2 т, производственных столов и конвейерных модулей; опубликованы размеры, скорость, минимальный проезд и интерфейсы.",
      sections: ["Технические характеристики", "Отличие H2000 от H1500"],
      limits: [specificationLimit, "Характеристики H1500 не переносятся на H2000: на этой странице указаны другая геометрия и максимальная скорость 1 м/с. Подробная спецификация запрашивается у производителя."],
    },
  },
  {
    manufacturerAliases: ronavi,
    modelAliases: ["Ronavi M (грузоподъемность до 1200 кг)"],
    resource: {
      id: "ronavi-m-spec", title: "Ronavi M: подвоз мобильных стеллажей к станции", kind: "specification",
      url: "https://ronavi-robotics.ru/catalogue/m", checkedAt, manufacturer: "Ronavi Robotics", models: ["Ronavi M"], solutionTypes: ["tote-amr", "g2p"],
      summary: "Описан процесс «товар к человеку», перенос мобильного стеллажа и интеграция с WMS. Есть таблица параметров и требования подготовки склада.",
      sections: ["Технические характеристики Ronavi M", "Подготовка склада", "Интеграция с WMS"],
      limits: [specificationLimit, "На странице несколько грузовых конфигураций. Допуск конкретного носителя, нижний просвет, его масса и центр тяжести требуют согласования; маркетинговые проценты экономии не являются замером объекта."],
    },
  },
  {
    manufacturerAliases: ronavi,
    modelAliases: ["Ronavi SR (грузоподъемность до 50 кг)"],
    resource: {
      id: "ronavi-sr-spec", title: "Ronavi SR: сортировка конвейерным модулем", kind: "specification",
      url: "https://ronavi-robotics.ru/catalogue/sr", checkedAt, manufacturer: "Ronavi Robotics", models: ["Ronavi SR"], solutionTypes: ["sorter"],
      summary: "Сортировочный робот с конвейерным модулем и опциональной высотой; источник описывает перемещение грузов до 50 кг.",
      sections: ["Технические характеристики Ronavi SR", "Назначение сортировщика"],
      limits: [specificationLimit, "Нагрузку и высоту стыковки нужно сверить с конфигурацией станций. Скорость отдельного робота не равна пропускной способности всей сортировочной линии."],
    },
  },
  {
    manufacturerAliases: ronavi,
    modelAliases: ["Ronavi SD (грузоподъемность до 10 кг)"],
    resource: {
      id: "ronavi-sd-spec", title: "Ronavi SD: сортировка посылок откидной платформой", kind: "specification",
      url: "https://ronavi-robotics.ru/catalogue/sd", checkedAt, manufacturer: "Ronavi Robotics", models: ["Ronavi SD"], solutionTypes: ["sorter"],
      summary: "Описаны робот для небольших отправлений до 10 кг, откидная платформа и технические характеристики модели.",
      sections: ["Технические характеристики Ronavi SD", "Сортировка посылок и писем"],
      limits: [specificationLimit, "Это отдельная модель, не SR: груз, исполнительный механизм и станции различаются. Обработка входного потока и исключений требует испытания всей линии."],
    },
  },
  {
    manufacturerAliases: pudu, modelAliases: ["CC1"],
    resource: {
      id: "pudu-cc1-operation-v6", title: "PUDU CC1: Operation Guide V6.0", kind: "manual",
      url: "https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6", checkedAt, manufacturer: "Pudu Robotics", models: ["PUDU CC1"], solutionTypes: ["cleaner"],
      summary: "Официальное руководство для CCBC01/CCBC01N: назначение, безопасность, уборка, вода/зарядка, обслуживание расходников и ошибки. История изменений содержит редакцию 13.03.2026.",
      sections: ["§1–2: назначение, безопасность и среда (стр. 7–9)", "§4: задачи, режимы, вода и зарядка (стр. 15–36)", "§5.1–5.3: очистка, расходники и неисправности (стр. 40–49)"],
      limits: ["Проверить соответствие CCBC01/CCBC01N, комплектации и версии ПО поставленного робота. CC1 Pro этим руководством не покрыт.", "Для ровных помещений с лёгким загрязнением: 0–40 °C, выступы до 8 мм при уборке и до 20 мм только при проезде; проход более 70 см, в длинном коридоре рекомендовано более 75 см. Это не проверка встречного движения.", "Рабочая станция и комплекты самообслуживания опциональны; наличие SLA на объект не подтверждено."],
    },
  },
  {
    manufacturerAliases: ["AGIBOT", "AGIBOT Innovation (Shanghai) Technology Co., Ltd."], modelAliases: ["C5"],
    resource: {
      id: "agibot-c5-spec", title: "AGIBOT C5: режимы и рабочая станция", kind: "specification",
      url: "https://www.agibot.com/products/C5", checkedAt, manufacturer: "AGIBOT Innovation (Shanghai) Technology Co., Ltd.", models: ["AGIBOT C5"], solutionTypes: ["cleaner"],
      summary: "Параметры мойки и автономности, ширина обработки, бак и функции станции. Описаны связь с лифтом/доступом и отчёты о заданиях.",
      sections: ["AGIBOT C5: параметры", "Key Features", "Workstation Introduction"],
      limits: [specificationLimit, "1980 м²/ч указано как максимум. Публичное руководство C5, интервалы ТО и условия конкретной установки станции при этой проверке не установлены. Документы других AGIBOT-моделей не применяются к C5."],
    },
  },
  {
    manufacturerAliases: ["VIGGO"], modelAliases: ["SC80"],
    resource: {
      id: "viggo-sc80-spec", title: "VIGGO SC80: параметры отдельной конфигурации", kind: "specification",
      url: "https://www.viggorobot.com/autonomous-cleaning-machines/viggo-sc80.html", checkedAt, manufacturer: "VIGGO", models: ["VIGGO SC80"], solutionTypes: ["cleaner"],
      summary: "В сравнительной таблице производителя выделены SC80, SC80S и SC80Pro: габариты, ширина мойки, баки, автономность и сенсоры.",
      sections: ["Parameter Specifications: столбец SC80", "Applicable Ground"],
      limits: [specificationLimit, "SC80S и SC80Pro не включены в область этой записи. 4000 м²/ч — максимальная эффективность, не принятая площадь за смену; публичный регламент ТО SC80 не установлен."],
    },
  },
  {
    manufacturerAliases: robocv, modelAliases: [],
    resource: {
      id: "robocv-fork-spec", title: "RoboCV: робот-штабелёр, спецификация и процесс", kind: "specification",
      url: "https://robocv.ru/robot-shtabelyor", checkedAt, manufacturer: "RoboCV", models: ["Робот-штабелёр RoboCV"], solutionTypes: ["fmr"],
      summary: "Опубликованы геометрия, грузоподъёмность, высота подъёма, требования к положению паллеты, развороту и движению с другими участниками.",
      sections: ["Технические характеристики", "Взаимодействие с движущимися объектами", "Обработка паллет"],
      limits: [specificationLimit, "Высота подъёма и исполнение зависят от базовой машины. Нужны её паспорт, остаточная грузоподъёмность на высоте и инструкции; страница не даёт готового регламента ТО."],
    },
  },
  {
    manufacturerAliases: robocv, modelAliases: [],
    resource: {
      id: "robocv-tug-spec", title: "RoboCV: робот-тягач, маршрут и тележки", kind: "specification",
      url: "https://robocv.ru/robot-tyagach", checkedAt, manufacturer: "RoboCV", models: ["Робот-тягач RoboCV"], solutionTypes: ["tug"],
      summary: "Описаны движение поезда тележек, варианты запуска с остановки, настройка участков маршрута и последовательный пропуск при конфликте.",
      sections: ["Технические характеристики", "Принцип работы роботов-тягачей", "Управление участками маршрута"],
      limits: [specificationLimit, "Публичная статья датирована 06.02.2020; актуальное исполнение требуется подтвердить у поставщика. Нельзя считать массу состава допуском для любой сцепки, поворота или уклона."],
    },
  },
  {
    manufacturerAliases: ["Pudu Robotics", "Pudu", "Shenzhen Pudu Technology Co., Ltd."], modelAliases: ["PUDU PuduBot 2"],
    resource: {
      id: "pudubot2-operation-v12-2", title: "PuduBot 2: Operation Guide V12.2", kind: "manual",
      url: "https://resource-wangsu.helplook.net/docker_production/r7bv6l/article/lb3JqQ/attachments/PuduBot2_Operation_Guide_V12.2-231117.pdf", checkedAt, manufacturer: "Pudu Robotics", models: ["PuduBot 2"], solutionTypes: ["delivery"],
      summary: "Руководство PDFD12/PDFD22: безопасность, доставка, настройка карт и зарядки, установка подносов, диагностика и уход.",
      sections: ["§1: рабочая среда и безопасность (стр. 5–7)", "§3: задания, настройки и стыковка (стр. 12–49)", "§4–5: неисправности и уход (стр. 50–53)"],
      limits: ["OEM-файл на CDN PUDU Academy; V12.2 относится к PDFD12/PDFD22. Перед применением проверить аппаратную и программную версию, не переносить на PuduBot первого поколения.", "§1.3: одиночный проезд от 0,8 м; встречный рекомендован более 2 м, иначе пропуск по очереди. В помещении уклон менее 5°, выступы не более 1 см. Это условия указанной редакции, не согласование объекта.", "Правила перевозки медицинских грузов и дезинфекции этим документом не подтверждены."],
    },
  },
  {
    manufacturerAliases: ["Завод Стелкон", "Стелкон", 'ООО "Завод Стелкон"'], modelAliases: ["СТЕЛКОН Pallet Shuttle"],
    resource: {
      id: "stelkon-pallet-shuttle-spec", title: "СТЕЛКОН Pallet Shuttle: каналы, носители и FIFO/LIFO", kind: "specification",
      url: "https://www.stelkon.ru/catalog/palletnye-stellazhi/pallet/", checkedAt, manufacturer: "Завод Стелкон", models: ["Pallet Shuttle"], solutionTypes: ["pallet-shuttle"],
      summary: "Описаны рельсовая система, работа под паллетами, загрузка края канала погрузчиком и варианты FIFO/LIFO; состав техники определяется потоком.",
      sections: ["Характеристики и конструкция", "Виды погрузочно-разгрузочной зоны"],
      limits: [specificationLimit, "Страница относится к системе хранения, не универсальному напольному AMR. Исполнение для холода и геометрию паллет согласовать отдельно; руководство и численный график ТО не установлены."],
    },
  },
  {
    manufacturerAliases: ["АРС", "АРС Смарт Роботикс", "ARS Smart Robotics", 'ООО "АРС"', 'ООО "АРС Смарт Роботикс"'], modelAliases: ["ARS SmartCube"],
    resource: {
      id: "ars-smartcube-mines-spec", title: "ARS SmartCube: шахты, доступ к ящикам и осмотры", kind: "specification",
      url: "https://arobosys.ru/mines", checkedAt, manufacturer: "АРС Смарт Роботикс", models: ["SmartCube"], solutionTypes: ["g2p"],
      summary: "Модельная страница шахт объясняет свободные верхние уровни для доступа к нижним ящикам, размещение системы и проверки несущей конструкции.",
      sections: ["Технические характеристики шахт", "FAQ: обслуживание и доступ к нижним уровням"],
      limits: [specificationLimit, "Эта страница описывает шахты до 6 м, главная сайта — до 14 м: версия/конфигурация не согласована. Не переносить ни одну высоту в проект без подтверждения; FAQ об осмотрах не является полным руководством системы."],
    },
  },
  {
    manufacturerAliases: ["Яндекс Роботикс", "Yandex Robotics", 'ООО "Яндекс Роботикс"'], modelAliases: ["Робот-инвентаризатор"],
    resource: {
      id: "yandex-inventory-market-case", title: "Яндекс Роботикс: инвентаризация на складе Маркета", kind: "case-study",
      url: "https://robotics.yandex.ru/cases/market-inv", checkedAt, manufacturer: "Яндекс Роботикс", models: ["Робот инвентаризатор"], solutionTypes: ["inventory"],
      summary: "Первичное описание внедрения на складе крупногабаритных товаров: сканирование паллет, сверка меток и передача расхождений в WMS.",
      sections: ["Задача, решение и результат", "Процесс ежедневной инвентаризации"],
      limits: ["Это кейс производителя для одного объекта, а не руководство, паспорт или независимое полевое исследование. Его сроки и результаты нельзя гарантировать другому складу; версия оборудования не названа."],
    },
  },
  {
    manufacturerAliases: dikom, modelAliases: ["ДиКом AS-RS P"],
    resource: {
      id: "dikom-as-rs-p-brochure", title: "ДиКом AS-RS P: буклет паллетного склада", kind: "brochure",
      url: "https://khvrptyuackxdmxadmin.dikom-a.ru/wp-content/uploads/2025/10/buklet-as-rs-p-ot-23.04.2026-szhatyj.pdf", checkedAt, manufacturer: "ДиКом", models: ["AS-RS P"], solutionTypes: ["pallet-asrs"],
      summary: "Буклет производителя со схемой склада, составом кран-штабелёра, зонами выдачи, ограждениями и вариантами телескопических вил SD/DD для паллет.",
      sections: ["Стр. 1: конструкция, параметры и варианты комплектации", "Стр. 2: общий вид системы и контакты производителя"],
      limits: ["Это техническая брошюра, не руководство эксплуатации и не регламент ТО. Файл опубликован в материалах официальной страницы dikom-a.ru/product/dikom-as-rs-p.", "В описании буклета горизонтальная скорость 2 м/с, в таблице — до 3 м/с: применимую конфигурацию подтвердить у производителя. Тип паллет, нагрузку, высоту и зоны безопасности согласовать в проекте; параметры AS-RS P не переносятся на AS-RS B."],
    },
  },
  {
    manufacturerAliases: dikom, modelAliases: ["ДиКом AS-RS B"],
    resource: {
      id: "dikom-as-rs-b-brochure", title: "ДиКом AS-RS B: буклет склада для ящиков KLT", kind: "brochure",
      url: "https://khvrptyuackxdmxadmin.dikom-a.ru/wp-content/uploads/2026/06/buklet-as-rs-b-lyogkij-dlya-sajta.pdf", checkedAt, manufacturer: "ДиКом", models: ["AS-RS B"], solutionTypes: ["g2p"],
      summary: "Показаны робот-штабелёр, стеллажи, ограждение, система передачи KLT-ящиков и мобильный DMR 50, зона выдачи и элементы системы.",
      sections: ["Стр. 1: состав системы, особенности конструкции и тара", "Стр. 2: общий вид системы и контакты производителя"],
      limits: ["Это брошюра, не инструкция запуска, безопасного восстановления или ТО. Файл связан с официальной страницей dikom-a.ru/product/dikom-as-rs-b.", "В буклете указаны ящики 600×400×220/340/420 мм, нагрузка робота-штабелёра 30 кг и высота до 12 м; комплектацию согласовать отдельно. Температурный диапазон AS-RS P не является допуском AS-RS B."],
    },
  },
  {
    manufacturerAliases: ["СМП Сервис", "СМП-Сервис", 'ООО "СМП Сервис"'],
    // The organizer's family entry already identifies this exact 5.1/5.2 source; never infer newer T5.3 compatibility.
    modelAliases: ["Трал Патруль 5"],
    resource: {
      id: "smp-tral-patrol-5-1-spec", title: "Трал Патруль 5: исполнения 5.1/5.2 и IP", kind: "specification",
      url: "https://www.tral.ru/production/ohrannij-robot/tral-patrul5-1/", checkedAt, manufacturer: "СМП Сервис", models: ["Трал Патруль 5.1", "Трал Патруль 5.2", "Трал Патруль 5.1 IP", "Трал Патруль 5.2 IP"], solutionTypes: ["patrol"],
      summary: "Официальная модельная страница СМП Сервис: маршрут, автоматическая зарядка, передача видео оператору и сравнение исполнений пятой серии.",
      sections: ["Описание и основные особенности", "Сравнение 5.1, 5.2, 5.1 IP, 5.2 IP", "Технические характеристики и зарядная станция"],
      limits: [specificationLimit, "В каталоге указано семейство «Трал Патруль 5»; перед пилотом установить точное исполнение. В таблице отличаются камеры, видеоаналитика и расчётная автономность. Документ не распространяется на T5.3 или седьмую серию; готовность распознавания и связь проверяются на объекте."],
    },
  },
  {
    manufacturerAliases: ["Evocargo", "Эвокарго", 'ООО "Эвокарго"'], modelAliases: [],
    resource: {
      id: "evocargo-n1-marvel-case", title: "EVOCARGO N1: перевозки на объекте Марвел-Логистика", kind: "case-study",
      url: "https://www.evocargo.com/implementations/detail/marvel-logistika-nachala-ispolzovanie-elektrogruzovikov-evocargo/", checkedAt, manufacturer: "Эвокарго", models: ["EVOCARGO N1"], solutionTypes: ["yard"],
      summary: "Поставщик описывает применение N1 для перевозки оборудования и материалов между точками складского объекта.",
      sections: ["Задача внутритерриториальной перевозки", "Описание внедрения N1"],
      limits: ["Кейс не является эксплуатационным руководством, допуском на дороги общего пользования или гарантией доступности. Маршрут, груз и безопасность конкретной территории требуют отдельного согласования."],
    },
  },
];

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

/** Class examples are separate from a product's exact manufacturer-and-model attribution. */
export function implementationResources(solutionType: string, manufacturer?: string | null, modelName?: string | null): ImplementationResource[] {
  const byClass = manufacturer == null && modelName == null;
  if (!byClass && (!manufacturer?.trim() || !modelName?.trim())) return [];
  return structuredClone(entries.filter(entry => {
    if (!entry.resource.solutionTypes.includes(solutionType)) return false;
    if (byClass) return true;
    const models = [...entry.resource.models, ...entry.modelAliases];
    return models.some(model => normalized(model) === normalized(modelName!))
      && entry.manufacturerAliases.some(alias => normalized(alias) === normalized(manufacturer!));
  }).map(entry => entry.resource));
}
