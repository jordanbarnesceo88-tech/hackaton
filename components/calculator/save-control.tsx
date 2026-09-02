"use client";

import { useState } from "react";
import Link from "next/link";
import { saveAnalysisAction } from "@/lib/analyses/actions";
import type {
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "@/lib/economics/types";

export function SaveControl({
  facilitySlug,
  solutionId,
  params,
  assumptions,
  result,
}: {
  facilitySlug: string;
  solutionId: string;
  params: FacilityParams;
  assumptions: AssumptionValues;
  result: EconomicsResult;
}) {
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  // Which inputs the last message described. Derived rather than reset in an effect: the
  // message is only true of the numbers it was produced for, so compare instead of clearing.
  const [msgFor, setMsgFor] = useState<string | null>(null);

  const snapshot = JSON.stringify({ params, assumptions, solutionId });
  // «Сохранено» describes a specific set of numbers. Once anything is edited it is no longer
  // true of what is on screen, and leaving it up invites a second save in the belief the first
  // already covered the new figures. The report link stays — that analysis really was saved.
  const currentMsg = msgFor === snapshot ? saveMsg : null;

  async function handleSave() {
    if (saving) return; // guard against double-submit while a save is in flight
    setSaving(true);
    setSaveMsg(null);
    // Fall back to a dated default when the user leaves the name blank.
    const trimmed = name.trim();
    const finalName = trimmed || `Расчёт — ${new Date().toLocaleDateString("ru-RU")}`;
    try {
      const res = await saveAnalysisAction({
        name: finalName,
        facilityTypeSlug: facilitySlug,
        solutionId,
        params,
        assumptions,
        results: result,
      });
      setMsgFor(snapshot);
      if (res.ok) {
        setSavedId(res.id);
        setSaveMsg("Сохранено");
      } else if (res.reason === "unauthenticated") setSaveMsg("unauth");
      else setSaveMsg("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="md:col-span-2 flex flex-wrap items-center gap-3">
      <label htmlFor="analysis-name" className="sr-only">
        Название расчёта (необязательно)
      </label>
      <input
        id="analysis-name"
        type="text"
        value={name}
        maxLength={120}
        placeholder="Название расчёта (необязательно)"
        onChange={(e) => setName(e.target.value)}
        className="min-w-56 flex-1 rounded-md border px-3 py-2 text-sm"
      />
      <button onClick={handleSave} disabled={saving}
        className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50">
        {saving ? "Сохранение…" : "Сохранить расчёт"}
      </button>
      {/* SC 4.1.3 Status Messages: the outcome appears without a navigation or focus change,
          so without a live region a screen-reader user gets no indication the save happened.
          role="status" is polite — it waits for a pause rather than interrupting. The wrapper
          is always rendered so the region exists in the tree before the text arrives; injecting
          an aria-live node and its content in the same tick is unreliably announced. */}
      <span role="status" aria-live="polite" className="text-sm">
        {currentMsg === "unauth" ? (
          <>
            <Link href="/login" className="underline">Войдите</Link>, чтобы сохранить расчёт
          </>
        ) : currentMsg ? (
          <span className="text-muted-foreground">{currentMsg}</span>
        ) : null}
      </span>
      {savedId && (
        <a href={`/report/${savedId}`} className="text-sm underline">
          Открыть отчёт
        </a>
      )}
    </div>
  );
}
