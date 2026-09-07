import { withParamDefaults } from "@/lib/economics/assumptions";
import type { FacilityParams } from "@/lib/economics/types";

/**
 * Шаги подбора и состояние, которое между ними копится.
 *
 * Состояние живёт в query-строке, а не в React: обновление страницы на середине опроса не
 * должно терять введённое, а ссылку на шаг должно быть можно отправить коллеге. Цена этого —
 * query-строка это пользовательский ввод, и доверять ей нельзя.
 */
export type WizardStepKey = "industry" | "facility" | "params" | "solutions" | "calc";

export const WIZARD_STEPS: { key: WizardStepKey; title: string }[] = [
  { key: "industry", title: "Отрасль" },
  { key: "facility", title: "Тип объекта" },
  { key: "params", title: "Параметры объекта" },
  { key: "solutions", title: "Решения" },
  { key: "calc", title: "Расчёт" },
];

export type WizardState = {
  industry: string | null;
  facility: string | null;
  objectName: string | null;
  params: FacilityParams;
  /** Хватает ли собранного, чтобы считать экономику. */
  complete: boolean;
};

type Query = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  const t = typeof s === "string" ? s.trim() : "";
  return t === "" ? null : t;
}

/**
 * Число из query-строки.
 *
 * Верхних границ у параметров объекта нет нигде в приложении, и придумывать их здесь было бы
 * изобретением правила, которого не знает остальной код. Отрицательное — другое дело: это не
 * вывод, а мусор, и форма его тоже не принимает (`min=0`). Всё остальное уходит движку, у
 * которого на вырожденный ввод есть типизированный ответ `invalid_inputs`.
 */
function num(v: string | string[] | undefined): number | undefined {
  const s = one(v);
  if (s === null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseWizardParams(query: Query): WizardState {
  const industry = one(query.industry);
  const facility = one(query.facility);
  // Валидация чисел — через тот же withParamDefaults, что защищает путь сохранения. Второго
  // пути не заводим: два места, решающих, что такое корректные параметры, неизбежно разъедутся.
  const params = withParamDefaults({
    areaM2: num(query.area),
    opsPerDay: num(query.ops),
    staffCount: num(query.staff),
  });
  const hasAll =
    industry !== null && facility !== null &&
    num(query.area) !== undefined && num(query.ops) !== undefined && num(query.staff) !== undefined;
  return {
    industry,
    facility,
    objectName: one(query.obj)?.slice(0, 80) ?? null,
    params,
    complete: hasAll,
  };
}

export function buildWizardQuery(state: {
  industry?: string | null;
  facility?: string | null;
  objectName?: string | null;
  params?: Partial<FacilityParams> | null;
}): string {
  const q = new URLSearchParams();
  if (state.industry) q.set("industry", state.industry);
  if (state.facility) q.set("facility", state.facility);
  if (state.objectName) q.set("obj", state.objectName.slice(0, 80));
  const p = state.params;
  if (p?.areaM2 !== undefined) q.set("area", String(p.areaM2));
  if (p?.opsPerDay !== undefined) q.set("ops", String(p.opsPerDay));
  if (p?.staffCount !== undefined) q.set("staff", String(p.staffCount));
  return q.toString();
}
