import type { SimProvenance } from "@/lib/sim/adapter";
import { SIM_MODEL_VERSION, type SimInput, type SimSummaryStored } from "@/lib/sim/types";

/**
 * Сценарии и варианты парка для списка «Сценарий и парк» (ТЗ §3.6.3 — выбор сценария). Для
 * каждого сценария роботизации имитацию можно запустить с тремя парками:
 * - по расчёту экономики (N);
 * - минимальным устойчивым по перебору имитацией (M);
 * - по паспортной производительности из норм организатора (K).
 * «Как есть» роботов не имеет — вариант показан, но недоступен.
 */

/** Вид варианта парка. */
export type SimVariantId = "calculated" | "minStable" | "byNorm";

/** Вариант парка: подпись для списка и вход имитации (null — имитировать нечего). */
export type SimVariant = {
  id: SimVariantId;
  label: string;
  input: SimInput | null;
  /**
   * «Откуда параметры» — происхождение чисел входа именно этого варианта (строки адаптера
   * `toSimInput`, см. `variantProvenance`); необязательно.
   */
  provenance?: SimProvenance[];
};

/** Сценарий в списке имитации. */
export type SimScenario = {
  /** Ключ сценария проекта (`ScenarioSpec.key`). */
  key: string;
  /** Название сценария: «Как есть», «Покупка — Ronavi H1500», … */
  name: string;
  /** Варианты парка; пустой список — сценарий без роботов («Как есть»). */
  variants: SimVariant[];
  /**
   * Сводка, сохранённая в проекте для парка по расчёту (сервер при сохранении). Её числа
   * показываются, только если она относится к текущему расчёту (`storedMatches`).
   */
  stored?: SimSummaryStored | null;
  /**
   * Загрузка, заложенная в расчёт парка, % (норматив utilization × 100) — для строки «в расчёте».
   * Без неё берётся из сохранённой сводки, иначе — значение норматива по умолчанию.
   */
  assumedUtilPct?: number;
  /**
   * Почему имитация недоступна, если у сценария нет ни одного входа (например, «класс решения
   * имитацией не моделируется»). По умолчанию: без роботов — имитировать нечего.
   */
  unavailableReason?: string;
};

/** Суффикс подписи варианта. */
const VARIANT_TEXT: Readonly<Record<SimVariantId, string>> = {
  calculated: "парк по расчёту",
  minStable: "минимальный по имитации",
  byNorm: "парк по норме организатора",
};

/** Что писать вместо числа роботов, если его нет. */
const VARIANT_MISSING: Readonly<Record<SimVariantId, string>> = {
  calculated: "нет данных",
  minStable: "не определён",
  byNorm: "нет нормы",
};

/**
 * Подпись варианта в списке: «Покупка — Ronavi H1500 — парк по расчёту (11)»,
 * «… — минимальный по имитации (9)», «… — парк по норме организатора (3)». Без числа —
 * «(нет данных)», «(не определён)», «(нет нормы)».
 */
export function simVariantLabel(scenarioName: string, id: SimVariantId, fleet: number | null): string {
  const n = fleet !== null && Number.isFinite(fleet) && fleet > 0 ? String(Math.floor(fleet)) : VARIANT_MISSING[id];
  return `${scenarioName} — ${VARIANT_TEXT[id]} (${n})`;
}

/** Вход с другим числом роботов (остальное, включая зерно, то же). */
function withFleet(input: SimInput, count: number): SimInput {
  return { ...input, robots: { ...input.robots, count } };
}

/**
 * Пояснения к числу роботов и зарядных станций у вариантов, парк которых задаёт не расчёт
 * экономики. Формулы те же, что в lib/sim/sweep.ts (перебор) и lib/tz/model.ts (парк по норме).
 */
const VARIANT_FLEET_NOTES: Readonly<Record<Exclude<SimVariantId, "calculated">, { fleet: string; chargers: string }>> = {
  minStable: {
    fleet:
      "Минимальный устойчивый парк по перебору имитацией: наименьшее число роботов, при котором " +
      "расчёт подтверждён (перебор от 1 до двойного парка по расчёту)",
    chargers: "Как в расчёте: при переборе парка число зарядных станций не меняется",
  },
  byNorm: {
    fleet:
      "Парк по паспортной производительности (норма организатора): пиковый поток / (норма × " +
      "загрузка × доступность) × (1 + резерв)",
    chargers: "Из расчёта экономики для парка по норме — по доле времени на зарядке",
  },
};

/**
 * «Откуда параметры» для варианта. Адаптер (`toSimInput`) собирает строки для парка по расчёту;
 * у двух других вариантов отличаются только число роботов и число зарядных станций — эти строки
 * получают своё происхождение и пояснение. Значения строк расчёта (роботы, станции, пиковый и
 * средний поток) у всех вариантов, включая парк по расчёту, берутся из входа самого варианта:
 * таблица описывает именно показанный прогон. Остальные строки (объект, продукт, нормативы) у
 * вариантов общие. Без входа таблицы нет — вариант нельзя выбрать.
 */
