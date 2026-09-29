"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Модальное окно — первое в приложении (docs/design/PROTOTYPE-DESIGN-SYSTEM.md §4.9: до этого
 * ни одного модала не было ни в одном компоненте). Анатомия — BCB: сильная граница,
 * rounded-panel (16px), shadow-pop, поверхность --popover — она выше страницы, а не утоплена
 * в неё, как --card.
 *
 * Скрим — тёмная заливка --scrim, а не тон самой страницы: вокруг окна должно быть темнее,
 * чем в окне, в обеих темах (значения проверены на настоящем фоне — см. --scrim в
 * globals.css). Лёгкое размытие остаётся: оно говорит «фон сейчас неактивен».
 *
 * Состав: DialogHeader (заголовок + «Закрыть» в одном ряду), содержимое, DialogFooter.
 * Кнопка «Закрыть» стоит в потоке заголовка, а не поверх окна (absolute): поверх она ложилась
 * на угол картинки шага в туре.
 *
 * @base-ui/react/dialog, тот же примитив, что уже даёт кнопку/радио в этом репозитории
 * (components/ui/button.tsx, components/ui/radio-group.tsx) — не третья библиотека.
 */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />;
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-scrim backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
      <DialogPrimitive.Popup
        className={cn(
          // max-h + overflow: на телефоне в альбомной ориентации окно выше экрана, и без
          // прокрутки его нижние кнопки оказывались за краем.
          "shadow-pop fixed top-1/2 left-1/2 z-[100] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          "rounded-panel border-2 border-border bg-popover p-6 text-popover-foreground",
          "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
          "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          // Entrance gets a touch of overshoot (a "pop", not a linear ease) and takes longer
          // than the exit — exit-faster-than-enter is standard motion-design practice: leaving
          // should never feel like it's making the user wait. motion-reduce kills the whole
          // transition, not just the transform, since scale+opacity together read as more
          // motion than the button lift above.
          "transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          "data-[ending-style]:duration-100 data-[ending-style]:ease-in",
          "motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/**
 * Верхний ряд окна: заголовок (и что к нему относится) слева, «Закрыть» справа. Отрицательные
 * поля у кнопки — оптическое выравнивание: сам крестик встаёт по краю содержимого и по центру
 * первой строки заголовка, а 28-пиксельная зона нажатия уходит в поле окна.
 */
function DialogHeader({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<"div"> & { showClose?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
      {showClose && (
        <DialogPrimitive.Close
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-mt-1 -mr-1.5 text-muted-foreground")}
        >
          <X aria-hidden={true} />
          <span className="sr-only">Закрыть</span>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

/** Нижний ряд окна: второстепенное действие слева, основные — справа (`ml-auto` у группы). */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("panel-label", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
