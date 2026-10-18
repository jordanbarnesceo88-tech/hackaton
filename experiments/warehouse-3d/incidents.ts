export type IncidentCode = "DRIVE_FAULT" | "LOCALIZATION_LOST" | "LINK_LOST" | "BATTERY_WARNING";
export type IncidentStatus = "reported" | "acknowledged" | "diagnosing" | "recovering" | "resolved";
export type IncidentSchedule = { id: string; code: IncidentCode; robotId: number; detectedAtS: number; ackAtS: number; diagnosingAtS: number; recoveryAtS: number; resolvedAtS: number };
export type IncidentConfig = { version: "incidents-1.0.0"; enabled: boolean; schedule: IncidentSchedule[] };
type Position = { x: number; y: number };
type IncidentBody = Position & { id: number; incident?: DemoIncident | null; operationalState?: string };
export type DemoIncident = {
  id: string; code: IncidentCode; robotId: number; label: string; severity: "critical" | "warning";
  status: IncidentStatus; active: boolean; haltsRobot: boolean; simulation: true; workflow: "automatic-demo";
  position: Position; x: number; y: number; detectedAtS: number; ackAtS: number | null; diagnosingAtS: number | null; recoveryAtS: number | null; resolvedAtS: number | null;
  planned: IncidentSchedule; observedAtS: number; ageS: number; instructions: string[]; impact: string; taskHandling: string; positionSource: "model-at-detection" | "last-known-model-pose";
};
export type IncidentEvent = { id: string; tS: number; observedAtS: number; type: "incident"; incidentId: string; robotId: number; code: IncidentCode; from?: IncidentStatus; to: IncidentStatus; simulation: true; workflow: "automatic-demo" };
export type IncidentRuntime = { config: IncidentConfig; incidents: DemoIncident[]; events: IncidentEvent[]; downtimeByRobotS: number[]; warningByRobotS: number[] };
export type IncidentState = { demoIncidents?: IncidentRuntime; robots: IncidentBody[]; tS: number };

const DEFINITIONS: Record<IncidentCode, { label: string; severity: "critical" | "warning"; haltsRobot: boolean; instructions: string[]; impact: string }> = {
  DRIVE_FAULT: { label: "Ошибка привода", severity: "critical", haltsRobot: true, instructions: ["Обозначить остановившуюся машину и сохранить безопасный проход.", "Проверить код привода, питание и механическое препятствие по инструкции производителя.", "После проверки выполнить разрешённый производителем тест движения."], impact: "Движение и операции приостановлены; корпус остаётся препятствием для других роботов." },
  LOCALIZATION_LOST: { label: "Потеря локализации", severity: "critical", haltsRobot: true, instructions: ["Остановить выполнение задания до подтверждения положения.", "Проверить карту, ориентиры и доступность локализации.", "Подтвердить положение перед возобновлением маршрута."], impact: "Защитная остановка: движение с недостоверной локализацией запрещено." },
  LINK_LOST: { label: "Потеря связи", severity: "critical", haltsRobot: true, instructions: ["Считать отображаемую позицию последней известной, не подтверждённой живым каналом.", "Проверить доступность сети, шлюза и бортового контроллера.", "Сверить состояние задания и положение после восстановления канала."], impact: "В этой модели связь потеряна вместе с защитной остановкой. Скрытое автономное движение не моделируется." },
  BATTERY_WARNING: { label: "Предупреждение контроллера АКБ", severity: "warning", haltsRobot: false, instructions: ["Считать диагностический код BMS и проверить его значение по документации производителя.", "Сверить состояние батареи с реальной диагностикой контроллера.", "Проверить батарею и контроллер, если предупреждение повторяется."], impact: "Учебный диагностический сигнал BMS без остановки. Он не означает низкий SOC; заряд, напряжение и температура не подменяются." },
};
const STAGES: [IncidentStatus, keyof Pick<IncidentSchedule, "detectedAtS" | "ackAtS" | "diagnosingAtS" | "recoveryAtS" | "resolvedAtS">][] = [["reported", "detectedAtS"], ["acknowledged", "ackAtS"], ["diagnosing", "diagnosingAtS"], ["recovering", "recoveryAtS"], ["resolved", "resolvedAtS"]];

export function defaultDemoIncidents(kind: "warehouse" | "cleaning", count: number): IncidentConfig {
  const start = kind === "warehouse" ? 1180 : 160;
  const definitions: [IncidentCode, number, number][] = [["DRIVE_FAULT", 0, 0], ["BATTERY_WARNING", 3, 40], ["LOCALIZATION_LOST", 1, 80], ["LINK_LOST", 2, 160]];
  return { version: "incidents-1.0.0", enabled: true, schedule: definitions.map(([code, robotId, offset], i) => {
    const detectedAtS = start + offset;
    return { id: `demo-${i + 1}`, code, robotId: Math.min(robotId, count - 1), detectedAtS, ackAtS: detectedAtS + 15, diagnosingAtS: detectedAtS + 30, recoveryAtS: detectedAtS + 120, resolvedAtS: detectedAtS + 180 };
  }) };
}

export function createIncidentRuntime(config: IncidentConfig | undefined, count: number): IncidentRuntime | undefined {
  if (!config) return undefined;
  if (config.version !== "incidents-1.0.0" || typeof config.enabled !== "boolean" || !Array.isArray(config.schedule) || config.schedule.length > 32) throw new Error("Недопустимый сценарий инцидентов");
  const ids = new Set<string>();
  for (const s of config.schedule) {
    const times = STAGES.map(([, key]) => s[key]);
    if (!s.id || ids.has(s.id) || !DEFINITIONS[s.code] || !Number.isInteger(s.robotId) || s.robotId < 0 || s.robotId >= count || times.some((t, i) => !Number.isFinite(t) || t < 0 || (i > 0 && t <= times[i - 1]!))) throw new Error("Недопустимое расписание инцидентов");
    ids.add(s.id);
  }
  return { config: structuredClone(config), incidents: [], events: [], downtimeByRobotS: Array<number>(count).fill(0), warningByRobotS: Array<number>(count).fill(0) };
}

