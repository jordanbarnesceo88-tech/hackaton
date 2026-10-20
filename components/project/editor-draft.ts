import { stableJson } from "@/lib/tz/version";

/** Unapplied form values live only in the current workspace, never in the project snapshot. */
export type EditorFormDraft = Record<string, string | boolean>;
export type EditorDraftBindings = {
  draft?: EditorFormDraft;
  onDraftChange?: (draft: EditorFormDraft | null) => void;
};
export type EditorDraftSection = "cleaningProfile" | "costPackage" | "raasPackage";
export type BindEditorDraft = (
  process: string, productSlug: string, section: EditorDraftSection, accepted: unknown,
) => EditorDraftBindings;

export function editorDraftIdentity(
  projectId: string | undefined, facility: string, scenario: string,
  process: string, productSlug: string, section: EditorDraftSection, accepted: unknown,
): string {
  return stableJson([projectId ?? "guest", facility, scenario, process, productSlug, section, accepted ?? null]);
}

/** Scenario keys may be reused after deletion; remove all sections and accepted versions. */
export function withoutScenarioEditorDrafts(
  drafts: Record<string, EditorFormDraft>, projectId: string | undefined, facility: string, scenario: string,
): Record<string, EditorFormDraft> {
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => {
    const [owner, kind, scenarioKey] = JSON.parse(key) as [string, string, string];
    return owner !== (projectId ?? "guest") || kind !== facility || scenarioKey !== scenario;
  }));
}

export function readEditorFormDraft(form: HTMLFormElement): EditorFormDraft {
  return editorDraftFromData(new FormData(form), form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]'));
}

export function editorDraftFromData(data: FormData, checkboxes: Iterable<{ name: string; checked: boolean }>): EditorFormDraft {
  const draft: EditorFormDraft = {};
  for (const [key, value] of data.entries()) draft[key] = String(value);
  // FormData omits unchecked checkboxes; false must override a previously accepted true.
  for (const input of checkboxes) {
    draft[input.name] = input.checked;
  }
  return draft;
}

export function draftText(draft: EditorFormDraft | undefined, key: string, fallback: string | number): string {
  return typeof draft?.[key] === "string" ? draft[key] : String(fallback);
}

export function draftChecked(draft: EditorFormDraft | undefined, key: string, fallback: boolean): boolean {
  return typeof draft?.[key] === "boolean" ? draft[key] : fallback;
}
