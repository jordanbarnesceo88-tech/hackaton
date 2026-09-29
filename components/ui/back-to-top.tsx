"use client";

import { useSyncExternalStore } from "react";
import { ArrowUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Плавающая кнопка «Наверх»: появляется, когда страница прокручена дальше трёх четвертей
 * экрана, и возвращает к её началу — на длинных шагах рабочей области (параметры, подбор,
 * экономика…) верхняя панель шагов и заголовок шага иначе далеко.
 *
 * Прокрутка читается через useSyncExternalStore, а не useState + эффект: снимок — булев флаг,
 * перерисовка только когда он меняется. Скрытая кнопка — `inert`: невидимую кнопку нельзя ни
 * нажать, ни выбрать Tab'ом.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}
const getSnapshot = () => window.scrollY > window.innerHeight * 0.75;
const getServerSnapshot = () => false;

export function BackToTop({ onTop }: { onTop?: () => void }) {
  const shown = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <button
      type="button"
      aria-label="Наверх"
      inert={!shown}
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        // Кнопка сейчас исчезнет — фокус переводит вызывающий (на заголовок шага), чтобы он не
        // упал на body.
        onTop?.();
      }}
      className={cn(
        buttonVariants({ variant: "outline", size: "icon-round-lg" }),
        // Над содержимым — поэтому сплошная заливка и тень, а не прозрачный контур.
        "no-print fixed right-4 bottom-4 z-40 bg-background shadow-panel sm:right-6 sm:bottom-6",
        "transition-[opacity,transform,border-color,color] duration-200 motion-reduce:transition-none",
        shown ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <ArrowUp aria-hidden={true} />
    </button>
  );
}
