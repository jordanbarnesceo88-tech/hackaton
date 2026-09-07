/** Отрасли и типы объектов. Категории решений живут отдельно: одна категория обслуживает
 *  много типов объектов, и связь между ними — в applicability.ts. */
export type FacilityTypeSeed = { slug: string; name: string; isGeneric: boolean };
export type IndustrySeed = { slug: string; name: string; facilityTypes: FacilityTypeSeed[] };

export const INDUSTRIES: IndustrySeed[] = [
  {
    "slug": "retail",
    "name": "Торговля",
    "facilityTypes": [
      {
        "slug": "warehouse",
        "name": "Склад",
        "isGeneric": false
      }
    ]
  },
  {
    "slug": "logistics",
    "name": "Логистика",
    "facilityTypes": [
      {
        "slug": "airport",
        "name": "Аэропорт",
        "isGeneric": false
      }
    ]
  },
  {
    "slug": "social",
    "name": "Социальная сфера",
    "facilityTypes": [
      {
        "slug": "medical",
        "name": "Медучреждение",
        "isGeneric": false
      }
    ]
  },
  {
    "slug": "other",
    "name": "Другое",
    "facilityTypes": [
      {
        "slug": "other",
        "name": "Произвольный объект",
        "isGeneric": true
      }
    ]
  }
];
