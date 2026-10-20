import type { CleaningProfile } from "../types";

/** Working assumptions are scenario inputs, never an approved field observation. */
export function parseCleaningProfile(value: unknown, options: { deferDailySchedule?: boolean } = {}): CleaningProfile {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Профиль уборки должен быть JSON-объектом");
  const v = value as Record<string, unknown>;
  const fields = ["basis", "throughputM2PerH", "workBeforeChargeH", "chargeH", "dailyCareMin", "windowH", "initiallyCharged", "careWithinWindow", "automatableLabourShare", "mode", "source", "date", "reason"];
  if (Object.keys(v).some(key => !fields.includes(key)) || v.basis !== "active-hour" || v.initiallyCharged !== true || v.careWithinWindow !== true) throw new Error("Профиль уборки: нужны выработка за активный час, полностью заряженный робот и уход внутри рабочего окна");
  const num = (key: string, min: number, max: number) => {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new Error(`Профиль уборки: ${key} — число от ${min} до ${max}`);
    return n;
  };
  const text = (key: string, max: number) => {
    const s = v[key];
    if (typeof s !== "string" || !s.trim() || s.length > max) throw new Error(`Профиль уборки: ${key} — непустая строка до ${max} символов`);
    return s.trim();
  };
  const windowH = num("windowH", 1 / 60, 24), dailyCareMin = num("dailyCareMin", 0, 1440);
  if (!options.deferDailySchedule && dailyCareMin / 60 >= windowH) throw new Error("Профиль уборки: уход занимает всё рабочее окно, времени для уборки не остаётся");
  const date = text("date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Профиль уборки: дата должна быть существующей датой YYYY-MM-DD");
  const profile: CleaningProfile = { basis: "active-hour", throughputM2PerH: num("throughputM2PerH", 0.01, 1_000_000), workBeforeChargeH: num("workBeforeChargeH", 1 / 60, 24),
    chargeH: num("chargeH", 1 / 60, 24), dailyCareMin, windowH, initiallyCharged: true, careWithinWindow: true,
    automatableLabourShare: num("automatableLabourShare", 0, 1), mode: text("mode", 100), source: text("source", 1000), date, reason: text("reason", 1000) };
  const day = cleaningDay(profile);
  if (!options.deferDailySchedule && day.remainingChargeH > day.overnightH + 1e-9) throw new Error("Профиль уборки: вне рабочего окна не хватает времени восстановить полный заряд к следующему дню. Сократите окно или уточните цикл; каждый день начинать с бесплатного полного заряда нельзя");
  return profile;
}

/** Care reserves the beginning of the finite day; no pointless final recharge is required. */
export function cleaningDay(profile: CleaningProfile) {
  const availableH = profile.windowH - profile.dailyCareMin / 60;
  const cycleH = profile.workBeforeChargeH + profile.chargeH;
  const cycles = Math.floor(availableH / cycleH);
  const activeHoursPerDay = cycles * profile.workBeforeChargeH + Math.min(profile.workBeforeChargeH, Math.max(0, availableH - cycles * cycleH));
  const tail = Math.max(0, availableH - cycles * cycleH);
  // A partial final work interval conservatively requires a full recharge; no linear SOC claim.
  const remainingChargeH = tail < 1e-9 ? 0 : tail <= profile.workBeforeChargeH ? profile.chargeH : cycleH - tail;
  return { activeHoursPerDay, chargeHoursPerDay: availableH - activeHoursPerDay,
    capacityM2PerDay: activeHoursPerDay * profile.throughputM2PerH, careHoursPerDay: profile.dailyCareMin / 60,
    remainingChargeH, overnightH: 24 - profile.windowH };
}

export function cleaningProfileDescription(profile: CleaningProfile): string {
  const p = parseCleaningProfile(profile), day = cleaningDay(p);
  return `Рабочая оценка уборки, не подтверждённый замер: ${p.throughputM2PerH} м²/активный ч; работа ${p.workBeforeChargeH} ч / зарядка ${p.chargeH} ч; окно ${p.windowH} ч, уход ${p.dailyCareMin} мин в начале окна; первоначально полный заряд. Активно ${day.activeHoursPerDay} ч, ${day.capacityM2PerDay} м²/робот/день; восстановление заряда после окна ${day.remainingChargeH} из доступных ${day.overnightH} ч (после частичной работы принят полный цикл зарядки). Доля роботизируемого труда ${p.automatableLabourShare}. Режим: ${p.mode}; источник: ${p.source}, ${p.date}; ${p.reason}. На каждого робота отдельная зарядка; вода, лифты, люди, очереди и поломки не смоделированы.`;
}
