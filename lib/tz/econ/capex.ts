import { normDef, type NormValues } from "../norms";
import type { LineItem, Origin } from "../types";
import { FACILITY_PARAM_KEYS, isRonavi, isWaybot, optNum, paramLabel, refuse, type ScenarioContext } from "./context";
import { CAPEX_LINE_KEYS, FORMULAS, capexFormulaKey, type CapexLineKey } from "./formulas";
import { charOrigin, mergeLines, sumLines, type ItemCalc } from "./internal";
import { fx, rub, share } from "./text";

/**
 * CAPEX по укрупнённым статьям (ТЗ §3.5.2: оборудование + инфраструктура + ПО + интеграция +
 * пусконаладка + обучение + резерв; легенда организатора — резерв 10 %). Зарядные станции
 * выделены из инфраструктуры в отдельную строку: у дилера Ronavi станция продаётся отдельно от
 * робота (см. обоснование норматива chargerRub).
 *
 * Статьи ПО, интеграции и обучения — на каждую позицию сценария (у каждой линейки роботов своя
 * система управления и своя интеграция); инфраструктура площадки — одна на объект.
 */

export const CAPEX_LABELS: Readonly<Record<CapexLineKey, string>> = {
  equipment: "Оборудование (роботы)",
  chargers: "Зарядные станции",
  infrastructure: "Инфраструктура площадки (разметка, Wi-Fi)",
  software: "ПО управления парком",
  integration: "Интеграция с WMS/ERP",
  commissioning: "Пусконаладка",
  training: "Обучение персонала",
  reserve: "Резерв (10 %)",
};

/** Пометка статьи RaaS, которая принята входящей в подписку. */
export const INCLUDED_IN_SUBSCRIPTION = "входит в подписку (допущение — проверить в договоре)";

function line(
  key: CapexLineKey,
  valueRub: number,
  substituted: string,
  origin: Origin,
  extra: Partial<Pick<LineItem, "originNote" | "overridden" | "includedInSubscription">> = {},
): LineItem {
  const out: LineItem = {
    key,
    label: CAPEX_LABELS[key],
    valueRub,
    formula: FORMULAS[capexFormulaKey(key)].expression,
    substituted,
    origin,
  };
  if (extra.originNote) out.originNote = extra.originNote;
  if (extra.overridden) out.overridden = true;
  if (extra.includedInSubscription) out.includedInSubscription = true;
  return out;
}

/** Статья RaaS, принятая входящей в подписку: 0 ₽ с пометкой. */
function included(key: CapexLineKey): LineItem {
  return line(key, 0, "входит в подписку", "choice", {
    originNote: INCLUDED_IN_SUBSCRIPTION,
    includedInSubscription: true,
  });
}

/** Норматив-аналог: пометка «аналог: <производитель>», если продукт другого производителя. */
function analogNote(isSameVendor: boolean, vendor: string): string | undefined {
  return isSameVendor ? undefined : `аналог: ${vendor}`;
}

function softwareLine(c: ItemCalc): LineItem {
  const p = c.product;
  if (p.softwareRubOneTime !== null && Number.isFinite(p.softwareRubOneTime) && p.softwareRubOneTime >= 0) {
    return line("software", p.softwareRubOneTime, `${rub(p.softwareRubOneTime)} (карточка ${p.name})`, charOrigin(p, "softwareRubOneTime", "research"));
  }
  const v = c.norms.softwareRubPerSite;
  return line("software", v, `${rub(v)} (норматив на объект)`, normDef("softwareRubPerSite").origin, {
    originNote: analogNote(isRonavi(p), "Ronavi"),
  });
}

function integrationLine(c: ItemCalc): LineItem {
  const p = c.product;
  if (p.implementationRub !== null && Number.isFinite(p.implementationRub) && p.implementationRub >= 0) {
    return line("integration", p.implementationRub, `${rub(p.implementationRub)} (карточка ${p.name})`, charOrigin(p, "implementationRub", "research"));
  }
  const v = c.norms.integrationRubPerSite;
  return line("integration", v, `${rub(v)} (норматив на объект)`, normDef("integrationRubPerSite").origin, {
    originNote: analogNote(isRonavi(p), "Ronavi"),
  });
}

function trainingLine(c: ItemCalc): LineItem {
  const p = c.product;
  if (p.trainingRub !== null && Number.isFinite(p.trainingRub) && p.trainingRub >= 0) {
    return line("training", p.trainingRub, `${rub(p.trainingRub)} (карточка ${p.name})`, charOrigin(p, "trainingRub", "research"));
  }
  const v = c.norms.trainingRubPerSite;
  return line("training", v, `${rub(v)} (норматив на объект)`, normDef("trainingRubPerSite").origin);
}

function reserveLine(norms: NormValues, subtotal: number): LineItem {
  const pct = norms.capexReservePct;
  const l = line("reserve", subtotal * pct, `${share(pct, 1)} × ${rub(subtotal)}`, normDef("capexReservePct").origin);
  l.label = `Резерв (${share(pct, 1)})`;
  return l;
}

