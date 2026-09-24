import type { ProcessDef } from "../processes";
import type { ParamValues, ProductForCalc, SelectionResult } from "../types";
import { SELECTION_CONSTANTS } from "./rules";
import { facilityLabel, fmtNum, fmtShareAsPct, fmtTemp, fmtTempRange } from "./text";

/**
 * Ограничения подбора (ТЗ §3.4.1, §3.4.3): жёсткие правила R1–R6 исключают продукт, мягкие
 * S1–S5 и S7 добавляют ограничения. Имена параметров объекта берутся из
 * `ProcessDef.constraints`, поэтому одно и то же правило работает для склада, аэропорта и
 * медучреждения. Каждая причина — готовая фраза по-русски с числами объекта и продукта.
 */

/** Недостающее значение с подсказкой, как его заполнить (форма `SelectionResult.missing`). */
export type MissingItem = SelectionResult["missing"][number];

/** Что подбор знает об объекте и процессе. */
export type SelectionContext = {
  facility: string;
  params: ParamValues;
  process: ProcessDef;
};

/**
 * Параметры объекта, которые проверяют мягкие правила, но которых нет в
 * `ProcessDef.constraints` (контракт W0 заморожен): наличие WMS, этажность и тип стеллажей.
 * Ключи — из датасета организатора (Склад, строки 39, 4 и 31). Если у объекта такого
 * параметра нет (аэропорт без `hasWms`), правило не применяется.
 */
export const OBJECT_PARAM_KEYS = {
  wms: "hasWms",
  floors: "floorsCount",
  rackType: "rackType",
} as const;

