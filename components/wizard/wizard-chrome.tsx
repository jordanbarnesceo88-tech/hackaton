"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { WIZARD_STEPS, type WizardStepKey } from "@/lib/wizard/steps";

function stepFromPath(pathname: string): WizardStepKey | null {
  if (pathname === "/onboarding") return "industry";
  if (pathname.startsWith("/onboarding/facility")) return "facility";
  if (pathname.startsWith("/onboarding/params")) return "params";
  if (pathname.startsWith("/compare/")) return "solutions";
  if (pathname.startsWith("/calculate/")) return "calc";
  return null;
}

/**
 * Прогресс и «Назад» над шагами подбора.
 *
 * Показывается ТОЛЬКО когда человек действительно идёт по подбору. Пришли из «Мои расчёты»
 * прямо на /calculate/… — оболочки нет: вы открыли сохранённый расчёт, а не проходите опрос,
 * и полоса «шаг 5 из 5» в этом случае врёт о том, где вы находитесь.
 *
 * Признак — наличие состояния подбора в query-строке. Первый шаг это признак не проходит и
 * учтён отдельно: с него подбор начинается, и там ещё нечему накопиться.
 */
export function WizardChrome() {
  const pathname = usePathname();
  const search = useSearchParams();
  const step = stepFromPath(pathname);
  if (!step) return null;

  const inWizard = step === "industry" || search.has("industry") || search.has("facility");
  if (!inWizard) return null;

  const index = WIZARD_STEPS.findIndex((s) => s.key === step);
  const previous = index > 0 ? WIZARD_STEPS[index - 1] : null;
  // Ветка для `solutions` отсутствовала, поэтому на шаге расчёта «Назад» превращалась в
  // серую надпись: прогресс говорил «Шаг 5 из 5», а вернуться к списку решений было нельзя
  // ничем, кроме кнопки браузера. Мёртвая ссылка хуже отсутствующей — она обещает.
  //
  // Query-строка передаётся целиком там, где это осмысленно: на шаг типа объекта уходит
  // только отрасль, но вместе с названием объекта — оно введено человеком, и терять его при
  // возврате значит терять ввод.
  const facilityHref = () => {
    const q = new URLSearchParams();
    const industry = search.get("industry");
    const obj = search.get("obj");
    if (industry) q.set("industry", industry);
    if (obj) q.set("obj", obj);
    return `/onboarding/facility?${q.toString()}`;
  };

  const backHref =
    previous?.key === "industry"
      ? "/onboarding"
      : previous?.key === "facility"
        ? facilityHref()
        : previous?.key === "params"
          ? `/onboarding/params?${search.toString()}`
          : previous?.key === "solutions"
            ? `/compare/${search.get("facility") ?? ""}?${search.toString()}`
            : null;

  return (
    <div className="border-b bg-card">
      <div className="surface-data flex items-center gap-4 py-3">
        {backHref ? (
          <Link
            href={backHref}
            className="rounded px-2 py-1 text-sm text-muted-foreground transition-colors
              hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            ← Назад
          </Link>
        ) : (
          <span className="px-2 py-1 text-sm text-muted-foreground/50">← Назад</span>
        )}

        <div className="flex flex-1 items-center gap-3">
          {/* Полоса и подпись говорят одно и то же двумя способами: полосу видно боковым
              зрением, подпись читает скринридер. Полоса от него скрыта, чтобы не дублировать. */}
          <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${((index + 1) / WIZARD_STEPS.length) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
            Шаг {index + 1} из {WIZARD_STEPS.length} · {WIZARD_STEPS[index]!.title}
          </span>
        </div>
      </div>
    </div>
  );
}
