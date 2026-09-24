import { resolveNorms, type NormKey, type NormValues } from "../norms";
import type { ProcessDef } from "../processes";
import type {
  ParamValues,
  ProductForCalc,
  Refusal,
  RefusalReason,
  ScenarioSpec,
  TraceStep,
} from "../types";
import { FORMULAS } from "./formulas";
import { fx } from "./text";

/**
 * Вход движка экономики tz-1.0.0 и общие помощники. Движок — чистые функции без React, Prisma,
 * Date и случайности: один и тот же вход даёт один и тот же результат на сервере и в браузере.
 *
 * Производительность по циклу приходит снаружи (`cycle`): её считает имитация по той же
 * планировке (lib/sim/analytic), но экономика lib/sim не импортирует — так расчёт можно
 * воспроизвести из снимка проекта без геометрии, а имитацию — проверить против расчёта.
 */

/** Средние плечи перевозки по планировке объекта и производительность по циклу, ед./ч. */
export type CycleInfo = { thrPerH: number; loadedM: number; emptyM: number };

/**
 * Всё, что нужно для расчёта сценариев объекта:
 * - `params` — полный набор параметров объекта (после проверки и значений по умолчанию);
 * - `norms` — итоговые нормативы (`resolveNorms`), уже прижатые к своим границам;
 * - `products` — снимки продуктов по slug;
 * - `processes` — определения процессов по slug;
 * - `cycle` — производительность по циклу по slug продукта; null — цикл не посчитан;
 * - `paramBounds` — границы организатора для параметров (для анализа чувствительности);
 * - `paramLabels` — подписи параметров для сообщений об ошибках.
 */
export type ScenarioContext = {
  facility: string;
  params: ParamValues;
  norms: NormValues;
  products: Record<string, ProductForCalc>;
  processes: Record<string, ProcessDef>;
  cycle: Record<string, CycleInfo | null>;
  paramBounds?: Record<string, { min: number | null; max: number | null }>;
  paramLabels?: Record<string, string>;
};

/**
 * Параметры уровня объекта, которые экономика читает по имени. Параметры процессов (объёмы,
 * численность, зарплата, пик) берутся из `ProcessDef`, а эти общие для объекта: режим работы,
 * площадь, горизонт, бюджет и инфраструктура.
 */
export const FACILITY_PARAM_KEYS = {
  shiftsPerDay: "shiftsPerDay",
  shiftDurationH: "shiftDurationH",
  operatingHoursPerDay: "operatingHoursPerDay",
  workDaysPerYear: "workDaysPerYear",
  activeAreaM2: "activeAreaM2",
  totalAreaM2: "totalAreaM2",
  horizonYears: "horizonYears",
  payrollTaxMultiplier: "payrollTaxMultiplier",
  capexBudgetMRub: "capexBudgetMRub",
  hasWms: "hasWms",
  floorsCount: "floorsCount",
  availablePowerKw: "availablePowerKw",
  chargingPowerKw: "chargingPowerKw",
} as const;

/**
 * Диапазон горизонтов расчёта для склада, лет: диапазон организатора («Горизонт расчёта
 * окупаемости», 3–10 лет — Датасеты_хакатон.xlsx › Склад › стр. 51). Используется только для
 * склада (ctx.facility === 'warehouse') и только когда ctx.paramBounds не передаёт границ
 * горизонта: у аэропорта и медучреждения диапазон организатора другой (5–15 лет). Это границы
 * рычага «Горизонт расчёта» и диапазон, на котором ищется смена вывода по горизонту.
 */
export const HORIZON_SCAN: readonly [number, number] = [3, 10];

/**
 * Наибольший горизонт расчёта, лет (наш выбор): у организатора максимум 10 лет для склада и
 * 15 лет для аэропорта и медучреждения, а срок службы роботов 5–10 лет. Горизонт больше этого
 * значения — ошибка ввода, а не повод молча его урезать. Та же граница — физический предел
 * рычага «Горизонт расчёта» в анализе чувствительности.
 */
export const HORIZON_MAX_YEARS = 30;