/** Площадь активной зоны для статьи инфраструктуры: activeAreaM2, иначе общая площадь. */
function activeArea(ctx: Pick<ScenarioContext, "params" | "paramLabels">): number {
  const K = FACILITY_PARAM_KEYS;
  const a = optNum(ctx.params, K.activeAreaM2) ?? optNum(ctx.params, K.totalAreaM2);
  if (a === null || a < 0) {
    refuse(
      "invalid_inputs",
      `Не задана площадь активной зоны («${paramLabel(ctx, K.activeAreaM2)}»): она нужна для статьи «Инфраструктура площадки»`,
      [`param:${K.activeAreaM2}`],
    );
  }
  return a;
}

/** Статья инфраструктуры площадки: для мобильных роботов — площадь × удельная стоимость. */
function infrastructureLine(ctx: Pick<ScenarioContext, "params" | "paramLabels">, items: readonly ItemCalc[], norms: NormValues): LineItem {
  if (!items.some((c) => c.product.mobile)) {
    return line("infrastructure", 0, "стационарная система — разметка и навигация для мобильных роботов не нужны", "derived");
  }
  const area = activeArea(ctx);
  const rate = norms.siteInfraRubPerM2;
  return line("infrastructure", area * rate, `${fx(area)} м² × ${rub(rate)}/м²`, normDef("siteInfraRubPerM2").origin);
}

/** Строки CAPEX покупки одной позиции, кроме инфраструктуры и резерва. */
function purchaseItemLines(c: ItemCalc): LineItem[] {
  const p = c.product;
  const price = c.priceRub ?? 0;
  // Происхождение цены: ручная — «задано вами»; иначе из карточки (priceOrigin, затем запись
  // источника priceRub). Если его нет нигде, цена помечается оценкой, а не приписывается
  // организатору: происхождение неизвестно.
  const priceSource = p.sources.find((s) => s.key === "priceRub");
  const originUnknown = !c.priceOverridden && p.priceOrigin === null && !priceSource;
  const notes = [
    !c.priceOverridden && !p.priceConfirmed ? "цена не подтверждена производителем" : null,
    originUnknown ? "источник цены в карточке не указан" : null,
  ].filter((x): x is string => x !== null);
  const equipment = line(
    "equipment",
    c.n * price,
    `${fx(c.n)} × ${rub(price)}`,
    c.priceOverridden ? "user" : (p.priceOrigin ?? charOrigin(p, "priceRub", "estimate")),
    {
      overridden: c.priceOverridden,
      originNote: notes.length > 0 ? notes.join("; ") : undefined,
    },
  );
  const chargerRub = c.norms.chargerRub;
  const chargers =
    c.chargers > 0
      ? line("chargers", c.chargers * chargerRub, `${fx(c.chargers)} × ${rub(chargerRub)}`, normDef("chargerRub").origin, {
          originNote: analogNote(isRonavi(p), "Ronavi"),
        })
      : line("chargers", 0, "стационарная система — зарядные станции не нужны", "derived");
  const perUnit = c.norms.commissioningRubPerUnit;
  const commissioning = line(
    "commissioning",
    c.n * perUnit,
    `${fx(c.n)} × ${rub(perUnit)}`,
    normDef("commissioningRubPerUnit").origin,
    { originNote: analogNote(isWaybot(p), "Вейбот Роботикс (Клинботикс)") },
  );
  return [equipment, chargers, softwareLine(c), integrationLine(c), commissioning, trainingLine(c)];
}

/** Упорядочивает строки по CAPEX_LINE_KEYS. */
function ordered(lines: LineItem[]): LineItem[] {
  const idx = (k: string) => {
    const i = (CAPEX_LINE_KEYS as readonly string[]).indexOf(k);
    return i < 0 ? 99 : i;
  };
  return lines.slice().sort((a, b) => idx(a.key) - idx(b.key));
}

/** CAPEX покупки: все статьи плюс резерв от их суммы. */
export function purchaseCapexLines(
  ctx: Pick<ScenarioContext, "params" | "paramLabels">,
  items: readonly ItemCalc[],
  norms: NormValues,
): LineItem[] {
  const merged = mergeLines(items.map(purchaseItemLines));
  const lines = ordered([...merged, infrastructureLine(ctx, items, norms)]);
  return [...lines, reserveLine(norms, sumLines(lines))];
}

/**
 * CAPEX услуги (RaaS): интеграция + обучение + резерв; оборудование, станции, инфраструктура,
 * ПО и пусконаладка приняты входящими в подписку (допущение — проверить в договоре).
 */
export function raasCapexLines(items: readonly ItemCalc[], norms: NormValues): LineItem[] {
  const merged = mergeLines(
    items.map((c) => [
      included("equipment"),
      included("chargers"),
      included("software"),
      integrationLine(c),
      included("commissioning"),
      trainingLine(c),
    ]),
  );
  const lines = ordered([...merged, included("infrastructure")]);
  return [...lines, reserveLine(norms, sumLines(lines))];
}
