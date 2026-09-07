/** Какие виды решений применимы к какому типу объекта.
 *
 *  Заполняется осознанно, а не «все ко всем»: паллетайзер неприменим к больничной палате, и
 *  связь, утверждающая обратное, врёт пользователю ровно на том экране, ради которого
 *  существует продукт.
 *
 *  Порядок внутри массива — это порядок показа на экране объекта. На складе первой стоит
 *  AS/RS: в ней два решения с реальными источниками против одного в AMR, и первая категория —
 *  то, с чем пользователь сравнит всё остальное. */
export type ApplicabilitySeed = { facilityType: string; categories: string[] };

export const APPLICABILITY: ApplicabilitySeed[] = [
  {
    "facilityType": "warehouse",
    "categories": [
      "asrs",
      "amr",
      "class-amr-transport",
      "class-palletizer",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "fulfillment",
    "categories": [
      "class-amr-transport",
      "class-sorter",
      "class-palletizer",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "darkstore",
    "categories": [
      "class-amr-transport",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "cold-storage",
    "categories": [
      "class-palletizer",
      "class-amr-transport"
    ]
  },
  {
    "facilityType": "retail-generic",
    "categories": [
      "class-amr-transport",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "airport",
    "categories": [
      "baggage-robots",
      "autonomous-tugs",
      "class-sorter",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "distribution-center",
    "categories": [
      "class-amr-transport",
      "class-palletizer",
      "class-sorter",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "parcel-hub",
    "categories": [
      "class-sorter",
      "class-amr-transport",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "port-terminal",
    "categories": [
      "class-palletizer",
      "class-amr-transport"
    ]
  },
  {
    "facilityType": "rail-terminal",
    "categories": [
      "class-palletizer",
      "class-amr-transport"
    ]
  },
  {
    "facilityType": "logistics-generic",
    "categories": [
      "class-amr-transport",
      "class-sorter",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "medical",
    "categories": [
      "med-delivery",
      "disinfection",
      "class-service-delivery",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "clinic",
    "categories": [
      "class-service-delivery",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "lab",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "pharmacy-warehouse",
    "categories": [
      "class-amr-transport",
      "class-cobot-pickplace",
      "class-palletizer"
    ]
  },
  {
    "facilityType": "social-generic",
    "categories": [
      "class-service-delivery",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "assembly-plant",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection",
      "class-amr-transport",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "machining-shop",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "electronics-plant",
    "categories": [
      "class-ai-inspection",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "paint-shop",
    "categories": [
      "class-ai-inspection",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "manufacturing-generic",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "food-processing",
    "categories": [
      "class-palletizer",
      "class-cobot-pickplace",
      "class-ai-inspection",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "bakery",
    "categories": [
      "class-palletizer",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "dairy-plant",
    "categories": [
      "class-palletizer",
      "class-ai-inspection",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "meat-processing",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "food-generic",
    "categories": [
      "class-palletizer",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "pharma-plant",
    "categories": [
      "class-ai-inspection",
      "class-cobot-pickplace",
      "class-palletizer"
    ]
  },
  {
    "facilityType": "cleanroom",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "pharma-warehouse",
    "categories": [
      "class-amr-transport",
      "class-palletizer",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "pharma-generic",
    "categories": [
      "class-cobot-pickplace",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "greenhouse",
    "categories": [
      "class-amr-transport",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "grain-elevator",
    "categories": [
      "class-palletizer",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "poultry-farm",
    "categories": [
      "class-ai-inspection",
      "class-palletizer"
    ]
  },
  {
    "facilityType": "agriculture-generic",
    "categories": [
      "class-amr-transport",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "ore-processing",
    "categories": [
      "class-ai-inspection",
      "class-amr-transport"
    ]
  },
  {
    "facilityType": "mine-warehouse",
    "categories": [
      "class-amr-transport",
      "class-palletizer"
    ]
  },
  {
    "facilityType": "mining-generic",
    "categories": [
      "class-amr-transport",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "precast-plant",
    "categories": [
      "class-palletizer",
      "class-amr-transport",
      "class-ai-inspection"
    ]
  },
  {
    "facilityType": "construction-generic",
    "categories": [
      "class-amr-transport",
      "class-palletizer"
    ]
  },
  {
    "facilityType": "waste-sorting",
    "categories": [
      "class-sorter",
      "class-ai-inspection",
      "class-amr-transport"
    ]
  },
  {
    "facilityType": "water-treatment",
    "categories": [
      "class-ai-inspection",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "utilities-generic",
    "categories": [
      "class-sorter",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "hotel",
    "categories": [
      "class-service-delivery",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "restaurant-kitchen",
    "categories": [
      "class-service-delivery",
      "class-cobot-pickplace"
    ]
  },
  {
    "facilityType": "conference-center",
    "categories": [
      "class-cleaning",
      "class-service-delivery"
    ]
  },
  {
    "facilityType": "hospitality-generic",
    "categories": [
      "class-service-delivery",
      "class-cleaning"
    ]
  },
  {
    "facilityType": "other",
    "categories": [
      "generic-mobile",
      "generic-fixed",
      "class-amr-transport",
      "class-cleaning"
    ]
  }
];
