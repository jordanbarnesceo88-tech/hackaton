import { ORGANIZER_DATA_VERSION } from "../data/organizer/version.generated";
import type { LiveInputs } from "../projects/recalc";
import { validateScenarioSpecs } from "../projects/validate";
import { applyDefaults } from "../tz/params/schema";
import { hasErrors, validateParamValues } from "../tz/params/validate";
import { isFacilitySlug, processesForFacility } from "../tz/processes";
import type { FacilitySlug } from "../tz/processes";
import type { Band, ParamIssue, ParamValues, ProjectResults, ScenarioKind, ScenarioSpec } from "../tz/types";

/**
 * Разбор и проверка входа расчёта через API (POST /api/v1/calculate и POST /api/v1/projects,
 * ТЗ §3.8.1, §3.2.4) и короткая сводка результата для интеграций. Чистые функции: проверка
 * параметров — та же, что у формы и загрузки файла (validateParamValues с origin 'api': лишний
 * ключ — ошибка), проверка сценариев — та же, что у сохранения проекта (validateScenarioSpecs).
 */

/** Допустимые типы объектов — для сообщений. */
export const FACILITY_HINT = "warehouse (склад), airport (аэропорт) или medical (медучреждение)";

/** Тип объекта из тела запроса. */
export function facilityOf(v: unknown): FacilitySlug | null {
  return typeof v === "string" && isFacilitySlug(v) ? v : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Итог проверки входа расчёта: готовые параметры и сценарии или отказ 422 с подробностями. */
export type CalcInputCheck =
  | { ok: true; params: ParamValues; scenarios: ScenarioSpec[] | undefined; warnings: ParamIssue[] }
  | { ok: false; error: string; details: { issues?: ParamIssue[]; errors?: string[] } };

/**
 * Параметры и сценарии запроса против живых описаний параметров и каталога:
 * - params не задан — базовые значения организатора (демо-данные); задан — объект «ключ →
 *   значение», ошибки проверки → отказ с ParamIssue[], предупреждения (вне диапазона
 *   организатора) → в ответе;
 * - scenarios не задан — сценарии по умолчанию из подбора (как у «Нового проекта»); задан —
 *   3–10 сценариев с ровно одним «Как есть», продукты — из каталога этого типа объекта.
 */
export function checkCalcInput(
  live: LiveInputs,
  facility: FacilitySlug,
  rawParams: unknown,
  rawScenarios: unknown,
): CalcInputCheck {
  if (rawParams !== undefined && rawParams !== null && !isPlainObject(rawParams)) {
    return {
      ok: false,
      error: "params — объект «ключ параметра → значение»; список ключей — GET /api/v1/facility-types/{slug}/params",
      details: {},
    };
  }
  const checked = validateParamValues(live.paramDefs, (rawParams ?? {}) as Record<string, unknown>, { origin: "api" });
  if (hasErrors(checked.issues)) {
    const labels = [...new Set(checked.issues.filter((i) => i.severity === "error").map((i) => `«${i.label}»`))];
    return {
      ok: false,
      error: `Параметры объекта не прошли проверку — исправьте: ${labels.join(", ")}`,
      details: { issues: checked.issues },
    };
  }
  let scenarios: ScenarioSpec[] | undefined;
  if (rawScenarios !== undefined && rawScenarios !== null) {
    const specs = validateScenarioSpecs(
      rawScenarios,
      facility,
      live.products.map((p) => p.slug),
      processesForFacility(facility).map((p) => p.slug),
    );
    if (!specs.ok) {
      return { ok: false, error: "Сценарии не прошли проверку — исправьте и повторите", details: { errors: specs.errors } };
    }
    scenarios = specs.value;
  }
  return {
    ok: true,
    params: applyDefaults(live.paramDefs, checked.values),
    scenarios,
    warnings: checked.issues.filter((i) => i.severity !== "error"),
  };
}

/** Версии, с которыми выполнен расчёт (ТЗ §3.1.5 — воспроизводимость). */
export type CalcVersions = {
  modelVersion: string;
  simModelVersion: string;
  /** Хэш снимков продуктов, нормативов и описаний параметров (как у сохранённого проекта). */
  dataVersion: string;
  calculatedAt: string;
  /** Версии выгрузок организатора, на которых собрана эта сборка. */
  organizer: typeof ORGANIZER_DATA_VERSION;
  /** Откуда описания параметров: БД (администрируемые) или код (данные ещё не засеяны). */
  paramDefsFrom: "db" | "code";
};

export function calcVersions(results: ProjectResults, live: LiveInputs): CalcVersions {
  return {
    modelVersion: results.modelVersion,
    simModelVersion: results.simModelVersion,
    dataVersion: results.dataVersion,
    calculatedAt: results.calculatedAt,
    organizer: ORGANIZER_DATA_VERSION,
    paramDefsFrom: live.paramDefsFrom,
  };
}

/** Строка сводки сценария: ключевые показатели без трассировки и денежных потоков. */
export type ScenarioSummary = {
  key: string;
  name: string;
  kind: ScenarioKind;
  status: "ok" | "refused";
  recommended: boolean;
  capexRub: number | null;
  opexYearRub: number | null;
  effectYearRub: number | null;
  paybackYears: number | null;
  band: Band | null;
  roiTzPct: number | null;
  npvRub: number | null;
  discountedPaybackYears: number | null;
  tcoRub: number | null;
  tcoYears: number | null;
  /** Состав оборудования: продукт, процесс, число роботов и зарядок. */
  equipment: { process: string; productSlug: string; productName: string; robots: number | null; chargers: number }[];
  /** Вердикт имитации (CONFIRMED / NOT_CONFIRMED); null — не проверялся. */
  simVerdict: string | null;
  /** Причина отказа расчёта сценария; null — рассчитан. */
  refusal: { reason: string; message: string; fields: string[] } | null;
};

/**
 * Сводка результатов для интеграций: по строке на сценарий. Числа — те же, что в
 * `results.results` (ничего не пересчитывается), здесь они только собраны в плоскую форму.
 */
export function summarizeResults(results: ProjectResults): ScenarioSummary[] {
  const recommended = results.conclusion.recommendedScenarioKey;
  return results.results.map((r) => {
    const equipment = r.items.map((i) => ({
      process: i.process,
      productSlug: i.productSlug,
      productName: i.productName,
      robots: i.n,
      chargers: i.chargers,
    }));
    const sim = results.sim[r.key];
    const common = {
      key: r.key,
      name: r.name,
      kind: r.kind,
      recommended: recommended === r.key,
      equipment,
      simVerdict: sim ? sim.verdict : null,
    };
    if (r.status === "ok") {
      return {
        ...common,
        status: "ok" as const,
        capexRub: r.capexRub,
        opexYearRub: r.opexYearRub,
        effectYearRub: r.effectYearRub,
        paybackYears: r.paybackYears,
        band: r.band,
        roiTzPct: r.roiTzPct,
        npvRub: r.npvRub,
        discountedPaybackYears: r.discountedPaybackYears,
        tcoRub: r.tcoRub,
        tcoYears: r.tcoYears,
        refusal: null,
      };
    }
    return {
      ...common,
      status: "refused" as const,
      capexRub: null,
      opexYearRub: null,
      effectYearRub: null,
      paybackYears: null,
      band: null,
      roiTzPct: null,
      npvRub: null,
      discountedPaybackYears: null,
      tcoRub: null,
      tcoYears: null,
      refusal: { reason: r.refusal.reason, message: r.refusal.message, fields: r.refusal.fields },
    };
  });
}
