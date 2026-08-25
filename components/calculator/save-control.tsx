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
  const [name, setName] = useState("");

  async function handleSave() {
    setSaveMsg(null);
    // Fall back to a dated default when the user leaves the name blank.
    const trimmed = name.trim();
    const finalName = trimmed || `Расчёт — ${new Date().toLocaleDateString("ru-RU")}`;
    const res = await saveAnalysisAction({
      name: finalName,
      facilityTypeSlug: facilitySlug,
      solutionId,
      params,
      assumptions,
      results: result,
    });
    if (res.ok) setSaveMsg("Сохранено");
    else if (res.reason === "unauthenticated") setSaveMsg("unauth");
    else setSaveMsg("Ошибка сохранения");
  }

  return (
    <div className="md:col-span-2 flex flex-wrap items-center gap-3">
      <input
        type="text"
        value={name}
        maxLength={120}
        placeholder="Название расчёта (необязательно)"
        onChange={(e) => setName(e.target.value)}
        className="min-w-56 flex-1 rounded-md border px-3 py-2 text-sm"
      />
      <button onClick={handleSave}
        className="rounded-md border px-3 py-2 text-sm font-medium">
        Сохранить расчёт
      </button>
      {saveMsg === "unauth" ? (
        <span className="text-sm">
          <Link href="/login" className="underline">Войдите</Link>, чтобы сохранить расчёт
        </span>
      ) : saveMsg ? (
        <span className="text-sm text-muted-foreground">{saveMsg}</span>
      ) : null}
    </div>
  );
}
