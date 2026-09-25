import { useSyncExternalStore } from "react";

/**
 * Предпочтение «уменьшить движение» из настроек системы.
 *
 * Медиазапрос — внешнее хранилище, и у сервера его снимка нет. Поэтому `useSyncExternalStore`
 * с явным серверным снимком `false`: разметка сервера и первая отрисовка клиента совпадают, а
 * если пользователь поменяет настройку при открытой странице, хук это увидит. CSS-медиазапрос до
 * цикла requestAnimationFrame не дотягивается, так что читать его приходится из JS.
 *
 * Шаблон перенесён из components/facility-visualization.tsx (строки 19–27, 62–66) копией, а не
 * импортом: тот файл заморожен вместе с моделью v1.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/** true, если пользователь просит уменьшить движение (prefers-reduced-motion: reduce). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
