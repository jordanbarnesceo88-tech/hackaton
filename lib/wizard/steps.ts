import { withParamDefaults } from "@/lib/economics/assumptions";
import type { FacilityParams } from "@/lib/economics/types";
// Потолки на карту занятости берутся у границы сохранения, а не заводятся заново: ссылка и
// сохранение обязаны считать годным одно и то же, иначе набор, прошедший по ссылке, отвергается
// при сохранении — и наоборот.
import { MAX_TASK_KEYS, MAX_TASK_SLUG_LEN } from "@/lib/analyses/validate";

/**
 * Шаги подбора и состояние, которое между ними копится.
 *
 * Состояние живёт в query-строке, а не в React: обновление страницы на середине опроса не
 * должно терять введённое, а ссылку на шаг должно быть можно отправить коллеге. Цена этого —
 * query-строка это пользовательский ввод, и доверять ей нельзя.
 */
export type WizardStepKey =
  | "industry"
  | "facility"
  | "params"
  | "staffing"
  | "solutions"
  | "calc";

export const WIZARD_STEPS: { key: WizardStepKey; title: string }[] = [
  { key: "industry", title: "Отрасль" },
  { key: "facility", title: "Тип объекта" },
  { key: "params", title: "Параметры объекта" },
  // Занятость стоит ПЕРЕД решениями, а не после: экран сравнения считает экономику всех
  // решений сразу, и без занятости семь из одиннадцати ему отказывают. Спросить после —
  // значит показать список, наполовину состоящий из отказов.
  { key: "staffing", title: "Кто чем занят" },
  { key: "solutions", title: "Решения" },
  { key: "calc", title: "Расчёт" },
];

export type WizardState = {
  industry: string | null;
  facility: string | null;
  objectName: string | null;
  params: FacilityParams;
  /**
   * Хватает ли собранного, чтобы считать экономику. Считается ТОЛЬКО по числам: движок
   * потребляет `params`, а отрасль в расчёт не входит вовсе. Требовать её значило молча
   * отбрасывать все три числа из ссылки, у которой отрасль потерялась при пересылке, —
   * и стартовать с 1000/500/10, противореча тому, что человек видит в адресной строке.
   */
  complete: boolean;
  /**
   * Поля, которые были присланы, но не приняты. Без этого «прислали −5» и «не прислали
   * ничего» неотличимы: оба дают значение по умолчанию, и человек, набравший −5, видит на
   * следующем экране 500 и не понимает, куда делось введённое.
   */
  rejected: ("area" | "ops" | "staff")[];
  /**
   * ТОЛЬКО те числа, которые человек прислал и которые приняты. В `params` их не отличить:
   * туда `withParamDefaults` уже подставил 1000 / 500 / 10 за всё недостающее, и «объект на
   * 1000 м²» неотличимо от «площадь не назвали».
   *
   * Заведено потому, что `complete: false` вызывающие трактовали как «параметров нет» и
   * передавали дальше `null`: человек вводил площадь 8000, персонал 25 и объём операций 0,
   * ноль справедливо отклонялся — и вместе с ним пропадали оба годных числа, после чего
   * калькулятор уверенно считал по 1000 / 500 / 10. Худший вид ошибки для продукта, который
   * обещает защитимое число: ответ дан не на те данные, и на экране об этом ни слова.
   */
  provided: Partial<FacilityParams>;
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
  // Строго больше нуля. Ноль здесь — не «мало», а вырожденный ввод: при нулевом персонале
  // замещать некого, базовые затраты равны нулю, и КАЖДОЕ решение становится убыточным —
  // после чего экран уверенно объясняет это тем, что «объём операций слишком мал для
  // автоматизации такого класса». Уверенное неверное объяснение хуже отказа принять ввод.
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Префикс ключей занятости в query-строке: `task_<slug категории>=<человек>`.
 *
 * Отдельные ключи, а не один упакованный параметр, — по той же причине, по которой площадь и
 * персонал лежат отдельно: ссылку на шаг можно прочитать глазами и поправить руками, а
 * упакованный blob этого не даёт.
 */
const TASK_PREFIX = "task_";

/**
 * Занятость из query-строки. Ноль ДОПУСТИМ и значим — «этой задачей никто не занят», — в
 * отличие от площади и персонала, где ноль вырожден. Различие не косметическое: по отсутствию
 * ключа движок берёт норматив категории, по нулю считает, что замещать некого.
 */
function taskNum(v: string | string[] | undefined): number | undefined {
  const s = one(v);
  if (s === null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseTaskStaffing(query: Query): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith(TASK_PREFIX)) continue;
    if (count >= MAX_TASK_KEYS) break;
    const slug = key.slice(TASK_PREFIX.length);
    if (!slug || slug.length > MAX_TASK_SLUG_LEN) continue;
    const n = taskNum(raw);
    // Негодное значение отбрасывается вместе с ключом, а не превращается в ноль: ноль здесь
    // означал бы «никто не занят», то есть утверждение, которого человек не делал.
    if (n === undefined) continue;
    out[slug] = n;
    count++;
  }
  // Пустая карта не создаётся — её отсутствие это другая инструкция, чем пустота.
  return count > 0 ? out : undefined;
}

export function parseWizardParams(query: Query): WizardState {
  const industry = one(query.industry);
  const facility = one(query.facility);
  // Валидация чисел — через тот же withParamDefaults, что защищает путь сохранения. Второго
  // пути не заводим: два места, решающих, что такое корректные параметры, неизбежно разъедутся.
  const taskStaffing = parseTaskStaffing(query);
  const params = withParamDefaults({
    areaM2: num(query.area),
    opsPerDay: num(query.ops),
    staffCount: num(query.staff),
    taskStaffing,
  });
  const fields = [
    ["area", query.area],
    ["ops", query.ops],
    ["staff", query.staff],
  ] as const;
  const rejected = fields
    .filter(([, raw]) => one(raw) !== null && num(raw) === undefined)
    .map(([name]) => name);
  const hasAll = fields.every(([, raw]) => num(raw) !== undefined);

  // Собирается из сырого query, а не из `params`: к этому моменту в `params` уже стоят
  // умолчания, и принятое от подставленного там не отличить.
  const provided: Partial<FacilityParams> = {};
  const areaM2 = num(query.area);
  const opsPerDay = num(query.ops);
  const staffCount = num(query.staff);
  if (areaM2 !== undefined) provided.areaM2 = areaM2;
  if (opsPerDay !== undefined) provided.opsPerDay = opsPerDay;
  if (staffCount !== undefined) provided.staffCount = staffCount;
  // Занятость — тоже присланное человеком, и в `provided` ей место наравне с тремя числами.
  // Без неё вызывающий, передающий дальше `provided` (неполный набор), молча терял ответы
  // экрана «кто чем занят», и расчёт снова упирался в staffing_required — то есть починка
  // одного места ломала соседнее.
  if (taskStaffing) provided.taskStaffing = taskStaffing;

  return {
    industry,
    facility,
    objectName: one(query.obj)?.slice(0, 80) ?? null,
    params,
    complete: hasAll,
    rejected: [...rejected],
    provided,
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
  for (const [slug, n] of Object.entries(p?.taskStaffing ?? {})) {
    if (Number.isFinite(n) && n >= 0) q.set(`${TASK_PREFIX}${slug}`, String(n));
  }
  return q.toString();
}
