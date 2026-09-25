"use client";

import { startTransition, useActionState } from "react";
import type { FormEvent } from "react";
import type { AdminFormState } from "@/lib/admin/actions";
import { cn } from "@/lib/utils";

/**
 * Общая механика форм админки. Действие вызывается из onSubmit внутри startTransition, а не
 * через <form action>: так React не сбрасывает поля после ответа, и при ошибке проверки
 * введённое администратором остаётся на месте. После успешного сохранения state.seq растёт —
 * формы ставят его ключом полей, и поля перемонтируются уже с сохранёнными значениями
 * (страница перерисована тем же ответом действия через revalidatePath).
 */

export const INITIAL_ADMIN_STATE: AdminFormState = { status: "idle", message: "", seq: 0 };

type AdminAction = (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;

export type AdminForm = {
  state: AdminFormState;
  pending: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
};

/**
 * Форма с серверным действием администратора. `confirmText` — вопрос перед необратимым
 * действием (удаление, возврат данных организатора): «Отмена» ничего не отправляет.
 */
export function useAdminForm(action: AdminAction, confirmText?: string): AdminForm {
  const [state, dispatch, pending] = useActionState(action, INITIAL_ADMIN_STATE);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (confirmText !== undefined && !window.confirm(confirmText)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }
  return { state, pending, onSubmit };
}

/**
 * Итог действия под формой: успех — вежливое объявление (role=status), ошибка — alert с
 * подсказкой, как исправить. Пока действие выполняется — «Сохраняю…».
 */
export function FormStatus({
  state,
  pending,
  pendingText = "Сохраняю…",
  className,
}: {
  state: AdminFormState;
  pending: boolean;
  pendingText?: string;
  className?: string;
}) {
  if (pending) {
    return (
      <p role="status" aria-live="polite" className={cn("text-xs text-muted-foreground", className)}>
        {pendingText}
      </p>
    );
  }
  if (state.status === "idle" || state.message === "") {
    return <p role="status" aria-live="polite" className="sr-only" />;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className={cn("text-xs text-destructive", className)}>
        {state.message}
      </p>
    );
  }
  return (
    <p role="status" aria-live="polite" className={cn("text-xs text-positive", className)}>
      {state.message}
    </p>
  );
}
