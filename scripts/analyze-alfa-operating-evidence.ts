import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CleaningReportObservation } from "../lib/catalog/operating-evidence-readiness";
import { parseOperatingEvidence, type OperatingEvidence } from "../lib/catalog/operating-evidence";

type ObjectRow = Record<string, unknown>;
const object = (value: unknown): ObjectRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid export object");
  return value as ObjectRow;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid export list");
  return value;
};
function number(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new Error("Invalid export measure");
  return value;
}
function summary(report: unknown) {
  const monthly = object(object(report).monthly), values = object(monthly.summary);
  const result = { area: number(values.area), hours: number(values.duration), tasks: number(values.task_count, true) };
  const days = array(monthly.chart).map(row => object(row));
  for (const [field, expected] of [["area", result.area], ["duration", result.hours], ["task_count", result.tasks]] as const) {
    const sum = days.reduce((total, row) => total + number(row[field], field === "task_count"), 0);
    if (Math.abs(sum - expected) > Math.max(1e-6, expected * 1e-9)) throw new Error("Report summary and daily rows disagree");
  }
  return { ...result, days: days.filter(row => number(row.task_count, true) > 0).length };
}

/** Raw identities stay in memory: the return value has a fixed aggregate-only field allowlist. */
export function analyzeAlfaReports(input: {
  vendor: CleaningReportObservation["vendor"]; from: string; through: string; mode: 0 | 1 | 2;
  family: unknown; robots: unknown; sourceFiles: CleaningReportObservation["sourceFiles"];
}): CleaningReportObservation {
  for (const date of [input.from, input.through]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Invalid export period");
  if (input.through < input.from || (input.vendor !== "pudu" && input.mode !== 0)) throw new Error("Invalid export mode or period");
  const family = summary(input.family);
  const identities = new Set<string>();
  const robots = array(input.robots).map(raw => {
    const sn = object(object(raw).robot).sn;
    if (typeof sn !== "string" || !sn.trim() || identities.has(sn)) throw new Error("Missing or duplicate robot identity");
    identities.add(sn);
    const records = array(object(raw).records).map(object).filter(record => record.mode === input.mode);
    if (records.length !== 1) throw new Error("Missing or duplicate robot-mode record");
    const days = array(object(object(records[0]!.data).monthly).chart).map(object);
    if (days.some(row => typeof row.task_time !== "string" || row.task_time < input.from || row.task_time > input.through)) throw new Error("Robot day is outside export period");
    return summary(records[0]!.data);
  });
  for (const key of ["area", "hours", "tasks"] as const) {
    const sum = robots.reduce((total, row) => total + row[key], 0);
    if (Math.abs(sum - family[key]) > Math.max(1e-6, family[key] * 1e-9)) throw new Error("Family and robot summaries disagree");
  }
  return {
    vendor: input.vendor, productSlug: null, from: input.from, through: input.through,
    mode: input.mode === 1 ? "scrubbing" : input.mode === 2 ? "sweeping" : "all", basis: "reported-task-hour",
    robotsSelected: robots.length, robotsWithTasks: robots.filter(row => row.tasks > 0).length,
    zeroOutputRobotsWithTasks: robots.filter(row => row.tasks > 0 && row.area === 0).length,
    tasks: family.tasks, reportedAreaM2: family.area, recordedTaskHours: family.hours,
    m2PerRecordedTaskHour: family.hours > 0 ? family.area / family.hours : null,
    recordedRobotDays: robots.reduce((total, row) => total + row.days, 0),
    sourceFiles: input.sourceFiles.map(({ file, sha256 }) => {
      if (basename(file) !== file || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid aggregate provenance");
      return { file, sha256 };
    }),
  };
}

export function cleaningModelFromTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  if (/\bPUDU\b/i.test(title) && /\bCC1\b(?!\s*(?:PRO|S)\b)/i.test(title)) return "pudu-cc1";
  if (/\bAGIBOT\b/i.test(title) && /\bC5\b/i.test(title)) return "agibot-c5";
  if (/\bVIGGO\b/i.test(title) && /\bSC80\b(?!\s*(?:PRO|S)\b)/i.test(title) && !/(?:АК|AK)[-\s]*SC80/i.test(title)) return "viggo-sc80";
  return null;
}

type ModelSource = { raw: unknown; source: CleaningReportObservation["sourceFiles"][number] };

export function analyzePuduTimeSemantics(raw: unknown): NonNullable<CleaningReportObservation["timeBasisCheck"]> {
  const rows = array(object(object(raw).data).list).map(object);
  if (!rows.length) throw new Error("Empty Pudu task sample");
  const times = rows.map(row => {
    const cleaning = number(row.clean_time), elapsed = number(row.end_time) - number(row.start_time);
    if (elapsed < 0) throw new Error("Invalid Pudu task interval");
    return { cleaning, elapsed, gap: elapsed - cleaning };
  });
  return { sampledRecords: rows.length, shorterThanElapsed: times.filter(row => row.gap > 0).length,
    equalToElapsed: times.filter(row => row.gap === 0).length, greaterThanElapsed: times.filter(row => row.gap < 0).length,
    gapMinSeconds: Math.min(...times.map(row => row.gap)), gapMaxSeconds: Math.max(...times.map(row => row.gap)),
    sampleCleaningSeconds: times.reduce((sum, row) => sum + row.cleaning, 0), sampleElapsedSeconds: times.reduce((sum, row) => sum + row.elapsed, 0) };
}

export function puduOperatingEvidenceDraft(raw: unknown, metadata: unknown, sourceRef: string): OperatingEvidence {
  const rows = array(object(object(raw).data).list).map(object), titles = array(object(metadata).robots).map(object);
  analyzePuduTimeSemantics(raw);
  if (new Set(rows.map(row => row.sn)).size !== 1 || rows.some(row => row.mode !== 1 || !titles.some(title => title.sn === row.sn && cleaningModelFromTitle(title.title) === "pudu-cc1"))) throw new Error("Pudu draft requires one mapped CC1 and scrubbing mode");
  const total = (fn: (row: ObjectRow) => number) => rows.reduce((sum, row) => sum + fn(row), 0);
  const measuredAt = new Date((Math.max(...rows.map(row => number(row.start_time))) + 3 * 3600) * 1000).toISOString().slice(0, 10);
  return parseOperatingEvidence({ schemaVersion: "operating-evidence-1", productSlug: "pudu-cc1", process: "cleaning", facility: "warehouse", mode: "scrubbing", unit: "м²/ч",
    site: "Обезличенная выборка одного CC1; тип исходного участка не установлен", measuredAt, verifiedAt: "2026-10-20", measuredBy: "Система отчётов Alfa Robots; статистический черновик без подтверждённого акта", samples: rows.length,
    output: total(row => number(row.clean_area)), operatingMinutes: total(row => number(row.clean_time)) / 60,
    elapsedMinutes: total(row => number(row.end_time) - number(row.start_time)) / 60, basis: "operating-hour", confirmed: false,
    sourceRef: `${sourceRef}. clean_time — сообщённое время уборки; паузы/зарядка не классифицированы. warehouse — целевой тип сопоставления, не установленный тип исходного объекта. Площадь сообщённая, качество не оценено; status не отфильтрован.` });
}

export function analyzeAlfaExportDirectory(directory: string, modelMetadata?: ModelSource, agibotDevices?: ModelSource): CleaningReportObservation[] {
  const manifest = object(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")));
  const period = object(manifest.window), artifacts = array(manifest.artifacts).map(object);
  const read = (file: string) => {
    const bytes = readFileSync(join(directory, file)), sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!artifacts.some(row => row.file === file && row.sha256 === sha256)) throw new Error("Export artifact does not match its manifest");
    return { raw: JSON.parse(bytes.toString("utf8")), source: { file, sha256 } };
  };
  const observations: CleaningReportObservation[] = [];
  for (const vendor of ["pudu", "agibot", "viggo"] as const) {
    const robots = read(`${vendor}-robots-daily.json`);
    for (const mode of vendor === "pudu" ? [0, 1, 2] as const : [0] as const) {
      const family = read(mode === 0 ? `${vendor}-family.json` : `${vendor}-mode-${mode}.json`);
      const input = { vendor, from: String(period.firstDay), through: String(period.lastDay), mode,
        family: family.raw, robots: robots.raw, sourceFiles: [family.source, robots.source] };
      const checked = analyzeAlfaReports(input);
      if (!modelMetadata) { observations.push(checked); continue; }
      const titles = array(object(modelMetadata.raw).robots).map(object);
      const groups = new Map<string | null, unknown[]>();
      for (const raw of array(robots.raw)) {
        const sn = object(object(raw).robot).sn;
        const models = new Set(titles.filter(row => row.sn === sn).map(row => cleaningModelFromTitle(row.title)));
        let model = models.size === 1 ? [...models][0]! : null;
        if (vendor === "agibot" && agibotDevices) {
          const devices = array(object(object(agibotDevices.raw).data).list).map(object).filter(row => row.sn === sn);
          const deviceModels = new Set(devices.map(row => row.productModel));
          if (deviceModels.size === 1 && deviceModels.has("C5")) model = "agibot-c5";
          else if (devices.length > 0) model = null;
        }
        if (model && !model.startsWith(`${vendor}-`)) model = null;
        const group = groups.get(model) ?? [];
        group.push(raw); groups.set(model, group);
      }
      for (const [productSlug, rows] of groups) {
        const charts = rows.flatMap(raw => {
          const record = array(object(raw).records).map(object).find(row => row.mode === mode)!;
          return array(object(object(record.data).monthly).chart).map(object);
        });
        const measure = (key: string) => charts.reduce((sum, row) => sum + number(row[key], key === "task_count"), 0);
        const groupFamily = { monthly: { summary: { area: measure("area"), duration: measure("duration"), task_count: measure("task_count") }, chart: charts } };
        const grouped = analyzeAlfaReports({ ...input, family: groupFamily, robots: rows, sourceFiles: [...input.sourceFiles, modelMetadata.source, ...(vendor === "agibot" && agibotDevices ? [agibotDevices.source] : [])] });
        observations.push({ ...grouped, productSlug });
      }
    }
  }
  return observations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, output, metadataPath, agibotDevicesPath, puduTasksPath] = process.argv.slice(2);
  if (!root || !output) throw new Error("Usage: tsx scripts/analyze-alfa-operating-evidence.ts <export-root> <aggregate-output.json> [private-model-metadata.json] [private-agibot-devices.json] [private-pudu-tasks.json]");
  const metadataBytes = metadataPath ? readFileSync(metadataPath) : undefined;
  const metadata = metadataBytes ? { raw: JSON.parse(metadataBytes.toString("utf8")), source: { file: basename(metadataPath!), sha256: createHash("sha256").update(metadataBytes).digest("hex") } } : undefined;
  const deviceBytes = agibotDevicesPath ? readFileSync(agibotDevicesPath) : undefined;
  const devices = deviceBytes ? { raw: JSON.parse(deviceBytes.toString("utf8")), source: { file: basename(agibotDevicesPath!), sha256: createHash("sha256").update(deviceBytes).digest("hex") } } : undefined;
  const observations = ["20260801-20260831", "20260901-20260930", "20260920-20261019"].flatMap(period => analyzeAlfaExportDirectory(join(root, `exports-${period}`), metadata, devices));
  if (puduTasksPath) {
    const bytes = readFileSync(puduTasksPath);
    const row = observations.find(row => row.productSlug === "pudu-cc1" && row.from === "2026-09-20" && row.mode === "scrubbing");
    if (!row) throw new Error("Pudu task sample has no mapped report context");
    row.timeBasisCheck = analyzePuduTimeSemantics(JSON.parse(bytes.toString("utf8")));
    const source = { file: basename(puduTasksPath), sha256: createHash("sha256").update(bytes).digest("hex") };
    row.sourceFiles.push(source);
    if (metadata) {
      const draft = puduOperatingEvidenceDraft(JSON.parse(bytes.toString("utf8")), metadata.raw, `${source.file} SHA-256 ${source.sha256}; модель: ${metadata.source.file} SHA-256 ${metadata.source.sha256}`);
      writeFileSync(join(resolve(output, ".."), "alfa-cc1-operating-evidence-draft.generated.json"), JSON.stringify(draft, null, 2) + "\n");
    }
  }
  writeFileSync(output, JSON.stringify(observations, null, 2) + "\n");
  console.log(JSON.stringify({ status: "AGGREGATED_NOT_CALIBRATION", periods: 3, observations: observations.length }));
}