/**
 * Русские подписи параметров, которые движок читает по имени, — запасной вариант для
 * сообщений, когда вызывающий код не передал ctx.paramLabels (иначе пользователь увидел бы
 * «horizonYears»). Скопированы из подписей датасета организатора и дополнений
 * (lib/data/organizer/params.generated.ts, поле label); у ключей, подписи которых различаются
 * по типам объектов, взята общая часть. Совпадение с датасетом проверяет тест
 * lib/tz/econ/labels.test.ts. Подписи из БД (администрируемые ParamDefinition) приходят через
 * ctx.paramLabels и имеют приоритет.
 */
export const DEFAULT_PARAM_LABELS: Readonly<Record<string, string>> = {
  // Уровень объекта (FACILITY_PARAM_KEYS)
  shiftsPerDay: "Количество рабочих смен в сутки",
  shiftDurationH: "Продолжительность смены",
  operatingHoursPerDay: "Часов работы в сутки",
  workDaysPerYear: "Рабочих дней в году",
  activeAreaM2: "Площадь активной (роботизируемой) зоны",
  // Склад — «Общая площадь склада», медучреждение — «Общая площадь здания(й)».
  totalAreaM2: "Общая площадь",
  horizonYears: "Горизонт расчёта окупаемости",
  payrollTaxMultiplier: "Коэффициент начислений на ФОТ",
  capexBudgetMRub: "Планируемый бюджет на роботизацию (CAPEX)",
  hasWms: "Наличие WMS",
  floorsCount: "Количество этажей",
  availablePowerKw: "Мощность электроснабжения (доступная)",
  chargingPowerKw: "Доступная мощность для зарядной инфраструктуры",
  // Склад: перемещение паллет
  inboundPalletsPerDay: "Объём приёмки (поддоны/сутки)",
  outboundPalletsPerDay: "Объём отгрузки (поддоны/сутки)",
  internalPalletMovesPerDay: "Внутренние перемещения паллет (подпитка, перестановки)",
  nonStandardCargoPct: "Доля негабаритных/нестандартных грузов",
  peakFactor: "Пиковый коэффициент нагрузки",
  forkliftOperatorsCount: "Из них: операторы погрузчиков",
  forkliftSalaryRubMonth: "Средняя з/п оператора погрузчика (gross)",
  // Склад: отбор и уборка
  pickLinesPerDay: "Объём отбора (строк/сутки, всего)",
  pickUnitsPerDay: "Объём отбора (штук/сутки, всего)",
  piecePickSharePct: "Доля мелкоштучного отбора (piece-pick)",
  pickersCount: "Из них: отборщики (комплектовщики)",
  pickerSalaryRubMonth: "Средняя з/п отборщика (gross)",
  cleaningAreaM2: "Площадь уборки",
  cleaningsPerDay: "Уборок в сутки",
  cleanersCount: "Численность уборщиков склада",
  cleanerSalaryRubMonth: "Средняя з/п уборщика склада (gross)",
  // Аэропорт
  baggagePerDay: "Объём перемещения багажа (единиц/сутки)",
  robotCleanableAreaM2: "Площадь, убираемая роботизированной уборкой",
  rampStaffCount: "Численность персонала наземного обслуживания (рамп)",
  rampSalaryRubMonth: "Средняя з/п сотрудника наземного обслуживания (gross)",
  terminalStaffCount: "Численность персонала внутри терминала (логистика, уборка)",
  terminalCleanerSalaryRubMonth: "Средняя з/п уборщика терминала (gross)",
  // Медучреждение
  drugRequestsPerDay: "Объём выдачи медикаментов (заявок/сутки)",
  labResultTripsPerDay: "Объём выдачи результатов анализов (рейсов/сутки)",
  suppliesTripsPerDay: "Объём доставки расходных материалов (рейсов/сутки)",
  orderliesCount: "Численность санитаров и транспортировщиков",
  orderlySalaryRubMonth: "Средняя з/п санитара/транспортировщика (gross)",
};

