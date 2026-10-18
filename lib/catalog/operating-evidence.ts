/** A field observation is stored separately from the manufacturer's specification. */
export type OperatingEvidence = {
  schemaVersion: "operating-evidence-1";
  productSlug: string;
  process: string;
  facility: "warehouse" | "airport" | "medical";
  mode: string;
  unit: string;
  site: string;
  measuredAt: string;
  verifiedAt: string;
  validUntil?: string;
  sourceRef: string;
  sourceUrl?: string;
  measuredBy: string;
  samples: number;
  output: number;
  operatingMinutes: number;
  elapsedMinutes: number;
  basis: "operating-hour" | "shift-hour";
  confirmed: boolean;
};

export const OPERATING_EVIDENCE_MAX_CHARS = 16_000;
export const OPERATING_MODE_RE = /^[a-z][a-z0-9-]{0,59}$/;
const FIELDS = new Set(["schemaVersion", "productSlug", "process", "facility", "mode", "unit", "site", "measuredAt", "verifiedAt", "validUntil", "sourceRef", "sourceUrl", "measuredBy", "samples", "output", "operatingMinutes", "elapsedMinutes", "basis", "confirmed"]);
const UNIT_LABELS = new Set(["м²/ч", "паллет/ч", "рейсов/ч", "ед./ч", "операций/ч", "шт./ч", "строк/ч", "паллетомест/ч", "обходов/ч"]);

export function evidenceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseOperatingEvidence(raw: unknown): OperatingEvidence {
  if (typeof raw === "string") {
    if (raw.length > OPERATING_EVIDENCE_MAX_CHARS) throw new Error("Данные замера слишком велики");
    try { raw = JSON.parse(raw); } catch { throw new Error("Данные замера должны быть корректным JSON"); }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw new Error("Замер должен быть объектом");
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some(key => !FIELDS.has(key))) throw new Error("В замере есть неизвестные поля");
  if (v.schemaVersion !== "operating-evidence-1") throw new Error("Неизвестная версия данных замера");
  const text = (key: string, max: number): string => {
    const value = v[key];
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Замер: заполните поле ${key} (до ${max} символов)`);
    return value.trim();
  };
  const slug = (key: string) => {
    const value = text(key, 80);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw new Error(`Замер: неверное поле ${key}`);
    return value;
  };
  const date = (key: string) => {
    const value = v[key];
    if (!evidenceDate(value)) throw new Error(`Замер: неверная дата ${key}`);
    return value;
  };
  const number = (key: string, min: number, max: number) => {
    const value = v[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Замер: неверное число ${key}`);
    return value;
  };
  const facility = v.facility;
  if (facility !== "warehouse" && facility !== "airport" && facility !== "medical") throw new Error("Замер: неизвестный тип объекта");
  const mode = text("mode", 60);
  if (!OPERATING_MODE_RE.test(mode)) throw new Error("Замер: режим должен быть обозначен коротким кодом, например scrubbing");
  const unit = text("unit", 40);
  if (!UNIT_LABELS.has(unit)) throw new Error("Замер: неизвестная единица выработки");
  const measuredAt = date("measuredAt"), verifiedAt = date("verifiedAt");
  if (verifiedAt < measuredAt) throw new Error("Проверка замера не может предшествовать измерению");
  const validUntil = v.validUntil === undefined ? undefined : date("validUntil");
  if (validUntil !== undefined && validUntil < verifiedAt) throw new Error("Срок применимости замера истёк до его проверки");
  const samples = number("samples", 1, 100_000);
  if (!Number.isInteger(samples)) throw new Error("Число повторов замера должно быть целым");
  const output = number("output", 0, 1e12), operatingMinutes = number("operatingMinutes", Number.MIN_VALUE, 1e9), elapsedMinutes = number("elapsedMinutes", Number.MIN_VALUE, 1e9);
  if (operatingMinutes > elapsedMinutes) throw new Error("Чистое время работы превышает полное время наблюдения");
  if (v.basis !== "operating-hour" && v.basis !== "shift-hour") throw new Error("Выберите базис замера: час чистой работы или час смены со всеми простоями");
  if (!Number.isFinite(output * 60 / (v.basis === "shift-hour" ? elapsedMinutes : operatingMinutes))) throw new Error("Объём и время замера не дают конечной выработки");
  if (typeof v.confirmed !== "boolean") throw new Error("Замер: отсутствует признак подтверждения");
  const sourceUrl = v.sourceUrl === undefined ? undefined : text("sourceUrl", 2000);
  if (sourceUrl !== undefined) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new Error("Замер: неверная ссылка на источник"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Замер: используйте HTTPS-ссылку без учётных данных");
  }
  return {
    schemaVersion: "operating-evidence-1", productSlug: slug("productSlug"), process: slug("process"), facility, mode, unit,
    site: text("site", 200), measuredAt, verifiedAt, ...(validUntil === undefined ? {} : { validUntil }),
    sourceRef: text("sourceRef", 1000), ...(sourceUrl === undefined ? {} : { sourceUrl }), measuredBy: text("measuredBy", 200),
    samples, output, operatingMinutes, elapsedMinutes, basis: v.basis, confirmed: v.confirmed,
  };
}

