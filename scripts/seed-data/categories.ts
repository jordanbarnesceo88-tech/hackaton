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
};

export const CATEGORIES: CategorySeed[] = [
  {
    "slug": "amr",
    "name": "Автономные мобильные роботы (AMR)",
    "description": "Мобильные роботы для перемещения товаров между зонами склада без выделенных путей",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "asrs",
    "name": "Автоматизированные системы хранения (AS/RS)",
    "description": "Автоматизированные стеллажные системы для хранения и подбора товаров",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "baggage-robots",
    "name": "Роботы для обработки багажа",
    "description": "Роботизированные системы сортировки и перемещения багажа",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "autonomous-tugs",
    "name": "Автономные тягачи",
    "description": "Автономные тягачи для перемещения багажных тележек и контейнеров",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "med-delivery",
    "name": "Роботы доставки медикаментов",
    "description": "Роботы для доставки медикаментов и расходных материалов по учреждению",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "disinfection",
    "name": "Роботы дезинфекции",
    "description": "Автономные роботы для дезинфекции помещений",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "generic-mobile",
    "name": "Универсальный мобильный робот",
    "description": "Универсальный мобильный робот для произвольных объектов",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "generic-fixed",
    "name": "Универсальная стационарная автоматизация",
    "description": "Универсальная стационарная роботизированная система",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "class-amr-transport",
    "name": "AMR: транспортировка и подбор",
    "description": "Мобильные роботы, перевозящие товар и полки к оператору; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "class-palletizer",
    "name": "Роботы-паллетайзеры",
    "description": "Укладка коробок и мешков на паллеты; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "class-sorter",
    "name": "Сортировочные роботы",
    "description": "Роботизированная сортировка посылок и мелких грузов; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "class-cleaning",
    "name": "Роботы-уборщики",
    "description": "Автономная уборка больших площадей; класс, а не конкретная модель",
    workloadStream: WorkloadStream.FLOOR_AREA
  },
  {
    "slug": "class-cobot-pickplace",
    "name": "Коботы pick-and-place",
    "description": "Коллаборативные манипуляторы на переносе и упаковке; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "class-service-delivery",
    "name": "Сервисные роботы доставки",
    "description": "Внутренняя доставка по зданию; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW
  },
  {
    "slug": "class-ai-inspection",
    "name": "ИИ-инспекция качества",
    "description": "Машинное зрение на контроле качества; класс, а не конкретная модель",
    workloadStream: WorkloadStream.OPERATION_FLOW
  }
];
