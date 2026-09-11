import { WorkloadStream } from "@prisma/client";

/** Глобальный каталог видов решений. Раньше категория принадлежала одному типу объекта;
 *  теперь применимость выражается отдельно (applicability.ts).
 *
 *  Категории с префиксом class- содержат не вендорские модели, а классы решений: обобщённые
 *  виды техники с диапазонами вместо точных цифр.
 *
 *  workloadStream задаётся ЯВНО у каждой категории. В схеме у поля есть значение по умолчанию,
 *  но оно существует ради миграции существующих строк, а не ради авторов данных: категория,
 *  молча унаследовавшая поток операций, — это ровно тот баг, из-за которого робот-уборщик
 *  «замещал» сорок складских сотрудников. */
export type CategorySeed = {
  slug: string;
  name: string;
  description: string;
  workloadStream: WorkloadStream;
  /** Название РАБОТЫ, а не техники: человек выбирает «Паллетирование коробок». */
  taskLabel: string;
  /** Норматив выработки человека — ТОЛЬКО для предзаполнения занятости. Движок не читает. */
  workerOutputPerYear?: number;
  /** Источник норматива. Без него норматив не заводится. */
  workerOutputSourceUrl?: string;
};

export const CATEGORIES: CategorySeed[] = [
  {
    "slug": "amr",
    "name": "Автономные мобильные роботы (AMR)",
    "description": "Мобильные роботы для перемещения товаров между зонами склада без выделенных путей",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Перемещение товара между зонами"
  },
  {
    "slug": "asrs",
    "name": "Автоматизированные системы хранения (AS/RS)",
    "description": "Автоматизированные стеллажные системы для хранения и подбора товаров",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Хранение и подача товара"
  },
  {
    "slug": "baggage-robots",
    "name": "Роботы для обработки багажа",
    "description": "Роботизированные системы сортировки и перемещения багажа",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Обработка багажа"
  },
  {
    "slug": "autonomous-tugs",
    "name": "Автономные тягачи",
    "description": "Автономные тягачи для перемещения багажных тележек и контейнеров",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Буксировка тележек и паллет"
  },
  {
    "slug": "med-delivery",
    "name": "Роботы доставки медикаментов",
    "description": "Роботы для доставки медикаментов и расходных материалов по учреждению",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Доставка медикаментов по отделениям"
  },
  {
    "slug": "disinfection",
    "name": "Роботы дезинфекции",
    "description": "Автономные роботы для дезинфекции помещений",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Дезинфекция помещений"
  },
  {
    "slug": "generic-mobile",
    "name": "Универсальный мобильный робот",
    "description": "Универсальный мобильный робот для произвольных объектов",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Перевозка грузов внутри объекта"
  },
  {
    "slug": "generic-fixed",
    "name": "Универсальная стационарная автоматизация",
    "description": "Универсальная стационарная роботизированная система",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Стационарные операции на линии"
  },
  {
    "slug": "class-amr-transport",
    "name": "AMR: транспортировка и подбор",
    "description": "Мобильные роботы, перевозящие товар и полки к оператору; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Отбор и транспортировка заказов",
    // 100 отборов/час — центр диапазона 80–120 для смешанного отбора x 2000 ч
    workerOutputPerYear: 200000,
    workerOutputSourceUrl:
      "https://cognitops.com/warehouse-pick-rate-benchmarks-by-industry/"
  },
  {
    "slug": "class-palletizer",
    "name": "Роботы-паллетайзеры",
    "description": "Укладка коробок и мешков на паллеты; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Паллетирование коробок"
  },
  {
    "slug": "class-sorter",
    "name": "Сортировочные роботы",
    "description": "Роботизированная сортировка посылок и мелких грузов; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Сортировка посылок",
    // 250 посылок/час — центр диапазона 200–300 на человека x 2000 ч
    workerOutputPerYear: 500000,
    workerOutputSourceUrl:
      "https://www.tompkinsrobotics.com/blog/why-your-as/rs-needs-a-sortation-system-to-be-effective"
  },
  {
    "slug": "class-cleaning",
    "name": "Роботы-уборщики",
    "description": "Автономная уборка больших площадей; класс, а не конкретная модель",
    workloadStream: WorkloadStream.FLOOR_AREA,
    taskLabel: "Уборка полов",
    // ISSA Cleaning Times: 28 000 ft2/FTE за смену (уровень 2) = 2601 м2 x 250 смен
    workerOutputPerYear: 650250,
    workerOutputSourceUrl:
      "https://www.mastercleanhq.com/blog/commercial-cleaning-industry-benchmarks-staffing-frequency"
  },
  {
    "slug": "class-cobot-pickplace",
    "name": "Коботы pick-and-place",
    "description": "Коллаборативные манипуляторы на переносе и упаковке; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Перекладка изделий на линии"
  },
  {
    "slug": "class-service-delivery",
    "name": "Сервисные роботы доставки",
    "description": "Внутренняя доставка по зданию; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Разнос заказов и вещей"
  },
  {
    "slug": "class-ai-inspection",
    "name": "ИИ-инспекция качества",
    "description": "Машинное зрение на контроле качества; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW,
    taskLabel: "Контроль качества продукции"
  }
];
