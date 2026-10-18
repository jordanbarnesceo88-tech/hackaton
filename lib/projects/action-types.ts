import type { ParamIssue, ParamValues, PendingChange, ProjectResults, ScenarioSpec } from "../tz/types";

/** Состояние формы «Новый проект» (useActionState). */
export type CreateProjectState = { error: string | null; issues?: ParamIssue[] };

/** Причина отказа действия с проектом. */
export type ProjectActionReason = "unauthenticated" | "not_found" | "invalid" | "error" | "conflict" | "precondition_required";

/** Отказ действия: причина и сообщение по-русски — что не так и как исправить. */
export type ProjectActionFailure = { ok: false; reason: ProjectActionReason; message: string };

/** Результат сохранения или пересчёта проекта. */
export type SaveProjectResult = { ok: true; calculatedAt: string; dataVersion: string; revision: number; results: ProjectResults } | ProjectActionFailure;

/** Что присылает рабочая область при сохранении. */
export type SaveProjectInput = {
  expectedRevision?: number;
  name?: string;
  params: ParamValues;
  scenarios: ScenarioSpec[];
  changes: PendingChange[];
};
