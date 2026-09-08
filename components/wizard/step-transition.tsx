"use client";

import { ViewTransition, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getSnapshot = () => window.matchMedia(QUERY).matches;

/**
 * Переход между шагами подбора.
 *
 * Направленный сдвиг (вперёд влево, назад вправо) НЕ сделан намеренно. Надёжно определить
 * направление можно только перехватив каждую навигацию — включая браузерную кнопку «Назад», —
 * а сдвиг не в ту сторону читается хуже, чем его отсутствие: он сообщает, что вы пошли назад,
 * когда вы пошли вперёд. Вместо этого — общий для обоих направлений подъём с растворением.
 *
 * При prefers-reduced-motion анимация не запускается вовсе, а не проигрывается незаметно:
 * приём тот же, что уже используется в визуализации, потому что медиазапрос из CSS не может
 * отменить переход, которым управляет React.
 */
export function StepTransition({ children }: { children: React.ReactNode }) {
  // Серверный снимок — false: на сервере медиазапроса нет, и разметка не должна расходиться
  // с той, которую гидратирует клиент.
  const reduced = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (reduced) return <>{children}</>;
  return <ViewTransition default="wizard-step">{children}</ViewTransition>;
}