/**
 * Отказ расчёта, брошенный изнутри движка. Ловится только в сборке сценария
 * (`computeScenariosCore`) и превращается в `ScenarioRefused`: наружу движок не бросает.
 */
export class RefusalError extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.message);
    this.name = "RefusalError";
    this.refusal = refusal;
  }
}

/** Бросает типизированный отказ. `fields` — поля в формате PendingChange ('param:<key>', …). */
export function refuse(reason: RefusalReason, message: string, fields: string[] = []): never {
  throw new RefusalError({ reason, fields, message });
}

/**
 * Число из значения параметра. Принимает конечное число или строку с числом в русской записи
 * («1 000», «1,5»); всё остальное — null.
 */
export function toNumber(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Подпись параметра для сообщения: из ctx.paramLabels, иначе встроенная русская подпись
 * (DEFAULT_PARAM_LABELS), иначе ключ.
 */
export function paramLabel(ctx: Pick<ScenarioContext, "paramLabels">, key: string): string {
  return ctx.paramLabels?.[key] ?? DEFAULT_PARAM_LABELS[key] ?? key;
}

/** Значение параметра или null, если оно не задано или не число. */
export function optNum(params: ParamValues, key: string): number | null {
  return toNumber(params[key]);
}

/**
 * Обязательный числовой параметр. Не задан или не число — отказ invalid_inputs с указанием
 * поля. `min` — нижняя допустимая граница (по умолчанию 0: объёмы, численность, площади и
 * зарплаты не бывают отрицательными).
 */
export function num(
  params: ParamValues,
  key: string,
  opts: { label?: string; min?: number } = {},
): number {
  const v = optNum(params, key);
  const label = opts.label ?? DEFAULT_PARAM_LABELS[key] ?? key;
  if (v === null) {
    refuse("invalid_inputs", `Не задан параметр «${label}»: заполните его в параметрах объекта`, [
      `param:${key}`,
    ]);
  }
  const min = opts.min ?? 0;
  if (v < min) {
    refuse(
      "invalid_inputs",
      `Параметр «${label}» = ${fx(v)} меньше допустимого ${fx(min)}: исправьте его в параметрах объекта`,
      [`param:${key}`],
    );
  }
  return v;
}

/** Часы работы объекта: в сутки, дней в году, в год. */
export type WorkHours = {
  /** Часов работы в сутки (не более 24). */
  Hd: number;
  /** Рабочих дней в году. */
  D: number;
  /** Часов работы в год. */
  Hy: number;
  trace: TraceStep;
};

/**
 * Режим работы объекта: Hсут = смен × длительность смены (склад) или часы работы в сутки
 * (аэропорт, медучреждение); Hгод = Hсут × рабочих дней.
 *
 * Организатор допускает 3 смены по 11 ч — это 33 ч в сутки, чего не бывает. Такое значение
 * прижимается к 24 ч, и подстановка это показывает, вместо того чтобы молча завысить спрос в
 * час ниже реального.
 */
export function workHours(ctx: Pick<ScenarioContext, "params" | "paramLabels">): WorkHours {
  const p = ctx.params;
  const K = FACILITY_PARAM_KEYS;
  const shifts = optNum(p, K.shiftsPerDay);
  const dur = optNum(p, K.shiftDurationH);
  let raw: number;
  let rawText: string;
  let fields: string[];
  if (shifts !== null && dur !== null) {
    raw = shifts * dur;
    rawText = `${fx(shifts)} × ${fx(dur)}`;
    fields = [`param:${K.shiftsPerDay}`, `param:${K.shiftDurationH}`];
  } else {
    const op = optNum(p, K.operatingHoursPerDay);
    if (op === null) {
      refuse(
        "invalid_inputs",
        "Не задан режим работы: укажите число смен и длительность смены (или часы работы в сутки)",
        [`param:${K.shiftsPerDay}`, `param:${K.shiftDurationH}`],
      );
    }
    raw = op;
    rawText = fx(op);
    fields = [`param:${K.operatingHoursPerDay}`];
  }
  if (!(raw > 0)) {
    refuse("invalid_inputs", "Часы работы объекта в сутки должны быть больше нуля: проверьте режим работы", fields);
  }
  const D = num(p, K.workDaysPerYear, { label: paramLabel(ctx, K.workDaysPerYear) });
  if (!(D > 0) || D > 366) {
    refuse("invalid_inputs", "Рабочих дней в году должно быть от 1 до 366: исправьте режим работы", [
      `param:${K.workDaysPerYear}`,
    ]);
  }
  const Hd = Math.min(24, raw);
  const Hy = Hd * D;
  const hdText = raw > 24 ? `min(24; ${rawText}) = ${fx(Hd)}` : `${rawText} = ${fx(Hd)}`;
  return {
    Hd,
    D,
    Hy,
    trace: {
      key: "workHours",
      label: FORMULAS.workHours.title,
      formula: FORMULAS.workHours.expression,
      substituted: `Hсут = ${hdText} ч; Hгод = ${fx(Hd)} × ${fx(D)} = ${fx(Hy)} ч`,
      value: Hy,
      unit: "ч/год",
      origin: "derived",
    },
  };
}

/** Горизонт расчёта H (целые годы) и горизонт TCO T = max(H, tcoMinYears). */
export type Horizon = { H: number; T: number };

/**
 * Горизонт окупаемости из параметров объекта. Годы целые: денежные потоки считаются по годам,
 * и дробный горизонт округляется к ближайшему (как в v1, `wholeYears`). T не меньше минимального
 * горизонта TCO по ТЗ §3.5.2.
 *
 * Горизонт, который после округления меньше 1 года или больше HORIZON_MAX_YEARS, — отказ
 * invalid_inputs. Молча подставить 1 год вместо введённого 0 (или урезать 60 лет) значило бы
 * показать расчёт не на том горизонте, который ввёл пользователь.
 */
export function horizonOf(ctx: Pick<ScenarioContext, "params" | "paramLabels">, norms: NormValues): Horizon {
  const K = FACILITY_PARAM_KEYS.horizonYears;
  const label = paramLabel(ctx, K);
  // Нижнюю границу проверяет сообщение ниже: «меньше допустимого 0» вводило бы в заблуждение.
  const raw = num(ctx.params, K, { label, min: -Infinity });
  const H = Math.round(raw);
  if (!(H >= 1 && H <= HORIZON_MAX_YEARS)) {
    refuse(
      "invalid_inputs",
      `Горизонт расчёта должен быть от 1 до ${HORIZON_MAX_YEARS} лет (целое число лет), сейчас ${fx(raw)}: исправьте «${label}» в параметрах объекта`,
      [`param:${K}`],
    );
  }
  const T = Math.max(H, Math.max(1, Math.round(norms.tcoMinYears)));
  return { H, T };
}

/**
 * Нормативы сценария: нормативы контекста плюс переопределения сценария, прижатые к границам
 * через `resolveNorms` (веса и взаимные ограничения восстанавливает он же).
 */
export function normsForSpec(ctx: Pick<ScenarioContext, "norms">, spec: Pick<ScenarioSpec, "normOverrides">): NormValues {
  const o = spec.normOverrides;
  if (!o || Object.keys(o).length === 0) return ctx.norms;
  const rows = (Object.keys(ctx.norms) as NormKey[]).map((key) => ({ key, value: ctx.norms[key] }));
  return resolveNorms(rows, o);
}

/** Производитель — Ronavi (для пометки «аналог: Ronavi» у нормативов, взятых из его тарифов). */
export function isRonavi(p: Pick<ProductForCalc, "manufacturer" | "name">): boolean {
  return /ronavi|ронави/i.test(`${p.manufacturer ?? ""} ${p.name}`);
}

/** Производитель — Вейбот / Клинботикс (источник норматива пусконаладки). */
export function isWaybot(p: Pick<ProductForCalc, "manufacturer" | "name">): boolean {
  return /waybot|вейбот|cleanbotics|клинботикс/i.test(`${p.manufacturer ?? ""} ${p.name}`);
}
