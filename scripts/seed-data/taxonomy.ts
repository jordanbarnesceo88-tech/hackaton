/** Отрасли и типы объектов. Категории решений живут отдельно: одна категория обслуживает
 *  много типов объектов, и связь между ними — в applicability.ts.
 *
 *  Slug'и первых четырёх типов объектов (warehouse, airport, medical, other) и их отраслей
 *  МЕНЯТЬ НЕЛЬЗЯ: SavedAnalysis.facilityTypeSlug — это строка, а не внешний ключ, и
 *  переименование молча осиротит уже сохранённые расчёты. */
export type FacilityTypeSeed = { slug: string; name: string; isGeneric: boolean };
export type IndustrySeed = { slug: string; name: string; facilityTypes: FacilityTypeSeed[] };

export const INDUSTRIES: IndustrySeed[] = [
  {
    "slug": "retail",
    "name": "Торговля и e-commerce",
    "facilityTypes": [
      {
        "slug": "warehouse",
        "name": "Склад",
        "isGeneric": false
      },
      {
        "slug": "fulfillment",
        "name": "Фулфилмент-центр",
        "isGeneric": false
      },
      {
        "slug": "darkstore",
        "name": "Даркстор",
        "isGeneric": false
      },
      {
        "slug": "cold-storage",
        "name": "Холодильный склад",
        "isGeneric": false
      },
      {
        "slug": "retail-generic",
        "name": "Другой объект торговли",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "logistics",
    "name": "Логистика и транспорт",
    "facilityTypes": [
      {
        "slug": "airport",
        "name": "Аэропорт",
        "isGeneric": false
      },
      {
        "slug": "distribution-center",
        "name": "Распределительный центр",
        "isGeneric": false
      },
      {
        "slug": "parcel-hub",
        "name": "Сортировочный хаб",
        "isGeneric": false
      },
      {
        "slug": "port-terminal",
        "name": "Портовый терминал",
        "isGeneric": false
      },
      {
        "slug": "rail-terminal",
        "name": "Железнодорожный терминал",
        "isGeneric": false
      },
      {
        "slug": "logistics-generic",
        "name": "Другой логистический объект",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "social",
    "name": "Здравоохранение",
    "facilityTypes": [
      {
        "slug": "medical",
        "name": "Больница",
        "isGeneric": false
      },
      {
        "slug": "clinic",
        "name": "Поликлиника",
        "isGeneric": false
      },
      {
        "slug": "lab",
        "name": "Лаборатория",
        "isGeneric": false
      },
      {
        "slug": "pharmacy-warehouse",
        "name": "Аптечный склад",
        "isGeneric": false
      },
      {
        "slug": "social-generic",
        "name": "Другой объект здравоохранения",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "manufacturing",
    "name": "Дискретное производство",
    "facilityTypes": [
      {
        "slug": "assembly-plant",
        "name": "Сборочный завод",
        "isGeneric": false
      },
      {
        "slug": "machining-shop",
        "name": "Механообрабатывающий цех",
        "isGeneric": false
      },
      {
        "slug": "electronics-plant",
        "name": "Производство электроники",
        "isGeneric": false
      },
      {
        "slug": "paint-shop",
        "name": "Окрасочный цех",
        "isGeneric": false
      },
      {
        "slug": "manufacturing-generic",
        "name": "Другое производство",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "food",
    "name": "Пищевое производство",
    "facilityTypes": [
      {
        "slug": "food-processing",
        "name": "Пищевой цех",
        "isGeneric": false
      },
      {
        "slug": "bakery",
        "name": "Хлебопекарное производство",
        "isGeneric": false
      },
      {
        "slug": "dairy-plant",
        "name": "Молочный завод",
        "isGeneric": false
      },
      {
        "slug": "meat-processing",
        "name": "Мясопереработка",
        "isGeneric": false
      },
      {
        "slug": "food-generic",
        "name": "Другое пищевое производство",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "pharma",
    "name": "Фармацевтика",
    "facilityTypes": [
      {
        "slug": "pharma-plant",
        "name": "Фармацевтический завод",
        "isGeneric": false
      },
      {
        "slug": "cleanroom",
        "name": "Чистое помещение",
        "isGeneric": false
      },
      {
        "slug": "pharma-warehouse",
        "name": "Фармацевтический склад",
        "isGeneric": false
      },
      {
        "slug": "pharma-generic",
        "name": "Другой объект фармацевтики",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "agriculture",
    "name": "Сельское хозяйство",
    "facilityTypes": [
      {
        "slug": "greenhouse",
        "name": "Тепличный комплекс",
        "isGeneric": false
      },
      {
        "slug": "grain-elevator",
        "name": "Элеватор",
        "isGeneric": false
      },
      {
        "slug": "poultry-farm",
        "name": "Птицефабрика",
        "isGeneric": false
      },
      {
        "slug": "agriculture-generic",
        "name": "Другой агрообъект",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "mining",
    "name": "Горнодобыча",
    "facilityTypes": [
      {
        "slug": "ore-processing",
        "name": "Обогатительная фабрика",
        "isGeneric": false
      },
      {
        "slug": "mine-warehouse",
        "name": "Рудничный склад",
        "isGeneric": false
      },
      {
        "slug": "mining-generic",
        "name": "Другой объект горнодобычи",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "construction",
    "name": "Строительство",
    "facilityTypes": [
      {
        "slug": "precast-plant",
        "name": "Завод ЖБИ",
        "isGeneric": false
      },
      {
        "slug": "construction-generic",
        "name": "Другой объект стройиндустрии",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "utilities",
    "name": "Коммунальное хозяйство",
    "facilityTypes": [
      {
        "slug": "waste-sorting",
        "name": "Мусоросортировочный комплекс",
        "isGeneric": false
      },
      {
        "slug": "water-treatment",
        "name": "Водоочистная станция",
        "isGeneric": false
      },
      {
        "slug": "utilities-generic",
        "name": "Другой коммунальный объект",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "hospitality",
    "name": "Гостеприимство",
    "facilityTypes": [
      {
        "slug": "hotel",
        "name": "Отель",
        "isGeneric": false
      },
      {
        "slug": "restaurant-kitchen",
        "name": "Ресторанная кухня",
        "isGeneric": false
      },
      {
        "slug": "conference-center",
        "name": "Конгресс-центр",
        "isGeneric": false
      },
      {
        "slug": "hospitality-generic",
        "name": "Другой объект гостеприимства",
        "isGeneric": true
      }
    ]
  },
  {
    "slug": "other",
    "name": "Другое",
    "facilityTypes": [
      {
        "slug": "other",
        "name": "Другой объект",
        "isGeneric": true
      }
    ]
  }
];

/** Типовые параметры объекта: ориентир, с которого начинается шаг ввода, а не утверждение о
 *  чьём-то конкретном объекте. Пользователь правит их, и именно поэтому пустые поля здесь
 *  хуже приблизительных: с нуля человек не знает, что вводить, и уходит. */
export type TypicalParams = { areaM2: number; opsPerDay: number; staffCount: number };

export const TYPICAL_PARAMS: Record<string, TypicalParams> = {
  "warehouse": {
    "areaM2": 10000,
    "opsPerDay": 5000,
    "staffCount": 40
  },
  "fulfillment": {
    "areaM2": 20000,
    "opsPerDay": 12000,
    "staffCount": 90
  },
  "darkstore": {
    "areaM2": 800,
    "opsPerDay": 1500,
    "staffCount": 14
  },
  "cold-storage": {
    "areaM2": 6000,
    "opsPerDay": 2500,
    "staffCount": 30
  },
  "retail-generic": {
    "areaM2": 3000,
    "opsPerDay": 1200,
    "staffCount": 15
  },
  "airport": {
    "areaM2": 50000,
    "opsPerDay": 20000,
    "staffCount": 120
  },
  "distribution-center": {
    "areaM2": 25000,
    "opsPerDay": 15000,
    "staffCount": 100
  },
  "parcel-hub": {
    "areaM2": 15000,
    "opsPerDay": 40000,
    "staffCount": 150
  },
  "port-terminal": {
    "areaM2": 60000,
    "opsPerDay": 8000,
    "staffCount": 110
  },
  "rail-terminal": {
    "areaM2": 30000,
    "opsPerDay": 6000,
    "staffCount": 70
  },
  "logistics-generic": {
    "areaM2": 10000,
    "opsPerDay": 5000,
    "staffCount": 45
  },
  "medical": {
    "areaM2": 20000,
    "opsPerDay": 3000,
    "staffCount": 200
  },
  "clinic": {
    "areaM2": 4000,
    "opsPerDay": 900,
    "staffCount": 45
  },
  "lab": {
    "areaM2": 1500,
    "opsPerDay": 2500,
    "staffCount": 30
  },
  "pharmacy-warehouse": {
    "areaM2": 5000,
    "opsPerDay": 4000,
    "staffCount": 35
  },
  "social-generic": {
    "areaM2": 5000,
    "opsPerDay": 1200,
    "staffCount": 50
  },
  "assembly-plant": {
    "areaM2": 15000,
    "opsPerDay": 6000,
    "staffCount": 120
  },
  "machining-shop": {
    "areaM2": 6000,
    "opsPerDay": 3000,
    "staffCount": 55
  },
  "electronics-plant": {
    "areaM2": 8000,
    "opsPerDay": 20000,
    "staffCount": 90
  },
  "paint-shop": {
    "areaM2": 4000,
    "opsPerDay": 2000,
    "staffCount": 35
  },
  "manufacturing-generic": {
    "areaM2": 8000,
    "opsPerDay": 4000,
    "staffCount": 60
  },
  "food-processing": {
    "areaM2": 7000,
    "opsPerDay": 15000,
    "staffCount": 80
  },
  "bakery": {
    "areaM2": 3000,
    "opsPerDay": 25000,
    "staffCount": 45
  },
  "dairy-plant": {
    "areaM2": 9000,
    "opsPerDay": 30000,
    "staffCount": 70
  },
  "meat-processing": {
    "areaM2": 6000,
    "opsPerDay": 9000,
    "staffCount": 95
  },
  "food-generic": {
    "areaM2": 5000,
    "opsPerDay": 10000,
    "staffCount": 55
  },
  "pharma-plant": {
    "areaM2": 12000,
    "opsPerDay": 40000,
    "staffCount": 110
  },
  "cleanroom": {
    "areaM2": 2000,
    "opsPerDay": 15000,
    "staffCount": 40
  },
  "pharma-warehouse": {
    "areaM2": 7000,
    "opsPerDay": 5000,
    "staffCount": 40
  },
  "pharma-generic": {
    "areaM2": 6000,
    "opsPerDay": 8000,
    "staffCount": 50
  },
  "greenhouse": {
    "areaM2": 30000,
    "opsPerDay": 20000,
    "staffCount": 60
  },
  "grain-elevator": {
    "areaM2": 12000,
    "opsPerDay": 1200,
    "staffCount": 25
  },
  "poultry-farm": {
    "areaM2": 18000,
    "opsPerDay": 35000,
    "staffCount": 55
  },
  "agriculture-generic": {
    "areaM2": 15000,
    "opsPerDay": 8000,
    "staffCount": 40
  },
  "ore-processing": {
    "areaM2": 20000,
    "opsPerDay": 4000,
    "staffCount": 90
  },
  "mine-warehouse": {
    "areaM2": 8000,
    "opsPerDay": 1500,
    "staffCount": 30
  },
  "mining-generic": {
    "areaM2": 12000,
    "opsPerDay": 2500,
    "staffCount": 50
  },
  "precast-plant": {
    "areaM2": 14000,
    "opsPerDay": 1800,
    "staffCount": 70
  },
  "construction-generic": {
    "areaM2": 9000,
    "opsPerDay": 1500,
    "staffCount": 45
  },
  "waste-sorting": {
    "areaM2": 11000,
    "opsPerDay": 30000,
    "staffCount": 85
  },
  "water-treatment": {
    "areaM2": 9000,
    "opsPerDay": 1000,
    "staffCount": 30
  },
  "utilities-generic": {
    "areaM2": 7000,
    "opsPerDay": 2000,
    "staffCount": 35
  },
  "hotel": {
    "areaM2": 12000,
    "opsPerDay": 900,
    "staffCount": 70
  },
  "restaurant-kitchen": {
    "areaM2": 600,
    "opsPerDay": 1200,
    "staffCount": 20
  },
  "conference-center": {
    "areaM2": 9000,
    "opsPerDay": 700,
    "staffCount": 35
  },
  "hospitality-generic": {
    "areaM2": 5000,
    "opsPerDay": 800,
    "staffCount": 30
  },
  "other": {
    "areaM2": 5000,
    "opsPerDay": 1000,
    "staffCount": 20
  }
};
