import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNum } from "@/lib/format/rub";
import { cleaningDay, parseCleaningProfile } from "@/lib/tz/econ/cleaning-profile";
import type { CleaningProfile } from "@/lib/tz/types";

export type CleaningScheduleSegment = { kind: "care" | "cleaning" | "charging"; startH: number; endH: number };
const PHASES = {
  care: { label: "Ежедневный уход", color: "bg-chart-4" },
  cleaning: { label: "Уборка", color: "bg-chart-3" },
  charging: { label: "Зарядка", color: "bg-chart-1" },
} as const;

/** One finite day, shared with the economic model; never a robot telemetry trace. */
export function buildCleaningSchedule(value: CleaningProfile) {
  const profile = parseCleaningProfile(value), day = cleaningDay(profile);
  const segments: CleaningScheduleSegment[] = [];
  let cursor = day.careHoursPerDay;
  if (cursor > 0) segments.push({ kind: "care", startH: 0, endH: cursor });
  let kind: "cleaning" | "charging" = "cleaning";
  // Validated work and charge intervals are at least one minute: at most 1440 phases, plus care.
  for (let index = 0; cursor < profile.windowH && index < 1440; index++) {
    const cycleH = profile.workBeforeChargeH + profile.chargeH;
    const phaseEnd = day.careHoursPerDay + Math.floor(index / 2) * cycleH + (kind === "cleaning" ? profile.workBeforeChargeH : cycleH);
    const endH = phaseEnd >= profile.windowH - 1e-9 ? profile.windowH : phaseEnd;
    segments.push({ kind, startH: cursor, endH });
    cursor = endH;
    kind = kind === "cleaning" ? "charging" : "cleaning";
  }
  if (cursor !== profile.windowH) throw new Error("Расписание не достигло конца рабочего окна.");
  return { profile, day, segments };
}

function elapsed(hours: number): string {
  const seconds = Math.round(hours * 3600);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
}

export type CleaningScheduleProps = {
  profile: CleaningProfile; fleet: number; requiredM2PerDay: number; productName: string;
};

