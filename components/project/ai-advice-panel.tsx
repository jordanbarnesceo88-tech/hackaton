"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AdviceView } from "@/lib/ai/advice/view";
import { AiAdviceContent } from "./ai-advice-content";

/**
 * Кнопка и блок «Рекомендации ИИ» под выводом проекта. Рекомендации готовятся по кнопке: ответ
 * модели занимает 15–40 с, поэтому есть отдельное состояние ожидания. Актуальный ответ кнопку не
 * показывает (тот же расчёт — тот же ответ из хранилища); устаревший — «Обновить».
 *
 * calculationKey меняется вместе с расчётом на экране: прежний ответ тогда помечается
 * устаревшим, а незавершённый запрос отменяется — его ответ был бы уже не к этому расчёту.
 */

export type AiAdvicePanelProps = {
  /** Маршрут рекомендаций: проекта или гостевого демо. */
  endpoint: string;
  /** Сохранённый ответ (у проекта). */
  initial?: AdviceView | null;
  /** Тело запроса; у проекта его нет — факты сервер берёт из сохранённого расчёта. */
  body?: () => unknown;
  /** Можно ли спрашивать сейчас; если нет — почему (reason). */
  ready: boolean;
  reason?: string;
  calculationKey: string | number;
};

export function AiAdvicePanel({ endpoint, initial = null, body, ready, reason, calculationKey }: AiAdvicePanelProps) {
  const [advice, setAdvice] = useState<AdviceView | null>(initial);
  const [state, setState] = useState<{ kind: "idle" | "loading" } | { kind: "error"; message: string }>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const firstKey = useRef(calculationKey);

  useEffect(() => {
    if (calculationKey === firstKey.current) return;
    firstKey.current = calculationKey;
    controller.current?.abort();
    setAdvice((a) => (a && !a.stale ? { ...a, stale: true } : a));
    setState({ kind: "idle" });
  }, [calculationKey]);

  useEffect(() => () => controller.current?.abort(), []);

  async function generate() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ kind: "loading" });
    try {
      const payload = body?.();
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? "{}" : JSON.stringify(payload),
        signal: current.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      if (current.signal.aborted) return;
      const view = (data as { advice?: AdviceView } | null)?.advice;
      if (!response.ok || !view) {
        const error = (data as { error?: unknown } | null)?.error;
        setState({ kind: "error", message: typeof error === "string" ? error : "Не удалось подготовить рекомендации. Повторите попытку." });
        return;
      }
      setAdvice(view);
      setState({ kind: "idle" });
    } catch {
      if (current.signal.aborted) return;
      setState({ kind: "error", message: "Нет связи с сервером. Проверьте подключение и повторите." });
    }
  }

  const loading = state.kind === "loading";
  const showButton = !advice || advice.stale;
  return (
    <section aria-label="Рекомендации ИИ" className="flex flex-col gap-3" data-ai-advice-panel={state.kind}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Рекомендации ИИ</h3>
        {showButton && (
          <Button type="button" size="sm" variant={advice ? "outline" : "default"} disabled={!ready || loading} onClick={() => void generate()}>
            {loading ? "Готовим…" : advice ? "Обновить рекомендации" : "Получить рекомендации"}
          </Button>
        )}
      </div>
      {!advice && !loading && state.kind !== "error" && (
        <p className="text-sm text-muted-foreground">
          {ready
            ? "ИИ разберёт результат расчёта: что сделать, главные риски и как их снизить, что проверить на пилоте. Числа — только из расчёта."
            : reason}
        </p>
      )}
      {advice?.stale && !ready && reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      {loading && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2 text-sm">
          <span>Готовим рекомендации по расчёту — обычно 15–40 секунд.</span>
          <span className="block h-1 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
            <span className="block h-full w-1/3 animate-pulse rounded bg-primary" />
          </span>
        </div>
      )}
      {state.kind === "error" && (
        <p role="alert" data-tone="warn" className="callout callout--sm">
          {state.message}
        </p>
      )}
      {advice && <AiAdviceContent advice={advice} />}
    </section>
  );
}