export function variantProvenance(
  provenance: readonly SimProvenance[] | undefined,
  id: SimVariantId,
  input: SimInput | null,
): SimProvenance[] | undefined {
  if (!provenance || !input) return undefined;
  const notes = id === "calculated" ? null : VARIANT_FLEET_NOTES[id];
  return provenance.map((p) => {
    switch (p.field) {
      case "calc:fleet":
        return notes
          ? { ...p, value: input.robots.count, origin: "derived", note: notes.fleet }
          : { ...p, value: input.robots.count };
      case "calc:chargers":
        return notes
          ? { ...p, value: input.layout.chargers, origin: "derived", note: notes.chargers }
          : { ...p, value: input.layout.chargers };
      case "calc:peakPerH":
        return { ...p, value: input.demand.peakPerH };
      case "calc:avgPerH":
        return { ...p, value: input.demand.avgPerH };
      default:
        return p;
    }
  });
}

/**
 * Три варианта парка сценария из входов расчёта (`ProjectModel.simInputs[key]`) и минимального
 * устойчивого парка (`SimSummaryStored.minStableFleet`). Вход «минимальный по имитации» — вход
 * по расчёту с M роботами: планировка, поток и зерно те же, иначе сравнение было бы нечестным.
 *
 * `minStableFleet` передавайте только из сводки, которая относится к текущему расчёту:
 * `storedMatches(stored, calculated) ? stored.minStableFleet : null`. Иначе после правки
 * параметров список предложил бы устаревший парк.
 */
export function buildSimVariants(args: {
  scenarioName: string;
  calculated: SimInput | null;
  byNorm: SimInput | null;
  minStableFleet: number | null;
  /** «Откуда параметры» парка по расчёту (`ProjectModel.simInputs[key].provenance`). */
  provenance?: readonly SimProvenance[] | null;
}): SimVariant[] {
  const { scenarioName, calculated, byNorm, minStableFleet } = args;
  const provenance = args.provenance ?? undefined;
  const m = minStableFleet !== null && Number.isFinite(minStableFleet) && minStableFleet > 0 ? minStableFleet : null;
  const minInput = calculated && m !== null ? withFleet(calculated, m) : null;
  return [
    {
      id: "calculated",
      label: simVariantLabel(scenarioName, "calculated", calculated?.robots.count ?? null),
      input: calculated,
      provenance: variantProvenance(provenance, "calculated", calculated),
    },
    {
      id: "minStable",
      label: simVariantLabel(scenarioName, "minStable", m),
      input: minInput,
      provenance: variantProvenance(provenance, "minStable", minInput),
    },
    {
      id: "byNorm",
      label: simVariantLabel(scenarioName, "byNorm", byNorm?.robots.count ?? null),
      input: byNorm,
      provenance: variantProvenance(provenance, "byNorm", byNorm),
    },
  ];
}

/** Разделитель ключа сценария и вида варианта в значении `<option>`. */
const SEP = "::";

/** Значение пункта списка. */
export function optionValue(key: string, id: SimVariantId | "none"): string {
  return `${key}${SEP}${id}`;
}

/** Пункт списка «Сценарий и парк». */
export type SimOption = { value: string; label: string; disabled: boolean };

/** Подпись сценария без входов: «Как есть (без роботов — имитировать нечего)». */
export function unavailableLabel(s: SimScenario): string {
  const reason =
    s.unavailableReason ??
    (s.variants.length === 0 ? "без роботов — имитировать нечего" : "нет данных для имитации");
  return `${s.name} (${reason})`;
}

/**
 * Пункты списка по сценариям в их порядке. Сценарий без единого входа даёт один недоступный
 * пункт с причиной; у остальных недоступны только варианты без входа.
 */
export function simOptions(scenarios: readonly SimScenario[]): SimOption[] {
  const out: SimOption[] = [];
  for (const s of scenarios) {
    if (!s.variants.some((v) => v.input !== null)) {
      out.push({ value: optionValue(s.key, "none"), label: unavailableLabel(s), disabled: true });
      continue;
    }
    for (const v of s.variants) {
      out.push({ value: optionValue(s.key, v.id), label: v.label, disabled: v.input === null });
    }
  }
  return out;
}

/** Выбранный сценарий и вариант. */
export type SimSelection = { scenario: SimScenario; variant: SimVariant };

/** Находит сценарий и вариант по значению пункта; null — такого доступного пункта нет. */
export function findSelection(scenarios: readonly SimScenario[], value: string | null): SimSelection | null {
  if (value === null) return null;
  const i = value.lastIndexOf(SEP);
  if (i < 0) return null;
  const key = value.slice(0, i);
  const id = value.slice(i + SEP.length);
  const scenario = scenarios.find((s) => s.key === key);
  const variant = scenario?.variants.find((v) => v.id === id);
  if (!scenario || !variant || variant.input === null) return null;
  return { scenario, variant };
}