/** Числовое значение параметра объекта; null — не задано или не число. */
export function numParam(params: ParamValues, key: string | undefined): number | null {
  if (key === undefined) return null;
  const v = params[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    // Значение из файла, не приведённое к числу: «2,8» или «1 000».
    const n = Number(v.replace(/[\s  ]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Ширина или масса объекта, которую можно сравнивать: положительное число. Ноль или
 * отрицательное значение (очищенное поле, непроверенная загрузка) означает «не задано»: иначе
 * любой продукт с опубликованной шириной исключался бы с причиной «… > ширина проходов 0 м».
 */
function positiveParam(params: ParamValues, key: string | undefined): number | null {
  const v = numParam(params, key);
  return v !== null && v > 0 ? v : null;
}

/** Конечное число характеристики продукта или null (NaN и ±∞ из снимка — это «нет данных»). */
export function finiteOrNull(v: number | null): number | null {
  return v !== null && Number.isFinite(v) ? v : null;
}

/**
 * Положительная характеристика продукта (грузоподъёмность, ширина, высота, скорость) или null:
 * ноль, NaN и ±∞ из снимка данными не считаются.
 */
export function positiveOrNull(v: number | null): number | null {
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

/** Текстовое значение параметра без пробелов по краям («Да » → «Да»); null — не задано. */
export function textParam(params: ParamValues, key: string | undefined): string | null {
  if (key === undefined) return null;
  const v = params[key];
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Температурный режим хранения: границы, в которых робот обязан работать. */
export type TempRegime = {
  kind: "normal" | "chilled" | "frozen";
  /** Значение параметра как есть — для текста причины. */
  label: string;
  /** Нижняя температура режима, °C: робот должен работать при ней. */
  minC: number;
  /** Верхняя температура режима, °C; null — у морозильного режима верхней границы нет. */
  maxC: number | null;
};

/**
 * Границы режимов совпадают с подписями вариантов параметра `storageTempRegime` (T1.1):
 * «Нормальный (+5…+25 °C)», «Охлаждаемый (0…+5 °C)», «Морозильный (ниже −18 °C)». Режим
 * узнаётся по началу слова, чтобы правка подписи в скобках не ломала правило.
 */
const TEMP_REGIMES: readonly { prefix: string; kind: TempRegime["kind"]; minC: number; maxC: number | null }[] = [
  { prefix: "нормальн", kind: "normal", minC: 5, maxC: 25 },
  { prefix: "охлажд", kind: "chilled", minC: 0, maxC: 5 },
  { prefix: "морозил", kind: "frozen", minC: -18, maxC: null },
];

/** Режим хранения по значению параметра; null — не задан или не распознан (правило не применяется). */
export function parseTempRegime(value: string | null): TempRegime | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  const def = TEMP_REGIMES.find((r) => v.startsWith(r.prefix));
  return def ? { kind: def.kind, label: value.trim(), minC: def.minC, maxC: def.maxC } : null;
}

/**
 * Состояние одной составляющей запаса: known — посчитан, unknown — ограничение есть, но
 * значения продукта или объекта нет, n/a — процесс или тип решения это не ограничивает.
 */
export type MarginState = "known" | "unknown" | "n/a";

/** Запасы продукта относительно объекта — вход фактора «Запас» балла подбора. */
export type Margins = {
  payload: {
    state: MarginState;
    /** (грузоподъёмность − масса груза) / масса груза. */
    share: number | null;
    payloadKg: number | null;
    loadKg: number | null;
  };
  aisle: {
    state: MarginState;
    /** Ширина прохода объекта − ширина, нужная роботу, м. */
    marginM: number | null;
    needM: number | null;
    widthM: number | null;
    /** Нужная ширина — для разворота (true) или минимальная для проезда (false). */
    turn: boolean;
    /** Решение стационарное — проходы для проезда ему не нужны. */
    stationary: boolean;
  };
};

/** Итог проверки ограничений одного продукта. */
export type ConstraintReport = {
  /** Причины исключения (жёсткие правила). */
  hard: string[];
  /** Причины соответствия: какие ограничения проверены и выполнены, с числами. */
  passed: string[];
  /** Ограничения (мягкие правила) — продукт остаётся в подборе. */
  soft: string[];
  /** Ограничения, которые нельзя проверить без данных продукта. */
  unverified: MissingItem[];
  margins: Margins;
};

/** Сравнение с допуском: 2,9 > 2,8 — да; 2,8 > 2,8 после арифметики — нет. */
const EPS = 1e-9;

const HARD_FLAG_REASONS = {
  "model-not-found": "Модель не найдена у производителя",
  "variant-unpublished": "Вариант не опубликован",
  "rnd-exclude": "Опытный образец",
} as const;

/**
 * Проверяет продукт против параметров объекта и процесса. Не меняет вход; одинаковый вход
 * даёт одинаковый результат (подбор сохраняется в снимке проекта и сравнивается бит-в-бит).
 */
export function checkConstraints(product: ProductForCalc, ctx: SelectionContext): ConstraintReport {
  const { params, process, facility } = ctx;
  const c = process.constraints;
  const name = product.name;
  const hard: string[] = [];
  const passed: string[] = [];
  const soft: string[] = [];
  const unverified: MissingItem[] = [];

  // ——— R1: статус НИОКР ———
  if (product.status === "rnd") hard.push("Статус НИОКР — в расчёт не включается");

  // ——— R2: пометки каталога, при которых продукт нельзя заказать ———
  for (const flag of ["model-not-found", "variant-unpublished", "rnd-exclude"] as const) {
    if (product.flags.includes(flag)) hard.push(HARD_FLAG_REASONS[flag]);
  }

  // ——— R6: исключён в каталоге, не тот процесс или тип объекта ———
  if (product.excluded) {
    const reason = product.excludedReason?.trim() || "Исключён из подбора в каталоге";
    if (!hard.includes(reason)) hard.push(reason);
  }
  if (!product.processes.includes(process.slug)) {
    hard.push(`${name}: не предназначен для процесса «${process.name}»`);
  }
  if (!product.facilityTypes.includes(facility)) {
    hard.push(`${name}: не применяется на объектах типа «${facilityLabel(facility)}»`);
  } else if (product.processes.includes(process.slug)) {
    passed.push(`Предназначен для процесса «${process.name}» на объекте типа «${facilityLabel(facility)}»`);
  }

  // Характеристики продукта, пригодные для сравнения: нечисловые значения — «не опубликовано».
  const payloadKg = positiveOrNull(product.payloadKg);
  const minAisleM = positiveOrNull(product.minAisleM);
  const turnAisleM = positiveOrNull(product.turnAisleM);
  const liftHeightMm = positiveOrNull(product.liftHeightMm);
  const tempMinC = finiteOrNull(product.tempMinC);
  const tempMaxC = finiteOrNull(product.tempMaxC);

  // ——— R3 и S1: грузоподъёмность ———
  const loadKg = c.payloadParam !== undefined ? positiveParam(params, c.payloadParam) : null;
  const payload: Margins["payload"] = { state: "n/a", share: null, payloadKg, loadKg };
  if (c.payloadParam !== undefined) {
    payload.state = "unknown";
    if (loadKg !== null && payloadKg !== null) {
      const p = payloadKg;
      if (p < loadKg - EPS) {
        hard.push(`${name}: грузоподъёмность ${fmtNum(p)} кг < масса груза ${fmtNum(loadKg)} кг`);
      } else {
        const share = (p - loadKg) / loadKg;
        payload.state = "known";
        payload.share = share;
        passed.push(`Грузоподъёмность ${fmtNum(p)} кг ≥ масса груза ${fmtNum(loadKg)} кг (запас ${fmtShareAsPct(share)})`);
        if (share < SELECTION_CONSTANTS.payloadMarginWarnShare.value - EPS) {
          soft.push(`запас грузоподъёмности ${fmtShareAsPct(share)} (${fmtNum(p)} кг при массе груза ${fmtNum(loadKg)} кг)`);
        }
      }
    } else if (loadKg !== null) {
      unverified.push({
        key: "payload",
        label: "Грузоподъёмность",
        howToFix: `Уточните грузоподъёмность у производителя — без неё не проверить, повезёт ли робот груз ${fmtNum(loadKg)} кг`,
      });
    }
  }

  // ——— R4: ширина рабочих проходов и главных проездов ———
  // Ширина объекта 0 или меньше — «не задана», а не «проход нулевой ширины».
  const widthM = c.aisleParam !== undefined ? positiveParam(params, c.aisleParam) : null;
  const needM = turnAisleM ?? minAisleM;
  const turn = turnAisleM !== null;
  const aisle: Margins["aisle"] = {
    state: "n/a",
    marginM: null,
    needM,
    widthM,
    turn,
    stationary: !product.mobile,
  };
  if (widthM !== null && needM !== null) {
    const what = turn ? "ширина прохода для разворота" : "минимальная ширина прохода";
    if (needM > widthM + EPS) {
      hard.push(`${name}: ${what} ${fmtNum(needM)} м > ширина проходов объекта ${fmtNum(widthM)} м`);
    } else {
      const What = what.charAt(0).toUpperCase() + what.slice(1);
      passed.push(`${What} ${fmtNum(needM)} м ≤ ширина проходов объекта ${fmtNum(widthM)} м`);
    }
  }
  if (c.aisleParam !== undefined && product.mobile) {
    aisle.state = "unknown";
    if (widthM !== null && needM !== null) {
      aisle.state = "known";
      aisle.marginM = widthM - needM;
    } else if (widthM !== null) {
      unverified.push({
        key: "aisle",
        label: "Ширина прохода",
        howToFix: `Уточните у производителя минимальную ширину прохода и разворота — без неё не проверить проходы объекта ${fmtNum(widthM)} м`,
      });
    }
  }
  const mainWidthM = c.mainAisleParam !== undefined ? positiveParam(params, c.mainAisleParam) : null;
  if (mainWidthM !== null && minAisleM !== null && minAisleM > mainWidthM + EPS) {
    hard.push(
      `${name}: минимальная ширина прохода ${fmtNum(minAisleM)} м > ширина главных проездов ${fmtNum(mainWidthM)} м`,
    );
  }

  // ——— R5: температурный режим хранения ———
  const regime = parseTempRegime(c.tempRegimeParam !== undefined ? textParam(params, c.tempRegimeParam) : null);
  if (regime !== null) {
    const tooWarmMin = tempMinC !== null && tempMinC > regime.minC + EPS;
    const tooCoolMax = regime.maxC !== null && tempMaxC !== null && tempMaxC < regime.maxC - EPS;
    if (tooWarmMin || tooCoolMax) {
      hard.push(`${name}: рабочая температура ${fmtTempRange(tempMinC, tempMaxC)} — не подходит для режима «${regime.label}»`);
    } else if (tempMinC !== null || tempMaxC !== null) {
      // «Подходит» — только когда опубликованы все границы, которые режим проверяет; иначе
      // честнее «не противоречит» с указанием, какой границы нет.
      const range = fmtTempRange(tempMinC, tempMaxC);
      const full = tempMinC !== null && (regime.maxC === null || tempMaxC !== null);
      passed.push(
        full
          ? `Рабочая температура ${range} подходит для режима «${regime.label}»`
          : `Рабочая температура ${range} не противоречит режиму «${regime.label}» ` +
              `(${tempMinC === null ? "нижняя" : "верхняя"} граница не опубликована)`,
      );
    }
    // Для нормального режима температуры большинство складских роботов не публикуют, и это не
    // повод для проверки; для холода важна нижняя граница, и без неё продукт требует проверки.
    if (regime.kind !== "normal" && tempMinC === null && !tooCoolMax) {
      unverified.push({
        key: "temperature",
        label: "Температура эксплуатации",
        howToFix: `Уточните у производителя диапазон рабочих температур — режим «${regime.label}» требует работы при ${fmtTemp(regime.minC)} °C`,
      });
    }
  }

  // ——— R5: минимальная температура открытой площадки (аэропорт) ———
  const siteMinC = c.tempMinParam !== undefined ? numParam(params, c.tempMinParam) : null;
  if (siteMinC !== null) {
    if (tempMinC === null) {
      unverified.push({
        key: "temperature",
        label: "Температура эксплуатации",
        howToFix: `Уточните у производителя нижнюю рабочую температуру — объект требует работы при ${fmtTemp(siteMinC)} °C`,
      });
    } else if (tempMinC > siteMinC + EPS) {
      hard.push(
        `${name}: минимальная температура эксплуатации ${fmtTemp(tempMinC)} °C выше зимнего минимума объекта ${fmtTemp(siteMinC)} °C`,
      );
    } else {
      passed.push(`Работает от ${fmtTemp(tempMinC)} °C при зимнем минимуме объекта ${fmtTemp(siteMinC)} °C`);
    }
  }

  // ——— S2: высота подъёма против верхнего яруса ———
  // Текст «только горизонтальная транспортировка» имеет смысл только для роботов, которые
  // перевозят груз (вилочный, подъёмный, тягач). Сканирующему роботу инвентаризации (класс
  // «other») высота нужна, чтобы достать до верхнего яруса, — у него своя формулировка.
  // Стационарным системам и уборщикам правило не нужно: ярусы — не их ограничение.
  const topLevelM = c.heightParam !== undefined ? positiveParam(params, c.heightParam) : null;
  const liftM = liftHeightMm !== null ? liftHeightMm / 1000 : null;
  const carriesCargo =
    product.handlingClass === "fork" || product.handlingClass === "jacking" || product.handlingClass === "tug";
  if (topLevelM !== null && carriesCargo) {
    const tail = "только горизонтальная транспортировка; размещение на верхние ярусы остаётся за погрузчиками";
    if (liftM !== null) {
      if (liftM < topLevelM - EPS) {
        soft.push(`высота подъёма ${fmtNum(liftM)} м < верхнего яруса ${fmtNum(topLevelM)} м: ${tail}`);
      } else {
        passed.push(`Высота подъёма ${fmtNum(liftM)} м ≥ верхнего яруса ${fmtNum(topLevelM)} м`);
      }
    } else if (product.handlingClass === "jacking" || product.handlingClass === "tug") {
      // Подъёмная платформа или сцепка: груз поднимается на сантиметры, не на ярус.
      soft.push(`подъём на ярусы не предусмотрен: ${tail}`);
    } else {
      soft.push(`высота подъёма не опубликована — размещение на ярус ${fmtNum(topLevelM)} м требует проверки`);
    }
  } else if (topLevelM !== null && product.handlingClass === "other" && liftM !== null) {
    if (liftM < topLevelM - EPS) {
      soft.push(
        `высота подъёма ${fmtNum(liftM)} м < верхнего яруса ${fmtNum(topLevelM)} м — ` +
          "охват верхних ярусов при сканировании требует проверки",
      );
    } else {
      passed.push(`Высота подъёма ${fmtNum(liftM)} м ≥ верхнего яруса ${fmtNum(topLevelM)} м`);
    }
  }

  // ——— S3: WMS ———
  if (Object.prototype.hasOwnProperty.call(params, OBJECT_PARAM_KEYS.wms)) {
    const wms = textParam(params, OBJECT_PARAM_KEYS.wms);
    if (wms === null) soft.push("наличие WMS не указано — интеграция парка может потребовать доработки");
    else if (!wms.toLowerCase().startsWith("да")) soft.push("нет WMS — интеграция парка потребует доработки");
  }

  // ——— S4: этажность для мобильных роботов ———
  const floors = numParam(params, OBJECT_PARAM_KEYS.floors);
  if (product.mobile && floors !== null && floors > 1) {
    soft.push(`несколько этажей (${fmtNum(floors)}) — межэтажный транспорт не учтён`);
  }

  // ——— S5: паллетный шаттл при фронтальных стеллажах ———
  const rackType = textParam(params, OBJECT_PARAM_KEYS.rackType);
  if (product.solutionType === "pallet-shuttle" && rackType !== null && rackType.toLowerCase().startsWith("фронтальн")) {
    soft.push("перестройка стеллажей под каналы шаттла в CAPEX не учтена");
  }

  // ——— S7: пилотная эксплуатация ———
  if (product.status === "piloting") soft.push("пилотная эксплуатация");

  return { hard, passed, soft, unverified, margins: { payload, aisle } };
}
