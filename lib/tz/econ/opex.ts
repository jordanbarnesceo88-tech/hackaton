import { pluralRu } from "../../format/plural";
import { normDef } from "../norms";
import type { LineItem, Origin } from "../types";
import { INCLUDED_IN_SUBSCRIPTION } from "./capex";
import { FORMULAS, OPEX_LINE_KEYS, opexFormulaKey, type OpexLineKey } from "./formulas";
import { charOrigin, mergeLines, type ItemCalc } from "./internal";
import type { ProcessBaseline } from "./labour";
import { fx, rub, share } from "./text";

/**
 * Годовой OPEX по статьям (ТЗ §3.5.2: сервис + лицензии + электроэнергия + связь + расходные
 * материалы + ремонт + персонал эксплуатации; легенда организатора добавляет замену АКБ раз в
 * 3–5 лет). Сравнение ведётся по полной стоимости процессов охвата, поэтому в OPEX сценария
 * входит и оставшийся ФОТ процесса, и ФОТ процессов охвата, которые сценарий не роботизирует.
 */

export const OPEX_LABELS: Readonly<Record<OpexLineKey, string>> = {
  subscription: "Подписка RaaS",
  service: "Сервисное обслуживание",
  licences: "Лицензии ПО",
  electricity: "Электроэнергия",
  connectivity: "Связь и сеть",
  consumables: "Расходные материалы",
  repair: "Ремонт вне сервисного договора",
  battery: "Замена АКБ (в среднем за год)",
  operatingStaff: "Персонал эксплуатации (диспетчер парка)",
  remainingLabour: "ФОТ оставшегося персонала процесса",
  uncoveredLabour: "ФОТ процессов без роботов (охват сравнения)",
  baselineLabour: "ФОТ персонала процессов (как есть)",
};

function line(
  key: OpexLineKey,
  valueRub: number,
  substituted: string,
  origin: Origin,
  extra: Partial<Pick<LineItem, "originNote" | "overridden" | "includedInSubscription">> = {},
): LineItem {
  const out: LineItem = {
    key,
    label: OPEX_LABELS[key],
    valueRub,
    formula: FORMULAS[opexFormulaKey(key)].expression,
    substituted,
    origin,
  };
  if (extra.originNote) out.originNote = extra.originNote;
  if (extra.overridden) out.overridden = true;
  if (extra.includedInSubscription) out.includedInSubscription = true;
  return out;
}

function included(key: OpexLineKey): LineItem {
  return line(key, 0, "входит в подписку", "choice", {
    originNote: INCLUDED_IN_SUBSCRIPTION,
    includedInSubscription: true,
  });
}