export function CleaningSchedule({ profile: input, fleet, requiredM2PerDay, productName }: CleaningScheduleProps) {
  let schedule: ReturnType<typeof buildCleaningSchedule>;
  try { schedule = buildCleaningSchedule(input); }
  catch (failure) { return <Card data-cleaning-schedule><CardContent><p role="alert">Не удалось построить расписание: {failure instanceof Error ? failure.message : "проверьте рабочий профиль уборки."}</p></CardContent></Card>; }
  const { profile, day, segments } = schedule;
  const comparable = Number.isSafeInteger(fleet) && fleet > 0 && fleet <= 2000 && Number.isFinite(requiredM2PerDay) && requiredM2PerDay > 0;
  const capacity = comparable ? day.capacityM2PerDay * fleet : null;
  const ratio = capacity === null ? null : capacity / requiredM2PerDay * 100;
  const difference = capacity === null ? null : capacity - requiredM2PerDay;
  const num = (value: number) => formatNum(value, 2);
  return <Card data-cleaning-schedule>
    <CardHeader><CardTitle as="h3">Расписание по рабочим допущениям</CardTitle>
      <p className="text-sm text-muted-foreground">{productName} · аналитический график одного типового робота. Это не 3D-имитация, полевая проверка или фактическая телеметрия.</p>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-5">
      <p className="text-sm">{comparable ? `Парк: ${fleet} роботов; для каждого отдельная зарядная станция и то же рабочее окно.` : "Для сравнения с планом задайте положительное целое число роботов (до 2000) и требуемую площадь в день."} Полный заряд принят к началу каждого дня. Режим: {profile.mode}.</p>
      <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Окно / активная уборка одного робота</dt><dd className="mt-1 text-sm font-medium tabular-nums">{num(profile.windowH)} / {num(day.activeHoursPerDay)} ч</dd></div>
        <div><dt className="text-xs text-muted-foreground">Расчётная площадь одного робота в день</dt><dd className="mt-1 text-sm font-medium tabular-nums">{num(day.capacityM2PerDay)} м²</dd></div>
        <div><dt className="text-xs text-muted-foreground">Расчётная площадь парка / план в день</dt><dd className="mt-1 text-sm font-medium tabular-nums">{capacity === null ? "Не задано" : `${num(capacity)} / ${num(requiredM2PerDay)} м²`}</dd></div>
      </dl>
      {ratio !== null && difference !== null && <div className="grid min-w-0 gap-2 border-y py-3">
        <p className="text-sm font-medium tabular-nums">{num(ratio)}% плана по расчётной площади. {difference >= 0 ? `Запас ${num(difference)} м²/день.` : `Дефицит ${num(-difference)} м²/день.`}</p>
        <div className="h-2 overflow-hidden bg-muted" role="meter" aria-label="Расчётное покрытие плана площади" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, ratio)} aria-valuetext={`${num(ratio)}% плана; ${difference >= 0 ? "расчётный запас" : "расчётный дефицит"} ${num(Math.abs(difference))} м² в день`}>
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, ratio)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">Это сравнение мощности с планом при указанных допущениях; принятая заказчиком площадь и качество уборки ещё не подтверждены.</p>
      </div>}
      <figure className="grid min-w-0 gap-2">
        <figcaption className="text-sm font-medium">Рабочее окно одного робота</figcaption>
        <div className="flex h-10 w-full overflow-hidden border" role="img" aria-label={`Уход ${num(profile.dailyCareMin)} мин, уборка ${num(day.activeHoursPerDay)} ч, зарядка внутри окна ${num(day.chargeHoursPerDay)} ч. Полное расписание доступно ниже.`}>
          {segments.map((segment, index) => <span key={index} aria-hidden="true" className={`${PHASES[segment.kind].color} h-full shrink-0 border-r border-background/50 last:border-r-0`} style={{ width: `${(segment.endH - segment.startH) / profile.windowH * 100}%` }} title={`${PHASES[segment.kind].label}: ${elapsed(segment.startH)}–${elapsed(segment.endH)}`} />)}
        </div>
        <div className="flex justify-between text-xs tabular-nums text-muted-foreground"><span>00:00:00</span><span>{elapsed(profile.windowH)}</span></div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">{Object.entries(PHASES).map(([key, phase]) => <li key={key} className="flex items-center gap-2"><span aria-hidden="true" className={`size-3 ${phase.color}`} />{phase.label}</li>)}</ul>
      </figure>
      <section className="grid min-w-0 gap-2 border-t pt-3">
        <h4 className="text-sm font-medium">После рабочего окна — восстановить заряд к следующему дню</h4>
        <p className="text-sm">{day.remainingChargeH > 0 ? `По допущениям нужно ещё ${num(day.remainingChargeH)} ч зарядки вне окна; доступно ${num(day.overnightH)} ч до следующего рабочего дня.` : `Полный цикл зарядки завершён внутри окна; до следующего дня остаётся ${num(day.overnightH)} ч.`}</p>
        {day.remainingChargeH > 0 && <div className="grid gap-1">
          <div className="flex h-4 overflow-hidden border bg-muted" role="img" aria-label={`После окна: восстановление заряда ${num(day.remainingChargeH)} ч из ${num(day.overnightH)} ч до следующего дня.`}>
            <span aria-hidden="true" className="h-full bg-chart-1" style={{ width: `${Math.min(100, day.remainingChargeH / day.overnightH * 100)}%` }} title={`Зарядка вне окна: ${elapsed(profile.windowH)}–${elapsed(profile.windowH + day.remainingChargeH)}`} />
          </div>
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground"><span>{elapsed(profile.windowH)}</span><span>24:00:00 — следующее окно</span></div>
        </div>}
        <p className="text-xs text-muted-foreground">После частичного рабочего цикла принят полный цикл зарядки как консервативная оценка. Уровень заряда и кривая заряда АКБ не рассчитываются; вне окна площадь уборки не добавляется.</p>
      </section>
      <details className="min-w-0 border-t pt-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Интервалы расписания и основания расчёта</summary>
        <p className="mt-3 text-xs text-muted-foreground">Время от начала рабочего окна, округлённое до секунды. Уход выполняется один раз в начале окна; строки относятся к одному типовому роботу.</p>
        <ol className="mt-3 grid min-w-0 divide-y border-y text-sm">{segments.map((segment, index) => <li key={index} className="grid min-w-0 gap-x-4 gap-y-1 py-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
          <span className="tabular-nums">{elapsed(segment.startH)}–{elapsed(segment.endH)}</span><span>{PHASES[segment.kind].label}</span><span className="tabular-nums">{num(segment.endH - segment.startH)} ч</span>
        </li>)}
          {day.remainingChargeH > 0 && <li className="grid min-w-0 gap-x-4 gap-y-1 py-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]"><span className="tabular-nums">{elapsed(profile.windowH)}–{elapsed(profile.windowH + day.remainingChargeH)}</span><span>Вне окна: восстановление заряда</span><span className="tabular-nums">{num(day.remainingChargeH)} ч</span></li>}
        </ol>
        <dl className="mt-4 grid min-w-0 gap-3 text-sm">{[
          ["Выработка за активный час", `${num(profile.throughputM2PerH)} м²/ч; basis: active-hour`],
          ["Источник рабочей оценки", profile.source], ["Дата оценки", profile.date], ["Основание и допущения", profile.reason],
        ].map(([label, value]) => <div key={label} className="min-w-0 break-words"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{value}</dd></div>)}</dl>
      </details>
      <p className="text-xs leading-relaxed text-muted-foreground">Площадь равна активным часам × рабочей выработке × числу роботов. Одинаковое расписание и независимые станции не проверяют совместное движение, доступ к воде, лифты, людей, доступность персонала для ухода, отказы и качество уборки. Планируйте эти ограничения и проверяйте их на объекте.</p>
    </CardContent>
  </Card>;
}
