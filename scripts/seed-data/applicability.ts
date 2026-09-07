/** Какие виды решений применимы к какому типу объекта. Заполняется осознанно, а не «все ко
 *  всем»: паллетайзер неприменим к больничной палате, и связь, утверждающая обратное, врёт
 *  пользователю ровно на том экране, ради которого существует продукт. */
export type ApplicabilitySeed = { facilityType: string; categories: string[] };

// Порядок внутри массива — это порядок показа категорий на экране объекта, а не список.
// До разворота категории сортировались по имени, и на складе первой шла AS/RS; она остаётся
// первой и здесь, но уже по существу: в ней два решения с реальными источниками, тогда как в
// AMR одно. Первая категория — то, что пользователь увидит и с чем сравнит остальное.
export const APPLICABILITY: ApplicabilitySeed[] = [
  {
    "facilityType": "warehouse",
    "categories": [
      "asrs",
      "amr"
    ]
  },
  {
    "facilityType": "airport",
    "categories": [
      "baggage-robots",
      "autonomous-tugs"
    ]
  },
  {
    "facilityType": "medical",
    "categories": [
      "med-delivery",
      "disinfection"
    ]
  },
  {
    "facilityType": "other",
    "categories": [
      "generic-mobile",
      "generic-fixed"
    ]
  }
];