/** Only canonical observations create incidents or advance their automatic demo workflow. */
export function updateIncidents(state: IncidentState): void {
  const runtime = state.demoIncidents;
  if (!runtime?.config.enabled) return;
  for (const schedule of runtime.config.schedule) {
    if (schedule.detectedAtS > state.tS + 1e-8) continue;
    let incident = runtime.incidents.find((i) => i.id === schedule.id);
    if (!incident) {
      const robot = state.robots.find((r) => r.id === schedule.robotId)!;
      const definition = DEFINITIONS[schedule.code];
      incident = { ...definition, id: schedule.id, code: schedule.code, robotId: schedule.robotId, status: "reported", active: true, simulation: true, workflow: "automatic-demo", position: { x: robot.x, y: robot.y }, x: robot.x, y: robot.y, detectedAtS: schedule.detectedAtS, ackAtS: null, diagnosingAtS: null, recoveryAtS: null, resolvedAtS: null, planned: { ...schedule }, observedAtS: state.tS, ageS: 0, instructions: [...definition.instructions], taskHandling: definition.haltsRobot ? "Текущее задание удерживается тем же роботом: без переназначения и завершения операций до разрешения инцидента." : "Задание продолжается; предупреждение само по себе не меняет числовой SOC и не вызывает ремонт.", positionSource: schedule.code === "LINK_LOST" ? "last-known-model-pose" : "model-at-detection" };
      runtime.incidents.push(incident);
    }
    for (const [status, key] of STAGES) if (schedule[key] <= state.tS + 1e-8 && !runtime.events.some((e) => e.id === `incident:${schedule.id}:${status}`)) {
      const from = status === "reported" ? undefined : incident.status;
      incident.status = status;
      if (key !== "detectedAtS") incident[key] = schedule[key];
      runtime.events.push({ id: `incident:${schedule.id}:${status}`, tS: schedule[key], observedAtS: state.tS, type: "incident", incidentId: schedule.id, robotId: schedule.robotId, code: schedule.code, from, to: status, simulation: true, workflow: "automatic-demo" });
    }
    incident.active = incident.status !== "resolved"; incident.ageS = Math.max(0, state.tS - incident.detectedAtS);
  }
  for (const robot of state.robots) {
    robot.incident = runtime.incidents.find((i) => i.robotId === robot.id && i.active && i.haltsRobot) ?? runtime.incidents.find((i) => i.robotId === robot.id && i.active) ?? null;
    robot.operationalState = robot.incident?.haltsRobot ? "incidentStop" : "operational";
  }
}

export function incidentHalts(state: IncidentState, robotId: number): boolean {
  return Boolean(state.demoIncidents?.incidents.some((i) => i.robotId === robotId && i.active && i.haltsRobot));
}
export function accrueIncidentTime(state: IncidentState, seconds: number): void {
  if (!state.demoIncidents) return;
  for (const r of state.robots) {
    if (incidentHalts(state, r.id)) state.demoIncidents.downtimeByRobotS[r.id]! += seconds;
    if (state.demoIncidents.incidents.some((i) => i.robotId === r.id && i.active && !i.haltsRobot)) state.demoIncidents.warningByRobotS[r.id]! += seconds;
  }
}
export function incidentSummary(state: IncidentState) {
  const runtime = state.demoIncidents;
  return { enabled: Boolean(runtime?.config.enabled), simulation: true as const, workflow: "automatic-demo" as const, detected: runtime?.incidents.length ?? 0, active: runtime?.incidents.filter((i) => i.active).length ?? 0, resolved: runtime?.incidents.filter((i) => !i.active).length ?? 0, stoppedRobotSeconds: runtime?.downtimeByRobotS.reduce((s, n) => s + n, 0) ?? 0, warningRobotSeconds: runtime?.warningByRobotS.reduce((s, n) => s + n, 0) ?? 0, downtimeByRobotS: [...(runtime?.downtimeByRobotS ?? [])] };
}
export function attachIncidentFrame<T extends { robots: { id: number; vMps?: number; working?: boolean }[]; events: { id: number | string; tS: number; observedAtS?: number; robotId: number; type: string }[] }>(frame: T, state: IncidentState): Omit<T, "robots" | "events"> & { incidents: DemoIncident[]; incidentSummary: ReturnType<typeof incidentSummary>; robots: (T["robots"][number] & { incident: DemoIncident | null; operationalState: string })[]; events: (T["events"][number] | IncidentEvent)[] } {
  const incidents = structuredClone(state.demoIncidents?.incidents ?? []);
  return { ...frame, incidents, incidentSummary: incidentSummary(state), robots: frame.robots.map((r) => {
    const incident = incidents.find((i) => i.robotId === r.id && i.active && i.haltsRobot) ?? incidents.find((i) => i.robotId === r.id && i.active) ?? null;
    return { ...r as T["robots"][number], incident, operationalState: incident?.haltsRobot ? "incidentStop" : "operational", ...(incident?.haltsRobot ? { vMps: 0, working: false } : {}) };
  }), events: [...frame.events as T["events"][number][], ...(state.demoIncidents?.events.map((e) => ({ ...e })) ?? [])].sort((a, b) => (a.observedAtS ?? a.tS) - (b.observedAtS ?? b.tS) || String(a.id).localeCompare(String(b.id))) };
}