export function measuredThroughput(evidence: OperatingEvidence): number {
  return evidence.output * 60 / (evidence.basis === "shift-hour" ? evidence.elapsedMinutes : evidence.operatingMinutes);
}

export type OperatingEvidenceDecision = {
  applied: boolean;
  reason: string;
  observedPerH: number | null;
  basis?: OperatingEvidence["basis"];
  evidence?: OperatingEvidence;
};

/** No clock is read here: the calculation date must be part of the captured input. */
export function assessOperatingEvidence(evidence: OperatingEvidence | undefined, context: {
  productSlug: string; process: string; facility: string; mode?: string; unit: string; confirmed: boolean; asOf?: string;
}): OperatingEvidenceDecision {
  const skip = (reason: string): OperatingEvidenceDecision => ({ applied: false, reason, observedPerH: null, ...(evidence ? { evidence } : {}) });
  if (!evidence) return skip("Полевой замер не предоставлен; паспорт и расчётный цикл не являются фактом эксплуатации.");
  try { evidence = parseOperatingEvidence(evidence); } catch { return skip("Запись замера некорректна; замер не использован."); }
  if (!context.confirmed || !evidence.confirmed) return skip("Замер не подтверждён; в расчёте используются исходные паспортные или расчётные данные.");
  if (!evidenceDate(context.asOf)) return skip("Дата оценки применимости замера не зафиксирована; замер не использован.");
  if (evidence.measuredAt > context.asOf || evidence.verifiedAt > context.asOf) return skip("Дата измерения или проверки находится после даты расчёта; замер не использован.");
  if (evidence.validUntil !== undefined && evidence.validUntil < context.asOf) return skip(`Срок применимости замера истёк ${evidence.validUntil}; нужно подтвердить актуальность.`);
  if (evidence.productSlug !== context.productSlug || evidence.process !== context.process || evidence.facility !== context.facility) return skip("Замер относится к другому решению, процессу или типу объекта; он не использован.");
  if (!context.mode || evidence.mode !== context.mode) return skip("Режим работы не выбран или отличается от режима замера; замер не использован.");
  if (evidence.unit !== context.unit) return skip("Единицы замера отличаются от единиц процесса; замер не использован.");
  return { applied: true, observedPerH: measuredThroughput(evidence), basis: evidence.basis, evidence,
    reason: `Полевой замер: ${evidence.site}, ${evidence.measuredAt}, ${evidence.samples} повторов; ${evidence.sourceRef}. Базис: ${evidence.basis === "shift-hour" ? "час смены со всеми простоями" : "час чистой работы"}.` };
}

export function operatingEvidenceText(raw: unknown): string {
  try {
    const e = parseOperatingEvidence(raw);
    const value = measuredThroughput(e);
    return `${Number(value.toFixed(2))} ${e.unit}; ${e.basis === "shift-hour" ? "за час смены, включая простои" : "за час чистой работы"}; ${e.mode}; ${e.site}; ${e.measuredAt}; повторов: ${e.samples}; ${e.confirmed ? "подтверждён" : "не подтверждён"}${e.validUntil ? `; применим до ${e.validUntil}` : "; срок применимости не задан"}. Источник: ${e.sourceRef}; измерил: ${e.measuredBy}.`;
  } catch { return "Данные замера некорректны; для расчёта не используются."; }
}
