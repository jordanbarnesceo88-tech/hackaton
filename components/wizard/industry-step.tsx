"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChoiceTiles } from "./choice-tiles";
import { StepShell } from "./step-shell";
import { buildWizardQuery } from "@/lib/wizard/steps";

export function IndustryStep({
  industries,
  initial,
}: {
  industries: { slug: string; name: string; count: number }[];
  initial: string | null;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState<string | null>(initial);
  const next = slug ? `/onboarding/facility?${buildWizardQuery({ industry: slug })}` : null;

  // Enter продвигает вперёд — это обещание, напечатанное под кнопкой, и оно должно работать.
  useEffect(() => {
    if (!next) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) router.push(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, router]);

  return (
    <StepShell question="В какой отрасли ваш объект?" nextHref={next}>
      <ChoiceTiles
        label="Отрасль"
        items={industries.map((i) => ({
          value: i.slug,
          label: i.name,
          hint: `${i.count} ${i.count === 1 ? "тип объекта" : i.count < 5 ? "типа объектов" : "типов объектов"}`,
        }))}
        value={slug}
        onChange={setSlug}
      />
    </StepShell>
  );
}