/**
 * Выбор по умолчанию: парк по расчёту сценария `initialKey` (или первый его доступный вариант),
 * иначе первый доступный вариант любого сценария. null — имитировать нечего.
 */
export function initialSelection(scenarios: readonly SimScenario[], initialKey: string): SimSelection | null {
  const preferred = scenarios.find((s) => s.key === initialKey);
  const ordered = preferred ? [preferred, ...scenarios.filter((s) => s !== preferred)] : [...scenarios];
  for (const scenario of ordered) {
    const variant = scenario.variants.find((v) => v.id === "calculated" && v.input !== null)
      ?? scenario.variants.find((v) => v.input !== null);
    if (variant) return { scenario, variant };
  }
  return null;
}

/**
 * Текущий выбор: выбранный пользователем пункт, если он ещё доступен (после пересчёта сценарии
 * приходят заново), иначе выбор по умолчанию.
 */
export function resolveSelection(
  scenarios: readonly SimScenario[],
  value: string | null,
  initialKey: string,
): SimSelection | null {
  return findSelection(scenarios, value) ?? initialSelection(scenarios, initialKey);
}

/** Число роботов варианта сценария; null — варианта или входа нет. */
export function variantFleet(s: SimScenario, id: SimVariantId): number | null {
  const v = s.variants.find((x) => x.id === id);
  return v?.input ? v.input.robots.count : null;
}

/** Вход варианта сценария; null — варианта или входа нет. */
function variantInput(s: SimScenario, id: SimVariantId): SimInput | null {
  return s.variants.find((x) => x.id === id)?.input ?? null;
}

/**
 * Относится ли сохранённая сводка к текущему расчёту: то же зерно, тот же парк, тот же пиковый
 * поток и та же версия модели имитации. Так же отбраковывает устаревшие сводки lib/tz/model.ts
 * (риски SIM_*). После правки параметров или пересчёта до сохранения сводка устаревает, и её
 * минимальный парк, парк по норме и вердикт по норме показывать нельзя.
 *
 * Граница: сводка хранит только скаляры, поэтому правка планировки, после которой парк и поток
 * не изменились, здесь не видна.
 */
export function storedMatches(
  stored: SimSummaryStored | null | undefined,
  calculated: SimInput | null | undefined,
): stored is SimSummaryStored {
  if (!stored || !calculated) return false;
  const peak = calculated.demand.peakPerH;
  return (
    stored.simModelVersion === SIM_MODEL_VERSION &&
    stored.seed === calculated.seed &&
    stored.fleet === calculated.robots.count &&
    Math.abs(stored.requiredPerH - peak) <= 1e-6 * Math.max(1, Math.abs(peak))
  );
}

/** Сведения о парках сценария, которых нет в самом прогоне. */
export type FleetFacts = Pick<SimSummaryStored, "minStableFleet" | "fleetByNorm" | "verdictByNorm">;

/** Вердикт прогона в виде поля `verdictByNorm`: только «подтверждён» или «не подтверждён». */
function verdictOf(s: SimSummaryStored): FleetFacts["verdictByNorm"] {
  return s.verdict === "CONFIRMED" || s.verdict === "NOT_CONFIRMED" ? s.verdict : null;
}

/**
 * Минимальный устойчивый парк, парк по норме и вердикт по норме для показа рядом с прогоном
 * варианта `selected`:
 * - числа парков берутся из текущих вариантов (они пересчитаны вместе со сценарием);
 * - сохранённая сводка — запасной источник, и только если она относится к текущему расчёту
 *   (`storedMatches`);
 * - вердикт по норме — из прогона, если показан сам вариант «по норме»; иначе из сохранённой
 *   сводки, и только если её парк по норме равен текущему.
 */
export function fleetFacts(s: SimScenario, selected: SimVariantId, run: SimSummaryStored | null): FleetFacts {
  const stored = storedMatches(s.stored, variantInput(s, "calculated")) ? s.stored : null;
  const fleetByNorm = variantFleet(s, "byNorm") ?? stored?.fleetByNorm ?? null;
  const verdictByNorm =
    selected === "byNorm" && run
      ? verdictOf(run)
      : stored && fleetByNorm !== null && stored.fleetByNorm === fleetByNorm
        ? stored.verdictByNorm
        : null;
  return {
    minStableFleet: variantFleet(s, "minStable") ?? stored?.minStableFleet ?? null,
    fleetByNorm,
    verdictByNorm,
  };
}

/**
 * Сводка для показа: прогон в браузере плюс то, что знает только расчёт проекта (`fleetFacts`).
 * `fullRun` — итог полного прогона показанного варианта: когда `summary` посчитана посреди
 * проигрывания, вердикт по норме берётся из полного прогона, а не из части окна.
 */
export function withFleetFacts<T extends SimSummaryStored>(
  summary: T,
  s: SimScenario,
  selected: SimVariantId = "calculated",
  fullRun: SimSummaryStored = summary,
): T {
  return { ...summary, ...fleetFacts(s, selected, fullRun) };
}
