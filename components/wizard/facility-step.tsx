"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChoiceTiles } from "./choice-tiles";
import { StepShell } from "./step-shell";
import { buildWizardQuery } from "@/lib/wizard/steps";

export function FacilityStep({
  industry,
  facilityTypes,
  initial,
  initialObjectName,
}: {
  industry: string;
  facilityTypes: { slug: string; name: string; isGeneric: boolean }[];
  initial: string | null;
  initialObjectName: string | null;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState<string | null>(initial);
  // Из URL, а не пустая строка: человек ввёл название, ушёл вперёд, вернулся — и оно должно
  // быть на месте. Вместе с исправлением backHref в WizardChrome, который его выбрасывал.
  const [objectName, setObjectName] = useState(initialObjectName ?? "");
  const selected = facilityTypes.find((f) => f.slug === slug) ?? null;

  const next = slug
    ? `/onboarding/params?${buildWizardQuery({
        industry,
        facility: slug,
        // Свободное название несёт смысл только на обобщённом пути: там объект нечем назвать,
        // кроме как словами пользователя, и дальше оно эхом возвращается в расчёте.
        objectName: selected?.isGeneric ? objectName.trim() : null,
      })}`
    : null;

  useEffect(() => {
    if (!next) return;
    const onKey = (e: KeyboardEvent) => {
      // Слушатель висит на window, поэтому Enter на сфокусированной ссылке или кнопке
      // срабатывал ДВАЖДЫ: элемент делал свою навигацию, а этот обработчик — свою вперёд.
      // Нажатие на «← Назад» уводило одновременно назад и вперёд.
      const t = e.target as HTMLElement | null;
      if (t?.closest("a,button,[role=radio],select,textarea")) return;
      // Текстовое поле названия объекта: Enter в нём не должен уводить со страницы.
      if (t?.tagName === "INPUT" && t.getAttribute("type") === "text") return;
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) router.push(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, router]);

  return (
    <StepShell question="Какой это объект?" nextHref={next}>
      <ChoiceTiles
        label="Тип объекта"
        items={facilityTypes.map((f) => ({ value: f.slug, label: f.name }))}
        value={slug}
        onChange={setSlug}
      />
      {selected?.isGeneric && (
        <label className="flex flex-col gap-2">
          <span className="font-medium">Как называется объект? (необязательно)</span>
          <input
            type="text"
            value={objectName}
            maxLength={80}
            placeholder="Например: распределительный центр «Восток»"
            onChange={(e) => setObjectName(e.target.value)}
            className="w-full border-0 border-b-2 border-input bg-transparent px-1 py-2 text-base
              outline-none transition-colors hover:border-muted-foreground
              focus-visible:border-primary"
          />
          <span className="text-sm text-muted-foreground">
            Название вернётся в расчёте и в отчёте.
          </span>
        </label>
      )}
    </StepShell>
  );
}
