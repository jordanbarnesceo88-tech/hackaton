import { describe, it, expect } from "vitest";
import {
  CHARACTERISTIC_KEYS,
  CHAR_GROUP_LABELS,
  REQUIRED_CHARACTERISTIC_KEYS,
  completenessPct,
  confirmedSharePct,
  originLabel,
  type CharGroup,
  type CharKey,
} from "./characteristics";
import type { Origin } from "./types";

const keys = Object.keys(CHARACTERISTIC_KEYS) as CharKey[];

describe("CHARACTERISTIC_KEYS (ТЗ §3.3.4)", () => {
  it("ровно 31 обязательный ключ", () => {
    expect(REQUIRED_CHARACTERISTIC_KEYS).toHaveLength(31);
  });

  it("обязательные ключи по группам: 6 + 8 + 5 + 6 + 3 + 3", () => {
    const byGroup = (g: CharGroup) => REQUIRED_CHARACTERISTIC_KEYS.filter((k) => CHARACTERISTIC_KEYS[k].group === g);
    expect(byGroup("IDENTIFICATION")).toEqual([
      "manufacturer",
      "modelName",
      "solutionType",
      "purpose",
      "countryOfOrigin",
      "availabilityStatus",
    ]);
    expect(byGroup("TECHNICAL")).toEqual([
      "payloadKg",
      "dimensionsMm",
      "speedMps",
      "throughput",
      "autonomyH",
      "positioningMm",
      "navigation",
      "operatingConditions",
    ]);
    expect(byGroup("INFRASTRUCTURE")).toEqual(["floorRequirements", "minAisleM", "chargeMin", "connectivity", "integration"]);
    expect(byGroup("ECONOMICS")).toEqual([
      "priceRub",
      "softwareRubOneTime",
      "implementationRub",
      "serviceRubYear",
      "acquisitionModels",
      "serviceLifeYears",
    ]);
    expect(byGroup("APPLICABILITY")).toEqual(["applicability", "limitations", "cases"]);
    expect(byGroup("DATA_QUALITY")).toEqual(["primarySourceUrl", "verifiedAt", "confirmation"]);
  });

  it("необязательные ключи — те, что нужны расчёту и подбору", () => {
    expect(keys.filter((k) => !CHARACTERISTIC_KEYS[k].required).sort()).toEqual(
      [
        "massKg",
        "liftHeightMm",
        "tempMinC",
        "tempMaxC",
        "turnAisleM",
        "robotsPerStation",
        "raasRubMonth",
        "trainingRub",
        "batteryCostRub",
        "batteryReplacementYears",
        "softwareRubYear",
        "consumablesRubYear",
        "chargerPowerKw",
      ].sort(),
    );
  });

  it("у каждого ключа есть подпись по-русски и группа с названием", () => {
    for (const k of keys) {
      const def = CHARACTERISTIC_KEYS[k];
      expect(def.label.trim(), k).toBeTruthy();
      expect(CHAR_GROUP_LABELS[def.group], k).toBeTruthy();
    }
  });
});

describe("completenessPct", () => {
  it("0 без данных и 100 при всех обязательных ключах", () => {
    expect(completenessPct([])).toBe(0);
    expect(completenessPct(REQUIRED_CHARACTERISTIC_KEYS)).toBe(100);
  });

  it("не выходит за 0..100: необязательные, неизвестные и повторные ключи не считаются", () => {
    const all = [...keys, "unknownKey", ...REQUIRED_CHARACTERISTIC_KEYS];
    expect(completenessPct(all)).toBe(100);
    expect(completenessPct(["massKg", "raasRubMonth", "unknownKey"])).toBe(0);
    expect(completenessPct(["priceRub", "priceRub", "priceRub"])).toBe(Math.round(100 / 31));
  });

  it("округляет долю от 31 до целого процента", () => {
    expect(completenessPct(REQUIRED_CHARACTERISTIC_KEYS.slice(0, 19))).toBe(61); // 19/31 = 61,3 %
    expect(completenessPct(REQUIRED_CHARACTERISTIC_KEYS.slice(0, 18))).toBe(58); // 18/31 = 58,1 %
  });

  it("принимает любой Iterable, в том числе Set", () => {
    expect(completenessPct(new Set(["manufacturer", "modelName"]))).toBe(Math.round(200 / 31));
  });
});

describe("confirmedSharePct", () => {
  it("пустой список — 0 %, а не деление на ноль", () => {
    expect(confirmedSharePct([])).toBe(0);
  });

  it("доля подтверждённых, округлённая до целого", () => {
    expect(confirmedSharePct([{ confirmed: true }, { confirmed: false }, { confirmed: false }])).toBe(33);
    expect(confirmedSharePct([{ confirmed: true }, { confirmed: true }])).toBe(100);
  });
});

describe("originLabel", () => {
  it("подписывает каждое происхождение по-русски", () => {
    const expected: Record<Origin, string> = {
      organizer: "Организатор",
      research: "Открытый источник",
      estimate: "Оценка",
      derived: "Расчёт",
      choice: "Наш выбор",
      tz: "ТЗ",
      admin: "Администратор",
      user: "Задано вами",
    };
    for (const [origin, label] of Object.entries(expected) as [Origin, string][]) {
      expect(originLabel(origin)).toBe(label);
    }
  });
});