function finitePos(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Срок из карточки продукта в целых годах, если он не меньше 1 года после округления; иначе
 * null. Срок 0 или 0,3 года — ошибка данных каталога, а не замена АКБ или докупка парка каждый
 * год: такое значение не принимается, и берётся норматив.
 */
function wholeYearsOrNull(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r >= 1 ? r : null;
}

/**
 * Замена АКБ позиции: стоимость комплекта на робота и срок замены B (целые годы, ≥ 1). Срок —
 * из карточки, если он не меньше года, иначе норматив batteryReplacementYears.
 */
export function batteryOf(c: ItemCalc): {
  costPerRobot: number;
  years: number;
  origin: Origin;
  costText: string;
} {
  const p = c.product;
  const years = wholeYearsOrNull(p.batteryReplacementYears) ?? Math.max(1, Math.round(c.norms.batteryReplacementYears));
  if (finitePos(p.batteryCostRub)) {
    return { costPerRobot: p.batteryCostRub, years, origin: charOrigin(p, "batteryCostRub", "research"), costText: rub(p.batteryCostRub) };
  }
  const price = c.priceRub ?? 0;
  const pct = c.norms.batteryCostPctOfPrice;
  return {
    costPerRobot: pct * price,
    years,
    origin: normDef("batteryCostPctOfPrice").origin,
    costText: `${share(pct)} × ${rub(price)}`,
  };
}

/**
 * Срок службы позиции Life (целые годы, ≥ 1): из карточки, если он не меньше года, иначе
 * норматив serviceLifeYearsDefault.
 */
export function lifeOf(c: ItemCalc): number {
  return wholeYearsOrNull(c.product.serviceLifeYears) ?? Math.max(1, Math.round(c.norms.serviceLifeYearsDefault));
}

function electricityLine(c: ItemCalc): LineItem {
  const n = c.norms;
  const v = c.n * n.robotAvgPowerKw * c.hours.Hy * n.utilization * n.electricityRubPerKwh;
  return line(
    "electricity",
    v,
    `${fx(c.n)} × ${fx(n.robotAvgPowerKw)} кВт × ${fx(c.hours.Hy)} ч × ${fx(n.utilization)} × ${fx(n.electricityRubPerKwh)} ₽/кВт·ч`,
    normDef("robotAvgPowerKw").origin,
  );
}

function connectivityLine(c: ItemCalc): LineItem {
  const rate = c.norms.connectivityRubPerUnitYear;
  return line("connectivity", c.n * rate, `${fx(c.n)} × ${rub(rate)}`, normDef("connectivityRubPerUnitYear").origin);
}

function labourLines(c: ItemCalc): LineItem[] {
  const r = c.result;
  return [
    line(
      "operatingStaff",
      r.operatingStaffRub,
      `${fx(r.operatorPosts)} ${pluralRu(r.operatorPosts, ["пост", "поста", "постов"])} × ${fx(c.hours.Hd)} ч × ${fx(c.hours.D)} дн. / ${fx(c.norms.annualHoursPerFte)} ч × ${rub(r.roleCostRubYear)}`,
      normDef("robotsPerOperatorPost").origin,
    ),
    line(
      "remainingLabour",
      r.remainingLabourRub,
      `(${fx(r.headcount)} − ${fx(r.releasedFte, 3)}) × ${rub(r.roleCostRubYear)}`,
      "derived",
    ),
  ];
}

function purchaseItemLines(c: ItemCalc): LineItem[] {
  const p = c.product;
  const price = c.priceRub ?? 0;
  const n = c.norms;

  const override = c.item.serviceRubYearOverride;
  let service: LineItem;
  if (finitePos(override)) {
    service = line("service", c.n * override, `${fx(c.n)} × ${rub(override)} (задано вами)`, "user", { overridden: true });
  } else if (finitePos(p.serviceRubYear)) {
    service = line("service", c.n * p.serviceRubYear, `${fx(c.n)} × ${rub(p.serviceRubYear)}`, charOrigin(p, "serviceRubYear", "research"));
  } else {
    const pct = n.servicePctOfPriceYear;
    service = line("service", c.n * pct * price, `${fx(c.n)} × ${share(pct)} × ${rub(price)}`, normDef("servicePctOfPriceYear").origin, {
      originNote: "сервис производителя не опубликован — доля цены по заявлениям производителей",
    });
  }

  const licences = finitePos(p.softwareRubYear)
    ? line("licences", p.softwareRubYear, `${rub(p.softwareRubYear)} (карточка ${p.name})`, charOrigin(p, "softwareRubYear", "research"))
    : line("licences", 0, "годовая плата за ПО не опубликована — принято 0", "estimate", {
        originNote: "проверить в договоре: годовая лицензия может быть платной",
      });

  const consumables = finitePos(p.consumablesRubYear)
    ? line("consumables", c.n * p.consumablesRubYear, `${fx(c.n)} × ${rub(p.consumablesRubYear)}`, charOrigin(p, "consumablesRubYear", "research"))
    : line(
        "consumables",
        c.n * n.consumablesPctOfPriceYear * price,
        `${fx(c.n)} × ${share(n.consumablesPctOfPriceYear)} × ${rub(price)}`,
        normDef("consumablesPctOfPriceYear").origin,
      );

  const equipment = c.n * price;
  const repair = line(
    "repair",
    n.repairPctOfPriceYear * equipment,
    `${share(n.repairPctOfPriceYear)} × ${rub(equipment)}`,
    normDef("repairPctOfPriceYear").origin,
  );

  const b = batteryOf(c);
  const battery = line(
    "battery",
    (c.n * b.costPerRobot) / b.years,
    `${fx(c.n)} × ${b.costText} / ${fx(b.years)} г.`,
    b.origin,
  );

  return [service, licences, electricityLine(c), connectivityLine(c), consumables, repair, battery, ...labourLines(c)];
}

function raasItemLines(c: ItemCalc): LineItem[] {
  const rate = c.raasRubMonth ?? 0;
  const p = c.product;
  let origin: Origin = c.raasOverridden ? "user" : (p.raasOrigin ?? "research");
  let originNote: string | undefined;
  if (c.item.raasFromEstimate) {
    origin = "estimate";
    originNote = `оценка ${share(c.norms.raasMonthlyPctOfPrice)} цены в месяц, а не тариф производителя`;
  } else if (!c.raasOverridden && p.raasQualifier === "от") {
    originNote = "ставка «от» — нижняя граница";
  }
  const subscription = line("subscription", c.n * 12 * rate, `${fx(c.n)} × 12 × ${rub(rate)}`, origin, {
    overridden: c.raasOverridden && !c.item.raasFromEstimate,
    originNote,
  });
  return [
    subscription,
    included("service"),
    included("licences"),
    electricityLine(c),
    connectivityLine(c),
    included("consumables"),
    included("repair"),
    included("battery"),
    ...labourLines(c),
  ];
}

function ordered(lines: LineItem[]): LineItem[] {
  const idx = (k: string) => {
    const i = (OPEX_LINE_KEYS as readonly string[]).indexOf(k);
    return i < 0 ? 99 : i;
  };
  return lines.slice().sort((a, b) => idx(a.key) - idx(b.key));
}

/**
 * Строка ФОТ процессов охвата, которые сценарий не роботизирует; null — таких нет.
 */
function uncoveredLine(uncovered: readonly ProcessBaseline[]): LineItem | null {
  if (uncovered.length === 0) return null;
  const total = uncovered.reduce((a, b) => a + b.baselineRub, 0);
  const sub = uncovered.map((b) => `${b.process.name}: ${fx(b.headcount)} × ${rub(b.roleCost)}`).join(" + ");
  return line("uncoveredLabour", total, sub, "derived");
}

/** OPEX покупки за год (среднее по замене АКБ). */
export function purchaseOpexLines(items: readonly ItemCalc[], uncovered: readonly ProcessBaseline[]): LineItem[] {
  const lines = ordered(mergeLines(items.map(purchaseItemLines)));
  const u = uncoveredLine(uncovered);
  return u ? [...lines, u] : lines;
}

/** OPEX услуги (RaaS) за год: подписка, электроэнергия, связь, персонал; остальное — в подписке. */
export function raasOpexLines(items: readonly ItemCalc[], uncovered: readonly ProcessBaseline[]): LineItem[] {
  const lines = ordered(mergeLines(items.map(raasItemLines)));
  const u = uncoveredLine(uncovered);
  return u ? [...lines, u] : lines;
}

/** OPEX «Как есть»: ФОТ персонала процессов охвата. */
export function asisOpexLines(base: readonly ProcessBaseline[]): LineItem[] {
  const total = base.reduce((a, b) => a + b.baselineRub, 0);
  const sub = base.map((b) => `${fx(b.headcount)} × ${rub(b.roleCost)}`).join(" + ");
  return [line("baselineLabour", total, `${sub} = ${rub(total)}`, "derived")];
}

/** Стоимость оборудования позиции (для ремонта и докупки): N × цена. */
export function equipmentRub(c: ItemCalc): number {
  return c.n * (c.priceRub ?? 0);
}

